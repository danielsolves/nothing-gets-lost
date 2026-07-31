// services/api/test/verify.service.test.ts
// Pins the honest labelling of spec 9.0: a Stripe receipt is indisputable because
// stripe.com serves it, a read-back on our own portal is an indication only.
//
// Connecting your own workspace flips that around. The entry is then in a system the
// visitor controls, so it becomes indisputable — and for Slack we cannot read it back
// at all, because we asked for no permission to read their channel. Saying "look in
// your own Slack" is both the honest answer and the stronger one.
import { describe, it, expect } from 'vitest';
import { VerifyService } from '../src/verify.service';

const HOUSE_SLACK = { token: 'xoxb-house', channel: 'C-HOUSE', visitor: false };
const HOUSE_HUBSPOT = { token: 'pat-house', visitor: false };

const houseCredentials = {
  async slack() { return HOUSE_SLACK; },
  async hubspot() { return HOUSE_HUBSPOT; },
};

const clients = {
  hubspot: {
    async getContact(_creds: unknown, id: string) {
      return {
        requestUrl: `https://api.hubapi.com/crm/v3/objects/contacts/${id}`,
        status: 200,
        body: { id, properties: { createdate: '2026-07-30T14:06:31.000Z' } },
      };
    },
  },
  slack: {
    async history() {
      return { ts: '1800000001.000100', raw: { ok: true, messages: [] } };
    },
  },
};

const deliveries = {
  async find(eventId: string, target: string) {
    if (target === 'stripe') {
      return {
        remoteRef: 'ch_1', remoteAt: new Date('2026-07-30T14:04:02Z'),
        receiptUrl: 'https://pay.stripe.com/receipts/ch_1',
      };
    }
    return { remoteRef: 'contact-1', remoteAt: null, receiptUrl: null };
  },
};

const service = new VerifyService(
  clients as never, deliveries as never, houseCredentials as never,
);

describe('VerifyService', () => {
  it('labels a stripe receipt as indisputable — stripe.com serves that page', async () => {
    const result = await service.verify('stripe', 'evt-1');
    expect(result.indisputable).toBe(true);
    expect(result.requestUrl).toContain('pay.stripe.com');
  });


  it('labels a read-back on our own hubspot portal as an indication only', async () => {
    // We render the answer, so a sceptic is right to say we could render anything.
    // Saying so on the page is the point of spec 9.0.
    const result = await service.verify('hubspot', 'evt-1');
    expect(result.indisputable).toBe(false);
  });

  it('shows the real request url so a technical reader can check the host', async () => {
    const result = await service.verify('hubspot', 'evt-1');
    expect(result.requestUrl).toContain('api.hubapi.com');
  });

  it('returns the timestamp assigned by the remote system, not ours', async () => {
    const result = await service.verify('hubspot', 'evt-1');
    expect(result.remoteAt).toBe('2026-07-30T14:06:31.000Z');
  });

  it('reports a missing record instead of inventing one', async () => {
    const empty = new VerifyService(
      { hubspot: { async getContact() { return { requestUrl: 'u', status: 404, body: {} }; } } } as never,
      { async find() { return null; } } as never,
      houseCredentials as never,
    );
    const result = await empty.verify('hubspot', 'evt-missing');
    expect(result.httpStatus).toBe(404);
    expect(result.remoteRef).toBeNull();
  });

  it('reads the house channel back while nothing is connected', async () => {
    const result = await service.verify('slack', 'evt-1');
    expect(result.remoteRef).toBe('1800000001.000100');
    expect(result.indisputable).toBe(false);
  });

  it('sends the visitor to their own slack instead of reading it for them', async () => {
    // chat:write and incoming-webhook, nothing that can read a channel. Rendering a
    // read-back here would mean asking them for a scope we decided not to ask for.
    let historyCalls = 0;
    const connected = new VerifyService(
      {
        ...clients,
        slack: { async history() { historyCalls += 1; return { ts: null, raw: {} }; } },
      } as never,
      deliveries as never,
      {
        async slack() { return { token: 'xoxb-theirs', channel: 'C-THEIRS', visitor: true }; },
        async hubspot() { return HOUSE_HUBSPOT; },
      } as never,
    );

    const result = await connected.verify('slack', 'evt-1');
    expect(historyCalls).toBe(0);
    expect(result.indisputable).toBe(true);
    expect(result.remoteRef).toBe('contact-1');
    expect(JSON.stringify(result.rawBody)).toMatch(/your own Slack workspace/i);
  });

  it('reads the visitor portal back with their own token', async () => {
    // Their portal granted crm.objects.contacts.read, so this one we genuinely can
    // do — and it lands in a system they control, which makes it a proof.
    let seenToken = '';
    const connected = new VerifyService(
      {
        ...clients,
        hubspot: {
          async getContact(creds: { token: string }, id: string) {
            seenToken = creds.token;
            return { requestUrl: `https://api.hubapi.com/contacts/${id}`, status: 200, body: {} };
          },
        },
      } as never,
      deliveries as never,
      {
        async slack() { return HOUSE_SLACK; },
        async hubspot() { return { token: 'pat-theirs', visitor: true }; },
      } as never,
    );

    const result = await connected.verify('hubspot', 'evt-1');
    expect(seenToken).toBe('pat-theirs');
    expect(result.indisputable).toBe(true);
  });
});
