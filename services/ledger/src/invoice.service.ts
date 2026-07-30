// services/ledger/src/invoice.service.ts
// Invoices, idempotent by event id. The UNIQUE (event_id) constraint carries the
// guarantee; the ON CONFLICT branch turns a repeated call into a read instead of an
// error, which is what lets the mediator retry safely after a crash (spec 6.5).
import type { Pool } from 'pg';

export interface Invoice {
  id: string;
  number: string;
  totalCents: number;
  createdAt: Date;
  created: boolean;
}

interface InvoiceRow {
  id: string;
  number: string;
  total_cents: number;
  created_at: Date;
}

function toInvoice(row: InvoiceRow, created: boolean): Invoice {
  return {
    id: row.id, number: row.number, totalCents: row.total_cents,
    createdAt: row.created_at, created,
  };
}

export class InvoiceService {
  constructor(private readonly pool: Pool) {}

  async createOrGet(eventId: string, totalCents: number): Promise<Invoice> {
    const inserted = await this.pool.query<InvoiceRow>(
      `INSERT INTO invoices (event_id, number, total_cents)
       VALUES ($1, 'INV-' || lpad(nextval('invoice_number_seq')::text, 4, '0'), $2)
       ON CONFLICT (event_id) DO NOTHING
       RETURNING id, number, total_cents, created_at`,
      [eventId, totalCents],
    );

    const insertedRow = inserted.rows[0];
    if (insertedRow) return toInvoice(insertedRow, true);

    const { rows } = await this.pool.query<InvoiceRow>(
      'SELECT id, number, total_cents, created_at FROM invoices WHERE event_id = $1',
      [eventId],
    );
    const existing = rows[0];
    if (!existing) {
      throw new Error(`invoice for event ${eventId} is neither new nor stored`);
    }
    return toInvoice(existing, false);
  }

  async findById(id: string): Promise<Invoice | null> {
    const { rows } = await this.pool.query<InvoiceRow>(
      'SELECT id, number, total_cents, created_at FROM invoices WHERE id = $1', [id],
    );
    const row = rows[0];
    return row ? toInvoice(row, false) : null;
  }
}
