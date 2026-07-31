// services/api/src/proof-log.service.ts
// A downloadable record of every call, for the client who does not click but asks
// somebody (spec 9.5).
//
// The file says of itself which entries are indisputable and which are merely our
// own claim. A proof log that overstates its own strength is worse than none.
import type { Pool } from 'pg';

export interface ProofLog {
  eventId: string;
  generatedAt: string;
  deliveries: Array<{
    target: string; state: string; attempts: number;
    remoteRef: string | null; remoteAt: string | null;
    lastError: string | null; updatedAt: string;
  }>;
  howToVerify: Record<string, string>;
}

const HOW_TO_VERIFY: Record<string, string> = {
  stripe:
    'Open the receipt url. That page is served by stripe.com, not by this demo. Indisputable.',
  mailer:
    'Open the confirmation in your own inbox and read the Received header. Your mail '
    + 'provider wrote that timestamp, not us. Indisputable.',
  hubspot:
    'The read-back shows api.hubapi.com and HubSpot own createdate, but we render '
    + 'it, so treat it as an indication. Connect your own HubSpot portal for proof.',
  slack:
    'Join the open demo channel and find the message, or connect your own workspace. '
    + 'Seen at the source it is proof; rendered here it is an indication.',
  ledger: 'Our own service. Query it yourself through the read-only SQL console.',
  custom_webhook:
    'Delivered to the url you supplied, on your own server. Indisputable.',
};

export class ProofLogService {
  constructor(private readonly pool: Pool) {}

  async build(eventId: string): Promise<ProofLog> {
    const { rows } = await this.pool.query<{
      target: string; state: string; attempts: number;
      remote_ref: string | null; remote_at: Date | null;
      last_error: string | null; updated_at: Date;
    }>(
      `SELECT target, state, attempts, remote_ref, remote_at, last_error, updated_at
         FROM deliveries WHERE event_id = $1 ORDER BY target`,
      [eventId],
    );

    return {
      eventId,
      generatedAt: new Date().toISOString(),
      deliveries: rows.map((row) => ({
        target: row.target,
        state: row.state,
        attempts: row.attempts,
        remoteRef: row.remote_ref,
        remoteAt: row.remote_at?.toISOString() ?? null,
        lastError: row.last_error,
        updatedAt: row.updated_at.toISOString(),
      })),
      howToVerify: HOW_TO_VERIFY,
    };
  }
}
