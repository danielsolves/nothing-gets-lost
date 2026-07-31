// services/mediator/src/targets/hubspot.target.ts
// Creates or updates the buyer as a HubSpot contact.
//
// HubSpot has no idempotency keys, so the natural key does the work: the email
// address identifies the contact. A retry after a crash finds the existing contact
// and patches it instead of creating a second one (spec 6.5).
//
// The timestamp read back is `createdate`. It was `createdate` for a long time,
// which is a real HubSpot property on several object types and is not one on a
// contact: the api answers with the field simply absent rather than with an error,
// so every delivery landed, reported success, and carried no remote time at all.
// That is the one field the proof chain wants from HubSpot (spec 9.1), and it was
// quietly null on every order. The fakes in the tests said createdate too, so
// they agreed with the bug instead of catching it.
//
// That holds just as well in the visitor's own portal (spec 9.4): their email
// address is a natural key over there too, so connecting a portal changes the token
// and nothing else about how exactly-once is achieved.
//
// Every call goes through the egress gate — never straight to api.hubapi.com —
// otherwise the control panel could not cut the connection. That stays true for the
// visitor's portal, or "cut the connection to HubSpot" would quietly become false
// for the one visitor most likely to check.
import type { DeliveryContext, DeliveryOutcome, DeliveryTarget } from '../target.interface';
import type { HubSpotCredentials } from '../credentials';
import { HubSpotHttp, type Fetch } from './hubspot.http';
import type { HubSpotOrders, OrderPayload } from './hubspot.order';

export class HubSpotClient {
  private readonly http: HubSpotHttp;

  constructor(baseUrl: string, doFetch: Fetch = fetch) {
    this.http = new HubSpotHttp(baseUrl, doFetch);
  }

  private get baseUrl(): string { return this.http.baseUrl; }

  private async call(
    creds: HubSpotCredentials, path: string, init?: RequestInit,
  ): Promise<unknown> {
    return this.http.call(creds, path, init);
  }

  async findByEmail(
    creds: HubSpotCredentials, email: string,
  ): Promise<{ total: number; id: string | null; createdAt: string | null }> {
    const result = (await this.call(creds, '/crm/v3/objects/contacts/search', {
      method: 'POST',
      body: JSON.stringify({
        filterGroups: [{ filters: [{ propertyName: 'email', operator: 'EQ', value: email }] }],
        properties: ['email', 'createdate'],
      }),
    })) as { body: { total: number; results: Array<{ id: string; properties: { createdate: string } }> } };

    const first = result.body.results?.[0];
    return {
      total: result.body.total ?? 0,
      id: first?.id ?? null,
      createdAt: first?.properties?.createdate ?? null,
    };
  }

  async getContact(
    creds: HubSpotCredentials, id: string,
  ): Promise<{ requestUrl: string; status: number; body: unknown }> {
    const path = `/crm/v3/objects/contacts/${id}?properties=email,createdate`;
    const result = (await this.call(creds, path)) as { status: number; body: unknown };
    return { requestUrl: `${this.baseUrl}${path}`, status: result.status, body: result.body };
  }

  async upsertContact(
    creds: HubSpotCredentials, input: OrderPayload,
  ): Promise<{ id: string; createdAt: string | null }> {
    const existing = await this.findByEmail(creds, input.customerEmail);
    const properties = {
      email: input.customerEmail,
      firstname: input.customerName,
    };

    if (existing.id) {
      await this.call(creds, `/crm/v3/objects/contacts/${existing.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ properties }),
      });
      return { id: existing.id, createdAt: existing.createdAt };
    }

    const created = (await this.call(creds, '/crm/v3/objects/contacts', {
      method: 'POST',
      body: JSON.stringify({ properties }),
    })) as { status: number; body: { id?: string; properties?: { createdate?: string } } };

    // Two workers raced us to it. Read back instead of failing.
    if (created.status === 409 || !created.body.id) {
      const again = await this.findByEmail(creds, input.customerEmail);
      if (!again.id) throw new Error('HubSpot upsert failed without a usable id');
      return { id: again.id, createdAt: again.createdAt };
    }

    return {
      id: created.body.id,
      createdAt: created.body.properties?.createdate ?? null,
    };
  }
}

export class HubSpotTarget implements DeliveryTarget {
  readonly target = 'hubspot' as const;

  constructor(
    private readonly client: HubSpotClient,
    private readonly credentials: () => Promise<HubSpotCredentials>,
    private readonly orders?: HubSpotOrders,
  ) {}

  /**
   * The buyer, then what they bought. In that order and not the other way round: a
   * deal has to hang off a contact, and a deal with no contact is a purchase HubSpot
   * cannot tell you who made.
   *
   * remoteRef stays the contact id even though a deal is written too. It is what the
   * proof panel reads back to show a record on api.hubapi.com (spec 9.2), and a
   * delivery may only carry one remote reference, so it carries the one a visitor is
   * shown. The deal is found from the event id whenever it is needed again.
   */
  async deliver(ctx: DeliveryContext): Promise<DeliveryOutcome> {
    const payload = ctx.payload as OrderPayload;
    const creds = await this.credentials();
    const contact = await this.client.upsertContact(creds, payload);
    await this.orders?.record(creds, {
      eventId: ctx.eventId, contactId: contact.id, payload,
    });
    return {
      remoteRef: contact.id,
      remoteAt: contact.createdAt ? new Date(contact.createdAt) : null,
    };
  }
}
