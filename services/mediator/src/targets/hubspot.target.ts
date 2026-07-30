// services/mediator/src/targets/hubspot.target.ts
// Creates or updates the buyer as a HubSpot contact.
//
// HubSpot has no idempotency keys, so the natural key does the work: the email
// address identifies the contact. A retry after a crash finds the existing contact
// and patches it instead of creating a second one (spec 6.5).
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
import { CALLER_TIMEOUT_MS } from '@ngl/contracts';

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

interface ContactPayload {
  customerName: string;
  customerEmail: string;
  totalCents: number;
}

export class HubSpotClient {
  constructor(
    private readonly baseUrl: string,
    private readonly doFetch: Fetch = fetch,
  ) {}

  private async call(
    creds: HubSpotCredentials, path: string, init?: RequestInit,
  ): Promise<unknown> {
    const response = await this.doFetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${creds.token}`,
        'content-type': 'application/json',
        ...(init?.headers ?? {}),
      },
      signal: AbortSignal.timeout(CALLER_TIMEOUT_MS),
    });
    const body = await response.json().catch(() => ({}));
    if (response.status >= 500 || response.status === 429) {
      throw new Error(`HubSpot responded ${response.status}`);
    }
    return { status: response.status, body };
  }

  async findByEmail(
    creds: HubSpotCredentials, email: string,
  ): Promise<{ total: number; id: string | null; createdAt: string | null }> {
    const result = (await this.call(creds, '/crm/v3/objects/contacts/search', {
      method: 'POST',
      body: JSON.stringify({
        filterGroups: [{ filters: [{ propertyName: 'email', operator: 'EQ', value: email }] }],
        properties: ['email', 'hs_createdate'],
      }),
    })) as { body: { total: number; results: Array<{ id: string; properties: { hs_createdate: string } }> } };

    const first = result.body.results?.[0];
    return {
      total: result.body.total ?? 0,
      id: first?.id ?? null,
      createdAt: first?.properties?.hs_createdate ?? null,
    };
  }

  async getContact(
    creds: HubSpotCredentials, id: string,
  ): Promise<{ requestUrl: string; status: number; body: unknown }> {
    const path = `/crm/v3/objects/contacts/${id}?properties=email,hs_createdate`;
    const result = (await this.call(creds, path)) as { status: number; body: unknown };
    return { requestUrl: `${this.baseUrl}${path}`, status: result.status, body: result.body };
  }

  async upsertContact(
    creds: HubSpotCredentials, input: ContactPayload,
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
    })) as { status: number; body: { id?: string; properties?: { hs_createdate?: string } } };

    // Two workers raced us to it. Read back instead of failing.
    if (created.status === 409 || !created.body.id) {
      const again = await this.findByEmail(creds, input.customerEmail);
      if (!again.id) throw new Error('HubSpot upsert failed without a usable id');
      return { id: again.id, createdAt: again.createdAt };
    }

    return {
      id: created.body.id,
      createdAt: created.body.properties?.hs_createdate ?? null,
    };
  }
}

export class HubSpotTarget implements DeliveryTarget {
  readonly target = 'hubspot' as const;

  constructor(
    private readonly client: HubSpotClient,
    private readonly credentials: () => Promise<HubSpotCredentials>,
  ) {}

  async deliver(ctx: DeliveryContext): Promise<DeliveryOutcome> {
    const payload = ctx.payload as ContactPayload;
    const creds = await this.credentials();
    const contact = await this.client.upsertContact(creds, payload);
    return {
      remoteRef: contact.id,
      remoteAt: contact.createdAt ? new Date(contact.createdAt) : null,
    };
  }
}
