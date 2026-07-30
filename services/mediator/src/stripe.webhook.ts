// services/mediator/src/stripe.webhook.ts
// Signature verification for incoming Stripe webhooks (spec 6.2).
//
// This is not optional plumbing. The "deliver the payment twice" button replays a
// real webhook, and the demo may only claim to dedupe genuine Stripe traffic if it
// refuses forged traffic in the first place.
import { createHmac, timingSafeEqual } from 'node:crypto';

const TOLERANCE_SECONDS = 300;

export function verifyStripeSignature(
  rawBody: string,
  header: string,
  secret: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): boolean {
  const parts = Object.fromEntries(
    header.split(',').map((pair) => pair.split('=') as [string, string]).filter((p) => p.length === 2),
  );
  const timestamp = Number(parts.t);
  const provided = parts.v1;
  if (!Number.isFinite(timestamp) || !provided) return false;
  if (Math.abs(nowSeconds - timestamp) > TOLERANCE_SECONDS) return false;

  const expected = createHmac('sha256', secret)
    .update(`${timestamp}.${rawBody}`)
    .digest('hex');

  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(provided, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Called at startup. A live key would mean the demo could move real money. */
export function assertTestMode(secretKey: string): void {
  if (!secretKey.startsWith('sk_test_')) {
    throw new Error('STRIPE_SECRET_KEY must be a test mode key (sk_test_...)');
  }
}
