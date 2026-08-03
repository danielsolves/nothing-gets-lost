// services/mediator/test/queue.repository.test.ts
// Exercises the hand-built queue against a real Postgres. These are the
// guarantees the whole demo rests on: claim once, retry with a schedule, give up
// visibly instead of silently, and hand nothing to two workers at the same time.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Pool } from 'pg';
import { runMigrations } from '@ngl/db';
import { QueueRepository } from '../src/queue.repository';

let container: StartedPostgreSqlContainer;
let pool: Pool;
let repo: QueueRepository;

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine').start();
  pool = new Pool({ connectionString: container.getConnectionUri() });
  await runMigrations(pool);
  repo = new QueueRepository(pool);
}, 120_000);

afterAll(async () => { await pool.end(); await container.stop(); });

beforeEach(async () => {
  await pool.query('TRUNCATE events CASCADE');
});

async function seedEvent(externalId: string): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO events (external_id, kind, payload)
     VALUES ($1, 'order.placed', '{}'::jsonb) RETURNING id`, [externalId],
  );
  return rows[0].id;
}

describe('QueueRepository', () => {
  it('enqueues once per event and target', async () => {
    const eventId = await seedEvent('evt_1');
    expect(await repo.enqueue(eventId, 'hubspot')).toBe(true);
    expect(await repo.enqueue(eventId, 'hubspot')).toBe(false);
  });

  it('claims only deliveries that are due', async () => {
    const eventId = await seedEvent('evt_2');
    await repo.enqueue(eventId, 'hubspot');
    await pool.query(
      `INSERT INTO deliveries (event_id, target, next_at)
       VALUES ($1, 'slack', now() + interval '1 hour')`, [eventId],
    );
    const claimed = await repo.claimDue(10);
    expect(claimed.map((c) => c.target)).toEqual(['hubspot']);
  });

  it('increments attempts and locks on claim', async () => {
    const eventId = await seedEvent('evt_3');
    await repo.enqueue(eventId, 'ledger');
    const [claimed] = await repo.claimDue(10);
    expect(claimed.attempts).toBe(1);
    const { rows } = await pool.query(
      'SELECT state, locked_at FROM deliveries WHERE id = $1', [claimed.id],
    );
    expect(rows[0].state).toBe('inflight');
    expect(rows[0].locked_at).not.toBeNull();
  });

  it('never hands the same delivery to two workers', async () => {
    const eventId = await seedEvent('evt_4');
    for (const target of ['hubspot', 'slack', 'ledger', 'mailer'] as const) {
      await repo.enqueue(eventId, target);
    }
    const [a, b] = await Promise.all([repo.claimDue(4), repo.claimDue(4)]);
    const ids = [...a, ...b].map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBe(4);
  });

  it('marks a delivery done with the remote reference', async () => {
    const eventId = await seedEvent('evt_5');
    await repo.enqueue(eventId, 'hubspot');
    const [claimed] = await repo.claimDue(1);
    const remoteAt = new Date('2026-07-30T14:06:31.000Z');
    await repo.markDone(claimed.id, 'contact-42', remoteAt);
    const { rows } = await pool.query(
      'SELECT state, remote_ref, remote_at FROM deliveries WHERE id = $1', [claimed.id],
    );
    expect(rows[0].state).toBe('done');
    expect(rows[0].remote_ref).toBe('contact-42');
    expect(new Date(rows[0].remote_at).toISOString()).toBe(remoteAt.toISOString());
  });

  it('reschedules a failed delivery', async () => {
    const eventId = await seedEvent('evt_6');
    await repo.enqueue(eventId, 'hubspot');
    const [claimed] = await repo.claimDue(1);
    expect(await repo.markFailed(claimed.id, 'ECONNRESET')).toBe('retrying');
    const { rows } = await pool.query(
      'SELECT state, last_error FROM deliveries WHERE id = $1', [claimed.id],
    );
    expect(rows[0].state).toBe('pending');
    expect(rows[0].last_error).toBe('ECONNRESET');
  });

  it('sends the sixth failure to the dead letter box', async () => {
    const eventId = await seedEvent('evt_7');
    await repo.enqueue(eventId, 'hubspot');
    let outcome: 'retrying' | 'dead' = 'retrying';
    for (let i = 0; i < 6; i++) {
      await pool.query(
        `UPDATE deliveries SET next_at = now() WHERE event_id = $1`, [eventId],
      );
      const [claimed] = await repo.claimDue(1);
      outcome = await repo.markFailed(claimed.id, 'still down');
    }
    expect(outcome).toBe('dead');
    const { rows } = await pool.query(
      'SELECT state, attempts FROM deliveries WHERE event_id = $1', [eventId],
    );
    expect(rows[0].state).toBe('dead');
    expect(rows[0].attempts).toBe(6);
  });

  it('releases deliveries whose worker died mid-flight', async () => {
    const eventId = await seedEvent('evt_8');
    await repo.enqueue(eventId, 'hubspot');
    const [claimed] = await repo.claimDue(1);
    await pool.query(
      `UPDATE deliveries SET locked_at = now() - interval '5 minutes' WHERE id = $1`,
      [claimed.id],
    );
    expect(await repo.releaseStuck(60)).toBe(1);
    const { rows } = await pool.query(
      'SELECT state FROM deliveries WHERE id = $1', [claimed.id],
    );
    expect(rows[0].state).toBe('pending');
  });
});

describe('retrying from the dead letter box', () => {
  it('puts a dead delivery back in the queue with a clean slate', async () => {
    const eventId = await seedEvent('evt_revive');
    await repo.enqueue(eventId, 'hubspot');
    await pool.query(
      `UPDATE deliveries SET state = 'dead', attempts = 6, last_error = 'gone'
        WHERE event_id = $1`, [eventId],
    );

    const { rows: before } = await pool.query(
      'SELECT id FROM deliveries WHERE event_id = $1', [eventId],
    );
    expect(await repo.retryDead(Number(before[0].id))).toBe(true);

    const { rows } = await pool.query(
      'SELECT state, attempts, last_error FROM deliveries WHERE event_id = $1', [eventId],
    );
    expect(rows[0].state).toBe('pending');
    expect(rows[0].attempts).toBe(0);
    expect(rows[0].last_error).toBeNull();
  });

  it('refuses to revive a delivery that is not dead', async () => {
    const eventId = await seedEvent('evt_alive');
    await repo.enqueue(eventId, 'hubspot');
    const { rows } = await pool.query(
      'SELECT id FROM deliveries WHERE event_id = $1', [eventId],
    );
    expect(await repo.retryDead(Number(rows[0].id))).toBe(false);
  });
});
