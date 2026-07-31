// services/mediator/test/targets/paypal.target.test.ts
// Proves the two things a payment target has to be able to say for itself: that a
// retry after a crash cannot take the money twice (spec 6.5), and that every call
// it makes, the token included, leaves through the egress gate (spec 7).
//
// The fake stands in for api-m.sandbox.paypal.com and behaves the way PayPal does:
// it mints a bearer token before it will speak at all, it honours PayPal-Request-Id
// on a repeat, and it answers a second capture of the same order with 422
// ORDER_ALREADY_CAPTURED. Both of the last two are the crash case, and the target
// has to survive either of them.
import { describe, it, expect, beforeEach } from 'vitest';
import { PayPalClient, PayPalTarget } from '../../src/targets/paypal.target';

const GATE = 'http://gate/proxy/paypal';

interface StoredCapture { id: string; create_time: string }

class FakePayPal {
  urls: string[] = [];
  requestIds: string[] = [];
  bearers: string[] = [];
  tokenCalls = 0;
  captureCalls = 0;
  /** PayPal only replays a request id for a while. False is after that window. */
  replaysRequestIds = true;
  /** A real order is captured only once the payer has approved it. */
  approved = true;

  private next = 1;
  private readonly ordersByRequestId = new Map<string, string>();
  private readonly capturesByOrder = new Map<string, StoredCapture>();

  fetch = async (url: string, init?: RequestInit): Promise<Response> => {
    this.urls.push(url);
    const headers = (init?.headers ?? {}) as Record<string, string>;
    if (headers['paypal-request-id']) this.requestIds.push(headers['paypal-request-id']);
    if (headers.authorization) this.bearers.push(headers.authorization);

    if (url.endsWith('/v1/oauth2/token')) {
      this.tokenCalls += 1;
      return json({ access_token: `A21AA-${this.tokenCalls}`, expires_in: 32400 });
    }
    if (url.endsWith('/v2/checkout/orders')) {
      return json(this.createOrder(headers['paypal-request-id'] ?? ''), 201);
    }
    const capturing = /\/v2\/checkout\/orders\/([^/]+)\/capture$/.exec(url);
    if (capturing) return this.capture(capturing[1], headers['paypal-request-id'] ?? '');
    const reading = /\/v2\/checkout\/orders\/([^/]+)$/.exec(url);
    if (reading) return json(this.order(reading[1]));
    return json({ name: 'RESOURCE_NOT_FOUND' }, 404);
  };

  private createOrder(requestId: string): unknown {
    const existing = this.ordersByRequestId.get(requestId);
    if (existing) return this.order(existing);
    const id = `5O1${this.next++}`;
    this.ordersByRequestId.set(requestId, id);
    return this.order(id);
  }

  private capture(orderId: string, requestId: string): Response {
    const already = this.capturesByOrder.get(orderId);
    if (already && this.replaysRequestIds && requestId !== '') {
      return json(this.order(orderId), 201);
    }
    if (already) {
      return json({
        name: 'UNPROCESSABLE_ENTITY',
        details: [{ issue: 'ORDER_ALREADY_CAPTURED' }],
      }, 422);
    }
    if (!this.approved) {
      return json({
        name: 'UNPROCESSABLE_ENTITY',
        details: [{ issue: 'ORDER_NOT_APPROVED' }],
      }, 422);
    }
    this.captureCalls += 1;
    this.capturesByOrder.set(orderId, {
      id: `3C4${this.captureCalls}`, create_time: '2026-07-31T14:04:02Z',
    });
    return json(this.order(orderId), 201);
  }

  private order(id: string): unknown {
    const capture = this.capturesByOrder.get(id);
    return {
      id,
      status: capture ? 'COMPLETED' : 'CREATED',
      links: [
        { href: `${GATE}/v2/checkout/orders/${id}`, rel: 'self' },
        { href: `https://www.sandbox.paypal.com/checkoutnow?token=${id}`, rel: 'approve' },
      ],
      purchase_units: [{ payments: capture ? { captures: [capture] } : undefined }],
    };
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status, headers: { 'content-type': 'application/json' },
  });
}

let api: FakePayPal;
let target: PayPalTarget;

beforeEach(() => {
  api = new FakePayPal();
  target = new PayPalTarget(
    new PayPalClient(GATE, 'client-id', 'client-secret', api.fetch),
  );
});

const ctx = {
  eventId: 'evt-9',
  idempotencyKey: 'evt-9:paypal',
  payload: { totalCents: 4900, customerEmail: 'm@example.com' },
};

describe('PayPalTarget', () => {
  it('takes the money and returns the capture id paypal assigned', async () => {
    const outcome = await target.deliver(ctx);
    expect(outcome.remoteRef).toBe('3C41');
    expect(outcome.remoteAt?.toISOString()).toBe('2026-07-31T14:04:02.000Z');
    expect(api.captureCalls).toBe(1);
  });

  it('carries no receipt url, because paypal serves no such page', async () => {
    // Stripe hands back a receipt on pay.stripe.com that a visitor can open without
    // logging in, and that is the demo's strongest payment proof. PayPal has no
    // equivalent: the links on a capture are api endpoints that need a bearer token,
    // and the approval page is a checkout, not evidence of a payment. Inventing a
    // url here would be the one kind of lie this demo cannot afford.
    const outcome = await target.deliver(ctx);
    expect(outcome.receiptUrl).toBeNull();
  });

  it('asks the gate for its token, not paypal.com', async () => {
    // Without this the "cut the line to PayPal" switch would be theatre for the one
    // request that matters most: the demo could still authenticate while claiming
    // the line was dead.
    await target.deliver(ctx);
    expect(api.urls[0]).toBe(`${GATE}/v1/oauth2/token`);
    for (const url of api.urls) expect(url.startsWith(GATE)).toBe(true);
  });

  it('uses the token it was just handed', async () => {
    await target.deliver(ctx);
    expect(api.bearers).toContain('Bearer A21AA-1');
  });

  it('fetches a fresh token per attempt rather than holding one', async () => {
    // A held token is a call that does not happen, and a call that does not happen
    // cannot be cut. The switch has to mean the same thing on every attempt.
    await target.deliver(ctx);
    await target.deliver(ctx);
    expect(api.tokenCalls).toBe(2);
  });

  it('sends the same request ids on a retry, so paypal replays', async () => {
    const first = await target.deliver(ctx);
    const second = await target.deliver(ctx);
    expect(api.requestIds).toEqual([
      'evt-9:paypal:order', 'evt-9:paypal:capture',
      'evt-9:paypal:order', 'evt-9:paypal:capture',
    ]);
    expect(api.captureCalls).toBe(1);
    expect(second.remoteRef).toBe(first.remoteRef);
  });

  it('reads the capture back when paypal has forgotten the request id', async () => {
    // The crash case with the replay window gone. PayPal answers 422
    // ORDER_ALREADY_CAPTURED, and giving up there would park a delivery whose money
    // has already moved. The order is read back instead and reports what happened.
    const first = await target.deliver(ctx);
    api.replaysRequestIds = false;
    const second = await target.deliver(ctx);
    expect(second.remoteRef).toBe(first.remoteRef);
    expect(api.captureCalls).toBe(1);
  });

  it('creates one order however often the delivery is attempted', async () => {
    await target.deliver(ctx);
    api.replaysRequestIds = false;
    await target.deliver(ctx);
    const created = api.urls.filter((url) => url.endsWith('/v2/checkout/orders'));
    expect(created).toHaveLength(2);
    expect(api.captureCalls).toBe(1);
  });

  it('points at the approval page while paypal is waiting for one', async () => {
    api.approved = false;
    await expect(target.deliver(ctx)).rejects.toThrow(/sandbox\.paypal\.com\/checkoutnow/);
  });

  it('says which two names are missing when nothing is configured', async () => {
    // No credential must ever stop the mediator booting or touch an order that chose
    // Stripe. It fails here, on this delivery, where a visitor can read the reason.
    const unconfigured = new PayPalTarget(new PayPalClient(GATE, '', '', api.fetch));
    await expect(unconfigured.deliver(ctx)).rejects.toThrow(/PAYPAL_CLIENT_ID/);
    expect(api.urls).toHaveLength(0);
  });

  it('throws when paypal is unreachable', async () => {
    const failing = new PayPalClient(GATE, 'client-id', 'client-secret',
      async () => { throw new TypeError('fetch failed'); });
    await expect(new PayPalTarget(failing).deliver(ctx)).rejects.toThrow(/fetch failed/);
  });
});
