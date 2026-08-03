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
//
// There are two shapes here and they answer two different questions. A row is one
// parked delivery, which is what v_backlog holds, what the MCP tool lists and what
// the tab counts. A card is one parked order, because the panel draws the queue's
// order card now: an order whose Slack post and confirmation mail both stopped is
// one order that needs a person, and drawing it twice would print the same basket,
// the same arrival and the same five marks under two headings.
//
// The card is built on top of the row rather than beside it, so the ordering rule
// lives in one place and the two cannot disagree about which entry is next.
import type { DeliveryView, OrderBooking, OrderView, Target } from '@ngl/contracts';
import { groupIntoOrders, type OrderCard, type OrderStep } from './order-cards';

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

/** One stopped checkpoint, said in two lines: what went wrong, then what it means. */
export interface BacklogFault {
  /** The delivery id. backlog_entry on the MCP server answers to this one. */
  id: number;
  target: Target;
  label: string;
  attempts: number;
  /**
   * What came back from the driver, whole. It is the one fact this panel exists to
   * carry, so it is a field of its own rather than the tail of the sentence below.
   * It used to be appended to that sentence in brackets, behind the attempt count,
   * which put the reason last on the quietest line of the row.
   */
  why: string;
  /** Which system, how many tries, and who has it now. */
  how: string;
}

/**
 * One parked order, in the shape the queue's card wants. Everything other than the
 * faults is the queue card's own, read off it wherever the order is on the board.
 */
export interface BacklogCard {
  /**
   * The lowest parked delivery id on this order. It ranks the card, for the reason
   * backlogOf sorts on it, and it is the handle the card wears when the order number
   * is missing.
   */
  id: number;
  eventId: string;
  /** Null when the order has not arrived in this snapshot. */
  number: number | null;
  receivedAt: string | null;
  booking: OrderBooking | null;
  steps: OrderStep[];
  faults: BacklogFault[];
}

/**
 * Better than a blank line where the reason goes. A driver that threw without a
 * message is itself worth knowing about, and an empty field reads as a panel that
 * lost the reason rather than as a machine that never got one.
 */
const NOTHING_SAID = 'Nothing came back to say why';

function faultOf(row: BacklogRow): BacklogFault {
  const tries = row.attempts === 1 ? '1 attempt' : `${row.attempts} attempts`;
  return {
    id: row.id,
    target: row.target,
    label: row.label,
    attempts: row.attempts,
    why: row.lastError ?? NOTHING_SAID,
    // The sentence the queue card already gives a step in this state. One wording
    // for one fact, so the two tabs cannot describe the same delivery differently.
    how: `${row.label}, written to the backlog after ${tries}, `
      + 'a person has to review it',
  };
}

/**
 * The checkpoints of an order that is not on the board, which is every row that
 * exists for it and no invented ones. groupIntoOrders is driven by the order list and
 * drops such a delivery, and it is right to: a queue card that cannot say which order
 * it is has nothing to offer for the one frame it would live. A backlog entry does,
 * and dropping it here would be the disappearance this panel exists to prevent.
 */
function strandedSteps(
  deliveries: readonly DeliveryView[], eventId: string,
): OrderStep[] {
  return deliveries
    .filter((delivery) => delivery.eventId === eventId)
    .sort((one, other) => one.id - other.id)
    .map((delivery) => ({
      target: delivery.target,
      label: LABELS[delivery.target],
      state: delivery.state,
      attempts: delivery.attempts,
      nextAt: delivery.nextAt,
      lastError: delivery.lastError,
      remoteRef: delivery.remoteRef,
    }));
}

/**
 * Oldest first, gathered per order. The rows arrive in that order already and a Map
 * keeps the order things were put into it, so the first parked delivery of an order
 * both places its card and ranks it.
 */
export function backlogCards(
  deliveries: readonly DeliveryView[], orders: readonly OrderView[],
): BacklogCard[] {
  const drawn = new Map<string, OrderCard>(
    groupIntoOrders([...deliveries], [...orders]).map((card) => [card.eventId, card]),
  );
  const parked = new Map<string, BacklogCard>();

  for (const row of backlogOf(deliveries, orders)) {
    const started = parked.get(row.eventId);
    if (started) {
      started.faults.push(faultOf(row));
      continue;
    }

    const card = drawn.get(row.eventId);
    parked.set(row.eventId, {
      id: row.id,
      eventId: row.eventId,
      number: row.number,
      receivedAt: card?.receivedAt ?? null,
      booking: card?.booking ?? null,
      steps: card?.steps ?? strandedSteps(deliveries, row.eventId),
      faults: [faultOf(row)],
    });
  }

  return [...parked.values()];
}
