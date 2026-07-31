// services/api/src/order-views.service.ts
// What the queue needs to say about an order rather than about a delivery: which
// order it is, when it arrived, and what was in it.
//
// The basket is priced here rather than in the browser. The page does not hold the
// catalogue at all until somebody opens the order form, and even then, multiplying a
// price on screen would invent a total that could disagree with the one Stripe was
// charged. `total_cents` is read back rather than re-added for the same reason: it is
// the figure on the receipt, and the card exists to be checked against the receipt.
import type { Pool } from 'pg';
import type { OrderLine, OrderView } from '@ngl/contracts';

interface OrderViewRow {
  event_id: string;
  number: string;
  received_at: Date;
  source: 'form' | 'email' | null;
  total_cents: number | null;
  lines: OrderLine[] | null;
}

/**
 * One query, because this runs on every tick of the board. The line join is done in
 * SQL rather than by reading the eight products into the service: a cached catalogue
 * is one more thing that can be stale, and this way an sku the catalogue no longer
 * has still names itself instead of coming back blank.
 */
const READ = `
  SELECT e.id::text AS event_id,
         e.number,
         e.received_at,
         o.source,
         o.total_cents,
         (SELECT jsonb_agg(jsonb_build_object(
                   'sku',   line.item->>'sku',
                   'name',  COALESCE(p.name, line.item->>'sku'),
                   'qty',   (line.item->>'qty')::int,
                   'cents', COALESCE(p.cents, 0) * (line.item->>'qty')::int
                 ) ORDER BY line.ord)
            FROM jsonb_array_elements(o.items) WITH ORDINALITY AS line(item, ord)
            LEFT JOIN products p ON p.sku = line.item->>'sku') AS lines
    FROM events e
    LEFT JOIN orders o ON o.event_id = e.id
   WHERE e.id = ANY($1::uuid[])`;

export class OrderViewsService {
  constructor(private readonly pool: Pool) {}

  async forEvents(eventIds: readonly string[]): Promise<OrderView[]> {
    if (eventIds.length === 0) return [];
    const { rows } = await this.pool.query<OrderViewRow>(READ, [eventIds]);
    return rows.map((row) => this.toView(row));
  }

  private toView(row: OrderViewRow): OrderView {
    return {
      eventId: row.event_id,
      // bigint arrives as a string from pg, the same way delivery ids do.
      number: Number(row.number),
      receivedAt: row.received_at.toISOString(),
      booking: this.toBooking(row),
    };
  }

  /**
   * All three fields or none. They come from the one orders row, and an event can
   * reach the queue without it: a Stripe payment webhook makes an event and its
   * deliveries and never books a basket.
   */
  private toBooking(row: OrderViewRow): OrderView['booking'] {
    if (row.source === null || row.total_cents === null) return null;
    return { source: row.source, lines: row.lines ?? [], totalCents: row.total_cents };
  }
}
