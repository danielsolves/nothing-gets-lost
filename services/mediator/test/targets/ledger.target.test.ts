// services/mediator/test/targets/ledger.target.test.ts
// The ledger is our own service, so its idempotency is a database constraint
// rather than a remote vendor's promise: a repeated delivery must return the
// existing invoice, not a second one with a second number (spec 6.5).
import { describe, it, expect, beforeEach } from 'vitest';
import { LedgerClient, LedgerTarget } from '../../src/targets/ledger.target';

/** Stands in for the ledger service, including its 200-on-repeat behaviour. */
class FakeLedger {
  invoices = new Map<string, { id: string; number: string; createdAt: string }>();
  calls: Array<{ url: string; idempotencyKey: string | undefined }> = [];
  private next = 1000;

  fetch = async (url: string, init?: RequestInit): Promise<Response> => {
    const headers = new Headers(init?.headers);
    this.calls.push({ url, idempotencyKey: headers.get('idempotency-key') ?? undefined });

    const body = JSON.parse(String(init?.body)) as { eventId: string };
    const existing = this.invoices.get(body.eventId);
    if (existing) return json(existing, 200);

    const created = {
      id: `inv-${this.next}`,
      number: `INV-${this.next}`,
      createdAt: '2026-07-30T14:06:31.000Z',
    };
    this.next += 1;
    this.invoices.set(body.eventId, created);
    return json(created, 201);
  };
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status, headers: { 'content-type': 'application/json' },
  });
}

let ledger: FakeLedger;
let target: LedgerTarget;

beforeEach(() => {
  ledger = new FakeLedger();
  target = new LedgerTarget(new LedgerClient('http://gate/proxy/ledger', ledger.fetch));
});

const ctx = (eventId: string) => ({
  eventId,
  idempotencyKey: `${eventId}:ledger`,
  payload: { totalCents: 1200 },
});

describe('LedgerTarget', () => {
  it('books an invoice and reports the number the ledger assigned', async () => {
    const outcome = await target.deliver(ctx('evt-1'));
    expect(outcome.remoteRef).toBe('INV-1000');
    expect(outcome.remoteAt?.toISOString()).toBe('2026-07-30T14:06:31.000Z');
  });

  it('books once when the same delivery is retried', async () => {
    const first = await target.deliver(ctx('evt-2'));
    const second = await target.deliver(ctx('evt-2'));

    expect(second.remoteRef).toBe(first.remoteRef);
    expect(ledger.invoices.size).toBe(1);
  });

  it('sends the idempotency key so the retry is recognisable at the target', async () => {
    await target.deliver(ctx('evt-3'));
    expect(ledger.calls[0].idempotencyKey).toBe('evt-3:ledger');
  });

  it('goes through the egress gate, never straight to the service', async () => {
    await target.deliver(ctx('evt-4'));
    expect(ledger.calls[0].url).toBe('http://gate/proxy/ledger/invoices');
  });

  it('throws when the ledger is unreachable, so the worker reschedules', async () => {
    const dead = new LedgerTarget(new LedgerClient('http://gate/proxy/ledger', async () => {
      throw new Error('ECONNRESET');
    }));
    await expect(dead.deliver(ctx('evt-5'))).rejects.toThrow(/ECONNRESET/);
  });
});
