// ui/src/queue.ts
// Turns the flat delivery list back into what it actually is: one order, five
// checkpoints, and a plain sentence about where it currently stands.
//
// The specification calls the mediator the heart of the repo and defends building
// the queue by hand with "take a ready-made one and the most interesting part
// becomes invisible". It was invisible anyway: the page drew a box labelled
// "queue · retry · exactly once" and asked the visitor to believe it. This is the
// rule that makes it visible, kept pure so it can be checked without a browser.
import type { DeliveryState, DeliveryView, Target } from '@ngl/contracts';

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
  /** The first block of the uuid: short enough to read, enough to paste into SQL. */
  shortId: string;
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

export function groupIntoOrders(deliveries: DeliveryView[]): OrderCard[] {
  const byEvent = new Map<string, DeliveryView[]>();
  for (const delivery of deliveries) {
    const existing = byEvent.get(delivery.eventId);
    if (existing) existing.push(delivery);
    else byEvent.set(delivery.eventId, [delivery]);
  }

  /**
   * Delivery ids are a sequence, so the lowest one in a group is when the order
   * arrived. Sorting on that keeps the newest card on top and stops cards from
   * jumping around as their individual deliveries succeed and fail.
   */
  const arrivedAt = new Map<string, number>();
  const cards: OrderCard[] = [];

  for (const [eventId, rows] of byEvent) {
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

    arrivedAt.set(eventId, Math.min(...rows.map((r) => r.id)));
    cards.push({
      eventId,
      shortId: eventId.split('-')[0],
      steps,
      doneCount,
      total,
      headline: headlineFor(steps, doneCount, total),
    });
  }

  return cards.sort(
    (a, b) => (arrivedAt.get(b.eventId) ?? 0) - (arrivedAt.get(a.eventId) ?? 0),
  );
}
