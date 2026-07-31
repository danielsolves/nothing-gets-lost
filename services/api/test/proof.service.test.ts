// services/api/test/proof.service.test.ts
// Pins the proof chain of spec 9.1: two timestamps that are not ours, the measured
// gap between them, and an honest null while the chain is still running.
//
// The payment end of it names its own route, read off the delivery that took the
// money rather than off what the order asked for. Reporting a payment as made by a
// provider that never saw it would be the demo claiming a receipt it does not have,
// which is the one kind of wrong this project cannot afford.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Pool } from 'pg';
import { runMigrations } from '@ngl/db';
import type { PaymentRoute } from '@ngl/contracts';
import { ProofLookups, ProofService } from '../src/proof.service';

interface Overrides {
  route: PaymentRoute | null;
  paidAt: Date | null; receiptUrl: string | null;
  mailAt: Date | null; hubspotAt: Date | null;
}

const DEFAULTS: Overrides = {
  route: 'stripe',
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
    async payment() {
      return { route: values.route, paidAt: values.paidAt, receiptUrl: values.receiptUrl };
    },
    async mail() { return { sentAt: values.mailAt }; },
    async hubspot() { return { createdAt: values.hubspotAt }; },
  };
}

describe('ProofService', () => {
  it('returns both foreign timestamps and names their source', async () => {
    const proof = await new ProofService(lookups()).build('evt-1');
    expect(proof.paidAt).toBe('2026-07-30T14:04:02.000Z');
    expect(proof.paidAtSource).toBe('stripe');
    expect(proof.mailReceivedAt).toBe('2026-07-30T14:06:35.000Z');
    expect(proof.mailReceivedAtSource).toBe('recipient mail server');
  });

  it('measures the outage as the gap between them', async () => {
    const proof = await new ProofService(lookups()).build('evt-1');
    expect(proof.gapSeconds).toBe(153);
  });

  it('links the stripe receipt, which stripe.com serves itself', async () => {
    const proof = await new ProofService(lookups()).build('evt-1');
    expect(proof.receiptUrl).toContain('pay.stripe.com');
  });

  it('offers no receipt when the payment carries none', async () => {
    // A route is not a promise of a page. The field has to stay null rather than
    // fall back to a link from somewhere else, which is what would make it a lie.
    const proof = await new ProofService(lookups({ receiptUrl: null })).build('evt-1');
    expect(proof.receiptUrl).toBeNull();
    expect(proof.paidAtSource).toBe('stripe');
  });

  it('names no payment source for an event that has no payment leg', async () => {
    // A Stripe webhook arrives already paid and queues no payment delivery at all.
    // Naming a source there would be inventing one to fill the field.
    const proof = await new ProofService(
      lookups({ route: null, paidAt: null, receiptUrl: null }),
    ).build('evt-1');
    expect(proof.paidAtSource).toBeNull();
    expect(proof.paidAt).toBeNull();
  });

  it('adds hubspot as a third witness when the visitor connected their portal', async () => {
    const proof = await new ProofService(
      lookups({ hubspotAt: new Date('2026-07-30T14:06:31Z') }),
    ).build('evt-1');
    expect(proof.hubspotCreatedAt).toBe('2026-07-30T14:06:31.000Z');
  });

  it('reports no gap while the chain has not completed', async () => {
    const proof = await new ProofService(lookups({ mailAt: null })).build('evt-1');
    expect(proof.mailReceivedAt).toBeNull();
    expect(proof.gapSeconds).toBeNull();
  });
});

describe('ProofLookups', () => {
  let container: StartedPostgreSqlContainer;
  let pool: Pool;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:16-alpine').start();
    pool = new Pool({ connectionString: container.getConnectionUri() });
    await runMigrations(pool);
  }, 120_000);

  afterAll(async () => { await pool.end(); await container.stop(); });

  async function paidEvent(externalId: string, target: string): Promise<string> {
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO events (external_id, kind, payload)
       VALUES ($1, 'order.placed', '{}'::jsonb) RETURNING id`, [externalId],
    );
    const eventId = rows[0].id;
    await pool.query(
      `INSERT INTO deliveries (event_id, target, state, remote_at)
       VALUES ($1, $2, 'done', timestamptz '2026-07-30T14:04:02Z')`,
      [eventId, target],
    );
    return eventId;
  }

  it('reads the route off the delivery that actually took the money', async () => {
    // The event carries four deliveries and only one of them is the payment. This
    // has to find that one by name, not take whichever row the database hands back
    // first, which is what would quietly break the day a second provider arrives.
    const eventId = await paidEvent('evt_paid_stripe', 'stripe');
    await pool.query(
      `INSERT INTO deliveries (event_id, target) VALUES ($1, 'slack'), ($1, 'ledger')`,
      [eventId],
    );
    const payment = await new ProofLookups(pool).payment(eventId);
    expect(payment.route).toBe('stripe');
    expect(payment.paidAt?.toISOString()).toBe('2026-07-30T14:04:02.000Z');
  });

  it('names the route before the money has moved', async () => {
    // The panel opens while the payment is still queued. "Stripe, not yet" is a
    // better answer than a blank that reads as if nothing was ever attempted.
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO events (external_id, kind, payload)
       VALUES ('evt_pending_route', 'order.placed', '{}'::jsonb) RETURNING id`,
    );
    await pool.query(
      `INSERT INTO deliveries (event_id, target) VALUES ($1, 'stripe')`, [rows[0].id],
    );
    const payment = await new ProofLookups(pool).payment(rows[0].id);
    expect(payment.route).toBe('stripe');
    expect(payment.paidAt).toBeNull();
  });

  it('names no route for an event with no payment leg', async () => {
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO events (external_id, kind, payload)
       VALUES ('evt_no_payment', 'payment.succeeded', '{}'::jsonb) RETURNING id`,
    );
    await pool.query(
      `INSERT INTO deliveries (event_id, target) VALUES ($1, 'hubspot')`, [rows[0].id],
    );
    const payment = await new ProofLookups(pool).payment(rows[0].id);
    expect(payment.route).toBeNull();
    expect(payment.paidAt).toBeNull();
  });
});
