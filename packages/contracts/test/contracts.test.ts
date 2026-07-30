// packages/contracts/test/contracts.test.ts
// Pins the shared vocabulary. These names also appear as CHECK constraints in
// migration 001 — if the two ever drift apart, inserts start failing at runtime
// instead of here, so this test is the cheap place to catch it.
import { describe, it, expect } from 'vitest';
import {
  TARGETS, DELIVERY_STATES, SWITCH_STATES, CHAOS_KINDS,
  EGRESS_BASE_URLS, isTarget,
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

  it('has an egress base url for every proxied target', () => {
    for (const target of ['hubspot', 'stripe', 'slack', 'ledger', 'mailer'] as const) {
      expect(EGRESS_BASE_URLS[target]).toMatch(/^https?:\/\//);
    }
  });

  it('recognises valid and invalid targets', () => {
    expect(isTarget('hubspot')).toBe(true);
    expect(isTarget('facebook')).toBe(false);
  });
});
