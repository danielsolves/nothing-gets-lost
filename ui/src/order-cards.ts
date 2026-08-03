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
import {
  DEFAULT_PAYMENT_ROUTE, PAYMENT_ROUTES,
  type DeliveryState, type DeliveryView, type OrderBooking, type OrderView,
  type PaymentRoute, type Target,
} from '@ngl/contracts';
import { retryGap } from './order-time';

/**
 * Everything after the payment, always drawn and always in this order, so a card
 * reads the same every time. The payment itself is prepended per order, because an
 * order takes one of two routes and drawing a box for the route it did not take
 * would leave a checkpoint that can never be reached.
 */
const AFTER_PAYMENT = ['hubspot', 'ledger', 'slack', 'mailer'] as const;

/** Kept exported for anything that wants the shape of a card without an order. */
export const CHECKPOINTS = [DEFAULT_PAYMENT_ROUTE, ...AFTER_PAYMENT] as const;

const LABELS: Record<Target, string> = {
  stripe: 'Stripe', hubspot: 'HubSpot', ledger: 'Invoice',
  slack: 'Slack', mailer: 'Confirmation mail', custom_webhook: 'Your endpoint',
};

/**
 * Which way this order was paid, read off the delivery rows rather than carried as
 * a field of its own: exactly one payment target is ever queued per order, so the
 * rows already say it and a second copy could only disagree with them.
 *
 * Before any row exists there is nothing to read, and the card still has to draw
 * five boxes rather than four and then grow one. It falls back to the route an
 * order takes when nobody chose, which is the one it will almost always turn out
 * to be.
 */
function routeOf(found: Map<Target, DeliveryView>): PaymentRoute {
  return PAYMENT_ROUTES.find((route) => found.has(route)) ?? DEFAULT_PAYMENT_ROUTE;
}

const COUNT_WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six'];

/** 'waiting' means the queue has not created the row yet, which is not a failure. */
export type StepState = DeliveryState | 'waiting';

/**
 * What a checkpoint's mark shows, which is not quite what its row says.
 *
 * Five states go in and six come out, because 'pending' covers two pieces of news
 * that a visitor would never call the same thing: a row that has been queued and not
 * tried, and a row whose third attempt came back 503 and is sitting out its backoff.
 * The mark is the only place that difference has ever been visible at a glance.
 *
 * Split off from the component so it can be checked without a browser, and so the
 * component has one table to look up rather than a chain of ifs per state.
 */
export type CheckLook =
  'waiting' | 'queued' | 'sending' | 'retrying' | 'delivered' | 'parked';

export function checkLook(state: StepState, attempts: number): CheckLook {
  switch (state) {
    case 'waiting': return 'waiting';
    case 'inflight': return 'sending';
    case 'done': return 'delivered';
    case 'dead': return 'parked';
    default: return attempts > 0 ? 'retrying' : 'queued';
  }
}

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
  /**
   * There is no `doneCount` beside this, and there was. The card printed "2 of 5"
   * next to five marks that already said it, and the owner's answer to that was
   * "you can see it on the marks". A count nobody draws is a field that can only
   * ever agree with the steps or be wrong about them.
   */
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
function headlineFor(steps: OrderStep[], now: Date): string {
  const dead = steps.find((s) => s.state === 'dead');
  if (dead) {
    return `${dead.label} needs a human after ${dead.attempts} attempts`;
  }

  const failing = steps.find((s) => s.state === 'pending' && s.attempts > 0);
  if (failing) {
    // The countdown belongs here rather than over the queue as a whole. It is a
    // promise about this order, and this is the only line on the page that can say
    // which order it is about without naming one.
    const gap = retryGap(failing.nextAt, now);
    const failed = `${failing.label}: attempt ${failing.attempts} failed`;
    return gap ? `${failed}, next try in ${gap}` : `${failed}, trying again`;
  }

  if (steps.some((s) => s.state === 'inflight')) return 'On its way';

  // Counted over the steps the machine actually took on, not over the five marks the
  // card draws. A `waiting` step has no delivery row at all, and in practice that is
  // only ever the confirmation mail: rule 6.7 queues it once everything else is done
  // and only for an order that carried an address, so on an order without one the row
  // never appears. Counted as outstanding, it left every card on the page reading
  // "Queued" underneath four green marks, for good.
  //
  // Counted here rather than carried on the card. This line is the only thing left
  // that wants the number, and it wants it as a word.
  const taken = steps.filter((s) => s.state !== 'waiting');
  if (taken.length > 0 && taken.every((s) => s.state === 'done')) {
    const all = taken.length;
    return `All ${COUNT_WORDS[all] ?? all} delivered`;
  }
  return 'Queued';
}

export function groupIntoOrders(
  deliveries: DeliveryView[], orders: OrderView[], now: Date = new Date(),
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

    const checkpoints: readonly Target[] = [routeOf(found), ...AFTER_PAYMENT];
    const steps: OrderStep[] = checkpoints.map(
      (target) => {
        const row = found.get(target);
        return row ? toStep(row) : emptyStep(target);
      },
    );

    // The visitor's own endpoint is only part of the chain once they have set one.
    const own = found.get('custom_webhook');
    if (own) steps.push(toStep(own));

    cards.push({
      eventId: view.eventId,
      number: view.number,
      receivedAt: view.receivedAt,
      booking: view.booking,
      steps,
      headline: headlineFor(steps, now),
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
