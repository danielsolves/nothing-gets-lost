// services/mcp/test/backlog.repository.test.ts
// The reader against a real Postgres, connected as the role the service actually
// uses. A fake pool would prove the SQL parses; only ngl_ro proves that an open MCP
// port cannot reach past the five views, which is the claim this service rests on.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Pool } from 'pg';
import { runMigrations } from '@ngl/db';
import { BacklogRepository } from '../src/backlog.repository';

let container: StartedPostgreSqlContainer;
let admin: Pool;
let readonly: Pool;
let backlog: BacklogRepository;

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine').start();
  admin = new Pool({ connectionString: container.getConnectionUri() });
  await runMigrations(admin);
  readonly = new Pool({
    connectionString: container.getConnectionUri().replace(/\/\/[^:]+:[^@]+@/, '//ngl_ro:ngl_ro@'),
  });
  backlog = new BacklogRepository(readonly);
}, 120_000);

afterAll(async () => { await admin.end(); await readonly.end(); await container.stop(); });

beforeEach(async () => { await admin.query('DELETE FROM events'); });

/** One parked delivery, written the way the mediator would leave it. */
async function park(options: {
  externalId: string;
  target: string;
  name?: string;
  email?: string;
  totalCents?: number;
  items?: { sku: string; qty: number }[];
  attempts?: number;
  lastError?: string;
  parkedAt?: string;
}): Promise<number> {
  const { rows: events } = await admin.query<{ id: string }>(
    `INSERT INTO events (external_id, kind, payload)
     VALUES ($1, 'order.placed', '{}'::jsonb) RETURNING id`,
    [options.externalId],
  );
  const eventId = events[0].id;

  if (options.name) {
    await admin.query(
      `INSERT INTO orders (event_id, customer_name, customer_email, items,
                           total_cents, source)
       VALUES ($1, $2, $3, $4::jsonb, $5, 'form')`,
      [
        eventId, options.name, options.email ?? 'someone@example.com',
        JSON.stringify(options.items ?? []), options.totalCents ?? 1000,
      ],
    );
  }

  const { rows } = await admin.query<{ id: string }>(
    `INSERT INTO deliveries (event_id, target, state, attempts, last_error, updated_at)
     VALUES ($1, $2, 'dead', $3, $4, COALESCE($5::timestamptz, now())) RETURNING id`,
    [
      eventId, options.target, options.attempts ?? 6,
      options.lastError ?? null, options.parkedAt ?? null,
    ],
  );
  return Number(rows[0].id);
}

describe('BacklogRepository', () => {
  it('reads a parked delivery with the order around it', async () => {
    const id = await park({
      externalId: 'evt_one', target: 'hubspot', name: 'R. Vogel',
      email: 'rita@example.com', totalCents: 8400, lastError: 'ECONNRESET',
    });

    const [entry] = await backlog.list();
    expect(entry).toMatchObject({
      id,
      target: 'hubspot',
      attempts: 6,
      lastError: 'ECONNRESET',
      customerName: 'R. Vogel',
      customerEmail: 'r***@example.com',
      totalCents: 8400,
    });
    expect(entry?.orderNumber).toBeGreaterThanOrEqual(1000);
    expect(Date.parse(entry?.parkedAt ?? '')).not.toBeNaN();
  });

  it('puts what has waited longest first', async () => {
    await park({
      externalId: 'evt_new', target: 'slack', parkedAt: '2026-07-31T12:00:00Z',
    });
    const older = await park({
      externalId: 'evt_old', target: 'mailer', parkedAt: '2026-07-30T12:00:00Z',
    });

    const entries = await backlog.list();
    expect(entries.map((entry) => entry.id)[0]).toBe(older);
  });

  it('narrows to one system when asked', async () => {
    await park({ externalId: 'evt_hs', target: 'hubspot' });
    await park({ externalId: 'evt_sl', target: 'slack' });

    const entries = await backlog.list({ target: 'slack' });
    expect(entries).toHaveLength(1);
    expect(entries[0]?.target).toBe('slack');
  });

  it('honours the limit and still counts the rest', async () => {
    await park({ externalId: 'evt_a', target: 'hubspot' });
    await park({ externalId: 'evt_b', target: 'hubspot' });
    await park({ externalId: 'evt_c', target: 'hubspot' });

    expect(await backlog.list({ limit: 2 })).toHaveLength(2);
    expect(await backlog.count()).toBe(3);
  });

  it('counts one system on its own', async () => {
    await park({ externalId: 'evt_d', target: 'hubspot' });
    await park({ externalId: 'evt_e', target: 'slack' });
    expect(await backlog.count('slack')).toBe(1);
  });

  it('reads one entry with its basket', async () => {
    const id = await park({
      externalId: 'evt_basket', target: 'ledger', name: 'K. Adler',
      items: [{ sku: 'MUG-BLUE', qty: 2 }, { sku: 'TEE-BLK', qty: 1 }],
    });

    const entry = await backlog.entry(id);
    expect(entry?.lines).toEqual([{ sku: 'MUG-BLUE', qty: 2 }, { sku: 'TEE-BLK', qty: 1 }]);
  });

  it('answers null for an id that is not parked', async () => {
    expect(await backlog.entry(999_999)).toBeNull();
  });

  it('leaves a delivery that is still retrying out of it', async () => {
    const { rows } = await admin.query<{ id: string }>(
      `INSERT INTO events (external_id, kind, payload)
       VALUES ('evt_pending', 'order.placed', '{}'::jsonb) RETURNING id`,
    );
    await admin.query(
      `INSERT INTO deliveries (event_id, target, state, attempts)
       VALUES ($1, 'stripe', 'pending', 3)`,
      [rows[0].id],
    );

    expect(await backlog.list()).toHaveLength(0);
    expect(await backlog.count()).toBe(0);
  });

  it('keeps a parked delivery whose event never booked a basket', async () => {
    const { rows } = await admin.query<{ id: string }>(
      `INSERT INTO events (external_id, kind, payload)
       VALUES ('evt_webhook', 'payment.succeeded', '{}'::jsonb) RETURNING id`,
    );
    const { rows: created } = await admin.query<{ id: string }>(
      `INSERT INTO deliveries (event_id, target, state, attempts)
       VALUES ($1, 'stripe', 'dead', 6) RETURNING id`,
      [rows[0].id],
    );

    const entry = await backlog.entry(Number(created[0].id));
    expect(entry?.customerName).toBeNull();
    expect(entry?.lines).toEqual([]);
  });

  // The reason the role exists. If this ever passes, the open port is a write port.
  it('cannot write through the pool it was given', async () => {
    await expect(
      readonly.query(`UPDATE deliveries SET state = 'pending'`),
    ).rejects.toThrow(/read-only|permission denied/i);
  });

  it('cannot read the tables behind the views', async () => {
    await expect(readonly.query('SELECT * FROM deliveries')).rejects.toThrow(/permission denied/i);
    await expect(readonly.query('SELECT * FROM oauth_tokens')).rejects.toThrow(/permission denied/i);
  });
});
