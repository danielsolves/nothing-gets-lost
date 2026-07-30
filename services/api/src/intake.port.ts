// services/api/src/intake.port.ts
// The one thing the api needs from the mediator: hand over an event and get back
// whether it was new. Declared as a port so the api can talk to the mediator over
// HTTP in production while a test drives the very same shape in process.
import type { EventKind, Target } from '@ngl/contracts';

export interface IntakeInput {
  externalId: string;
  kind: EventKind;
  payload: unknown;
  targets: readonly Target[];
}

export interface IntakeResult {
  eventId: string;
  /** False when the same external id arrived before — a dropped duplicate. */
  accepted: boolean;
  enqueued: Target[];
}

export interface EventIntake {
  accept(input: IntakeInput): Promise<IntakeResult>;
}
