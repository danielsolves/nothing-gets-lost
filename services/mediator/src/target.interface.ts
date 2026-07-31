// services/mediator/src/target.interface.ts
// Contract every delivery target implements (spec 6.5).
//
// idempotencyKey is not optional. The hard case this project exists to solve is:
// the call went out, the target processed it, and the worker died before recording
// success. Bookkeeping cannot fix that — only the target recognising the key can.
// Making the key part of the signature means a target without idempotency cannot
// be written in the first place.
import type { Target } from '@ngl/contracts';

export interface DeliveryContext {
  eventId: string;
  idempotencyKey: string;
  payload: unknown;
}

export interface DeliveryOutcome {
  /** Id assigned by the remote system, shown in the proof panel. */
  remoteRef: string | null;
  /** Timestamp assigned by the remote system, never by us. */
  remoteAt: Date | null;
  /**
   * A page about this delivery that a third party serves, not us. Only Stripe has
   * one today, and it is the strongest payment proof in the demo (spec 9.2), so it
   * is kept on the event rather than thrown away with the rest of the response.
   */
  receiptUrl?: string | null;
}

export interface DeliveryTarget {
  readonly target: Target;
  /** Throws on failure. The worker turns that into a retry or a dead letter. */
  deliver(ctx: DeliveryContext): Promise<DeliveryOutcome>;
}

export function idempotencyKey(eventId: string, target: Target): string {
  return `${eventId}:${target}`;
}

/**
 * A failure that retrying cannot repair, so the delivery goes straight to the dead
 * letter box (spec 6.6) rather than spending six attempts to arrive there anyway.
 *
 * There is exactly one today: a Slack message into a visitor's own workspace whose
 * fate is unknown because the worker died mid-call, and where we hold no history
 * scope to look it up. Posting again might duplicate a message in a stranger's
 * Slack; giving up would lose it. Parking it visibly does neither, and the counter
 * that matters still reads lost 0.
 */
export class UnresolvableDelivery extends Error {
  readonly terminal = true;

  constructor(message: string) {
    super(message);
    this.name = 'UnresolvableDelivery';
  }
}

export function isTerminal(error: unknown): boolean {
  return error instanceof UnresolvableDelivery;
}
