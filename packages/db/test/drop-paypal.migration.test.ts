// packages/db/test/drop-paypal.migration.test.ts
// Migration 011 on a database that already carries PayPal data, which is the only
// situation it exists for. The schema test proves the constraints are narrow on a
// fresh database; nothing there can prove the cleanup, because a fresh database has
// nothing to clean. The demo host does.
//
// The runner records migrations by filename, so 001..010 are applied by marking 011
// as already done, and then unmarking it. That runs the real runner both times
// rather than a hand-rolled copy of it that could drift from the one that ships.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Pool } from 'pg';
import { runMigrations } from '../src/migrate';

const LAST = '011_drop_paypal_route.sql';

let container: StartedPostgreSqlContainer;
let pool: Pool;
let paypalEvent: string;
let stripeEvent: string;

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine').start();
  pool = new Pool({ connectionString: container.getConnectionUri() });

  await pool.query(
    `CREATE TABLE schema_migrations (
       filename text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`,
  );
  await pool.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [LAST]);
  await runMigrations(pool);

  paypalEvent = await seedOrder('evt_paid_by_paypal', 'paypal');
  stripeEvent = await seedOrder('evt_paid_by_stripe', 'stripe');

  await pool.query('DELETE FROM schema_migrations WHERE filename = $1', [LAST]);
  await runMigrations(pool);
}, 180_000);

afterAll(async () => {
  await pool.end();
  await container.stop();
});

/** An order as intake writes it: the event, the order row, and its payment leg. */
async function seedOrder(externalId: string, route: string): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO events (external_id, kind, payload)
     VALUES ($1, 'order.placed', '{}'::jsonb) RETURNING id`,
    [externalId],
  );
  const eventId = rows[0].id;
  await pool.query(
    `INSERT INTO orders (event_id, customer_name, customer_email, items, total_cents,
                         source, payment_route)
     VALUES ($1, 'M. Berger', 'm@example.com', '[]'::jsonb, 4900, 'form', $2)`,
    [eventId, route],
  );
  await pool.query(
    `INSERT INTO deliveries (event_id, target) VALUES ($1, $2), ($1, 'slack')`,
    [eventId, route],
  );
  await pool.query(
    `INSERT INTO invoices (event_id, number, total_cents) VALUES ($1, $2, 4900)`,
    [eventId, `INV-${externalId}`],
  );
  await pool.query(
    `INSERT INTO sent_mail (event_id, recipient) VALUES ($1, 'm@example.com')`,
    [eventId],
  );
  return eventId;
}

describe('migration 011 on a database that already took PayPal payments', () => {
  it('applies at all, which it cannot do while a paypal row is still there', async () => {
    // The ALTERs validate against the rows in the table. If the deletes above them
    // were dropped, the whole migration would have thrown in beforeAll and every
    // test in this file would fail rather than this one alone.
    const { rows } = await pool.query<{ filename: string }>(
      'SELECT filename FROM schema_migrations WHERE filename = $1', [LAST],
    );
    expect(rows).toHaveLength(1);
  });

  it('takes the paypal order away whole, rather than leaving a hole in its chain', async () => {
    // Deleting only the payment leg would leave an order whose money never moved
    // next to a page claiming nothing is lost.
    const { rowCount } = await pool.query('SELECT 1 FROM events WHERE id = $1', [paypalEvent]);
    expect(rowCount).toBe(0);
    const { rowCount: orders } = await pool.query(
      'SELECT 1 FROM orders WHERE event_id = $1', [paypalEvent],
    );
    expect(orders).toBe(0);
    const { rowCount: deliveries } = await pool.query(
      'SELECT 1 FROM deliveries WHERE event_id = $1', [paypalEvent],
    );
    expect(deliveries).toBe(0);
  });

  it('clears the invoice and the mail, which no foreign key would have taken', async () => {
    const { rowCount: invoices } = await pool.query(
      'SELECT 1 FROM invoices WHERE event_id = $1', [paypalEvent],
    );
    expect(invoices).toBe(0);
    const { rowCount: mail } = await pool.query(
      'SELECT 1 FROM sent_mail WHERE event_id = $1', [paypalEvent],
    );
    expect(mail).toBe(0);
  });

  it('leaves the stripe order and everything hanging off it untouched', async () => {
    const { rowCount: events } = await pool.query(
      'SELECT 1 FROM events WHERE id = $1', [stripeEvent],
    );
    expect(events).toBe(1);
    const { rowCount: deliveries } = await pool.query(
      'SELECT 1 FROM deliveries WHERE event_id = $1', [stripeEvent],
    );
    expect(deliveries).toBe(2);
    const { rowCount: invoices } = await pool.query(
      'SELECT 1 FROM invoices WHERE event_id = $1', [stripeEvent],
    );
    expect(invoices).toBe(1);
  });

  it('drops the paypal switch, so the gate has nothing left to read', async () => {
    const { rowCount } = await pool.query(
      `SELECT 1 FROM switches WHERE target = 'paypal'`,
    );
    expect(rowCount).toBe(0);
  });
});
