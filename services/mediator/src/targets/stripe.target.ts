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

/**
 * What /v1/payment_intents answers with. receipt_url does not live here: it lives
 * on the charge, which comes back as a bare id unless the call asks for it to be
 * expanded. Getting that wrong is silent — a null receipt, not an error — and the
 * receipt is the one payment proof a visitor cannot accuse us of faking.
 */
interface StripeIntent {
  id: string;
  created: number;
  latest_charge?: { id: string; receipt_url?: string } | string | null;
}

export class StripeClient {
  constructor(
    private readonly baseUrl: string,
    private readonly secretKey: string,
    private readonly doFetch: Fetch = fetch,
  ) {}

  async charge(input: ChargePayload, idempotencyKey: string): Promise<StripeIntent> {
    const form = new URLSearchParams({
      amount: String(input.totalCents),
      currency: 'eur',
      confirm: 'true',
      'payment_method': 'pm_card_visa',
      'automatic_payment_methods[enabled]': 'true',
      'automatic_payment_methods[allow_redirects]': 'never',
      receipt_email: input.customerEmail,
      'expand[]': 'latest_charge',
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
    return (await response.json()) as StripeIntent;
  }
}

export interface StripeOutcome extends DeliveryOutcome {
  receiptUrl: string | null;
}

export class StripeTarget implements DeliveryTarget {
  readonly target = 'stripe' as const;

  constructor(private readonly client: StripeClient) {}

  async deliver(ctx: DeliveryContext): Promise<StripeOutcome> {
    const intent = await this.client.charge(
      ctx.payload as ChargePayload, ctx.idempotencyKey,
    );
    // Expanded, latest_charge is the charge object; unexpanded it is a bare id and
    // there is no receipt to carry. Narrowed rather than assumed, because guessing
    // wrong here loses the proof silently instead of loudly.
    const charge = typeof intent.latest_charge === 'object' ? intent.latest_charge : null;
    return {
      remoteRef: intent.id,
      remoteAt: new Date(intent.created * 1000),
      receiptUrl: charge?.receipt_url ?? null,
    };
  }
}
