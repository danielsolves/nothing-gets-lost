// services/mediator/src/targets/paypal.target.ts
// Takes the payment when the visitor picked PayPal instead of Stripe. Orders v2:
// create the order, then capture it, because money only moves at the capture.
//
// PayPal has no idempotency key on the url the way Stripe does; it has the
// PayPal-Request-Id header, and it is honoured per call, so the create and the
// capture carry one each, both derived from the delivery key. The crash-after-call
// case (spec 6.5) is answered twice over. Inside the replay window the same header
// makes PayPal hand back the original response rather than act again. Outside it,
// a second capture of the same order is refused with ORDER_ALREADY_CAPTURED, and
// this target reads the order back and reports the capture that already happened
// rather than parking a delivery whose money has moved.
//
// A repeated create outside the window does make a second PayPal order, and that
// costs nothing: an order nobody captures is not a charge. The double charge is
// what has to be impossible, and the capture is where that is decided.
//
// There is no receipt. Stripe serves a page on pay.stripe.com that anybody can open,
// which is the strongest payment proof in the demo (spec 9.2); the links PayPal puts
// on a capture are api endpoints that need a bearer token, and the approval link is a
// checkout page, not evidence that anything was paid. So this target carries none,
// and the proof panel says so rather than showing a url that proves nothing.
import { CALLER_TIMEOUT_MS } from '@ngl/contracts';
import type { DeliveryContext, DeliveryOutcome, DeliveryTarget } from '../target.interface';

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

interface ChargePayload { totalCents: number }

interface PayPalCapture { id: string; create_time?: string }

interface PayPalOrder {
  id: string;
  status?: string;
  links?: Array<{ href?: string; rel?: string }>;
  purchase_units?: Array<{ payments?: { captures?: PayPalCapture[] } }>;
}

interface PayPalFault { name?: string; message?: string; details?: Array<{ issue?: string }> }

export interface PayPalCharge { orderId: string; capture: PayPalCapture }

export class PayPalClient {
  constructor(
    private readonly baseUrl: string,
    private readonly clientId: string,
    private readonly clientSecret: string,
    private readonly doFetch: Fetch = fetch,
  ) {}

  async charge(input: ChargePayload, requestId: string): Promise<PayPalCharge> {
    const token = await this.accessToken();
    const order = await this.createOrder(token, input, `${requestId}:order`);
    return {
      orderId: order.id,
      capture: await this.captureOrder(token, order, requestId, `${requestId}:capture`),
    };
  }

  /**
   * Minted per attempt and never held between them.
   *
   * A token kept in memory is a call that does not happen, and a call that does not
   * happen cannot be cut. Every other outbound call in this demo leaves through the
   * gate on every attempt, and if the one that authenticates us did not, then "cut
   * the line to PayPal" would be true of the charge and false of the login. One
   * extra round trip per delivery is the whole cost of the switch meaning the same
   * thing every time it is flipped.
   */
  private async accessToken(): Promise<string> {
    if (!this.clientId || !this.clientSecret) {
      throw new Error(
        'PayPal is not configured: PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET are unset',
      );
    }
    const basic = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64');
    const response = await this.doFetch(`${this.baseUrl}/v1/oauth2/token`, {
      method: 'POST',
      headers: {
        authorization: `Basic ${basic}`,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
      signal: AbortSignal.timeout(CALLER_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new Error(`PayPal refused the credentials: ${response.status}`);
    }
    const body = (await response.json()) as { access_token?: string };
    if (!body.access_token) throw new Error('PayPal returned no access token');
    return body.access_token;
  }

  private async createOrder(
    token: string, input: ChargePayload, requestId: string,
  ): Promise<PayPalOrder> {
    const response = await this.call(token, '/v2/checkout/orders', requestId, {
      intent: 'CAPTURE',
      purchase_units: [{
        // Our delivery key, written into PayPal's own record of the order. It is
        // what lets somebody standing in the PayPal dashboard match a payment to a
        // row in this queue without taking our word for the pairing.
        custom_id: requestId,
        amount: { currency_code: 'EUR', value: euros(input.totalCents) },
      }],
    });
    if (!response.ok) throw await fault(response, 'create the order');
    return (await response.json()) as PayPalOrder;
  }

  private async captureOrder(
    token: string, order: PayPalOrder, deliveryKey: string, requestId: string,
  ): Promise<PayPalCapture> {
    const response = await this.call(
      token, `/v2/checkout/orders/${order.id}/capture`, requestId, {},
    );
    if (response.ok) {
      const captured = captureOf((await response.json()) as PayPalOrder);
      if (captured) return captured;
      throw new Error('PayPal captured the order but named no capture');
    }

    const issue = await issueOf(response);
    if (issue === 'ORDER_ALREADY_CAPTURED') return this.existingCapture(token, order.id);
    if (issue === 'ORDER_NOT_APPROVED') {
      throw new Error(
        `PayPal is holding order ${order.id} until the payer approves it: ` +
        `${approvalLink(order)} Approve it and the next attempt of ${deliveryKey} ` +
        'captures the same order rather than making a second one.',
      );
    }
    throw new Error(`PayPal responded ${response.status} to the capture (${issue})`);
  }

  /** The money already moved. Report what PayPal recorded, do not capture again. */
  private async existingCapture(token: string, orderId: string): Promise<PayPalCapture> {
    const response = await this.call(token, `/v2/checkout/orders/${orderId}`);
    if (!response.ok) throw await fault(response, `read order ${orderId} back`);
    const captured = captureOf((await response.json()) as PayPalOrder);
    if (!captured) {
      throw new Error(`PayPal calls order ${orderId} captured but names no capture`);
    }
    return captured;
  }

  private async call(
    token: string, path: string, requestId?: string, body?: unknown,
  ): Promise<Response> {
    return this.doFetch(`${this.baseUrl}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        // Absent on the read-back on purpose: it acts on nothing, so there is
        // nothing for PayPal to replay, and a shared id across two endpoints is
        // not a thing the header is defined for.
        ...(requestId === undefined ? {} : { 'paypal-request-id': requestId }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(CALLER_TIMEOUT_MS),
    });
  }
}

export interface PayPalOutcome extends DeliveryOutcome {
  /** Always null, and not an oversight. See the note at the top of this file. */
  receiptUrl: null;
}

export class PayPalTarget implements DeliveryTarget {
  readonly target = 'paypal' as const;

  constructor(private readonly client: PayPalClient) {}

  async deliver(ctx: DeliveryContext): Promise<PayPalOutcome> {
    const charged = await this.client.charge(
      ctx.payload as ChargePayload, ctx.idempotencyKey,
    );
    return {
      remoteRef: charged.capture.id,
      // PayPal's own clock, like every other remote_at in this demo.
      remoteAt: charged.capture.create_time
        ? new Date(charged.capture.create_time)
        : null,
      receiptUrl: null,
    };
  }
}

function euros(totalCents: number): string {
  return (totalCents / 100).toFixed(2);
}

function captureOf(order: PayPalOrder): PayPalCapture | null {
  return order.purchase_units?.[0]?.payments?.captures?.[0] ?? null;
}

function approvalLink(order: PayPalOrder): string {
  const link = order.links?.find((candidate) => candidate.rel === 'payer-action')
    ?? order.links?.find((candidate) => candidate.rel === 'approve');
  return link?.href ?? 'no approval link was offered';
}

/** PayPal states the real reason in details[0].issue, not in the status code. */
async function issueOf(response: Response): Promise<string> {
  const body = (await response.json().catch(() => ({}))) as PayPalFault;
  return body.details?.[0]?.issue ?? body.name ?? 'no reason given';
}

async function fault(response: Response, doing: string): Promise<Error> {
  return new Error(
    `PayPal responded ${response.status} and would not ${doing} (${await issueOf(response)})`,
  );
}
