// services/mcp/src/orders.repository.ts
// Reads orders that have already been taken, and reads nothing that says who took
// them.
//
// A second repository rather than more methods on BacklogRepository, because the two
// answer different questions. The backlog is what still needs a person; this is the
// history whether or not anything went wrong. They share the pool and therefore the
// role, which is where the read-only guarantee actually lives (migration 005).
//
// Three of the four things an order has to report already had a view: v_events has
// the number a visitor can read out loud and the moment it arrived, v_orders has the
// total, v_deliveries has how each system fared. The fourth, the basket priced as it
// was charged, needed migration 016. v_orders carries only sku and quantity, and the
// catalogue that would name and price them is a table this role cannot see.
//
// Two columns are conspicuously absent from every SELECT below, and their absence is
// the point of this file. v_orders offers customer_name whole and customer_email
// masked, and neither is asked for. `customerEmail` is the identity an order is
// booked under and `confirmTo` is the address a visitor typed (see
// services/api/src/orders.service.ts); an open MCP port that any client can reach is
// not where either of them is answered from. The nightly sweep in cleanup.service.ts
// erases the address after 24 hours, and this file never holds it long enough to be
// swept.
//
// last_error is left out of the delivery report for the same reason, and it is worth
// naming because it is on v_deliveries and the backlog tools do return it. It is a
// third party's own sentence about our request, and a rejection is free to quote the
// value it disliked. A tool that promises to carry no address cannot carry a field
// that is allowed to spell one.
import type { Pool } from 'pg';
import type { DeliveryState, OrderLine, Target } from '@ngl/contracts';

/** How one system fared for one order. */
export interface OrderDelivery {
  target: Target;
  state: DeliveryState;
  attempts: number;
  /** What the third party called it, once it has answered with something to name. */
  remoteRef: string | null;
}

/** One order that has already happened, whole, and with nobody's name on it. */
export interface PastOrder {
  /** From the sequence on events. The number printed on the card (migration 009). */
  orderNumber: number;
  eventId: string;
  /** When the order reached the queue, on our clock. */
  receivedAt: string;
  /** The figure that was charged, read back rather than added up again here. */
  totalCents: number;
  lines: OrderLine[];
  deliveries: OrderDelivery[];
}

interface OrderRow {
  event_id: string;
  number: string;
  received_at: Date;
  total_cents: number;
}

interface LineRow {
  event_id: string;
  sku: string;
  name: string;
  qty: number;
  cents: number;
}

interface DeliveryRow {
  event_id: string;
  target: Target;
  state: DeliveryState;
  attempts: number;
  remote_ref: string | null;
}

/**
 * The join, written once. It is an inner join on purpose: not every event booked a
 * basket, a payment webhook being one, and an order history that listed those would
 * be listing rows with no order in them.
 */
const FROM_ORDERS = `FROM v_orders o JOIN v_events e ON e.id = o.event_id`;
const COLUMNS = `o.event_id, e.number, e.received_at, o.total_cents`;

const MAX_LIMIT = 100;

export class OrdersRepository {
  constructor(private readonly readonlyPool: Pool) {}

  /**
   * Newest first, which is the opposite of the backlog next door and for the same
   * reason. A backlog is read to find what has waited longest; a history is read to
   * find what just happened, and a list that opened on the oldest order would bury
   * exactly that behind every order ever placed.
   */
  async list(options: { limit?: number } = {}): Promise<PastOrder[]> {
    const limit = Math.min(options.limit ?? 20, MAX_LIMIT);
    const { rows } = await this.readonlyPool.query<OrderRow>(
      `SELECT ${COLUMNS} ${FROM_ORDERS}
        ORDER BY e.received_at DESC, e.number DESC
        LIMIT $1`,
      [limit],
    );
    return this.fill(rows);
  }

  /** How many orders there are, without pulling them all to count them. */
  async count(): Promise<number> {
    const { rows } = await this.readonlyPool.query<{ total: string }>(
      `SELECT count(*)::text AS total ${FROM_ORDERS}`,
    );
    return Number(rows[0]?.total ?? 0);
  }

  /** One order by the number the visitor was shown, or null when nobody has it. */
  async byNumber(orderNumber: number): Promise<PastOrder | null> {
    const { rows } = await this.readonlyPool.query<OrderRow>(
      `SELECT ${COLUMNS} ${FROM_ORDERS} WHERE e.number = $1`,
      [orderNumber],
    );
    const filled = await this.fill(rows);
    return filled[0] ?? null;
  }

  /**
   * Both lists for the whole page in one query each, rather than two queries per
   * order. Twenty orders is twenty round trips the moment this is written the
   * obvious way, and the answer is identical.
   */
  private async fill(rows: OrderRow[]): Promise<PastOrder[]> {
    if (rows.length === 0) return [];
    const eventIds = rows.map((row) => row.event_id);
    const [lines, deliveries] = await Promise.all([
      this.lines(eventIds),
      this.deliveries(eventIds),
    ]);
    return rows.map((row) => ({
      // bigint arrives as a string from pg, the same way delivery ids do.
      orderNumber: Number(row.number),
      eventId: row.event_id,
      receivedAt: row.received_at.toISOString(),
      totalCents: row.total_cents,
      lines: lines.get(row.event_id) ?? [],
      deliveries: deliveries.get(row.event_id) ?? [],
    }));
  }

  private async lines(eventIds: string[]): Promise<Map<string, OrderLine[]>> {
    const { rows } = await this.readonlyPool.query<LineRow>(
      `SELECT event_id, sku, name, qty, cents FROM v_order_lines
        WHERE event_id = ANY($1::uuid[])
        ORDER BY event_id, line_no`,
      [eventIds],
    );
    return group(rows, (row) => ({
      sku: row.sku, name: row.name, qty: row.qty, cents: row.cents,
    }));
  }

  /**
   * Ordered by the delivery id, which is the order the targets were queued in, so
   * the payment leads and the confirmation mail trails. Sorting by target instead
   * would read alphabetically and tell a reader nothing about what happened when.
   */
  private async deliveries(eventIds: string[]): Promise<Map<string, OrderDelivery[]>> {
    const { rows } = await this.readonlyPool.query<DeliveryRow>(
      `SELECT event_id, target, state, attempts, remote_ref FROM v_deliveries
        WHERE event_id = ANY($1::uuid[])
        ORDER BY event_id, id`,
      [eventIds],
    );
    return group(rows, (row) => ({
      target: row.target, state: row.state, attempts: row.attempts, remoteRef: row.remote_ref,
    }));
  }
}

/** Rows carrying an event_id, bucketed by it, keeping the order they arrived in. */
function group<Row extends { event_id: string }, Item>(
  rows: Row[], toItem: (row: Row) => Item,
): Map<string, Item[]> {
  const byEvent = new Map<string, Item[]>();
  for (const row of rows) {
    const bucket = byEvent.get(row.event_id);
    if (bucket) bucket.push(toItem(row));
    else byEvent.set(row.event_id, [toItem(row)]);
  }
  return byEvent;
}
