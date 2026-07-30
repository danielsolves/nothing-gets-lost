// services/mediator/test/enqueue.controller.test.ts
// The mediator's own door. The api hands every event over this endpoint instead
// of writing the queue itself, so the exactly-once rules stay in one process —
// which only holds if the endpoint actually exists and speaks IntakeInput.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Pool } from 'pg';
import { runMigrations } from '@ngl/db';
import { QueueRepository } from '../src/queue.repository';
import { IntakeService } from '../src/intake.service';
import { createMediatorApp } from '../src/main';

let container: StartedPostgreSqlContainer;
let pool: Pool;
let app: Awaited<ReturnType<typeof createMediatorApp>>;
let baseUrl: string;

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine').start();
  pool = new Pool({ connectionString: container.getConnectionUri() });
  await runMigrations(pool);
  app = await createMediatorApp(new IntakeService(pool, new QueueRepository(pool)));
  await app.listen(0, '127.0.0.1');
  baseUrl = await app.getUrl();
}, 120_000);

afterAll(async () => { await app.close(); await pool.end(); await container.stop(); });
beforeEach(async () => { await pool.query('TRUNCATE events CASCADE'); });

interface EnqueueBody { eventId: string; accepted: boolean; enqueued: string[] }

async function enqueue(body: unknown): Promise<Response> {
  return fetch(`${baseUrl}/internal/enqueue`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function enqueueJson(body: unknown): Promise<EnqueueBody> {
  return (await enqueue(body)).json() as Promise<EnqueueBody>;
}

const order = (externalId: string) => ({
  externalId,
  kind: 'order.placed' as const,
  payload: { totalCents: 1200 },
  targets: ['hubspot', 'ledger'] as const,
});

describe('POST /internal/enqueue', () => {
  it('accepts an event and reports what it queued', async () => {
    const response = await enqueue(order('evt_api_1'));
    expect(response.status).toBe(201);

    const body = (await response.json()) as EnqueueBody;
    expect(body.accepted).toBe(true);
    expect(body.enqueued.sort()).toEqual(['hubspot', 'ledger']);
    expect(body.eventId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('reports a repeated event as dropped rather than failing', async () => {
    const first = await enqueueJson(order('evt_api_same'));
    const second = await enqueueJson(order('evt_api_same'));

    expect(second.accepted).toBe(false);
    expect(second.eventId).toBe(first.eventId);

    const { rows } = await pool.query('SELECT count(*) FROM deliveries');
    expect(Number(rows[0].count)).toBe(2);
  });

  it('refuses a malformed body instead of queueing something half-formed', async () => {
    expect((await enqueue({ externalId: 'evt_bad' })).status).toBe(400);
    expect((await enqueue({ ...order('evt_bad2'), targets: ['facebook'] })).status).toBe(400);
    expect((await enqueue({ ...order('evt_bad3'), kind: 'order.cancelled' })).status).toBe(400);
  });

  it('answers the health probe docker compose waits on', async () => {
    const response = await fetch(`${baseUrl}/internal/health`);
    expect(response.status).toBe(200);
    expect(((await response.json()) as { status: string }).status).toBe('ok');
  });
});
