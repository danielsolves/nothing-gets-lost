// services/api/test/orders.controller.test.ts
// Pins the visitor's own order: priced from the catalogue, four deliveries queued
// with the confirmation mail left to rule 6.7, and every malformed order refused.
//
// The plan drives this against the mediator's IntakeService. That strand is being
// built in parallel and its source is not in this tree, so the intake port is
// exercised by an in-process stand-in with the same frozen semantics (task 6).
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Pool } from 'pg';
import { runMigrations } from '@ngl/db';
import { OrdersService } from '../src/orders.service';
import type { EventIntake, IntakeInput, IntakeResult } from '../src/intake.port';

let container: StartedPostgreSqlContainer;
let pool: Pool;
let orders: OrdersService;

class InProcessIntake implements EventIntake {
  constructor(private readonly pool: Pool) {}

  async accept(input: IntakeInput): Promise<IntakeResult> {
    const inserted = await this.pool.query<{ id: string }>(
      `INSERT INTO events (external_id, kind, payload)
       VALUES ($1, $2, $3::jsonb) ON CONFLICT (external_id) DO NOTHING RETURNING id`,
      [input.externalId, input.kind, JSON.stringify(input.payload)],
    );
    if (inserted.rowCount === 0) {
      const existing = await this.pool.query<{ id: string }>(
        'SELECT id FROM events WHERE external_id = $1', [input.externalId],
      );
      return { eventId: existing.rows[0].id, accepted: false, enqueued: [] };
    }
    const eventId = inserted.rows[0].id;
    for (const target of input.targets) {
      await this.pool.query(
        'INSERT INTO deliveries (event_id, target) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [eventId, target],
      );
    }
    return { eventId, accepted: true, enqueued: [...input.targets] };
  }
}

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine').start();
  pool = new Pool({ connectionString: container.getConnectionUri() });
  await runMigrations(pool);
  orders = new OrdersService(pool, new InProcessIntake(pool));
}, 120_000);

afterAll(async () => { await pool.end(); await container.stop(); });
beforeEach(async () => { await pool.query('TRUNCATE events CASCADE'); });

const request = {
  customerName: 'M. Berger',
  customerEmail: 'm@example.com',
  items: [{ sku: 'MUG-BLUE', qty: 3 }, { sku: 'TEAPOT', qty: 1 }],
};

describe('OrdersService', () => {
  it('prices the order from the catalogue, never from the request', async () => {
    const result = await orders.place(request);
    const { rows } = await pool.query('SELECT total_cents FROM orders WHERE id = $1', [result.orderId]);
    expect(rows[0].total_cents).toBe(3 * 1200 + 4900);
  });

  it('queues four deliveries and lets rule 6.7 add the mail later', async () => {
    const result = await orders.place(request);
    const { rows } = await pool.query(
      'SELECT target FROM deliveries WHERE event_id = $1 ORDER BY target', [result.eventId],
    );
    expect(rows.map((r) => r.target)).toEqual(['hubspot', 'ledger', 'slack', 'stripe']);
  });

  it('rejects an unknown sku instead of pricing it as zero', async () => {
    await expect(orders.place({ ...request, items: [{ sku: 'MUG-AZURE', qty: 1 }] }))
      .rejects.toThrow(/unknown sku/i);
  });

  it('rejects an empty order', async () => {
    await expect(orders.place({ ...request, items: [] })).rejects.toThrow(/no items/i);
  });

  it('rejects an invalid email, since the mail is the strongest proof', async () => {
    await expect(orders.place({ ...request, customerEmail: 'not-an-email' }))
      .rejects.toThrow(/email/i);
  });
});
