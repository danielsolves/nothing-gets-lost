// services/api/test/orders.controller.test.ts
// Pins the visitor's own order: priced from the catalogue, four deliveries queued
// with the confirmation mail left to rule 6.7, and every malformed order refused.
//
// The plan drives this against the mediator's IntakeService. That strand is being
// built in parallel and its source is not in this tree, so the intake port is
// exercised by an in-process stand-in with the same frozen semantics (task 6).
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Pool } from 'pg';
import { runMigrations } from '@ngl/db';
import { isPaymentRoute, type PlaceOrderRequest } from '@ngl/contracts';
import { OrderViewsService } from '../src/order-views.service';
import { OrdersService } from '../src/orders.service';
import type { EventIntake, IntakeInput, IntakeResult } from '../src/intake.port';

let container: StartedPostgreSqlContainer;
let pool: Pool;
let orders: OrdersService;

class InProcessIntake implements EventIntake {
  constructor(private readonly pool: Pool) {}

  async accept(input: IntakeInput): Promise<IntakeResult> {
    const inserted = await this.pool.query<{ id: string }>(
      `INSERT INTO events (external_id, kind, payload)
       VALUES ($1, $2, $3::jsonb) ON CONFLICT (external_id) DO NOTHING RETURNING id`,
      [input.externalId, input.kind, JSON.stringify(input.payload)],
    );
    if (inserted.rowCount === 0) {
      const existing = await this.pool.query<{ id: string }>(
        'SELECT id FROM events WHERE external_id = $1', [input.externalId],
      );
      return { eventId: existing.rows[0].id, accepted: false, enqueued: [] };
    }
    const eventId = inserted.rows[0].id;
    for (const target of input.targets) {
      await this.pool.query(
        'INSERT INTO deliveries (event_id, target) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [eventId, target],
      );
    }
    return { eventId, accepted: true, enqueued: [...input.targets] };
  }
}

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine').start();
  pool = new Pool({ connectionString: container.getConnectionUri() });
  await runMigrations(pool);
  orders = new OrdersService(pool, new InProcessIntake(pool));
}, 120_000);

afterAll(async () => { await pool.end(); await container.stop(); });
beforeEach(async () => { await pool.query('TRUNCATE events CASCADE'); });

const request = {
  customerName: 'M. Berger',
  customerEmail: 'm@example.com',
  items: [{ sku: 'MUG-BLUE', qty: 3 }, { sku: 'TEAPOT', qty: 1 }],
};

describe('OrdersService', () => {
  it('prices the order from the catalogue, never from the request', async () => {
    const result = await orders.place(request);
    const { rows } = await pool.query('SELECT total_cents FROM orders WHERE id = $1', [result.orderId]);
    expect(rows[0].total_cents).toBe(3 * 1200 + 4900);
  });

  it('shows the queue the same total the payment is asked for', async () => {
    // The card in the queue exists to be held up against the Stripe receipt, so the
    // two figures may never be arrived at separately. The stripe target charges
    // payload.totalCents, and this is the one place both ends can be seen at once.
    const placed = await orders.place(request);
    const [view] = await new OrderViewsService(pool).forEvents([placed.eventId]);
    const { rows } = await pool.query<{ payload: { totalCents: number } }>(
      'SELECT payload FROM events WHERE id = $1', [placed.eventId],
    );

    expect(view.booking?.totalCents).toBe(rows[0].payload.totalCents);
    const summed = (view.booking?.lines ?? []).reduce((sum, line) => sum + line.cents, 0);
    expect(summed).toBe(view.booking?.totalCents);
  });

  it('queues four deliveries and lets rule 6.7 add the mail later', async () => {
    const result = await orders.place(request);
    const { rows } = await pool.query(
      'SELECT target FROM deliveries WHERE event_id = $1 ORDER BY target', [result.eventId],
    );
    expect(rows.map((r) => r.target)).toEqual(['hubspot', 'ledger', 'slack', 'stripe']);
  });

  // An order is charged through exactly one provider. Two would be a shop that
  // bills twice, none a shop that ships for free, and the demo only shows things
  // that are true. There is one provider today, so what these guard is that the
  // route is still decided once, written down, and read back rather than assumed.

  it('queues exactly one payment target, whatever else it queues', async () => {
    const result = await orders.place({ ...request, paymentRoute: 'stripe' });
    const { rows } = await pool.query<{ target: string }>(
      'SELECT target FROM deliveries WHERE event_id = $1 ORDER BY target', [result.eventId],
    );
    const paying = rows.filter((row) => isPaymentRoute(row.target));
    expect(paying).toHaveLength(1);
    expect(rows.map((r) => r.target)).toEqual(['hubspot', 'ledger', 'slack', 'stripe']);
  });

  it('books the route on the order, where the read-only console can reach it', async () => {
    const result = await orders.place({ ...request, paymentRoute: 'stripe' });
    const { rows } = await pool.query<{ payment_route: string }>(
      'SELECT payment_route FROM orders WHERE id = $1', [result.orderId],
    );
    expect(rows[0].payment_route).toBe('stripe');
  });

  it('carries the route in the payload, the only copy the mediator reads', async () => {
    // A mediator that restarts mid-order reads the payload back rather than
    // deciding anything again, and it never looks at the orders table.
    const result = await orders.place({ ...request, paymentRoute: 'stripe' });
    const { rows } = await pool.query<{ route: string }>(
      `SELECT payload->>'paymentRoute' AS route FROM events WHERE id = $1`,
      [result.eventId],
    );
    expect(rows[0].route).toBe('stripe');
  });

  it('sends an order with no stated route to stripe, and says so on the row', async () => {
    const result = await orders.place(request);
    const { rows } = await pool.query<{ payment_route: string }>(
      'SELECT payment_route FROM orders WHERE id = $1', [result.orderId],
    );
    expect(rows[0].payment_route).toBe('stripe');
  });

  it('sends the demo order, which carries no body at all, to stripe', async () => {
    const result = await orders.placeDemo(request.items);
    const { rows } = await pool.query(
      'SELECT target FROM deliveries WHERE event_id = $1 ORDER BY target', [result.eventId],
    );
    expect(rows.map((r) => r.target)).toContain('stripe');
  });

  it('refuses a payment route nothing can charge', async () => {
    // Not a cast: JSON.parse is what the body actually arrives as, and the type
    // annotation is the same claim the controller makes about it. The claim is
    // wrong here, which is exactly the case the check exists for.
    const fromTheWire: PlaceOrderRequest = JSON.parse(
      '{"items":[{"sku":"MUG-BLUE","qty":1}],"paymentRoute":"bitcoin"}',
    );
    await expect(orders.place(fromTheWire)).rejects.toThrow(/payment route/i);
  });

  it('rejects an unknown sku instead of pricing it as zero', async () => {
    await expect(orders.place({ ...request, items: [{ sku: 'MUG-AZURE', qty: 1 }] }))
      .rejects.toThrow(/unknown sku/i);
  });

  it('rejects an empty order', async () => {
    await expect(orders.place({ ...request, items: [] })).rejects.toThrow(/no items/i);
  });

  it('rejects an invalid email, since the mail is the strongest proof', async () => {
    await expect(orders.place({ ...request, customerEmail: 'not-an-email' }))
      .rejects.toThrow(/email/i);
  });

  // Spec 9.7 makes the address mandatory. It is optional here on the owner's
  // instruction, so that a visitor can watch a real order go through before
  // deciding to hand anything over. The tests below are what "optional" has to
  // mean if the demo is to stay honest about it.

  it('accepts an order with no address at all', async () => {
    const result = await orders.place({ items: request.items });
    expect(result.eventId).toBeTruthy();
  });

  it('promises a confirmation only to somebody who asked for one', async () => {
    const withAddress = await orders.place(request);
    const without = await orders.place({ items: request.items });

    const { rows } = await pool.query<{ id: string; confirm_to: string | null }>(
      `SELECT id, payload->>'confirmTo' AS confirm_to FROM events WHERE id = ANY($1)`,
      [[withAddress.eventId, without.eventId]],
    );
    const byId = new Map(rows.map((row) => [row.id, row.confirm_to]));
    expect(byId.get(withAddress.eventId)).toBe('m@example.com');
    expect(byId.get(without.eventId)).toBeNull();
  });

  it('still books an anonymous order under an identity Stripe and HubSpot can use', async () => {
    // Both of those need an address as a natural key. Dropping it would break
    // exactly-once at HubSpot, which is the more expensive promise to lose.
    const result = await orders.place({ items: request.items });
    const { rows } = await pool.query<{ email: string }>(
      `SELECT payload->>'customerEmail' AS email FROM events WHERE id = $1`,
      [result.eventId],
    );
    expect(rows[0].email).toMatch(/@/);
  });

  it('treats a blank address as no address rather than refusing the order', async () => {
    const result = await orders.place({ ...request, customerEmail: '   ' });
    const { rows } = await pool.query(
      `SELECT payload->>'confirmTo' AS confirm_to FROM events WHERE id = $1`,
      [result.eventId],
    );
    expect(rows[0].confirm_to).toBeNull();
  });

  it('places the demo order without inventing a customer to write to', async () => {
    const result = await orders.placeDemo(request.items);
    const { rows } = await pool.query(
      `SELECT payload->>'confirmTo' AS confirm_to FROM events WHERE id = $1`,
      [result.eventId],
    );
    expect(rows[0].confirm_to).toBeNull();
  });
});
