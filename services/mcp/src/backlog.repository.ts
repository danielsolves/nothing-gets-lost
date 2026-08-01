// services/mcp/src/backlog.repository.ts
// Reads the backlog, and reads nothing else.
//
// The pool handed in here connects as ngl_ro: read only at the role level, with a
// two second statement timeout, and able to see five views and no table. That is the
// same role behind the public SQL console, and it is deliberate that the guarantee
// lives there rather than in this file. Anyone reading this service to decide
// whether it can be trusted with an open port should not have to believe a comment;
// they can read migration 005 instead.
import type { Pool } from 'pg';
import type { Target } from '@ngl/contracts';

/** One parked delivery, with enough of its order around it to be acted on. */
export interface BacklogEntry {
  /** The delivery row. It is what a retry would name, so it is worth printing. */
  id: number;
  eventId: string;
  /** The number the page prints on the card and a visitor can read out loud. */
  orderNumber: number;
  target: Target;
  attempts: number;
  lastError: string | null;
  parkedAt: string;
  /** Null for an event that never booked a basket, a payment webhook being one. */
  customerName: string | null;
  /** Masked in the view, so this is `k***@example.com` and never the address. */
  customerEmail: string | null;
  totalCents: number | null;
}

/** What was ordered, as it was stored. Prices are not joined in: see `lines`. */
export interface BacklogOrderLine {
  sku: string;
  qty: number;
}

export interface BacklogDetail extends BacklogEntry {
  /**
   * The basket, by sku and quantity.
   *
   * Deliberately not priced per line. The catalogue lives in `products`, which the
   * read-only role cannot see at all, so pricing here would mean widening the role
   * to make a nicer answer. The order total is already on the entry, and it is the
   * figure that was actually charged rather than one added up again here.
   */
  lines: BacklogOrderLine[];
}

interface BacklogRow {
  id: string;
  event_id: string;
  order_number: string;
  target: Target;
  attempts: number;
  last_error: string | null;
  parked_at: Date;
  customer_name: string | null;
  customer_email: string | null;
  total_cents: number | null;
}

const COLUMNS = `id, event_id, order_number, target, attempts, last_error,
                 parked_at, customer_name, customer_email, total_cents`;

const MAX_LIMIT = 100;

export class BacklogRepository {
  constructor(private readonly readonlyPool: Pool) {}

  /**
   * Oldest first. A backlog is read to find what has been waiting longest, and a
   * list that opened on the newest arrival would bury exactly that.
   */
  async list(options: { target?: Target; limit?: number } = {}): Promise<BacklogEntry[]> {
    const limit = Math.min(options.limit ?? 20, MAX_LIMIT);
    const { rows } = await this.readonlyPool.query<BacklogRow>(
      `SELECT ${COLUMNS} FROM v_backlog
        WHERE ($1::text IS NULL OR target = $1)
        ORDER BY parked_at, id
        LIMIT $2`,
      [options.target ?? null, limit],
    );
    return rows.map(toEntry);
  }

  /** How much is waiting, without pulling the whole list to count it. */
  async count(target?: Target): Promise<number> {
    const { rows } = await this.readonlyPool.query<{ total: string }>(
      `SELECT count(*)::text AS total FROM v_backlog
        WHERE ($1::text IS NULL OR target = $1)`,
      [target ?? null],
    );
    return Number(rows[0]?.total ?? 0);
  }

  /** One entry with its basket, or null when that id is not parked. */
  async entry(id: number): Promise<BacklogDetail | null> {
    const { rows } = await this.readonlyPool.query<BacklogRow>(
      `SELECT ${COLUMNS} FROM v_backlog WHERE id = $1`, [id],
    );
    const row = rows[0];
    if (!row) return null;
    return { ...toEntry(row), lines: await this.lines(row.event_id) };
  }

  private async lines(eventId: string): Promise<BacklogOrderLine[]> {
    const { rows } = await this.readonlyPool.query<{ sku: string; qty: number }>(
      `SELECT line->>'sku' AS sku, (line->>'qty')::int AS qty
         FROM v_orders o, jsonb_array_elements(o.items) AS line
        WHERE o.event_id = $1`,
      [eventId],
    );
    return rows.map((row) => ({ sku: row.sku, qty: row.qty }));
  }
}

function toEntry(row: BacklogRow): BacklogEntry {
  return {
    // Both arrive as strings: id is a bigserial and the order number a bigint.
    id: Number(row.id),
    eventId: row.event_id,
    orderNumber: Number(row.order_number),
    target: row.target,
    attempts: row.attempts,
    lastError: row.last_error,
    parkedAt: row.parked_at.toISOString(),
    customerName: row.customer_name,
    customerEmail: row.customer_email,
    totalCents: row.total_cents,
  };
}
