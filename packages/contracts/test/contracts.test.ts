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
  it('names the six targets exactly as the spec does', () => {
    expect([...TARGETS]).toEqual(
      ['hubspot', 'stripe', 'slack', 'ledger', 'mailer', 'custom_webhook'],
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

  it('recognises valid and invalid targets', () => {
    expect(isTarget('hubspot')).toBe(true);
    expect(isTarget('facebook')).toBe(false);
  });

  it('no longer knows paypal at all', () => {
    // It was the second payment route and it is gone: PayPal will not capture a
    // server-made order until a payer approves it in a browser, and there is no
    // shared test payer the way Stripe has pm_card_visa. Pinned here because the
    // name also has to be absent from the CHECK constraints migration 011 narrows,
    // and a value that came back in code while the database refused it would fail
    // at an insert rather than in a test.
    expect(isTarget('paypal')).toBe(false);
    expect(isPaymentRoute('paypal')).toBe(false);
  });

  it('offers the one payment route, and it is a target', () => {
    expect([...PAYMENT_ROUTES]).toEqual(['stripe']);
    for (const route of PAYMENT_ROUTES) expect(isTarget(route)).toBe(true);
  });

  it('defaults to a route it can actually charge', () => {
    expect(isPaymentRoute(DEFAULT_PAYMENT_ROUTE)).toBe(true);
    expect(isPaymentRoute('bitcoin')).toBe(false);
  });
});
