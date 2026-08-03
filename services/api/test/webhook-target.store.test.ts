// services/api/test/webhook-target.store.test.ts
// The visitor's own webhook url has to outlive the request that set it: the
// mediator reads it from another process, and a restart must not silently turn
// the target off. So it is stored, not held in memory — and validated on the way
// in as well as immediately before each call (spec 10.2).
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Pool } from 'pg';
import { runMigrations } from '@ngl/db';
import { WebhookTargetStore } from '../src/webhook-target.store';

let container: StartedPostgreSqlContainer;
let pool: Pool;
let store: WebhookTargetStore;

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine').start();
  pool = new Pool({ connectionString: container.getConnectionUri() });
  await runMigrations(pool);
  store = new WebhookTargetStore(pool);
}, 120_000);

afterAll(async () => { await pool.end(); await container.stop(); });
beforeEach(async () => { await pool.query('DELETE FROM custom_webhook'); });

describe('WebhookTargetStore', () => {
  it('reports no url before the visitor sets one', async () => {
    expect(await store.get()).toBeNull();
  });

  it('keeps the url so another process can read it', async () => {
    await store.set('https://example.com/hook');
    expect(await store.get()).toBe('https://example.com/hook');
  });

  it('replaces the url instead of collecting a second one', async () => {
    await store.set('https://example.com/one');
    await store.set('https://example.com/two');

    expect(await store.get()).toBe('https://example.com/two');
    const { rows } = await pool.query('SELECT count(*) FROM custom_webhook');
    expect(Number(rows[0].count)).toBe(1);
  });

  it('forgets the url when the visitor disconnects', async () => {
    await store.set('https://example.com/hook');
    await store.clear();
    expect(await store.get()).toBeNull();
  });
});
