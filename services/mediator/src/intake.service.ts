// services/mediator/src/intake.service.ts
// Intake with deduplication (spec 6.2). ON CONFLICT DO NOTHING on the unique
// external_id is what makes a repeated Stripe webhook harmless — the "deliver the
// payment twice" button on the control panel exercises exactly this path.
//
// The RETURNING/SELECT combination is deliberate: on conflict the INSERT returns
// nothing, so the existing id has to be read back. Two simultaneous copies of the
// same webhook therefore end up with the same event id, and only one of them
// reports accepted: true.
import type { Pool } from 'pg';
import type { EventKind, Target } from '@ngl/contracts';
import type { QueueRepository } from './queue.repository';

export interface IntakeInput {
  externalId: string;
  kind: EventKind;
  payload: unknown;
  targets: readonly Target[];
}

export interface IntakeResult {
  eventId: string;
  accepted: boolean;
  enqueued: Target[];
}

export class IntakeService {
  constructor(
    private readonly pool: Pool,
    private readonly queue: QueueRepository,
  ) {}

  async accept(input: IntakeInput): Promise<IntakeResult> {
    const inserted = await this.pool.query<{ id: string }>(
      `INSERT INTO events (external_id, kind, payload)
       VALUES ($1, $2, $3::jsonb)
       ON CONFLICT (external_id) DO NOTHING
       RETURNING id`,
      [input.externalId, input.kind, JSON.stringify(input.payload)],
    );

    if (inserted.rowCount === 0) {
      const existing = await this.pool.query<{ id: string }>(
        'SELECT id FROM events WHERE external_id = $1', [input.externalId],
      );
      return { eventId: existing.rows[0].id, accepted: false, enqueued: [] };
    }

    const eventId = inserted.rows[0].id;
    const enqueued: Target[] = [];
    for (const target of input.targets) {
      if (await this.queue.enqueue(eventId, target)) enqueued.push(target);
    }
    return { eventId, accepted: true, enqueued };
  }
}
