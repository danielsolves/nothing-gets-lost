// ui/src/backlog-rows.ts
// What is waiting for a person, turned from delivery rows into rows a reader can act
// on. Pure, like order-cards.ts and activity.ts, so what the panel claims can be
// checked without a browser.
//
// Named for the rows rather than for the panel, the way order-cards.ts is. A module
// called backlog.ts beside a component called Backlog.tsx is two files that differ
// only in case, which does not compile on a case-insensitive disk.
//
// The page has said "needs a human" since the counters existed, and until now that
// was the end of the sentence: the row sat in the queue and nothing named where it
// had gone or who was supposed to find it. It goes to a backlog, the backlog is a
// real place with a name, and the same rows can be read from outside the page in two
// ways that do not involve believing this panel: `SELECT * FROM v_backlog` in the
// console, and the backlog_list tool on the MCP server.
import type { DeliveryView, OrderView, Target } from '@ngl/contracts';

const LABELS: Record<Target, string> = {
  stripe: 'Stripe', hubspot: 'HubSpot', ledger: 'Invoice',
  slack: 'Slack', mailer: 'Confirmation mail', custom_webhook: 'Your endpoint',
};

export interface BacklogRow {
  /** The delivery id. It is what v_backlog and backlog_entry answer to. */
  id: number;
  eventId: string;
  /**
   * The order number, or null when the board has a parked delivery whose order has
   * not arrived in the same snapshot. The row is still drawn: a backlog that hides
   * an entry until it can label it nicely is the failure this panel exists to end.
   */
  number: number | null;
  target: Target;
  label: string;
  attempts: number;
  lastError: string | null;
}

/**
 * Oldest first. Ids come from a sequence, so the lowest id is the delivery that has
 * been waiting longest, and a backlog is read to find exactly that. It is the same
 * ordering the MCP tool and the view use, so the three cannot tell different stories
 * about which entry is next.
 */
export function backlogOf(
  deliveries: readonly DeliveryView[], orders: readonly OrderView[],
): BacklogRow[] {
  const numbers = new Map(orders.map((order) => [order.eventId, order.number]));

  return deliveries
    .filter((delivery) => delivery.state === 'dead')
    .map((delivery) => ({
      id: delivery.id,
      eventId: delivery.eventId,
      number: numbers.get(delivery.eventId) ?? null,
      target: delivery.target,
      label: LABELS[delivery.target],
      attempts: delivery.attempts,
      lastError: delivery.lastError,
    }))
    .sort((a, b) => a.id - b.id);
}
