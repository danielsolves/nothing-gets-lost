// services/mediator/src/targets/ledger.target.ts
// Books the invoice. The ledger is our own service, so the crash-after-call case
// (spec 6.5) is answered by a UNIQUE (event_id) on its invoices table: a repeated
// delivery gets 200 with the existing invoice instead of a second number.
//
// The invoice number and timestamp come back from the ledger, never from here —
// the proof panel shows what the target assigned, not what we hoped for.
import { CALLER_TIMEOUT_MS } from '@ngl/contracts';
import type { DeliveryContext, DeliveryOutcome, DeliveryTarget } from '../target.interface';

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

interface InvoicePayload { totalCents: number }

interface Invoice { id: string; number: string; createdAt: string }

export class LedgerClient {
  constructor(
    private readonly baseUrl: string,
    private readonly doFetch: Fetch = fetch,
  ) {}

  async createInvoice(
    eventId: string, input: InvoicePayload, idempotencyKey: string,
  ): Promise<Invoice> {
    const response = await this.doFetch(`${this.baseUrl}/invoices`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': idempotencyKey,
      },
      body: JSON.stringify({ eventId, totalCents: input.totalCents }),
      signal: AbortSignal.timeout(CALLER_TIMEOUT_MS),
    });

    if (!response.ok) throw new Error(`Ledger responded ${response.status}`);
    return (await response.json()) as Invoice;
  }
}

export class LedgerTarget implements DeliveryTarget {
  readonly target = 'ledger' as const;

  constructor(private readonly client: LedgerClient) {}

  async deliver(ctx: DeliveryContext): Promise<DeliveryOutcome> {
    const invoice = await this.client.createInvoice(
      ctx.eventId, ctx.payload as InvoicePayload, ctx.idempotencyKey,
    );
    return { remoteRef: invoice.number, remoteAt: new Date(invoice.createdAt) };
  }
}
