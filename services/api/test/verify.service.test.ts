// services/api/test/verify.service.test.ts
// Pins the honest labelling of spec 9.0: a Stripe receipt is indisputable because
// stripe.com serves it, a read-back on our own portal is an indication only.
import { describe, it, expect } from 'vitest';
import { VerifyService } from '../src/verify.service';

const clients = {
  hubspot: {
    async getContact(id: string) {
      return {
        requestUrl: `https://api.hubapi.com/crm/v3/objects/contacts/${id}`,
        status: 200,
        body: { id, properties: { hs_createdate: '2026-07-30T14:06:31.000Z' } },
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

const service = new VerifyService(clients as never, deliveries as never);

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
    );
    const result = await empty.verify('hubspot', 'evt-missing');
    expect(result.httpStatus).toBe(404);
    expect(result.remoteRef).toBeNull();
  });
});
