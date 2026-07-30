// services/mediator/test/intake.service.test.ts
// Covers the entrance to the system: the same webhook arriving twice, and two
// copies of it arriving at the same instant, must both end up as one event with
// one set of deliveries. This is what the "deliver the payment twice" button hits.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Pool } from 'pg';
import { runMigrations } from '@ngl/db';
import { QueueRepository } from '../src/queue.repository';
import { IntakeService } from '../src/intake.service';

let container: StartedPostgreSqlContainer;
let pool: Pool;
let intake: IntakeService;

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine').start();
  pool = new Pool({ connectionString: container.getConnectionUri() });
  await runMigrations(pool);
  intake = new IntakeService(pool, new QueueRepository(pool));
}, 120_000);

afterAll(async () => { await pool.end(); await container.stop(); });
beforeEach(async () => { await pool.query('TRUNCATE events CASCADE'); });

const input = (externalId: string) => ({
  externalId,
  kind: 'payment.succeeded' as const,
  payload: { amount: 1200 },
  targets: ['hubspot', 'ledger', 'slack'] as const,
});

describe('IntakeService', () => {
  it('accepts a new event and enqueues one delivery per target', async () => {
    const result = await intake.accept({ ...input('evt_new'), targets: [...input('e').targets] });
    expect(result.accepted).toBe(true);
    expect(result.enqueued.sort()).toEqual(['hubspot', 'ledger', 'slack']);
    const { rows } = await pool.query('SELECT count(*) FROM deliveries');
    expect(Number(rows[0].count)).toBe(3);
  });

  it('drops a repeated webhook without creating a second set of deliveries', async () => {
    const first = await intake.accept({ ...input('evt_same'), targets: [...input('e').targets] });
    const second = await intake.accept({ ...input('evt_same'), targets: [...input('e').targets] });

    expect(first.accepted).toBe(true);
    expect(second.accepted).toBe(false);
    expect(second.eventId).toBe(first.eventId);
    expect(second.enqueued).toEqual([]);

    const { rows } = await pool.query('SELECT count(*) FROM deliveries');
    expect(Number(rows[0].count)).toBe(3);
  });

  it('stores the payload verbatim so the proof log can quote it', async () => {
    const result = await intake.accept({ ...input('evt_payload'), targets: ['ledger'] });
    const { rows } = await pool.query(
      'SELECT payload FROM events WHERE id = $1', [result.eventId],
    );
    expect(rows[0].payload).toEqual({ amount: 1200 });
  });

  it('survives two simultaneous deliveries of the same webhook', async () => {
    const [a, b] = await Promise.all([
      intake.accept({ ...input('evt_race'), targets: ['ledger'] }),
      intake.accept({ ...input('evt_race'), targets: ['ledger'] }),
    ]);
    expect([a.accepted, b.accepted].filter(Boolean)).toHaveLength(1);
    expect(a.eventId).toBe(b.eventId);
    const { rows } = await pool.query('SELECT count(*) FROM deliveries');
    expect(Number(rows[0].count)).toBe(1);
  });
});
