// services/mediator/test/worker.service.test.ts
// The hardest case in the project (spec 6.5): the call reached the target and
// the worker died before recording it. The proof here is that the retry carries
// the SAME idempotency key, which is the only thing that lets the target ignore it.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Pool } from 'pg';
import { runMigrations } from '@ngl/db';
import { QueueRepository } from '../src/queue.repository';
import { WorkerService } from '../src/worker.service';
import {
  idempotencyKey, UnresolvableDelivery, type DeliveryTarget,
} from '../src/target.interface';

let container: StartedPostgreSqlContainer;
let pool: Pool;
let queue: QueueRepository;

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine').start();
  pool = new Pool({ connectionString: container.getConnectionUri() });
  await runMigrations(pool);
  queue = new QueueRepository(pool);
}, 120_000);

afterAll(async () => { await pool.end(); await container.stop(); });
beforeEach(async () => { await pool.query('TRUNCATE events CASCADE'); });

async function seed(externalId: string, target: 'hubspot' | 'ledger' = 'hubspot') {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO events (external_id, kind, payload)
     VALUES ($1, 'order.placed', '{"a":1}'::jsonb) RETURNING id`, [externalId],
  );
  await queue.enqueue(rows[0].id, target);
  return rows[0].id;
}

/** Records every idempotency key it is called with, so we can prove exactly-once. */
function recordingTarget(
  target: 'hubspot' | 'ledger',
  behaviour: (call: number) => void = () => {},
): DeliveryTarget & { keys: string[] } {
  const keys: string[] = [];
  return {
    target,
    keys,
    async deliver(ctx) {
      keys.push(ctx.idempotencyKey);
      behaviour(keys.length);
      return { remoteRef: `ref-${keys.length}`, remoteAt: new Date('2026-07-30T14:06:31Z') };
    },
  };
}

describe('WorkerService', () => {
  it('delivers a due item and marks it done', async () => {
    const eventId = await seed('evt_ok');
    const target = recordingTarget('hubspot');
    const worker = new WorkerService(queue, [target]);

    expect(await worker.tick()).toBe(1);
    expect(target.keys).toEqual([idempotencyKey(eventId, 'hubspot')]);

    const { rows } = await pool.query('SELECT state, remote_ref FROM deliveries');
    expect(rows[0].state).toBe('done');
    expect(rows[0].remote_ref).toBe('ref-1');
  });

  it('reschedules when the target throws', async () => {
    await seed('evt_fail');
    const target: DeliveryTarget = {
      target: 'hubspot',
      async deliver() { throw new Error('ECONNRESET'); },
    };
    const worker = new WorkerService(queue, [target]);

    await worker.tick();
    const { rows } = await pool.query('SELECT state, attempts, last_error FROM deliveries');
    expect(rows[0].state).toBe('pending');
    expect(rows[0].attempts).toBe(1);
    expect(rows[0].last_error).toContain('ECONNRESET');
  });

  it('passes the same idempotency key on every retry', async () => {
    const eventId = await seed('evt_retry');
    const target = recordingTarget('hubspot', (call) => {
      if (call === 1) throw new Error('down');
    });
    const worker = new WorkerService(queue, [target]);

    await worker.tick();
    await pool.query('UPDATE deliveries SET next_at = now()');
    await worker.tick();

    expect(target.keys).toEqual([
      idempotencyKey(eventId, 'hubspot'),
      idempotencyKey(eventId, 'hubspot'),
    ]);
  });

  it('does not deliver twice when the worker dies before recording success', async () => {
    // The delivery succeeded at the target, but the process died before markDone.
    // releaseStuck puts it back; the retry reaches the target with the SAME key,
    // which is what makes the target able to ignore it (spec 6.5).
    const eventId = await seed('evt_crash');
    const target = recordingTarget('hubspot');
    const worker = new WorkerService(queue, [target]);

    const [claimed] = await queue.claimDue(1);
    await target.deliver({
      eventId, idempotencyKey: idempotencyKey(eventId, 'hubspot'), payload: {},
    });
    // no markDone — simulate the crash
    await pool.query(
      `UPDATE deliveries SET locked_at = now() - interval '5 minutes' WHERE id = $1`,
      [claimed.id],
    );
    expect(await queue.releaseStuck(60)).toBe(1);
    await worker.tick();

    expect(new Set(target.keys).size).toBe(1);
    expect(target.keys).toHaveLength(2);
    const { rows } = await pool.query('SELECT state FROM deliveries');
    expect(rows[0].state).toBe('done');
  });

  it('fails loudly when no target is registered', async () => {
    await seed('evt_unknown', 'ledger');
    const worker = new WorkerService(queue, []);
    await worker.tick();
    const { rows } = await pool.query('SELECT state, last_error FROM deliveries');
    expect(rows[0].state).toBe('pending');
    expect(rows[0].last_error).toContain('no target registered');
  });

  it('keeps the receipt url, because the proof chain is built on it', async () => {
    // The strongest payment proof in the demo is a page served by stripe.com. The
    // target read it and the worker dropped it, so the verify button answered 404
    // and the proof chain had no link. Nothing failed; it was simply absent.
    const eventId = await seed('evt_receipt');
    const worker = new WorkerService(queue, [{
      target: 'hubspot',
      async deliver() {
        return {
          remoteRef: 'pi_1',
          remoteAt: new Date('2026-07-30T14:04:02Z'),
          receiptUrl: 'https://pay.stripe.com/receipts/ch_1',
        };
      },
    }], pool);

    await worker.tick();

    const { rows } = await pool.query<{ receipt_url: string | null }>(
      `SELECT payload ->> 'receipt_url' AS receipt_url FROM events WHERE id = $1`,
      [eventId],
    );
    expect(rows[0].receipt_url).toBe('https://pay.stripe.com/receipts/ch_1');
  });

  it('leaves the rest of the event payload alone when it stores the receipt', async () => {
    const eventId = await seed('evt_receipt_merge');
    const worker = new WorkerService(queue, [{
      target: 'hubspot',
      async deliver() {
        return { remoteRef: 'pi_2', remoteAt: null, receiptUrl: 'https://pay.stripe.com/x' };
      },
    }], pool);

    await worker.tick();

    const { rows } = await pool.query<{ payload: Record<string, unknown> }>(
      'SELECT payload FROM events WHERE id = $1', [eventId],
    );
    expect(rows[0].payload).toMatchObject({ a: 1, receipt_url: 'https://pay.stripe.com/x' });
  });

  it('parks an unresolvable delivery at once instead of retrying it blind', async () => {
    // A Slack message into a visitor's workspace whose fate nobody can establish.
    // Five more attempts would each hit the same wall, so the visitor would watch
    // "next attempt in ..." for thirteen minutes on something that cannot recover.
    await seed('evt_unresolvable');
    const target: DeliveryTarget = {
      target: 'hubspot',
      async deliver() {
        throw new UnresolvableDelivery('the outcome could not be confirmed');
      },
    };
    const worker = new WorkerService(queue, [target]);

    await worker.tick();
    const { rows } = await pool.query('SELECT state, attempts, last_error FROM deliveries');
    expect(rows[0].state).toBe('dead');
    expect(rows[0].attempts).toBe(1);
    expect(rows[0].last_error).toContain('could not be confirmed');
  });

  it('leaves an unresolvable delivery retryable by hand', async () => {
    // Spec 6.6: a dead letter is not lost, it is parked with a button next to it.
    await seed('evt_unresolvable_retry');
    const worker = new WorkerService(queue, [{
      target: 'hubspot',
      async deliver() { throw new UnresolvableDelivery('unconfirmed'); },
    }]);
    await worker.tick();

    const { rows } = await pool.query<{ id: string }>('SELECT id FROM deliveries');
    expect(await queue.retryDead(Number(rows[0].id))).toBe(true);
  });

  it('sends a delivery to the dead letter box after six failures', async () => {
    await seed('evt_dead');
    const target: DeliveryTarget = {
      target: 'hubspot',
      async deliver() { throw new Error('still down'); },
    };
    const worker = new WorkerService(queue, [target]);

    for (let i = 0; i < 6; i++) {
      await pool.query('UPDATE deliveries SET next_at = now()');
      await worker.tick();
    }
    const { rows } = await pool.query('SELECT state, attempts FROM deliveries');
    expect(rows[0].state).toBe('dead');
    expect(rows[0].attempts).toBe(6);
  });
});
