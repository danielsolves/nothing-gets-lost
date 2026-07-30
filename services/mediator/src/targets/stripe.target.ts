// services/mediator/src/targets/stripe.target.ts
// Takes the payment. Stripe is the only target with a real idempotency key, so the
// crash-after-call case (spec 6.5) is answered by Stripe itself: the same key
// replays the original response instead of charging twice.
//
// receipt_url is carried out of here deliberately — it is a page served by
// stripe.com, which makes it the one payment proof a visitor cannot accuse us of
// faking (spec 9.2).
import { CALLER_TIMEOUT_MS } from '@ngl/contracts';
import type { DeliveryContext, DeliveryOutcome, DeliveryTarget } from '../target.interface';

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

interface ChargePayload { totalCents: number; customerEmail: string }

interface StripeCharge { id: string; created: number; receipt_url: string }

export class StripeClient {
  constructor(
    private readonly baseUrl: string,
    private readonly secretKey: string,
    private readonly doFetch: Fetch = fetch,
  ) {}

  async charge(input: ChargePayload, idempotencyKey: string): Promise<StripeCharge> {
    const form = new URLSearchParams({
      amount: String(input.totalCents),
      currency: 'eur',
      confirm: 'true',
      'payment_method': 'pm_card_visa',
      'automatic_payment_methods[enabled]': 'true',
      'automatic_payment_methods[allow_redirects]': 'never',
      receipt_email: input.customerEmail,
    });

    const response = await this.doFetch(`${this.baseUrl}/v1/payment_intents`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.secretKey}`,
        'content-type': 'application/x-www-form-urlencoded',
        'idempotency-key': idempotencyKey,
      },
      body: form.toString(),
      signal: AbortSignal.timeout(CALLER_TIMEOUT_MS),
    });

    if (!response.ok) throw new Error(`Stripe responded ${response.status}`);
    return (await response.json()) as StripeCharge;
  }
}

export interface StripeOutcome extends DeliveryOutcome {
  receiptUrl: string | null;
}

export class StripeTarget implements DeliveryTarget {
  readonly target = 'stripe' as const;

  constructor(private readonly client: StripeClient) {}

  async deliver(ctx: DeliveryContext): Promise<StripeOutcome> {
    const charge = await this.client.charge(
      ctx.payload as ChargePayload, ctx.idempotencyKey,
    );
    return {
      remoteRef: charge.id,
      remoteAt: new Date(charge.created * 1000),
      receiptUrl: charge.receipt_url ?? null,
    };
  }
}
