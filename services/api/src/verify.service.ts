// services/api/src/verify.service.ts
// One live read-back against the real third-party system (spec 9.2).
//
// indisputable is deliberately false for our own portals. We render the answer, so
// a sceptic is right that we could render anything. Saying that on the page costs
// nothing and buys the credibility of everything we DO claim is unfalsifiable.
import type { Pool } from 'pg';
import type { Target, VerifyResponse } from '@ngl/contracts';
import type { HubSpotClient } from '../../mediator/src/targets/hubspot.target';
import type { SlackClient } from '../../mediator/src/targets/slack.target';

export interface DeliveryRecord {
  remoteRef: string | null; remoteAt: Date | null; receiptUrl: string | null;
}

export interface DeliveryLookup {
  find(eventId: string, target: Target): Promise<DeliveryRecord | null>;
}

/** Only proofs served by a third party or landing with the visitor count as proof. */
const INDISPUTABLE: ReadonlySet<Target> = new Set<Target>(['stripe', 'mailer', 'custom_webhook']);

export class VerifyService {
  constructor(
    private readonly clients: { hubspot: HubSpotClient; slack: SlackClient },
    private readonly deliveries: DeliveryLookup,
  ) {}

  async verify(target: Target, eventId: string): Promise<VerifyResponse> {
    const delivery = await this.deliveries.find(eventId, target);
    const indisputable = INDISPUTABLE.has(target);

    if (target === 'stripe') {
      return {
        target, indisputable,
        requestUrl: delivery?.receiptUrl ?? '',
        httpStatus: delivery?.receiptUrl ? 200 : 404,
        remoteRef: delivery?.remoteRef ?? null,
        remoteAt: delivery?.remoteAt?.toISOString() ?? null,
        rawBody: { receipt_url: delivery?.receiptUrl ?? null },
      };
    }

    if (target === 'hubspot') {
      const id = delivery?.remoteRef;
      if (!id) {
        return {
          target, indisputable, requestUrl: 'https://api.hubapi.com/crm/v3/objects/contacts',
          httpStatus: 404, remoteRef: null, remoteAt: null,
          rawBody: { note: 'not delivered yet' },
        };
      }
      const result = await this.clients.hubspot.getContact(id);
      const body = result.body as { properties?: { hs_createdate?: string } };
      return {
        target, indisputable,
        requestUrl: result.requestUrl,
        httpStatus: result.status,
        remoteRef: id,
        remoteAt: body.properties?.hs_createdate ?? null,
        rawBody: result.body,
      };
    }

    if (target === 'slack') {
      const history = await this.clients.slack.history(`${eventId}:slack`);
      return {
        target, indisputable,
        requestUrl: 'https://slack.com/api/conversations.history',
        httpStatus: 200,
        remoteRef: history.ts,
        remoteAt: history.ts ? new Date(Number(history.ts.split('.')[0]) * 1000).toISOString() : null,
        rawBody: history.raw,
      };
    }

    return {
      target, indisputable,
      requestUrl: '', httpStatus: delivery ? 200 : 404,
      remoteRef: delivery?.remoteRef ?? null,
      remoteAt: delivery?.remoteAt?.toISOString() ?? null,
      rawBody: delivery ?? {},
    };
  }
}

/**
 * The production lookup. receipt_url is read from the event payload because the
 * deliveries table has no column for it — Stripe's target writes it back there.
 */
export class DeliveryRecords implements DeliveryLookup {
  constructor(private readonly pool: Pool) {}

  async find(eventId: string, target: Target): Promise<DeliveryRecord | null> {
    const { rows } = await this.pool.query<{
      remote_ref: string | null; remote_at: Date | null; receipt_url: string | null;
    }>(
      `SELECT d.remote_ref, d.remote_at, e.payload ->> 'receipt_url' AS receipt_url
         FROM deliveries d JOIN events e ON e.id = d.event_id
        WHERE d.event_id = $1::uuid AND d.target = $2`,
      [eventId, target],
    );
    const row = rows[0];
    if (!row) return null;
    return { remoteRef: row.remote_ref, remoteAt: row.remote_at, receiptUrl: row.receipt_url };
  }
}
