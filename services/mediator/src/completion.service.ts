// services/mediator/src/completion.service.ts
// Rule 6.7: the confirmation mail is only queued once every other delivery for the
// same event is done.
//
// This is not cosmetics. The arrival timestamp of that mail is the second witness
// of the proof chain (spec 9.1) — stamped by the visitor's own mail provider, not
// by us. If the mail went out alongside the others it would arrive while HubSpot is
// still cut, and it would prove nothing.
//
// It is also simply correct: you confirm to a customer once everything is booked.
import type { Pool } from 'pg';

export class CompletionService {
  constructor(private readonly pool: Pool) {}

  async enqueueMailIfComplete(eventId: string): Promise<boolean> {
    const { rowCount } = await this.pool.query(
      `INSERT INTO deliveries (event_id, target, state)
       SELECT $1, 'mailer', 'pending'
        WHERE NOT EXISTS (
              SELECT 1 FROM deliveries
               WHERE event_id = $1
                 AND target <> 'mailer'
                 AND state <> 'done')
       ON CONFLICT (event_id, target) DO NOTHING`,
      [eventId],
    );
    return rowCount === 1;
  }
}
