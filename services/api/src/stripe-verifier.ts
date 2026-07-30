// services/api/src/stripe-verifier.ts
// The signature check the webhook endpoint stands on. The HMAC itself belongs to
// the Stripe strand (services/mediator/src/stripe.webhook.ts, task 14); this file
// is only the seam, and until that implementation is wired in it fails closed —
// an unverified webhook is refused rather than trusted.
export interface StripeSignatureVerifier {
  verify(rawBody: string, signatureHeader: string, now: number): boolean;
}

export class UnwiredStripeVerifier implements StripeSignatureVerifier {
  verify(): boolean {
    return false;
  }
}
