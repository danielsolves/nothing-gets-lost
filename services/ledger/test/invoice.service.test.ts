// services/ledger/test/invoice.service.test.ts
// Pins the idempotency of invoice creation against a real Postgres, including the
// race between two simultaneous calls — the case a retry after a crash produces.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Pool } from 'pg';
import { runMigrations } from '@ngl/db';
import { InvoiceService } from '../src/invoice.service';

let container: StartedPostgreSqlContainer;
let pool: Pool;
let service: InvoiceService;

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine').start();
  pool = new Pool({ connectionString: container.getConnectionUri() });
  await runMigrations(pool);
  service = new InvoiceService(pool);
}, 120_000);

afterAll(async () => { await pool.end(); await container.stop(); });
beforeEach(async () => { await pool.query('TRUNCATE invoices'); });

const eventId = '11111111-1111-1111-1111-111111111111';

describe('InvoiceService', () => {
  it('creates an invoice with a running number', async () => {
    const invoice = await service.createOrGet(eventId, 4900);
    expect(invoice.created).toBe(true);
    expect(invoice.number).toMatch(/^INV-\d{4}$/);
    expect(invoice.totalCents).toBe(4900);
  });

  it('returns the existing invoice for a repeated event, never a second one', async () => {
    const first = await service.createOrGet(eventId, 4900);
    const second = await service.createOrGet(eventId, 4900);
    expect(second.created).toBe(false);
    expect(second.id).toBe(first.id);
    expect(second.number).toBe(first.number);
    const { rows } = await pool.query('SELECT count(*) FROM invoices');
    expect(Number(rows[0].count)).toBe(1);
  });

  it('survives two simultaneous calls for the same event', async () => {
    const [a, b] = await Promise.all([
      service.createOrGet(eventId, 1200),
      service.createOrGet(eventId, 1200),
    ]);
    expect(a.id).toBe(b.id);
    expect([a.created, b.created].filter(Boolean)).toHaveLength(1);
  });

  it('reads an invoice back by id', async () => {
    const created = await service.createOrGet(eventId, 2600);
    const found = await service.findById(created.id);
    expect(found?.number).toBe(created.number);
  });
});
