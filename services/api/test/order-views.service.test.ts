// services/api/test/order-views.service.test.ts
// What the queue needs to say about an order rather than about a delivery: which
// order it is, when it arrived, and what was in it.
//
// The basket is priced here rather than in the browser. The page does not hold the
// catalogue, and even if it did, multiplying a price on screen would invent a total
// that could disagree with the one Stripe was charged. The figure a visitor compares
// against their receipt has to be the stored figure.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Pool } from 'pg';
import { runMigrations } from '@ngl/db';
import { OrderViewsService } from '../src/order-views.service';

let container: StartedPostgreSqlContainer;
let pool: Pool;
let orders: OrderViewsService;

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine').start();
  pool = new Pool({ connectionString: container.getConnectionUri() });
  await runMigrations(pool);
  orders = new OrderViewsService(pool);
}, 120_000);

afterAll(async () => { await pool.end(); await container.stop(); });
beforeEach(async () => { await pool.query('TRUNCATE events CASCADE'); });

async function newEvent(externalId: string): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO events (external_id, kind, payload)
     VALUES ($1, 'order.placed', '{}'::jsonb) RETURNING id`,
    [externalId],
  );
  return rows[0].id;
}

async function book(
  eventId: string,
  items: ReadonlyArray<{ sku: string; qty: number }>,
  totalCents: number,
  source: 'form' | 'email' = 'form',
): Promise<void> {
  await pool.query(
    `INSERT INTO orders (event_id, customer_name, customer_email, items, total_cents, source)
     VALUES ($1, 'Someone', 'someone@example.com', $2::jsonb, $3, $4)`,
    [eventId, JSON.stringify(items), totalCents, source],
  );
}

describe('OrderViewsService', () => {
  it('gives an event a number and the moment it arrived', async () => {
    const eventId = await newEvent('evt_one');
    const [view] = await orders.forEvents([eventId]);

    expect(view.eventId).toBe(eventId);
    expect(view.number).toBeGreaterThanOrEqual(1000);
    expect(Number.isInteger(view.number)).toBe(true);
    expect(Date.parse(view.receivedAt)).not.toBeNaN();
  });

  it('names and prices what was ordered', async () => {
    // "2 x MUG-BLUE" is a worse answer than "2 x Blue mug, 24.00 EUR", and the
    // names and prices live in the products table, one join away.
    const eventId = await newEvent('evt_named');
    await book(eventId, [{ sku: 'TEAPOT', qty: 1 }, { sku: 'MUG-BLUE', qty: 2 }], 7300);
    const [view] = await orders.forEvents([eventId]);

    expect(view.booking?.lines).toEqual([
      { sku: 'TEAPOT', name: 'Teapot', qty: 1, cents: 4900 },
      { sku: 'MUG-BLUE', name: 'Blue mug', qty: 2, cents: 2400 },
    ]);
  });

  it('reports the total that was charged rather than adding the lines up again', async () => {
    const eventId = await newEvent('evt_total');
    await book(eventId, [{ sku: 'TEAPOT', qty: 1 }, { sku: 'MUG-BLUE', qty: 2 }], 7300);
    const [view] = await orders.forEvents([eventId]);

    expect(view.booking?.totalCents).toBe(7300);
    const summed = (view.booking?.lines ?? []).reduce((sum, line) => sum + line.cents, 0);
    expect(summed).toBe(view.booking?.totalCents);
  });

  it('says where the order came in from', async () => {
    const shop = await newEvent('evt_shop');
    const mail = await newEvent('evt_mail');
    await book(shop, [{ sku: 'TEAPOT', qty: 1 }], 4900, 'form');
    await book(mail, [{ sku: 'TEAPOT', qty: 1 }], 4900, 'email');

    const views = await orders.forEvents([shop, mail]);
    const bySource = new Map(views.map((view) => [view.eventId, view.booking?.source]));
    expect(bySource.get(shop)).toBe('form');
    expect(bySource.get(mail)).toBe('email');
  });

  it('still numbers and dates an event that was never booked as an order', async () => {
    // A Stripe payment webhook makes an event with deliveries and no orders row, so
    // it reaches the queue with nothing to itemise. The card has to say so rather
    // than draw an empty basket.
    const eventId = await newEvent('evt_webhook');
    const [view] = await orders.forEvents([eventId]);

    expect(view.number).toBeGreaterThanOrEqual(1000);
    expect(view.booking).toBeNull();
  });

  it('falls back to the sku when a line names something the catalogue lost', async () => {
    const eventId = await newEvent('evt_unknown_sku');
    await book(eventId, [{ sku: 'GONE-42', qty: 3 }], 0);
    const [view] = await orders.forEvents([eventId]);

    expect(view.booking?.lines).toEqual([
      { sku: 'GONE-42', name: 'GONE-42', qty: 3, cents: 0 },
    ]);
  });

  it('says nothing about an event it has never seen', async () => {
    expect(await orders.forEvents(['00000000-0000-4000-8000-000000000000'])).toEqual([]);
  });

  it('asks the database nothing when the board is empty', async () => {
    expect(await orders.forEvents([])).toEqual([]);
  });
});
