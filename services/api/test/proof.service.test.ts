// services/api/test/proof.service.test.ts
// Pins the proof chain of spec 9.1: two timestamps that are not ours, the measured
// gap between them, and an honest null while the chain is still running.
import { describe, it, expect } from 'vitest';
import { ProofService } from '../src/proof.service';

interface Overrides {
  paidAt: Date | null; receiptUrl: string | null;
  mailAt: Date | null; hubspotAt: Date | null;
}

const DEFAULTS: Overrides = {
  paidAt: new Date('2026-07-30T14:04:02Z'),
  receiptUrl: 'https://pay.stripe.com/receipts/ch_1',
  mailAt: new Date('2026-07-30T14:06:35Z'),
  hubspotAt: null,
};

// Merged by spread rather than by ??, because an explicit null override means "this
// step has not happened yet" and ?? would silently hand back the default instead.
function lookups(overrides: Partial<Overrides> = {}) {
  const values = { ...DEFAULTS, ...overrides };
  return {
    async stripe() {
      return { paidAt: values.paidAt, receiptUrl: values.receiptUrl };
    },
    async mail() { return { sentAt: values.mailAt }; },
    async hubspot() { return { createdAt: values.hubspotAt }; },
  };
}

describe('ProofService', () => {
  it('returns both foreign timestamps and names their source', async () => {
    const proof = await new ProofService(lookups() as never).build('evt-1');
    expect(proof.paidAt).toBe('2026-07-30T14:04:02.000Z');
    expect(proof.paidAtSource).toBe('stripe');
    expect(proof.mailReceivedAt).toBe('2026-07-30T14:06:35.000Z');
    expect(proof.mailReceivedAtSource).toBe('recipient mail server');
  });

  it('measures the outage as the gap between them', async () => {
    const proof = await new ProofService(lookups() as never).build('evt-1');
    expect(proof.gapSeconds).toBe(153);
  });

  it('links the stripe receipt, which stripe.com serves itself', async () => {
    const proof = await new ProofService(lookups() as never).build('evt-1');
    expect(proof.receiptUrl).toContain('pay.stripe.com');
  });

  it('adds hubspot as a third witness when the visitor connected their portal', async () => {
    const proof = await new ProofService(
      lookups({ hubspotAt: new Date('2026-07-30T14:06:31Z') }) as never,
    ).build('evt-1');
    expect(proof.hubspotCreatedAt).toBe('2026-07-30T14:06:31.000Z');
  });

  it('reports no gap while the chain has not completed', async () => {
    const proof = await new ProofService(lookups({ mailAt: null }) as never).build('evt-1');
    expect(proof.mailReceivedAt).toBeNull();
    expect(proof.gapSeconds).toBeNull();
  });
});
