// services/api/src/stripe-verifier.ts
// The signature check the webhook endpoint stands on. The HMAC itself belongs to
// the Stripe strand (services/mediator/src/stripe.webhook.ts, task 14); this file
// is only the seam, so the crypto lives in exactly one place.
//
// It fails closed: without a configured webhook secret an unverified webhook is
// refused rather than trusted. The demo may only claim to drop duplicate Stripe
// traffic if it rejects forged traffic first (spec 6.2).
import { verifyStripeSignature } from '@ngl/mediator';

export interface StripeSignatureVerifier {
  verify(rawBody: string, signatureHeader: string, now: number): boolean;
}

export class StripeVerifier implements StripeSignatureVerifier {
  constructor(private readonly secret: string | undefined) {}

  verify(rawBody: string, signatureHeader: string, now: number): boolean {
    if (!this.secret) return false;
    return verifyStripeSignature(rawBody, signatureHeader, this.secret, now);
  }
}
