// services/api/test/deliveries.service.test.ts
// A log line is a record of something that happened, so reading it later must not
// change it.
//
// It used to phrase the retry delay as a countdown against Date.now(). The stream
// re-sends the whole log every second, so the same failure came back as "next try in
// 34 s", then 35, then 36, and the page had no way to tell that those were one event.
// The delay belongs to the schedule: next_at minus updated_at, both of them columns.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Pool } from 'pg';
import { runMigrations } from '@ngl/db';
import { DeliveriesService } from '../src/deliveries.service';

let container: StartedPostgreSqlContainer;
let pool: Pool;
let service: DeliveriesService;

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine').start();
  pool = new Pool({ connectionString: container.getConnectionUri() });
  await runMigrations(pool);
  service = new DeliveriesService(pool);
}, 120_000);

afterAll(async () => { await pool.end(); await container.stop(); });
beforeEach(async () => { await pool.query('TRUNCATE events CASCADE'); });

/** A delivery frozen in a given state, with the two timestamps set explicitly. */
async function seed(options: {
  state: string; attempts: number; secondsUntilRetry?: number;
  lastError?: string; remoteRef?: string; target?: string;
}): Promise<void> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO events (external_id, kind, payload)
     VALUES ($1, 'order.placed', '{}'::jsonb) RETURNING id`,
    [`evt_${Math.random().toString(36).slice(2)}`],
  );
  await pool.query(
    `INSERT INTO deliveries
       (event_id, target, state, attempts, next_at, last_error, remote_ref, updated_at)
     VALUES ($1, $7, $2, $3,
             now() + make_interval(secs => $4), $5, $6, now())`,
    [
      rows[0].id, options.state, options.attempts,
      options.secondsUntilRetry ?? 0, options.lastError ?? null, options.remoteRef ?? null,
      options.target ?? 'slack',
    ],
  );
}

describe('DeliveriesService timeline', () => {
  it('reads the same line the same way a minute later', async () => {
    await seed({ state: 'pending', attempts: 3, secondsUntilRetry: 30 });

    const first = await service.timeline(10);
    await new Promise((resolve) => setTimeout(resolve, 1100));
    const second = await service.timeline(10);

    expect(second[0].text).toBe(first[0].text);
  });

  it('calls the paypal line PayPal rather than leaving it unnamed', async () => {
    // The label map covers every target by type. A missing entry does not fail to
    // compile in the browser, it reads as "undefined: confirmed" on the page.
    await seed({ state: 'done', attempts: 1, remoteRef: '3C41', target: 'paypal' });
    const [entry] = await service.timeline(10);
    expect(entry.text).toBe('PayPal: confirmed as 3C41');
  });

  it('phrases the delay as the schedule it was given', async () => {
    await seed({ state: 'pending', attempts: 3, secondsUntilRetry: 30, lastError: 'ECONNRESET' });
    const [entry] = await service.timeline(10);
    expect(entry.text).toContain('attempt 3 failed, next try in 30 s');
  });

  it('rounds a long wait to minutes', async () => {
    await seed({ state: 'pending', attempts: 4, secondsUntilRetry: 120 });
    const [entry] = await service.timeline(10);
    expect(entry.text).toContain('in 2 min');
  });

  it('still says a delivery is queued before the first attempt', async () => {
    await seed({ state: 'pending', attempts: 0 });
    const [entry] = await service.timeline(10);
    expect(entry.text).toContain('queued');
  });

  it('still names the record a confirmed delivery produced', async () => {
    await seed({ state: 'done', attempts: 1, remoteRef: 'INV-1010' });
    const [entry] = await service.timeline(10);
    expect(entry.text).toContain('confirmed as INV-1010');
    expect(entry.level).toBe('success');
  });

  it('still says a parked delivery is waiting for a human', async () => {
    await seed({ state: 'dead', attempts: 6, lastError: 'still down' });
    const [entry] = await service.timeline(10);
    expect(entry.text).toContain('given up after 6 attempts, waiting for a human');
    expect(entry.level).toBe('error');
  });
});
