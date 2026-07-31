// services/api/test/proof-log.service.test.ts
// Pins the take-away proof log of spec 9.5: every attempt with its remote reference
// and foreign timestamp, the failure reason kept readable, the honest labelling
// carried inside the file, and no customer email anywhere in it.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Pool } from 'pg';
import { runMigrations } from '@ngl/db';
import { ProofLogService } from '../src/proof-log.service';

let container: StartedPostgreSqlContainer;
let pool: Pool;
let service: ProofLogService;

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine').start();
  pool = new Pool({ connectionString: container.getConnectionUri() });
  await runMigrations(pool);
  service = new ProofLogService(pool);
}, 120_000);

afterAll(async () => { await pool.end(); await container.stop(); });
beforeEach(async () => { await pool.query('TRUNCATE events CASCADE'); });

async function seed(): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO events (external_id, kind, payload)
     VALUES ('evt_log', 'order.placed', '{"totalCents":4900}'::jsonb) RETURNING id`,
  );
  await pool.query(
    `INSERT INTO deliveries (event_id, target, state, attempts, remote_ref, remote_at, last_error)
     VALUES ($1, 'hubspot', 'done', 4, 'contact-1', '2026-07-30T14:06:31Z', NULL),
            ($1, 'stripe', 'done', 1, 'ch_1', '2026-07-30T14:04:02Z', NULL),
            ($1, 'slack', 'dead', 6, NULL, NULL, 'channel_not_found')`,
    [rows[0].id],
  );
  return rows[0].id;
}

describe('ProofLogService', () => {
  it('lists every delivery attempt with its remote reference', async () => {
    const log = await service.build(await seed());
    expect(log.deliveries).toHaveLength(3);
    const hubspot = log.deliveries.find((d) => d.target === 'hubspot');
    expect(hubspot?.attempts).toBe(4);
    expect(hubspot?.remoteRef).toBe('contact-1');
  });

  it('records timestamps assigned by the remote systems', async () => {
    const log = await service.build(await seed());
    const stripe = log.deliveries.find((d) => d.target === 'stripe');
    expect(stripe?.remoteAt).toBe('2026-07-30T14:04:02.000Z');
  });

  it('keeps the failure reason readable for the dead delivery', async () => {
    const log = await service.build(await seed());
    const slack = log.deliveries.find((d) => d.target === 'slack');
    expect(slack?.state).toBe('dead');
    expect(slack?.lastError).toBe('channel_not_found');
  });

  it('states in the file itself which entries are indisputable', async () => {
    const log = await service.build(await seed());
    expect(log.howToVerify.stripe).toContain('stripe.com');
    expect(log.howToVerify.hubspot).toContain('indication');
  });

  it('does not leak the customer email address', async () => {
    const eventId = await seed();
    await pool.query(
      `INSERT INTO orders (event_id, customer_name, customer_email, items, total_cents, source)
       VALUES ($1, 'M. Berger', 'secret@example.com', '[]'::jsonb, 4900, 'form')`,
      [eventId],
    );
    const log = await service.build(eventId);
    expect(JSON.stringify(log)).not.toContain('secret@example.com');
  });
});
