// services/mediator/test/target.interface.test.ts
// The key format is shared by six delivery targets and by the Stripe
// Idempotency-Key header. Pinning it here means a target built in one strand and
// the worker built in another cannot disagree about what a retry looks like.
import { describe, it, expect } from 'vitest';
import { idempotencyKey } from '../src/target.interface';

describe('idempotency key', () => {
  it('joins event and target with a colon', () => {
    expect(idempotencyKey('7f0d6c1e-0000-4000-8000-000000000001', 'hubspot'))
      .toBe('7f0d6c1e-0000-4000-8000-000000000001:hubspot');
  });

  it('is stable across calls, so a retry carries the same key', () => {
    const first = idempotencyKey('evt', 'stripe');
    const second = idempotencyKey('evt', 'stripe');
    expect(first).toBe(second);
  });

  it('separates targets of the same event', () => {
    expect(idempotencyKey('evt', 'slack')).not.toBe(idempotencyKey('evt', 'ledger'));
  });
});
