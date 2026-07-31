// services/api/src/proof.service.ts
// The proof chain (spec 9.1).
//
// Two timestamps, neither of them ours: the payment provider stamps the payment, the
// visitor's own mail provider stamps the arrival of the confirmation. The gap between
// them is the outage the visitor caused, and we cannot forge either end of it.
//
// Which provider that was is read off the delivery that took the money rather than
// off what the order asked for. The two agree today, and the day they stop agreeing
// this panel is the place that should say so.
//
// This only works because of rule 6.7 — the mail is queued after the chain
// completes. If it went out alongside the others it would arrive while HubSpot is
// still cut and prove nothing.
import type { Pool } from 'pg';
import type { PaymentRoute, ProofResponse } from '@ngl/contracts';

export interface Payment {
  /** Null when the event has no payment leg. A Stripe webhook arrives already paid. */
  route: PaymentRoute | null;
  paidAt: Date | null;
  receiptUrl: string | null;
}

export interface Lookups {
  payment(eventId: string): Promise<Payment>;
  mail(eventId: string): Promise<{ sentAt: Date | null }>;
  hubspot(eventId: string): Promise<{ createdAt: Date | null }>;
}

export class ProofService {
  constructor(private readonly lookups: Lookups) {}

  async build(eventId: string): Promise<ProofResponse> {
    const [payment, mail, hubspot] = await Promise.all([
      this.lookups.payment(eventId),
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
      paidAtSource: payment.route,
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

  /**
   * One row at most: intake queues exactly one of the two payment targets, so the
   * delivery is the record of which route the order really took. The state is read
   * rather than filtered on, because a route that has not been charged yet is still
   * the route, and "PayPal, not yet" beats a blank that reads as nothing attempted.
   */
  async payment(eventId: string): Promise<Payment> {
    const { rows } = await this.pool.query<{
      target: PaymentRoute; state: string;
      remote_at: Date | null; receipt_url: string | null;
    }>(
      `SELECT d.target, d.state, d.remote_at, e.payload ->> 'receipt_url' AS receipt_url
         FROM deliveries d JOIN events e ON e.id = d.event_id
        WHERE d.event_id = $1::uuid AND d.target IN ('stripe', 'paypal')`,
      [eventId],
    );
    const row = rows[0];
    if (!row) return { route: null, paidAt: null, receiptUrl: null };
    return {
      route: row.target,
      paidAt: row.state === 'done' ? row.remote_at : null,
      // Only the Stripe target ever writes one. Handing stripe.com's proof to a
      // payment Stripe never saw would be the demo forging its own evidence.
      receiptUrl: row.target === 'stripe' ? row.receipt_url : null,
    };
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
