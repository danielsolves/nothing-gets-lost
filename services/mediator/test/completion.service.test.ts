// services/mediator/test/completion.service.test.ts
// Rule 6.7 under test: the confirmation mail must not be queued while anything
// else about the same order is still unfinished. The proof chain in spec 9.1
// depends on it — a mail that arrives early measures nothing.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Pool } from 'pg';
import { runMigrations } from '@ngl/db';
import { CompletionService } from '../src/completion.service';

let container: StartedPostgreSqlContainer;
let pool: Pool;
let completion: CompletionService;

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine').start();
  pool = new Pool({ connectionString: container.getConnectionUri() });
  await runMigrations(pool);
  completion = new CompletionService(pool);
}, 120_000);

afterAll(async () => { await pool.end(); await container.stop(); });
beforeEach(async () => { await pool.query('TRUNCATE events CASCADE'); });

async function seedWith(states: Array<[string, string]>): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO events (external_id, kind, payload)
     VALUES ('evt_' || gen_random_uuid(), 'order.placed', '{}'::jsonb) RETURNING id`,
  );
  const eventId = rows[0].id;
  for (const [target, state] of states) {
    await pool.query(
      'INSERT INTO deliveries (event_id, target, state) VALUES ($1, $2, $3)',
      [eventId, target, state],
    );
  }
  return eventId;
}

describe('CompletionService', () => {
  it('does not queue the mail while any delivery is still pending', async () => {
    const eventId = await seedWith([['hubspot', 'done'], ['ledger', 'pending']]);
    expect(await completion.enqueueMailIfComplete(eventId)).toBe(false);
    const { rows } = await pool.query(
      `SELECT count(*) FROM deliveries WHERE event_id = $1 AND target = 'mailer'`, [eventId],
    );
    expect(Number(rows[0].count)).toBe(0);
  });

  it('does not queue the mail while a delivery is dead', async () => {
    const eventId = await seedWith([['hubspot', 'done'], ['ledger', 'dead']]);
    expect(await completion.enqueueMailIfComplete(eventId)).toBe(false);
  });

  it('queues the mail once every other delivery is done', async () => {
    const eventId = await seedWith([
      ['hubspot', 'done'], ['ledger', 'done'], ['slack', 'done'],
    ]);
    expect(await completion.enqueueMailIfComplete(eventId)).toBe(true);
    const { rows } = await pool.query(
      `SELECT state FROM deliveries WHERE event_id = $1 AND target = 'mailer'`, [eventId],
    );
    expect(rows[0].state).toBe('pending');
  });

  it('never queues the mail twice', async () => {
    const eventId = await seedWith([['hubspot', 'done']]);
    expect(await completion.enqueueMailIfComplete(eventId)).toBe(true);
    expect(await completion.enqueueMailIfComplete(eventId)).toBe(false);
    const { rows } = await pool.query(
      `SELECT count(*) FROM deliveries WHERE event_id = $1 AND target = 'mailer'`, [eventId],
    );
    expect(Number(rows[0].count)).toBe(1);
  });

  it('ignores the mailer row itself when judging completeness', async () => {
    const eventId = await seedWith([['hubspot', 'done'], ['mailer', 'pending']]);
    expect(await completion.enqueueMailIfComplete(eventId)).toBe(false);
  });
});
