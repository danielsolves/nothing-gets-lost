// services/mediator/test/slack-send.log.test.ts
// The bookkeeping that replaces conversations.history on the visitor path, pinned
// against a real database because its whole job is to survive a process that dies.
//
// Three answers, and the third is the one that matters: "fresh" means nothing has
// gone out, "sent" means it already did and here is the timestamp, and "unknown"
// means a previous attempt made the call and never came back to say how it went.
// Only a durable row can tell those apart, which is why this is not a Map.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Pool } from 'pg';
import { runMigrations } from '@ngl/db';
import { PgSlackSendLog } from '../src/slack-send.log';

let container: StartedPostgreSqlContainer;
let pool: Pool;
let log: PgSlackSendLog;

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine').start();
  pool = new Pool({ connectionString: container.getConnectionUri() });
  await runMigrations(pool);
  log = new PgSlackSendLog(pool);
}, 120_000);

afterAll(async () => { await pool.end(); await container.stop(); });
beforeEach(async () => { await pool.query('TRUNCATE events CASCADE'); });

async function newEvent(): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO events (external_id, kind, payload)
     VALUES ($1, 'order.placed', '{}'::jsonb) RETURNING id`,
    [`evt_${Math.random().toString(36).slice(2)}`],
  );
  return rows[0].id;
}

describe('PgSlackSendLog', () => {
  it('lets the first attempt through', async () => {
    const eventId = await newEvent();
    expect(await log.begin(eventId, `${eventId}:slack`)).toEqual({ status: 'fresh' });
  });

  it('returns the recorded timestamp instead of posting twice', async () => {
    const eventId = await newEvent();
    await log.begin(eventId, `${eventId}:slack`);
    await log.complete(eventId, '1800000001.000100');

    expect(await log.begin(eventId, `${eventId}:slack`))
      .toEqual({ status: 'sent', messageTs: '1800000001.000100' });
  });

  it('reports an attempt that never came back as unknown', async () => {
    const eventId = await newEvent();
    await log.begin(eventId, `${eventId}:slack`);
    // No complete, no abandon — this is a worker that died mid-call.
    expect(await log.begin(eventId, `${eventId}:slack`)).toEqual({ status: 'unknown' });
  });

  it('lets a cleanly failed attempt try again', async () => {
    const eventId = await newEvent();
    await log.begin(eventId, `${eventId}:slack`);
    // Slack answered, so we know nothing was posted — the cut line heals from here.
    await log.abandon(eventId);

    expect(await log.begin(eventId, `${eventId}:slack`)).toEqual({ status: 'fresh' });
  });

  it('keeps one event from shadowing another', async () => {
    const first = await newEvent();
    const second = await newEvent();
    await log.begin(first, `${first}:slack`);
    await log.complete(first, '1800000001.000100');

    expect(await log.begin(second, `${second}:slack`)).toEqual({ status: 'fresh' });
  });

  it('forgets its rows when the event is reset away', async () => {
    const eventId = await newEvent();
    await log.begin(eventId, `${eventId}:slack`);
    await pool.query('DELETE FROM events WHERE id = $1', [eventId]);

    const { rows } = await pool.query('SELECT count(*) FROM slack_visitor_sends');
    expect(Number(rows[0].count)).toBe(0);
  });
});
