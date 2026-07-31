// ui/src/order-cards.ts
// Turns the flat delivery list back into what it actually is: one order, five
// checkpoints, and a plain sentence about where it currently stands.
//
// The specification calls the mediator the heart of the repo and defends building
// the queue by hand with "take a ready-made one and the most interesting part
// becomes invisible". It was invisible anyway: the page drew a box labelled
// "queue · retry · exactly once" and asked the visitor to believe it. This is the
// rule that makes it visible, kept pure so it can be checked without a browser.
//
// It takes two lists. The deliveries say how the order is getting on; the order entry
// says which order it is, when it came in and what was in it, none of which a
// delivery row knows and none of which is worth repeating on all five of them.
import type {
  DeliveryState, DeliveryView, OrderBooking, OrderView, Target,
} from '@ngl/contracts';

/** Always drawn, always in this order, so a card reads the same every time. */
export const CHECKPOINTS = ['stripe', 'hubspot', 'ledger', 'slack', 'mailer'] as const;

const LABELS: Record<Target, string> = {
  stripe: 'Stripe', hubspot: 'HubSpot', ledger: 'Invoice',
  slack: 'Slack', mailer: 'Confirmation mail', custom_webhook: 'Your endpoint',
};

const COUNT_WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six'];

/** 'waiting' means the queue has not created the row yet, which is not a failure. */
export type StepState = DeliveryState | 'waiting';

export interface OrderStep {
  target: Target;
  label: string;
  state: StepState;
  attempts: number;
  nextAt: string | null;
  lastError: string | null;
  remoteRef: string | null;
}

export interface OrderCard {
  eventId: string;
  /** From a sequence on events: readable out loud, and `v_events` answers to it. */
  number: number;
  receivedAt: string;
  /** Null for an order that was never booked as a basket, a payment webhook being one. */
  booking: OrderBooking | null;
  steps: OrderStep[];
  doneCount: number;
  total: number;
  headline: string;
}

function emptyStep(target: Target): OrderStep {
  return {
    target, label: LABELS[target], state: 'waiting',
    attempts: 0, nextAt: null, lastError: null, remoteRef: null,
  };
}

function toStep(delivery: DeliveryView): OrderStep {
  return {
    target: delivery.target,
    label: LABELS[delivery.target],
    state: delivery.state,
    attempts: delivery.attempts,
    nextAt: delivery.nextAt,
    lastError: delivery.lastError,
    remoteRef: delivery.remoteRef,
  };
}

/**
 * What the card says in one line. Ordered by what a visitor most needs to know:
 * something parked beats something retrying, and both beat quiet progress.
 */
function headlineFor(steps: OrderStep[], doneCount: number, total: number): string {
  const dead = steps.find((s) => s.state === 'dead');
  if (dead) {
    return `${dead.label} needs a human after ${dead.attempts} attempts`;
  }

  const failing = steps.find((s) => s.state === 'pending' && s.attempts > 0);
  if (failing) {
    return `${failing.label}: attempt ${failing.attempts} failed, trying again`;
  }

  if (steps.some((s) => s.state === 'inflight')) return 'On its way';
  if (doneCount === total) return `All ${COUNT_WORDS[total] ?? total} delivered`;
  return 'Queued';
}

export function groupIntoOrders(
  deliveries: DeliveryView[], orders: OrderView[],
): OrderCard[] {
  const byEvent = new Map<string, DeliveryView[]>();
  for (const delivery of deliveries) {
    const existing = byEvent.get(delivery.eventId);
    if (existing) existing.push(delivery);
    else byEvent.set(delivery.eventId, [delivery]);
  }

  const cards: OrderCard[] = [];

  for (const view of orders) {
    const rows = byEvent.get(view.eventId);
    if (!rows) continue;

    const found = new Map<Target, DeliveryView>();
    for (const row of rows) found.set(row.target, row);

    const steps: OrderStep[] = CHECKPOINTS.map(
      (target) => {
        const row = found.get(target);
        return row ? toStep(row) : emptyStep(target);
      },
    );

    // The visitor's own endpoint is only part of the chain once they have set one.
    const own = found.get('custom_webhook');
    if (own) steps.push(toStep(own));

    const doneCount = steps.filter((s) => s.state === 'done').length;
    const total = steps.length;

    cards.push({
      eventId: view.eventId,
      number: view.number,
      receivedAt: view.receivedAt,
      booking: view.booking,
      steps,
      doneCount,
      total,
      headline: headlineFor(steps, doneCount, total),
    });
  }

  /**
   * Driven by the order list rather than by the deliveries, which also decides what
   * happens to a delivery whose order is missing: no card. The two lists are read a
   * moment apart, so a reset landing between them is real, and a card that cannot
   * say which order it is has nothing to offer for the one frame it would live.
   *
   * The number is a sequence, so sorting on it descending puts the newest card on
   * top and holds it there while its individual deliveries succeed and fail.
   */
  return cards.sort((a, b) => b.number - a.number);
}
