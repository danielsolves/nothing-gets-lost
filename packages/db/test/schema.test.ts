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

  it('accepts paypal as a delivery target', async () => {
    const eventId = await newEvent('evt_paypal_target');
    await expect(
      pool.query(`INSERT INTO deliveries (event_id, target) VALUES ($1, 'paypal')`, [eventId]),
    ).resolves.toBeDefined();
  });

  it('gives paypal a switch of its own, so the line to it can be cut', async () => {
    // Without the row the gate reads no state for paypal and every call sails
    // through, which would make "cut the line to PayPal" a button that does nothing.
    const { rows } = await pool.query<{ state: string }>(
      `SELECT state FROM switches WHERE target = 'paypal'`,
    );
    expect(rows[0].state).toBe('up');
  });

  it('records which payment route an order took', async () => {
    const eventId = await newEvent('evt_route_recorded');
    const { rows } = await pool.query<{ payment_route: string }>(
      `INSERT INTO orders (event_id, customer_name, customer_email, items, total_cents,
                           source, payment_route)
       VALUES ($1, 'M. Berger', 'm@example.com', '[]'::jsonb, 4900, 'form', 'paypal')
       RETURNING payment_route`,
      [eventId],
    );
    expect(rows[0].payment_route).toBe('paypal');
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
       VALUES ($1, 'M. Berger', 'm@example.com', '[]'::jsonb, 4900, 'form', 'paypal')`,
      [eventId],
    );
    const { rows } = await pool.query<{ payment_route: string }>(
      'SELECT payment_route FROM v_orders WHERE event_id = $1', [eventId],
    );
    expect(rows[0].payment_route).toBe('paypal');
  });

  it('allows only one slack send marker per event', async () => {
    const eventId = await newEvent('evt_one_marker');
    await pool.query(
      `INSERT INTO slack_visitor_sends (event_id, marker) VALUES ($1, $2)`,
      [eventId, `${eventId}:slack`],
    );
    await expect(
      pool.query(
        `INSERT INTO slack_visitor_sends (event_id, marker) VALUES ($1, $2)`,
        [eventId, `${eventId}:slack`],
      ),
    ).rejects.toThrow(/duplicate key/);
  });

  it('starts a slack send marker with no message timestamp', async () => {
    const eventId = await newEvent('evt_marker_open');
    const { rows } = await pool.query<{ message_ts: string | null }>(
      `INSERT INTO slack_visitor_sends (event_id, marker) VALUES ($1, $2)
       RETURNING message_ts`,
      [eventId, `${eventId}:slack`],
    );
    expect(rows[0].message_ts).toBeNull();
  });

  it('exposes the four read-only views', async () => {
    const { rows } = await pool.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.views WHERE table_schema = 'public'`,
    );
    expect(rows.map((r) => r.table_name).sort())
      .toEqual(['v_dead_letters', 'v_deliveries', 'v_events', 'v_orders']);
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
