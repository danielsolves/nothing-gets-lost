// services/mediator/test/targets/stripe.target.test.ts
// Proves the payment carries the delivery idempotency key (spec 6.5): a retried
// delivery replays the original charge instead of taking the money twice. The
// fake stands in for api.stripe.com and answers a known key the way Stripe does.
import { describe, it, expect, beforeEach } from 'vitest';
import { StripeTarget, StripeClient } from '../../src/targets/stripe.target';

class FakeStripe {
  charges = new Map<string, { id: string; created: number; receipt_url: string }>();
  seenKeys: string[] = [];
  private next = 1;

  fetch = async (url: string, init?: RequestInit): Promise<Response> => {
    const key = (init?.headers as Record<string, string>)?.['idempotency-key'];
    this.seenKeys.push(key);

    // Stripe replays the original response for a known idempotency key.
    const existing = this.charges.get(key);
    if (existing) return json(existing);

    const charge = {
      id: `ch_${this.next++}`,
      created: 1_800_000_000,
      receipt_url: `https://pay.stripe.com/receipts/ch_${this.next}`,
    };
    this.charges.set(key, charge);
    return json(charge, 200);
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status, headers: { 'content-type': 'application/json' },
  });
}

let api: FakeStripe;
let target: StripeTarget;

beforeEach(() => {
  api = new FakeStripe();
  target = new StripeTarget(
    new StripeClient('http://gate/proxy/stripe', 'sk_test_x', api.fetch),
  );
});

const ctx = {
  eventId: 'evt-9',
  idempotencyKey: 'evt-9:stripe',
  payload: { totalCents: 4900, customerEmail: 'm@example.com' },
};

describe('StripeTarget', () => {
  it('charges and returns stripe id, timestamp and receipt url', async () => {
    const outcome = await target.deliver(ctx);
    expect(outcome.remoteRef).toBe('ch_1');
    expect(outcome.remoteAt?.getTime()).toBe(1_800_000_000 * 1000);
    expect(outcome.receiptUrl).toMatch(/^https:\/\/pay\.stripe\.com\/receipts\//);
  });

  it('sends the delivery idempotency key so a retry cannot charge twice', async () => {
    await target.deliver(ctx);
    await target.deliver(ctx);
    expect(api.seenKeys).toEqual(['evt-9:stripe', 'evt-9:stripe']);
    expect(api.charges.size).toBe(1);
  });

  it('returns the identical charge on retry', async () => {
    const first = await target.deliver(ctx);
    const second = await target.deliver(ctx);
    expect(second.remoteRef).toBe(first.remoteRef);
  });

  it('throws when stripe is unreachable', async () => {
    const failing = new StripeClient('http://gate/proxy/stripe', 'sk_test_x',
      async () => { throw new TypeError('fetch failed'); });
    await expect(new StripeTarget(failing).deliver(ctx)).rejects.toThrow(/fetch failed/);
  });
});
