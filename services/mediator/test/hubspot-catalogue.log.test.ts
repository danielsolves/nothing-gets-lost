// services/mediator/test/hubspot-catalogue.log.test.ts
// Which sku became which HubSpot product, pinned against a real database because its
// whole job is to survive a process that dies.
//
// Three answers, and the third is the one that matters: "fresh" means nobody has
// mirrored this sku and this caller may create it, "mirrored" means it is already a
// product, and "unknown" means an earlier attempt called HubSpot and never came back.
// Only a durable row can tell those apart, which is why this is not a Map.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Pool } from 'pg';
import { runMigrations } from '@ngl/db';
import { PgCatalogueLog } from '../src/hubspot-catalogue.log';

let container: StartedPostgreSqlContainer;
let pool: Pool;
let log: PgCatalogueLog;

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine').start();
  pool = new Pool({ connectionString: container.getConnectionUri() });
  await runMigrations(pool);
  log = new PgCatalogueLog(pool);
}, 120_000);

afterAll(async () => { await pool.end(); await container.stop(); });
beforeEach(async () => { await pool.query('TRUNCATE hubspot_products'); });

describe('PgCatalogueLog', () => {
  it('lets the first caller create the product', async () => {
    expect(await log.claim('TEAPOT')).toEqual({ status: 'fresh' });
  });

  it('hands back the product it already made instead of a second claim', async () => {
    await log.claim('TEAPOT');
    await log.record('TEAPOT', '426893556972');

    expect(await log.claim('TEAPOT'))
      .toEqual({ status: 'mirrored', productId: '426893556972' });
  });

  it('reports an attempt that never came back as unknown, and says when', async () => {
    await log.claim('TEAPOT');
    // No record, no release — this is a worker that died mid-call. The age is what
    // lets the caller decide whether a search finding nothing is proof of nothing.
    const again = await log.claim('TEAPOT');

    expect(again.status).toBe('unknown');
    if (again.status !== 'unknown') throw new Error('expected an unknown claim');
    expect(again.claimedAt.getTime()).toBeLessThanOrEqual(Date.now());
  });

  it('lets a cleanly failed attempt try again', async () => {
    await log.claim('TEAPOT');
    // HubSpot answered, so we know no product was created.
    await log.release('TEAPOT');

    expect(await log.claim('TEAPOT')).toEqual({ status: 'fresh' });
  });

  it('never releases a sku that was mirrored', async () => {
    // A release arriving late must not throw away a product id somebody recorded,
    // or the next order would create the catalogue a second time.
    await log.claim('TEAPOT');
    await log.record('TEAPOT', '426893556972');
    await log.release('TEAPOT');

    expect(await log.claim('TEAPOT'))
      .toEqual({ status: 'mirrored', productId: '426893556972' });
  });

  it('lets only one of two racing workers claim a sku', async () => {
    const [first, second] = await Promise.all([log.claim('MUG-BLUE'), log.claim('MUG-BLUE')]);
    const fresh = [first, second].filter((result) => result.status === 'fresh');

    expect(fresh).toHaveLength(1);
  });

  it('keeps one sku from shadowing another', async () => {
    await log.claim('TEAPOT');
    await log.record('TEAPOT', '426893556972');

    expect(await log.claim('MUG-BLUE')).toEqual({ status: 'fresh' });
  });

  it('outlives a reset, because the products in HubSpot do', async () => {
    // POST /api/reset clears the demo's traffic. It does not un-create eight products
    // in somebody's CRM, so forgetting their ids here would mirror them all again.
    await log.claim('TEAPOT');
    await log.record('TEAPOT', '426893556972');
    await pool.query('TRUNCATE events CASCADE');

    expect(await log.claim('TEAPOT'))
      .toEqual({ status: 'mirrored', productId: '426893556972' });
  });
});
