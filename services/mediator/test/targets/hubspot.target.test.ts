// services/mediator/test/targets/hubspot.target.test.ts
// Proves the HubSpot delivery is idempotent over the natural key (spec 6.5): a
// retried delivery must find the contact by email and patch it, never create a
// second one. A fake stands in for api.hubapi.com so no test touches the network.
//
// It used to be handed a visitor's own portal token as well, and the claim then was
// that nothing extra was needed for it: the email address is just as natural a key
// over there. That connection is gone. What the tests below still hold is the part
// that outlived it, that the target sends whichever token it is given and always
// through the egress gate, so the control panel keeps working.
import { describe, it, expect, beforeEach } from 'vitest';
import { HubSpotTarget, HubSpotClient } from '../../src/targets/hubspot.target';
import type { HubSpotCredentials } from '../../src/credentials';

/** Stands in for api.hubapi.com. Records calls so upsert behaviour is provable. */
class FakeHubSpot {
  contacts = new Map<string, { id: string; createdAt: string }>();
  calls: Array<{ method: string; url: string; token: string }> = [];
  private nextId = 1;

  fetch = async (url: string, init?: RequestInit): Promise<Response> => {
    this.calls.push({
      method: init?.method ?? 'GET',
      url,
      token: String((init?.headers as Record<string, string>).authorization),
    });

    if (url.includes('/search')) {
      const body = JSON.parse(String(init?.body));
      const email = body.filterGroups[0].filters[0].value;
      const found = this.contacts.get(email);
      return json({
        total: found ? 1 : 0,
        results: found
          ? [{ id: found.id, properties: { email, createdate: found.createdAt } }]
          : [],
      });
    }

    if (init?.method === 'POST' && url.endsWith('/contacts')) {
      const body = JSON.parse(String(init.body));
      const email = body.properties.email;
      const existing = this.contacts.get(email);
      if (existing) return json({ status: 'error', category: 'CONFLICT' }, 409);
      const created = {
        id: `contact-${this.nextId++}`,
        createdAt: '2026-07-30T14:06:31.000Z',
      };
      this.contacts.set(email, created);
      return json({ id: created.id, properties: { createdate: created.createdAt } }, 201);
    }

    if (init?.method === 'PATCH') {
      const id = url.split('/').pop()!;
      const entry = [...this.contacts.values()].find((c) => c.id === id);
      return json({ id, properties: { createdate: entry?.createdAt } });
    }

    if (init?.method === undefined || init.method === 'GET') {
      const id = url.split('/')[url.split('/').length - 1].split('?')[0];
      const entry = [...this.contacts.values()].find((c) => c.id === id);
      if (!entry) return json({ status: 'error' }, 404);
      return json({ id, properties: { createdate: entry.createdAt } });
    }

    return json({ status: 'error' }, 500);
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status, headers: { 'content-type': 'application/json' },
  });
}

const HOUSE: HubSpotCredentials = { token: 'pat-house' };
// The portal a visitor had connected. There is no such thing any more, so this is
// only a second token, kept because the target must still send whatever token it is
// handed rather than one of its own.
const OTHER: HubSpotCredentials = { token: 'pat-other' };

let api: FakeHubSpot;
let target: HubSpotTarget;

function targetFor(creds: HubSpotCredentials, fetcher = api.fetch): HubSpotTarget {
  return new HubSpotTarget(
    new HubSpotClient('http://gate/proxy/hubspot', fetcher),
    async () => creds,
  );
}

beforeEach(() => {
  api = new FakeHubSpot();
  target = targetFor(HOUSE);
});

const ctx = (email: string) => ({
  eventId: 'evt-1',
  idempotencyKey: 'evt-1:hubspot',
  payload: { customerName: 'M. Berger', customerEmail: email, totalCents: 4900 },
});

describe('HubSpotTarget', () => {
  it('creates a contact and returns hubspot own id and timestamp', async () => {
    const outcome = await target.deliver(ctx('m@example.com'));
    expect(outcome.remoteRef).toBe('contact-1');
    expect(outcome.remoteAt?.toISOString()).toBe('2026-07-30T14:06:31.000Z');
  });

  it('does not create a second contact when the delivery is retried', async () => {
    await target.deliver(ctx('m@example.com'));
    const second = await target.deliver(ctx('m@example.com'));
    expect(second.remoteRef).toBe('contact-1');
    expect(api.contacts.size).toBe(1);
  });

  it('goes through the egress gate, never straight to hubspot', async () => {
    await target.deliver(ctx('m@example.com'));
    expect(api.calls.every((c) => c.url.startsWith('http://gate/proxy/hubspot'))).toBe(true);
  });

  it('throws when hubspot is unreachable, so the worker retries', async () => {
    const failing = targetFor(HOUSE, async () => { throw new TypeError('fetch failed'); });
    await expect(failing.deliver(ctx('x@example.com'))).rejects.toThrow(/fetch failed/);
  });

  it('throws on a server error rather than reporting success', async () => {
    const failing = targetFor(HOUSE, async () => json({ error: 'unavailable' }, 503));
    await expect(failing.deliver(ctx('y@example.com'))).rejects.toThrow(/503/);
  });

  it('finds a contact by email for the uniqueness proof', async () => {
    await target.deliver(ctx('m@example.com'));
    const client = new HubSpotClient('http://gate/proxy/hubspot', api.fetch);
    const found = await client.findByEmail(HOUSE, 'm@example.com');
    expect(found.total).toBe(1);
  });

  it('writes with the token the resolver handed it', async () => {
    await target.deliver(ctx('m@example.com'));
    expect(api.calls.every((c) => c.token === 'Bearer pat-house')).toBe(true);
  });

  it('sends whatever token it was handed, rather than one of its own', async () => {
    await targetFor(OTHER).deliver(ctx('m@example.com'));
    expect(api.calls.every((c) => c.token === 'Bearer pat-other')).toBe(true);
  });

  it('goes through the egress gate whichever token it carries', async () => {
    // Otherwise "cut the connection to HubSpot" would quietly stop being true for
    // some deliveries, and a switch that is true only sometimes is worse than no
    // switch at all.
    await targetFor(OTHER).deliver(ctx('m@example.com'));
    expect(api.calls.every((c) => c.url.startsWith('http://gate/proxy/hubspot'))).toBe(true);
  });

  it('creates one contact under a second token even when retried', async () => {
    const other = targetFor(OTHER);
    await other.deliver(ctx('m@example.com'));
    const second = await other.deliver(ctx('m@example.com'));
    expect(second.remoteRef).toBe('contact-1');
    expect(api.contacts.size).toBe(1);
  });
});
