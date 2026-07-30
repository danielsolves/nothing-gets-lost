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
}

export interface DeliveryTarget {
  readonly target: Target;
  /** Throws on failure. The worker turns that into a retry or a dead letter. */
  deliver(ctx: DeliveryContext): Promise<DeliveryOutcome>;
}

export function idempotencyKey(eventId: string, target: Target): string {
  return `${eventId}:${target}`;
}
