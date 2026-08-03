// services/api/src/chaos.service.ts
// The three one-off mischief buttons (spec 3). Each one drives a real path rather
// than a simulated one: the duplicate goes through intake again, and the two
// malformed orders go to the extractor exactly as an incoming mail would.
import type { Pool } from 'pg';
import type { ChaosKind, EventKind, Target } from '@ngl/contracts';
import type { EventIntake } from './intake.port';
import type { DuplicatesStore } from './duplicates.store';

const EXTRACTOR_URL = process.env.EXTRACTOR_URL ?? 'http://extractor:3006';

/** Half an order: no quantity, no address, a price where a SKU belongs. */
const GARBAGE = 'Hi, send me the blue ones. 12,00 for each I think. Thanks';

/** A well-formed mail — the invented article number comes from the model. */
const HALLUCINATION_SOURCE =
  'Hello, please send two blue mugs and one teapot to Berlin. Regards, M. Berger';

export class ChaosService {
  constructor(
    private readonly pool: Pool,
    private readonly intake: EventIntake,
    private readonly duplicates?: DuplicatesStore,
  ) {}

  async run(kind: ChaosKind): Promise<{ ok: boolean; detail: string }> {
    if (kind === 'duplicate_webhook') return this.replayNewestEvent();
    const hallucinate = kind === 'hallucinate';
    return this.extract(hallucinate ? HALLUCINATION_SOURCE : GARBAGE, hallucinate);
  }

  /** Sends the newest event in a second time — the same external id, so it drops. */
  private async replayNewestEvent(): Promise<{ ok: boolean; detail: string }> {
    const { rows } = await this.pool.query<{
      external_id: string; kind: EventKind; payload: unknown; targets: Target[];
    }>(
      `SELECT e.external_id, e.kind, e.payload,
              coalesce(array_agg(d.target) FILTER (WHERE d.target IS NOT NULL), '{}') AS targets
         FROM events e LEFT JOIN deliveries d ON d.event_id = e.id
        GROUP BY e.id ORDER BY e.received_at DESC LIMIT 1`,
    );
    const event = rows[0];
    if (!event) return { ok: false, detail: 'there is no event to deliver twice yet' };

    const result = await this.intake.accept({
      externalId: event.external_id,
      kind: event.kind,
      payload: event.payload,
      targets: event.targets,
    });
    // Intake leaves no trace of a drop, so the counter is told here.
    if (!result.accepted) await this.duplicates?.record(event.external_id);
    return {
      ok: true,
      detail: result.accepted
        ? 'the event was new after all and went through'
        : 'the repeated event was recognised and dropped',
    };
  }

  private async extract(text: string, hallucinate: boolean): Promise<{ ok: boolean; detail: string }> {
    const response = await fetch(`${EXTRACTOR_URL}/internal/extract`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text, hallucinate }),
    });
    return {
      ok: response.ok,
      detail: hallucinate
        ? 'the model was pushed into inventing an article number'
        : 'a malformed order was handed to the extractor',
    };
  }
}
