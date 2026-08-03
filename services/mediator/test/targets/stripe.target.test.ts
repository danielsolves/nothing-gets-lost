// services/mediator/test/targets/stripe.target.test.ts
// Proves the payment carries the delivery idempotency key (spec 6.5): a retried
// delivery replays the original charge instead of taking the money twice. The
// fake stands in for api.stripe.com and answers a known key the way Stripe does.
//
// It answers with a PaymentIntent, because that is what /v1/payment_intents
// returns. The earlier fake replied with a charge-shaped object, and that one
// wrong assumption hid a real bug: receipt_url lives on the charge, not on the
// intent, so the demo's strongest proof came back null against the real API.
import { describe, it, expect, beforeEach } from 'vitest';
import { StripeTarget, StripeClient } from '../../src/targets/stripe.target';

interface FakeIntent {
  id: string;
  created: number;
  status: string;
  latest_charge: { id: string; receipt_url: string } | string;
}

class FakeStripe {
  intents = new Map<string, FakeIntent>();
  seenKeys: string[] = [];
  seenBodies: string[] = [];
  private next = 1;

  fetch = async (url: string, init?: RequestInit): Promise<Response> => {
    const key = (init?.headers as Record<string, string>)?.['idempotency-key'];
    this.seenKeys.push(key);
    const body = String(init?.body ?? '');
    this.seenBodies.push(body);

    // Stripe replays the original response for a known idempotency key.
    const existing = this.intents.get(key);
    if (existing) return json(existing);

    const n = this.next++;
    // The charge is only an object when the caller asked for it to be expanded.
    // Otherwise it is a bare id string, exactly as the real API behaves.
    const expanded = body.includes('expand') && body.includes('latest_charge');
    const intent: FakeIntent = {
      id: `pi_${n}`,
      created: 1_800_000_000,
      status: 'succeeded',
      latest_charge: expanded
        ? { id: `ch_${n}`, receipt_url: `https://pay.stripe.com/receipts/ch_${n}` }
        : `ch_${n}`,
    };
    this.intents.set(key, intent);
    return json(intent, 200);
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
    expect(outcome.remoteRef).toBe('pi_1');
    expect(outcome.remoteAt?.getTime()).toBe(1_800_000_000 * 1000);
    expect(outcome.receiptUrl).toBe('https://pay.stripe.com/receipts/ch_1');
  });

  it('asks stripe to expand the charge, which is where the receipt lives', () => {
    // Without the expansion latest_charge comes back as a bare id and the receipt
    // url is simply absent. That is a silent null, not an error, which is why it
    // has to be pinned rather than trusted.
    return target.deliver(ctx).then(() => {
      expect(api.seenBodies[0]).toContain('expand');
      expect(api.seenBodies[0]).toContain('latest_charge');
    });
  });

  it('sends the delivery idempotency key so a retry cannot charge twice', async () => {
    await target.deliver(ctx);
    await target.deliver(ctx);
    expect(api.seenKeys).toEqual(['evt-9:stripe', 'evt-9:stripe']);
    expect(api.intents.size).toBe(1);
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
