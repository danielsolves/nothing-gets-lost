// services/api/test/counters.service.test.ts
// Pins the six header counters to their definitions against a real database,
// above all that lost stays 0 while dead deliveries are counted as needing a human.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Pool } from 'pg';
import { runMigrations } from '@ngl/db';
import { CountersService } from '../src/counters.service';

let container: StartedPostgreSqlContainer;
let pool: Pool;
let counters: CountersService;

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine').start();
  pool = new Pool({ connectionString: container.getConnectionUri() });
  await runMigrations(pool);
  counters = new CountersService(pool);
}, 120_000);

afterAll(async () => { await pool.end(); await container.stop(); });
beforeEach(async () => { await pool.query('TRUNCATE events CASCADE'); });

async function seed(states: string[]): Promise<void> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO events (external_id, kind, payload)
     VALUES ('evt_' || gen_random_uuid(), 'order.placed', '{}'::jsonb) RETURNING id`,
  );
  const targets = ['hubspot', 'stripe', 'slack', 'ledger', 'mailer'];
  for (const [index, state] of states.entries()) {
    await pool.query(
      'INSERT INTO deliveries (event_id, target, state) VALUES ($1, $2, $3)',
      [rows[0].id, targets[index], state],
    );
  }
}

describe('CountersService', () => {
  it('reports zeros on an empty system, and lost is zero', async () => {
    expect(await counters.read()).toEqual({
      received: 0, delivered: 0, waiting: 0,
      duplicatesDropped: 0, needsHuman: 0, lost: 0,
    });
  });

  it('counts events as received', async () => {
    await seed(['done']);
    await seed(['done']);
    expect((await counters.read()).received).toBe(2);
  });

  it('counts done deliveries as delivered', async () => {
    await seed(['done', 'done', 'pending']);
    expect((await counters.read()).delivered).toBe(2);
  });

  it('counts pending and inflight together as waiting', async () => {
    await seed(['pending', 'inflight', 'done']);
    expect((await counters.read()).waiting).toBe(2);
  });

  it('counts dead deliveries as needing a human, never as lost', async () => {
    await seed(['dead', 'dead', 'done']);
    const result = await counters.read();
    expect(result.needsHuman).toBe(2);
    expect(result.lost).toBe(0);
  });

  it('keeps lost at zero even when everything is dead', async () => {
    await seed(['dead', 'dead', 'dead', 'dead', 'dead']);
    expect((await counters.read()).lost).toBe(0);
  });
});
