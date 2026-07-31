// packages/contracts/test/contracts.test.ts
// Pins the shared vocabulary. These names also appear as CHECK constraints in
// migration 001 — if the two ever drift apart, inserts start failing at runtime
// instead of here, so this test is the cheap place to catch it.
import { describe, it, expect } from 'vitest';
import {
  TARGETS, SWITCHABLE_TARGETS, DELIVERY_STATES, SWITCH_STATES, CHAOS_KINDS,
  PAYMENT_ROUTES, DEFAULT_PAYMENT_ROUTE,
  EGRESS_BASE_URLS, isTarget, isPaymentRoute,
} from '../src/index';

describe('frozen contracts', () => {
  it('names the seven targets exactly as the spec does', () => {
    expect([...TARGETS]).toEqual(
      ['hubspot', 'stripe', 'paypal', 'slack', 'ledger', 'mailer', 'custom_webhook'],
    );
  });

  it('names the four delivery states', () => {
    expect([...DELIVERY_STATES]).toEqual(['pending', 'inflight', 'done', 'dead']);
  });

  it('names the four switch states', () => {
    expect([...SWITCH_STATES]).toEqual(['up', 'slow', 'error', 'cut']);
  });

  it('names the three chaos buttons', () => {
    expect([...CHAOS_KINDS]).toEqual(
      ['duplicate_webhook', 'garbage_payload', 'hallucinate'],
    );
  });

  it('has an egress base url for every switchable target', () => {
    // Not a convenience. A target without a base url here cannot be reached through
    // the gate at all, which would mean its switch says "cut" and nothing happens.
    for (const target of SWITCHABLE_TARGETS) {
      expect(EGRESS_BASE_URLS[target]).toMatch(/^https?:\/\//);
    }
  });

  it('sends paypal to the sandbox host and nowhere else', () => {
    // Spec 11 rules out real money by construction. Stripe does it with a key
    // prefix; PayPal client ids carry no such marker, so the host is pinned here
    // instead and a live credential simply fails to authenticate against it.
    expect(EGRESS_BASE_URLS.paypal).toBe('https://api-m.sandbox.paypal.com');
  });

  it('recognises valid and invalid targets', () => {
    expect(isTarget('hubspot')).toBe(true);
    expect(isTarget('facebook')).toBe(false);
  });

  it('offers two payment routes and both of them are targets', () => {
    expect([...PAYMENT_ROUTES]).toEqual(['stripe', 'paypal']);
    for (const route of PAYMENT_ROUTES) expect(isTarget(route)).toBe(true);
  });

  it('defaults to a route it can actually charge', () => {
    expect(isPaymentRoute(DEFAULT_PAYMENT_ROUTE)).toBe(true);
    expect(isPaymentRoute('bitcoin')).toBe(false);
  });
});
