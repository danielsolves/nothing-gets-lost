// services/mediator/test/stripe.webhook.test.ts
// Pins the Stripe webhook signature check (spec 6.2): a correct signature is
// accepted, a forged, tampered, replayed or malformed one is refused. The test
// mode guard is pinned here too, so the demo can never move real money.
import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import { verifyStripeSignature, assertTestMode } from '../src/stripe.webhook';

const SECRET = 'whsec_test';
const BODY = JSON.stringify({ id: 'evt_1', type: 'payment_intent.succeeded' });

function signature(timestamp: number, body = BODY, secret = SECRET): string {
  const signed = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
  return `t=${timestamp},v1=${signed}`;
}

describe('stripe webhook signature', () => {
  const now = 1_800_000_000;

  it('accepts a correctly signed payload', () => {
    expect(verifyStripeSignature(BODY, signature(now), SECRET, now)).toBe(true);
  });

  it('rejects a payload signed with the wrong secret', () => {
    expect(verifyStripeSignature(BODY, signature(now, BODY, 'whsec_other'), SECRET, now))
      .toBe(false);
  });

  it('rejects a tampered body', () => {
    const header = signature(now);
    expect(verifyStripeSignature(BODY.replace('evt_1', 'evt_2'), header, SECRET, now))
      .toBe(false);
  });

  it('rejects a replayed signature older than five minutes', () => {
    expect(verifyStripeSignature(BODY, signature(now - 400), SECRET, now)).toBe(false);
  });

  it('rejects a malformed header', () => {
    expect(verifyStripeSignature(BODY, 'nonsense', SECRET, now)).toBe(false);
    expect(verifyStripeSignature(BODY, '', SECRET, now)).toBe(false);
  });
});

describe('test mode guard', () => {
  it('accepts a test key', () => {
    expect(() => assertTestMode('sk_test_abc')).not.toThrow();
  });

  it('refuses a live key so the demo can never touch real money', () => {
    expect(() => assertTestMode('sk_live_abc')).toThrow(/test mode/i);
  });

  it('accepts no key at all, because the demo has to start without one', () => {
    // README: "No API keys required." An empty key is not a live key, it is a
    // Stripe target that will fail and retry where the visitor can watch it.
    expect(() => assertTestMode('')).not.toThrow();
    expect(() => assertTestMode(undefined)).not.toThrow();
  });

  it('refuses anything that is neither empty nor a test secret key', () => {
    // A restricted key, a publishable key, a pasted webhook secret. None of them
    // belong here, and all of them fail confusingly later if let through.
    expect(() => assertTestMode('rk_live_abc')).toThrow(/test mode/i);
    expect(() => assertTestMode('pk_test_abc')).toThrow(/test mode/i);
    expect(() => assertTestMode('whsec_abc')).toThrow(/test mode/i);
  });
});
