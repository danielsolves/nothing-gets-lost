// services/api/test/stream.controller.test.ts
// The page may only show what the server holds. Reset empties the tables and says
// nothing, so the tick is the only thing that can tell the page; if the tick is a
// stream of separate rows the page can merge, a deleted row has no way to arrive.
//
// So a tick is one snapshot of the whole board, and the test that matters is the one
// that presses reset with a viewer already watching: the next snapshot must be empty.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Pool } from 'pg';
import type { Subscription } from 'rxjs';
import type { BoardSnapshot } from '@ngl/contracts';
import { runMigrations } from '@ngl/db';
import { BoardService, BOARD_DELIVERIES } from '../src/board.service';
import { CountersService } from '../src/counters.service';
import { DeliveriesService } from '../src/deliveries.service';
import { OrderViewsService } from '../src/order-views.service';
import { PresenceService } from '../src/presence.service';
import { ResetController } from '../src/reset.controller';
import { StateController } from '../src/state.controller';
import { StreamController } from '../src/stream.controller';
import { SwitchStore } from '../src/switch.store';

let container: StartedPostgreSqlContainer;
let pool: Pool;
let board: BoardService;
let switches: SwitchStore;
let presence: PresenceService;

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine').start();
  pool = new Pool({ connectionString: container.getConnectionUri() });
  await runMigrations(pool);
  switches = new SwitchStore(pool);
  presence = new PresenceService();
  board = new BoardService(
    new CountersService(pool), new DeliveriesService(pool),
    new OrderViewsService(pool), switches,
  );
}, 120_000);

afterAll(async () => { await pool.end(); await container.stop(); });
beforeEach(async () => { await pool.query('TRUNCATE events, dropped_duplicates CASCADE'); });

/** The browser going away is all this controller wants from the response. */
function connection(): {
  on: (event: 'close', listener: () => void) => void; close: () => void;
} {
  const listeners: Array<() => void> = [];
  return {
    on: (_event, listener) => { listeners.push(listener); },
    close: () => { for (const listener of listeners) listener(); },
  };
}

/** One order, queued to the targets named. A delivery per target, as the real one. */
async function seedOrder(targets: readonly string[]): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO events (external_id, kind, payload)
     VALUES ($1, 'order.placed', '{}'::jsonb) RETURNING id`,
    [`evt_${Math.random().toString(36).slice(2)}`],
  );
  await pool.query(
    `INSERT INTO deliveries (event_id, target, state, attempts, updated_at)
     SELECT $1, unnest($2::text[]), 'pending', 0, now()`,
    [rows[0].id, targets],
  );
  return rows[0].id;
}

/** The basket, as orders.service.ts writes it: skus and quantities, priced once. */
async function bookBasket(eventId: string): Promise<void> {
  await pool.query(
    `INSERT INTO orders (event_id, customer_name, customer_email, items, total_cents, source)
     VALUES ($1, 'Demo order', 'demo@example.com',
             '[{"sku":"TEAPOT","qty":1},{"sku":"MUG-BLUE","qty":2}]'::jsonb, 7300, 'form')`,
    [eventId],
  );
}

/** Enough orders to overrun any window the board might have. One delivery each. */
async function seedOrders(count: number): Promise<void> {
  await pool.query(
    `WITH created AS (
       INSERT INTO events (external_id, kind, payload)
       SELECT 'evt_' || gen_random_uuid(), 'order.placed', '{}'::jsonb
         FROM generate_series(1, $1) RETURNING id
     )
     INSERT INTO deliveries (event_id, target, state, attempts, updated_at)
     SELECT id, 'slack', 'pending', 0, now() FROM created`,
    [count],
  );
}

/** A viewer, watching. Collects the snapshots as they land. */
function watch(): { seen: BoardSnapshot[]; stop: () => void } {
  const seen: BoardSnapshot[] = [];
  const response = connection();
  const controller = new StreamController(presence, board);
  const subscription: Subscription = controller.stream(response).subscribe((message) => {
    if (message.data.type === 'board') seen.push(message.data.payload);
  });
  // Both halves of a browser leaving: express fires close, Nest drops the stream.
  return { seen, stop: () => { response.close(); subscription.unsubscribe(); } };
}

async function until(
  predicate: () => boolean, what: string, timeoutMs = 8000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

describe('StreamController', () => {
  it('pushes the whole board as one snapshot', async () => {
    await seedOrder(['slack', 'stripe']);
    const viewer = watch();
    try {
      await until(() => viewer.seen.length > 0, 'the first snapshot');
      const snapshot = viewer.seen[0];
      expect(snapshot.counters.received).toBe(1);
      expect(snapshot.deliveries).toHaveLength(2);
      expect(snapshot.timeline).toHaveLength(2);
      expect(snapshot.switches.hubspot).toBe('up');
    } finally { viewer.stop(); }
  });

  it('empties the board it pushes when reset empties the tables', async () => {
    await seedOrder(['slack', 'stripe', 'hubspot']);
    const viewer = watch();
    try {
      await until(() => viewer.seen.some((s) => s.deliveries.length === 3), 'the seeded rows');
      await new ResetController(pool, switches).reset();
      await until(
        () => viewer.seen.some((s) => s.deliveries.length === 0),
        'a snapshot without the deleted rows',
      );
      const last = viewer.seen[viewer.seen.length - 1];
      expect(last.deliveries).toEqual([]);
      expect(last.timeline).toEqual([]);
      expect(last.counters.received).toBe(0);
      expect(last.counters.waiting).toBe(0);
    } finally { viewer.stop(); }
  });

  it('counts a viewer for as long as the stream is open', async () => {
    const viewer = watch();
    try {
      expect(presence.count()).toBe(1);
    } finally { viewer.stop(); }
    expect(presence.count()).toBe(0);
  });

  it('describes an order once however many deliveries it has', async () => {
    // Number, arrival time and basket belong to the order, not to each attempt at
    // delivering it. Five copies of them on five delivery rows is five chances for
    // the payload to disagree with itself.
    const eventId = await seedOrder(['slack', 'stripe', 'hubspot']);
    await bookBasket(eventId);
    const viewer = watch();
    try {
      await until(() => viewer.seen.some((s) => s.orders.length > 0), 'the order');
      const snapshot = viewer.seen[viewer.seen.length - 1];
      expect(snapshot.deliveries).toHaveLength(3);
      expect(snapshot.orders).toHaveLength(1);
      expect(snapshot.orders[0].eventId).toBe(eventId);
      expect(snapshot.orders[0].number).toBeGreaterThanOrEqual(1000);
      expect(snapshot.orders[0].booking?.totalCents).toBe(7300);
      expect(snapshot.orders[0].booking?.lines).toHaveLength(2);
    } finally { viewer.stop(); }
  });

  it('gives every delivery in the window an order to belong to', async () => {
    await seedOrders(BOARD_DELIVERIES + 5);
    const viewer = watch();
    try {
      await until(() => viewer.seen.some((s) => s.orders.length > 0), 'the orders');
      const snapshot = viewer.seen[viewer.seen.length - 1];
      const known = new Set(snapshot.orders.map((order) => order.eventId));
      expect(snapshot.deliveries.every((row) => known.has(row.eventId))).toBe(true);
    } finally { viewer.stop(); }
  });

  it('shows the same window the state endpoint shows', async () => {
    // The page is handed its first board by /api/state and every board after that by
    // the stream. Two different windows and the list visibly shrank a second after
    // the page loaded, which reads exactly like rows disappearing.
    await seedOrders(BOARD_DELIVERIES + 5);
    const viewer = watch();
    try {
      await until(() => viewer.seen.length > 0, 'the first snapshot');
      const state = await new StateController(board, presence).read();
      expect(viewer.seen[0].deliveries).toHaveLength(BOARD_DELIVERIES);
      expect(state.deliveries).toHaveLength(BOARD_DELIVERIES);
      expect(state.timeline).toHaveLength(viewer.seen[0].timeline.length);
    } finally { viewer.stop(); }
  });
});
