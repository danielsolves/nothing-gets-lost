// services/api/src/verify.service.ts
// One live read-back against the real third-party system (spec 9.2).
//
// indisputable is deliberately false for our own portals. We render the answer, so
// a sceptic is right that we could render anything. Saying that on the page costs
// nothing and buys the credibility of everything we DO claim is unfalsifiable.
//
// It used to reverse for a visitor who had connected their own workspace, because
// the entry then sat in a system they control. That path is gone with the OAuth, so
// HubSpot and Slack are read back through our own accounts and are labelled as our
// own claim, always. What a visitor can still have in a system we do not control is
// their own endpoint, which is in the set below.
import type { Pool } from 'pg';
import { isIndisputable, upstreamUrl, type Target, type VerifyResponse } from '@ngl/contracts';
import type { HubSpotClient } from '../../mediator/src/targets/hubspot.target';
import type { SlackClient } from '../../mediator/src/targets/slack.target';
import type { CredentialResolver } from '../../mediator/src/credentials';

export interface DeliveryRecord {
  remoteRef: string | null; remoteAt: Date | null; receiptUrl: string | null;
}

export interface DeliveryLookup {
  find(eventId: string, target: Target): Promise<DeliveryRecord | null>;
}

export class VerifyService {
  constructor(
    private readonly clients: { hubspot: HubSpotClient; slack: SlackClient },
    private readonly deliveries: DeliveryLookup,
    private readonly credentials: CredentialResolver,
  ) {}

  async verify(target: Target, eventId: string): Promise<VerifyResponse> {
    const delivery = await this.deliveries.find(eventId, target);
    // Decided once, from the set alone. It used to be reassigned further down: a
    // read-back on a portal the visitor had connected became indisputable, because
    // the record was then in a system they controlled. Nothing flips it any more.
    const indisputable = isIndisputable(target);

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
      const creds = await this.credentials.hubspot();
      const id = delivery?.remoteRef;
      if (!id) {
        return {
          target, indisputable, requestUrl: 'https://api.hubapi.com/crm/v3/objects/contacts',
          httpStatus: 404, remoteRef: null, remoteAt: null,
          rawBody: { note: 'not delivered yet' },
        };
      }
      const result = await this.clients.hubspot.getContact(creds, id);
      const body = result.body as { properties?: { createdate?: string } };
      return {
        target, indisputable,
        // The url the record actually lives on, not the gate the call went through.
        // The gate is how we cut the line; naming it here would answer "which
        // foreign system holds this?" with a container on our own network.
        requestUrl: upstreamUrl(result.requestUrl) ?? result.requestUrl,
        httpStatus: result.status,
        remoteRef: id,
        remoteAt: body.properties?.createdate ?? null,
        rawBody: result.body,
      };
    }

    if (target === 'slack') {
      const creds = await this.credentials.slack();
      const history = await this.clients.slack.history(creds, `${eventId}:slack`);
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
