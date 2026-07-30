// services/api/src/proof.service.ts
// The proof chain (spec 9.1).
//
// Two timestamps, neither of them ours: Stripe stamps the payment, the visitor's own
// mail provider stamps the arrival of the confirmation. The gap between them is the
// outage the visitor caused, and we cannot forge either end of it.
//
// This only works because of rule 6.7 — the mail is queued after the chain
// completes. If it went out alongside the others it would arrive while HubSpot is
// still cut and prove nothing.
import type { Pool } from 'pg';
import type { ProofResponse } from '@ngl/contracts';

export interface Lookups {
  stripe(eventId: string): Promise<{ paidAt: Date | null; receiptUrl: string | null }>;
  mail(eventId: string): Promise<{ sentAt: Date | null }>;
  hubspot(eventId: string): Promise<{ createdAt: Date | null }>;
}

export class ProofService {
  constructor(private readonly lookups: Lookups) {}

  async build(eventId: string): Promise<ProofResponse> {
    const [payment, mail, hubspot] = await Promise.all([
      this.lookups.stripe(eventId),
      this.lookups.mail(eventId),
      this.lookups.hubspot(eventId),
    ]);

    const gapSeconds =
      payment.paidAt && mail.sentAt
        ? Math.round((mail.sentAt.getTime() - payment.paidAt.getTime()) / 1000)
        : null;

    return {
      eventId,
      paidAt: payment.paidAt?.toISOString() ?? null,
      paidAtSource: 'stripe',
      receiptUrl: payment.receiptUrl,
      mailReceivedAt: mail.sentAt?.toISOString() ?? null,
      mailReceivedAtSource: 'recipient mail server',
      hubspotCreatedAt: hubspot.createdAt?.toISOString() ?? null,
      gapSeconds,
    };
  }
}

/**
 * The production lookups. Every timestamp here was written by a foreign system and
 * only stored by us: Stripe's charge time and HubSpot's hs_createdate arrive as
 * remote_at, and sent_mail.sent_at is the row the mailer writes around its own send.
 */
export class ProofLookups implements Lookups {
  constructor(private readonly pool: Pool) {}

  async stripe(eventId: string): Promise<{ paidAt: Date | null; receiptUrl: string | null }> {
    const { rows } = await this.pool.query<{ remote_at: Date | null; receipt_url: string | null }>(
      `SELECT d.remote_at, e.payload ->> 'receipt_url' AS receipt_url
         FROM deliveries d JOIN events e ON e.id = d.event_id
        WHERE d.event_id = $1::uuid AND d.target = 'stripe' AND d.state = 'done'`,
      [eventId],
    );
    const row = rows[0];
    return { paidAt: row?.remote_at ?? null, receiptUrl: row?.receipt_url ?? null };
  }

  async mail(eventId: string): Promise<{ sentAt: Date | null }> {
    const { rows } = await this.pool.query<{ sent_at: Date }>(
      'SELECT sent_at FROM sent_mail WHERE event_id = $1::uuid', [eventId],
    );
    return { sentAt: rows[0]?.sent_at ?? null };
  }

  async hubspot(eventId: string): Promise<{ createdAt: Date | null }> {
    const { rows } = await this.pool.query<{ remote_at: Date | null }>(
      `SELECT remote_at FROM deliveries
        WHERE event_id = $1::uuid AND target = 'hubspot' AND state = 'done'`,
      [eventId],
    );
    return { createdAt: rows[0]?.remote_at ?? null };
  }
}
