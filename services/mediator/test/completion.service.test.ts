// services/mediator/test/completion.service.test.ts
// Rule 6.7 under test: the confirmation mail must not be queued while anything
// else about the same order is still unfinished. The proof chain in spec 9.1
// depends on it — a mail that arrives early measures nothing.
//
// And a second condition that used to be missing: there has to be somebody to
// write to. An order placed without an address was still queueing a mail, which
// failed six times and parked itself in the dead letter box, so the demo's own
// "needs a human" counter climbed on every untouched run.
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

/** What an order placed with an address looks like once it reaches the queue. */
const WITH_ADDRESS = { confirmTo: 'visitor@example.com' };

async function seedWith(
  states: Array<[string, string]>,
  payload: Record<string, unknown> = WITH_ADDRESS,
): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO events (external_id, kind, payload)
     VALUES ('evt_' || gen_random_uuid(), 'order.placed', $1::jsonb) RETURNING id`,
    [JSON.stringify(payload)],
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

/**
 * The address an order with no address is booked under. Spelled out rather than
 * imported: this service is in another package, and rule 6.7 has to keep its hands
 * off the house address whatever the api happens to call it today. A test that
 * imported the value would pass even if the two drifted apart, which is the one
 * thing it is here to catch.
 */
const HOUSE_ADDRESS = 'orders@ngl.danielsolves.ai';

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

  it('queues nothing when the order carries no address to write to', async () => {
    const eventId = await seedWith([['hubspot', 'done']], { customerName: 'Demo order' });
    expect(await completion.enqueueMailIfComplete(eventId)).toBe(false);
    const { rows } = await pool.query(
      `SELECT count(*) FROM deliveries WHERE event_id = $1 AND target = 'mailer'`, [eventId],
    );
    expect(Number(rows[0].count)).toBe(0);
  });

  it('treats a blank address as no address', async () => {
    const eventId = await seedWith([['hubspot', 'done']], { confirmTo: '' });
    expect(await completion.enqueueMailIfComplete(eventId)).toBe(false);
  });

  it('does not mistake the booking identity for somebody who asked to be told', async () => {
    // customerEmail is what the order is booked under and is always set, house
    // address included. confirmTo is the promise to a real person, and only that
    // promise may create a delivery.
    const eventId = await seedWith(
      [['hubspot', 'done']], { customerEmail: HOUSE_ADDRESS },
    );
    expect(await completion.enqueueMailIfComplete(eventId)).toBe(false);
  });
});
