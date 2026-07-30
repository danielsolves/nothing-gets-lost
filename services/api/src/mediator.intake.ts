// services/api/src/mediator.intake.ts
// The production wiring of the intake port: the api hands events to the mediator
// over its internal endpoint instead of writing the queue itself, so the
// exactly-once rules live in exactly one service (spec 4).
import type { EventIntake, IntakeInput, IntakeResult } from './intake.port';

const MEDIATOR_URL = process.env.MEDIATOR_URL ?? 'http://mediator:3002';

export class MediatorIntake implements EventIntake {
  async accept(input: IntakeInput): Promise<IntakeResult> {
    const response = await fetch(`${MEDIATOR_URL}/internal/enqueue`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    });
    if (!response.ok) {
      throw new Error(`the mediator refused the event: ${response.status}`);
    }
    return (await response.json()) as IntakeResult;
  }
}
