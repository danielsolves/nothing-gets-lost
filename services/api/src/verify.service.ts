// services/api/src/verify.service.ts
// One live read-back against the real third-party system (spec 9.2).
//
// indisputable is deliberately false for our own portals. We render the answer, so
// a sceptic is right that we could render anything. Saying that on the page costs
// nothing and buys the credibility of everything we DO claim is unfalsifiable.
//
// Once the visitor connects their own workspace that reverses: the entry sits in a
// system they control, so it becomes a proof (spec 9.2). For HubSpot we can still
// read it back, with their token, because their portal granted contacts.read. For
// Slack we cannot and should not: we asked for chat:write and incoming-webhook, and
// nothing that reads a channel. Pointing them at their own Slack is the honest
// answer, and it happens to be the stronger one.
import type { Pool } from 'pg';
import { upstreamUrl, type Target, type VerifyResponse } from '@ngl/contracts';
import type { HubSpotClient } from '../../mediator/src/targets/hubspot.target';
import type { SlackClient } from '../../mediator/src/targets/slack.target';
import type { CredentialResolver } from '../../mediator/src/credentials';

export interface DeliveryRecord {
  remoteRef: string | null; remoteAt: Date | null; receiptUrl: string | null;
}

export interface DeliveryLookup {
  find(eventId: string, target: Target): Promise<DeliveryRecord | null>;
}

/**
 * Only proofs served by a third party or landing with the visitor count as proof.
 *
 * Stripe is in this set because its receipt is a page on stripe.com that anybody can
 * open. A payment id that only the account holder can look up would not be, however
 * foreign the system that issued it: calling both proof would borrow credibility one
 * of them has not got (spec 9.0).
 */
const INDISPUTABLE: ReadonlySet<Target> = new Set<Target>(['stripe', 'mailer', 'custom_webhook']);

export class VerifyService {
  constructor(
    private readonly clients: { hubspot: HubSpotClient; slack: SlackClient },
    private readonly deliveries: DeliveryLookup,
    private readonly credentials: CredentialResolver,
  ) {}

  async verify(target: Target, eventId: string): Promise<VerifyResponse> {
    const delivery = await this.deliveries.find(eventId, target);
    let indisputable = INDISPUTABLE.has(target);

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
      // Their portal, their login, their record. That is a proof, not an indication.
      indisputable = creds.visitor;
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
      if (creds.visitor) {
        // No read scope in their workspace, by choice. The message is already where
        // they can see it, which is more than a rendered read-back would prove.
        return {
          target, indisputable: true,
          requestUrl: '', httpStatus: delivery ? 200 : 404,
          remoteRef: delivery?.remoteRef ?? null,
          remoteAt: delivery?.remoteAt?.toISOString() ?? null,
          rawBody: {
            note: 'Delivered into your own Slack workspace. This demo asked for ' +
              'permission to post and none to read, so it cannot show you the ' +
              'message here. Open the channel you picked while connecting: the ' +
              'message carries the delivery id below.',
            deliveryId: `${eventId}:slack`,
          },
        };
      }
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
