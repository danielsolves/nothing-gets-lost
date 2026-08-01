// services/api/test/cleanup.service.test.ts
// Pins the nightly tidy-up of spec 14: a visitor's address is gone a day later, a
// fresh one is untouched, and the order row itself survives.
//
// It swept lapsed OAuth tokens as well, so that "deleted after 24 hours" was true of
// the disk and not only of the answer. The visitor OAuth is gone and migration 015
// drops the table, so there is nothing left of that half to pin.
//
// The address is written three times: in orders, in the event payload the deliveries
// read from, and in the mailer's own send record. The promise under the order form is
// only kept if all three go, and the last two were missed.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Pool } from 'pg';
import { runMigrations } from '@ngl/db';
import { CleanupService } from '../src/cleanup.service';
import { HOUSE_IDENTITY } from '../src/orders.service';

let container: StartedPostgreSqlContainer;
let pool: Pool;
let cleanup: CleanupService;

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine').start();
  pool = new Pool({ connectionString: container.getConnectionUri() });
  await runMigrations(pool);
  cleanup = new CleanupService(pool);
}, 120_000);

afterAll(async () => { await pool.end(); await container.stop(); });
// sent_mail carries no foreign key to events, so the cascade does not reach it.
beforeEach(async () => {
  await pool.query('TRUNCATE events CASCADE; TRUNCATE sent_mail;');
});

async function seedOrder(ageHours: number): Promise<void> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO events (external_id, kind, payload)
     VALUES ('evt_' || gen_random_uuid(), 'order.placed', '{}'::jsonb) RETURNING id`,
  );
  await pool.query(
    `INSERT INTO orders (event_id, customer_name, customer_email, items, total_cents,
                         source, created_at)
     VALUES ($1, 'M. Berger', 'private@example.com', '[]'::jsonb, 100, 'form',
             now() - make_interval(hours => $2))`,
    [rows[0].id, ageHours],
  );
}

/** Whatever a delivery reads out of the payload has to be seeded, ageing included. */
async function seedEvent(
  ageHours: number, payload: Record<string, unknown>,
): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO events (external_id, kind, payload, received_at)
     VALUES ('evt_' || gen_random_uuid(), 'order.placed', $1::jsonb,
             now() - make_interval(hours => $2)) RETURNING id`,
    [JSON.stringify(payload), ageHours],
  );
  return rows[0].id;
}

async function payloadOf(eventId: string): Promise<Record<string, unknown>> {
  const { rows } = await pool.query<{ payload: Record<string, unknown> }>(
    'SELECT payload FROM events WHERE id = $1', [eventId],
  );
  return rows[0].payload;
}

/** The mailer's record of a send. Only a real person ever gets one (rule 6.7). */
async function seedSentMail(ageHours: number, eventId: string): Promise<void> {
  await pool.query(
    `INSERT INTO sent_mail (event_id, recipient, message_id, sent_at)
     VALUES ($1, 'private@example.com', '<msg-1@demo>',
             now() - make_interval(hours => $2))`,
    [eventId, ageHours],
  );
}

/** A visitor who typed an address: booked under it, and promised a mail to it. */
const VISITOR = {
  customerName: 'M. Berger', customerEmail: 'private@example.com',
  confirmTo: 'private@example.com', totalCents: 4900,
};

/** Nobody typed anything, so the order runs under the house and promises nothing. */
const HOUSE = {
  customerName: 'Demo order', customerEmail: HOUSE_IDENTITY,
  totalCents: 1200,
};

describe('CleanupService', () => {
  it('erases email addresses older than a day', async () => {
    await seedOrder(30);
    expect(await cleanup.run()).toBeGreaterThan(0);
    const { rows } = await pool.query('SELECT customer_email FROM orders');
    expect(rows[0].customer_email).toBe('[deleted]');
  });

  it('leaves recent orders alone', async () => {
    await seedOrder(2);
    await cleanup.run();
    const { rows } = await pool.query('SELECT customer_email FROM orders');
    expect(rows[0].customer_email).toBe('private@example.com');
  });

  it('keeps the order itself, only the address goes', async () => {
    await seedOrder(30);
    await cleanup.run();
    const { rows } = await pool.query('SELECT count(*) FROM orders');
    expect(Number(rows[0].count)).toBe(1);
  });

  it('erases the address a day-old payload was booked under', async () => {
    const eventId = await seedEvent(30, VISITOR);
    // The count is rows touched, and this payload is the only row there is.
    expect(await cleanup.run()).toBe(1);
    expect((await payloadOf(eventId)).customerEmail).toBe('[deleted]');
  });

  it('drops the promise of a mail rather than blanking it', async () => {
    const eventId = await seedEvent(30, VISITOR);
    await cleanup.run();
    expect('confirmTo' in (await payloadOf(eventId))).toBe(false);
  });

  it('leaves the rest of an emptied payload where it was', async () => {
    const eventId = await seedEvent(30, VISITOR);
    await cleanup.run();
    const payload = await payloadOf(eventId);
    expect(payload.customerName).toBe('M. Berger');
    expect(payload.totalCents).toBe(4900);
  });

  it('leaves a recent payload alone', async () => {
    const eventId = await seedEvent(2, VISITOR);
    await cleanup.run();
    const payload = await payloadOf(eventId);
    expect(payload.customerEmail).toBe('private@example.com');
    expect(payload.confirmTo).toBe('private@example.com');
  });

  it('leaves the house address in an old payload alone', async () => {
    const eventId = await seedEvent(30, HOUSE);
    expect(await cleanup.run()).toBe(0);
    expect((await payloadOf(eventId)).customerEmail)
      .toBe(HOUSE_IDENTITY);
  });

  it('finds nothing left to erase on the next sweep', async () => {
    await seedEvent(30, VISITOR);
    await cleanup.run();
    expect(await cleanup.run()).toBe(0);
  });

  it('keeps the event and its delivery history, only the address goes', async () => {
    const eventId = await seedEvent(30, VISITOR);
    await pool.query(
      `INSERT INTO deliveries (event_id, target, state, remote_ref)
       VALUES ($1, 'stripe', 'done', 'ch_123')`, [eventId],
    );
    await cleanup.run();
    const { rows } = await pool.query<{ count: string; remote_ref: string }>(
      `SELECT count(*)::text AS count, min(remote_ref) AS remote_ref
         FROM deliveries WHERE event_id = $1`, [eventId],
    );
    expect(Number(rows[0].count)).toBe(1);
    expect(rows[0].remote_ref).toBe('ch_123');
    const events = await pool.query('SELECT count(*) FROM events');
    expect(Number(events.rows[0].count)).toBe(1);
  });

  it('erases the address a day-old confirmation was sent to', async () => {
    const eventId = await seedEvent(30, VISITOR);
    await seedSentMail(30, eventId);
    await cleanup.run();
    const { rows } = await pool.query<{ recipient: string }>(
      'SELECT recipient FROM sent_mail WHERE event_id = $1', [eventId],
    );
    expect(rows[0].recipient).toBe('[deleted]');
  });

  it('leaves a recent confirmation alone', async () => {
    const eventId = await seedEvent(2, VISITOR);
    await seedSentMail(2, eventId);
    await cleanup.run();
    const { rows } = await pool.query<{ recipient: string }>(
      'SELECT recipient FROM sent_mail WHERE event_id = $1', [eventId],
    );
    expect(rows[0].recipient).toBe('private@example.com');
  });

  it('keeps the proof that the mail went out, only the address goes', async () => {
    const eventId = await seedEvent(30, VISITOR);
    await seedSentMail(30, eventId);
    await cleanup.run();
    // sent_at is the second witness of the proof chain and message_id is how the
    // send is found again. Neither is an address, so neither may move.
    const { rows } = await pool.query<{ sent_at: Date; message_id: string }>(
      'SELECT sent_at, message_id FROM sent_mail WHERE event_id = $1', [eventId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].sent_at).toBeInstanceOf(Date);
    expect(rows[0].message_id).toBe('<msg-1@demo>');
  });

  it('sweeps all three copies once and then finds nothing', async () => {
    await seedOrder(30);
    const eventId = await seedEvent(30, VISITOR);
    await seedSentMail(30, eventId);
    // One row per copy of the address, and the count must not climb after that.
    expect(await cleanup.run()).toBe(3);
    expect(await cleanup.run()).toBe(0);
  });

});
