// packages/db/test/schema.test.ts
// Guards the first frozen contract (spec 16.3). Every strand builds on this
// schema, and the UNIQUE (event_id, target) below is the exactly-once guarantee
// itself — if this test ever goes red, the demo's central claim is broken.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Pool } from 'pg';
import { runMigrations } from '../src/migrate';

let container: StartedPostgreSqlContainer;
let pool: Pool;

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine').start();
  pool = new Pool({ connectionString: container.getConnectionUri() });
  await runMigrations(pool);
}, 120_000);

afterAll(async () => { await pool.end(); await container.stop(); });

async function newEvent(externalId: string): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO events (external_id, kind, payload)
     VALUES ($1, 'order.placed', '{}'::jsonb) RETURNING id`, [externalId],
  );
  return rows[0].id;
}

describe('schema guarantees', () => {
  it('rejects a second delivery for the same event and target', async () => {
    const eventId = await newEvent('evt_dup_target');
    await pool.query(
      `INSERT INTO deliveries (event_id, target) VALUES ($1, 'hubspot')`, [eventId],
    );
    await expect(
      pool.query(`INSERT INTO deliveries (event_id, target) VALUES ($1, 'hubspot')`, [eventId]),
    ).rejects.toThrow(/duplicate key/);
  });

  it('allows different targets for the same event', async () => {
    const eventId = await newEvent('evt_two_targets');
    await pool.query(`INSERT INTO deliveries (event_id, target) VALUES ($1, 'hubspot')`, [eventId]);
    await expect(
      pool.query(`INSERT INTO deliveries (event_id, target) VALUES ($1, 'slack')`, [eventId]),
    ).resolves.toBeDefined();
  });

  it('rejects a second event with the same external id', async () => {
    await newEvent('evt_same_external');
    await expect(newEvent('evt_same_external')).rejects.toThrow(/duplicate key/);
  });

  it('rejects an unknown target', async () => {
    const eventId = await newEvent('evt_bad_target');
    await expect(
      pool.query(`INSERT INTO deliveries (event_id, target) VALUES ($1, 'facebook')`, [eventId]),
    ).rejects.toThrow(/violates check constraint/);
  });

  it('rejects an unknown delivery state', async () => {
    const eventId = await newEvent('evt_bad_state');
    await expect(
      pool.query(
        `INSERT INTO deliveries (event_id, target, state) VALUES ($1, 'slack', 'maybe')`,
        [eventId],
      ),
    ).rejects.toThrow(/violates check constraint/);
  });

  it('seeds exactly eight products', async () => {
    const { rows } = await pool.query<{ count: string }>('SELECT count(*) FROM products');
    expect(Number(rows[0].count)).toBe(8);
  });

  it('refuses paypal as a delivery target, since no worker can make one', async () => {
    // Migration 010 accepted it and 011 narrowed it back. A queue that took a
    // delivery nothing can attempt would sit at "waiting" forever, and the counter
    // that says nothing is lost would be the thing lying about it.
    const eventId = await newEvent('evt_paypal_target');
    await expect(
      pool.query(`INSERT INTO deliveries (event_id, target) VALUES ($1, 'paypal')`, [eventId]),
    ).rejects.toThrow(/violates check constraint/);
  });

  it('keeps no switch for paypal, because there is no line left to cut', async () => {
    const { rowCount } = await pool.query(
      `SELECT state FROM switches WHERE target = 'paypal'`,
    );
    expect(rowCount).toBe(0);
  });

  it('records which payment route an order took', async () => {
    const eventId = await newEvent('evt_route_recorded');
    const { rows } = await pool.query<{ payment_route: string }>(
      `INSERT INTO orders (event_id, customer_name, customer_email, items, total_cents,
                           source, payment_route)
       VALUES ($1, 'M. Berger', 'm@example.com', '[]'::jsonb, 4900, 'form', 'stripe')
       RETURNING payment_route`,
      [eventId],
    );
    expect(rows[0].payment_route).toBe('stripe');
  });

  it('refuses a payment route nothing can charge', async () => {
    const eventId = await newEvent('evt_route_invented');
    await expect(
      pool.query(
        `INSERT INTO orders (event_id, customer_name, customer_email, items, total_cents,
                             source, payment_route)
         VALUES ($1, 'M. Berger', 'm@example.com', '[]'::jsonb, 4900, 'form', 'bitcoin')`,
        [eventId],
      ),
    ).rejects.toThrow(/violates check constraint/);
  });

  it('books an order under the default route when nobody said', async () => {
    // POST /api/demo-order carries no body at all. A NOT NULL column with no default
    // would turn that endpoint into an error the first time this migration ran.
    const eventId = await newEvent('evt_route_unstated');
    const { rows } = await pool.query<{ payment_route: string }>(
      `INSERT INTO orders (event_id, customer_name, customer_email, items, total_cents, source)
       VALUES ($1, 'Demo order', 'demo@example.invalid', '[]'::jsonb, 4900, 'form')
       RETURNING payment_route`,
      [eventId],
    );
    expect(rows[0].payment_route).toBe('stripe');
  });

  it('shows the route in the read-only view, where a visitor can check it', async () => {
    const eventId = await newEvent('evt_route_public');
    await pool.query(
      `INSERT INTO orders (event_id, customer_name, customer_email, items, total_cents,
                           source, payment_route)
       VALUES ($1, 'M. Berger', 'm@example.com', '[]'::jsonb, 4900, 'form', 'stripe')`,
      [eventId],
    );
    const { rows } = await pool.query<{ payment_route: string }>(
      'SELECT payment_route FROM v_orders WHERE event_id = $1', [eventId],
    );
    expect(rows[0].payment_route).toBe('stripe');
  });

  // Two tests stood here, pinning the UNIQUE and the open message timestamp on
  // slack_visitor_sends. That table remembered a send into a visitor's own Slack,
  // because we held permission to post there and none to read. The visitor OAuth is
  // gone and migration 015 drops the table, so both claims are about nothing.

  it('exposes the five read-only views', async () => {
    const { rows } = await pool.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.views WHERE table_schema = 'public'`,
    );
    expect(rows.map((r) => r.table_name).sort())
      .toEqual(['v_backlog', 'v_dead_letters', 'v_deliveries', 'v_events', 'v_orders']);
  });

  it('puts a parked delivery in the backlog with the order around it', async () => {
    const eventId = await newEvent('evt_backlog_full');
    await pool.query(
      `INSERT INTO orders (event_id, customer_name, customer_email, items,
                           total_cents, source)
       VALUES ($1, 'R. Vogel', 'rita@example.com', '[]'::jsonb, 8400, 'form')`,
      [eventId],
    );
    await pool.query(
      `INSERT INTO deliveries (event_id, target, state, attempts, last_error)
       VALUES ($1, 'hubspot', 'dead', 6, 'ECONNRESET')`,
      [eventId],
    );

    const { rows } = await pool.query<{
      order_number: string; target: string; attempts: number;
      last_error: string; customer_name: string; customer_email: string;
      total_cents: number; parked_at: Date;
    }>('SELECT * FROM v_backlog WHERE event_id = $1', [eventId]);

    expect(rows).toHaveLength(1);
    expect(rows[0].target).toBe('hubspot');
    expect(rows[0].attempts).toBe(6);
    expect(rows[0].last_error).toBe('ECONNRESET');
    expect(rows[0].customer_name).toBe('R. Vogel');
    expect(rows[0].total_cents).toBe(8400);
    expect(Number(rows[0].order_number)).toBeGreaterThanOrEqual(1000);
    expect(rows[0].parked_at).toBeInstanceOf(Date);
  });

  // The one column a stranger should never be able to read whole. It is masked in
  // v_orders and the backlog inherits that rather than restating it.
  it('masks the address in the backlog the way v_orders does', async () => {
    const eventId = await newEvent('evt_backlog_mask');
    await pool.query(
      `INSERT INTO orders (event_id, customer_name, customer_email, items,
                           total_cents, source)
       VALUES ($1, 'K. Adler', 'katrin@example.com', '[]'::jsonb, 1200, 'form')`,
      [eventId],
    );
    await pool.query(
      `INSERT INTO deliveries (event_id, target, state, attempts)
       VALUES ($1, 'mailer', 'dead', 6)`,
      [eventId],
    );

    const { rows } = await pool.query<{ customer_email: string }>(
      'SELECT customer_email FROM v_backlog WHERE event_id = $1', [eventId],
    );
    expect(rows[0].customer_email).toBe('k***@example.com');
  });

  // A payment webhook reaches the queue without an orders row, and its delivery can
  // be parked like any other. The join must not drop it.
  it('keeps a parked delivery that has no order behind it', async () => {
    const { rows: created } = await pool.query<{ id: string }>(
      `INSERT INTO events (external_id, kind, payload)
       VALUES ('evt_backlog_no_order', 'payment.succeeded', '{}'::jsonb) RETURNING id`,
    );
    const eventId = created[0].id;
    await pool.query(
      `INSERT INTO deliveries (event_id, target, state, attempts)
       VALUES ($1, 'stripe', 'dead', 6)`,
      [eventId],
    );

    const { rows } = await pool.query<{ customer_name: string | null }>(
      'SELECT customer_name FROM v_backlog WHERE event_id = $1', [eventId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].customer_name).toBeNull();
  });

  it('leaves a delivery that is still retrying out of the backlog', async () => {
    const eventId = await newEvent('evt_backlog_pending');
    await pool.query(
      `INSERT INTO deliveries (event_id, target, state, attempts)
       VALUES ($1, 'slack', 'pending', 3)`,
      [eventId],
    );

    const { rows } = await pool.query(
      'SELECT id FROM v_backlog WHERE event_id = $1', [eventId],
    );
    expect(rows).toHaveLength(0);
  });

  it('hands every event a number without being asked for one', async () => {
    const { rows } = await pool.query<{ number: string }>(
      `INSERT INTO events (external_id, kind, payload)
       VALUES ('evt_numbered', 'order.placed', '{}'::jsonb) RETURNING number`,
    );
    expect(Number(rows[0].number)).toBeGreaterThanOrEqual(1000);
  });

  it('never gives two events the same number', async () => {
    const first = await pool.query<{ number: string }>(
      `INSERT INTO events (external_id, kind, payload)
       VALUES ('evt_number_a', 'order.placed', '{}'::jsonb) RETURNING number`,
    );
    const second = await pool.query<{ number: string }>(
      `INSERT INTO events (external_id, kind, payload)
       VALUES ('evt_number_b', 'order.placed', '{}'::jsonb) RETURNING number`,
    );
    expect(Number(second.rows[0].number)).toBeGreaterThan(Number(first.rows[0].number));
  });

  it('lets the read-only console look an order up by its number', async () => {
    // The number is the handle the queue prints on every card. A handle nobody can
    // resolve is worse than the uuid fragment it replaces, and the console reaches
    // the four views and nothing else.
    const { rows } = await pool.query<{ number: string }>(
      `INSERT INTO events (external_id, kind, payload)
       VALUES ('evt_number_lookup', 'order.placed', '{}'::jsonb) RETURNING number`,
    );
    const found = await pool.query<{ external_id: string }>(
      'SELECT external_id FROM v_events WHERE number = $1', [rows[0].number],
    );
    expect(found.rows[0].external_id).toBe('evt_number_lookup');
  });

  it('goes on counting after a reset rather than reusing a number', async () => {
    // POST /api/reset truncates events. Numbering that restarted there would let one
    // number mean two different orders on two different afternoons, and a visitor
    // who wrote one down would be quietly given somebody else's.
    const before = await pool.query<{ number: string }>(
      `INSERT INTO events (external_id, kind, payload)
       VALUES ('evt_before_reset', 'order.placed', '{}'::jsonb) RETURNING number`,
    );
    await pool.query('TRUNCATE events CASCADE');
    const after = await pool.query<{ number: string }>(
      `INSERT INTO events (external_id, kind, payload)
       VALUES ('evt_after_reset', 'order.placed', '{}'::jsonb) RETURNING number`,
    );
    expect(Number(after.rows[0].number)).toBeGreaterThan(Number(before.rows[0].number));
  });
});
