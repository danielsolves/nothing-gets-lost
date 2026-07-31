// test/integration/pipeline.test.ts
// The nine integration tests from spec 12. Every one of them describes a failure
// that a normal integration actually has in production.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { startHarness } from './harness';

let harness: Awaited<ReturnType<typeof startHarness>>;

beforeAll(async () => { harness = await startHarness(); }, 180_000);
afterAll(async () => { await harness.stop(); });
beforeEach(async () => {
  await harness.pool.query('TRUNCATE events CASCADE');
  for (const target of Object.values(harness.targets)) {
    target.received.length = 0;
    target.reachable = true;
  }
});

const ORDER = {
  kind: 'order.placed' as const,
  payload: { customerName: 'M. Berger', customerEmail: 'm@example.com', totalCents: 4900 },
  targets: ['hubspot', 'stripe', 'ledger', 'slack'] as const,
};

describe('1. a repeated webhook produces exactly one delivery per target', () => {
  it('drops the duplicate', async () => {
    await harness.intake.accept({ ...ORDER, externalId: 'evt_same' });
    await harness.intake.accept({ ...ORDER, externalId: 'evt_same' });
    await harness.drain();

    expect(harness.targets.hubspot.received).toHaveLength(1);
    expect(harness.targets.ledger.received).toHaveLength(1);
  });
});

describe('2. a cut target holds the work, nothing is lost', () => {
  it('keeps the delivery waiting', async () => {
    harness.targets.hubspot.reachable = false;
    await harness.intake.accept({ ...ORDER, externalId: 'evt_cut' });
    await harness.worker.tick();

    const { rows } = await harness.pool.query(
      `SELECT state FROM deliveries WHERE target = 'hubspot'`,
    );
    expect(rows[0].state).toBe('pending');
    expect(harness.targets.hubspot.received).toHaveLength(0);
  });
});

describe('3. a returning target catches up, each item exactly once', () => {
  it('delivers everything once after recovery', async () => {
    harness.targets.hubspot.reachable = false;
    for (const id of ['a', 'b', 'c']) {
      await harness.intake.accept({ ...ORDER, externalId: `evt_${id}` });
    }
    await harness.drain(3);
    expect(harness.targets.hubspot.received).toHaveLength(0);

    harness.targets.hubspot.reachable = true;
    await harness.drain();

    expect(harness.targets.hubspot.received).toHaveLength(3);
    expect(new Set(harness.targets.hubspot.received).size).toBe(3);
  });
});

describe('4. six failures land in the dead letter box, not in the void', () => {
  it('marks it dead and keeps it visible', async () => {
    harness.targets.slack.reachable = false;
    await harness.intake.accept({ ...ORDER, externalId: 'evt_dead' });
    await harness.drain();

    const { rows } = await harness.pool.query(
      `SELECT state, attempts, last_error FROM deliveries WHERE target = 'slack'`,
    );
    expect(rows[0].state).toBe('dead');
    expect(rows[0].attempts).toBe(6);
    expect(rows[0].last_error).toContain('unreachable');
  });
});

describe('5. a worker dying between call and record does not deliver twice', () => {
  it('reaches the target twice but the target sees one key', async () => {
    const result = await harness.intake.accept({
      ...ORDER, externalId: 'evt_crash', targets: ['hubspot'],
    });
    const [claimed] = await harness.queue.claimDue(1);
    await harness.targets.hubspot.deliver({
      eventId: result.eventId,
      idempotencyKey: `${result.eventId}:hubspot`,
      payload: ORDER.payload,
    });
    // crash: no markDone
    await harness.pool.query(
      `UPDATE deliveries SET locked_at = now() - interval '5 minutes' WHERE id = $1`,
      [claimed.id],
    );
    await harness.drain();

    expect(harness.targets.hubspot.received).toHaveLength(1);
    const { rows } = await harness.pool.query('SELECT state FROM deliveries');
    expect(rows[0].state).toBe('done');
  });
});

describe('6. two workers never take the same row', () => {
  it('splits the work without overlap', async () => {
    for (let i = 0; i < 8; i++) {
      await harness.intake.accept({ ...ORDER, externalId: `evt_par_${i}` });
    }
    const [a, b] = await Promise.all([
      harness.queue.claimDue(20), harness.queue.claimDue(20),
    ]);
    const ids = [...a, ...b].map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(32);
  });
});

describe('7. the confirmation mail waits for the whole chain', () => {
  it('is not queued while a target is cut, and is queued after recovery', async () => {
    harness.targets.ledger.reachable = false;
    const result = await harness.intake.accept({ ...ORDER, externalId: 'evt_mail' });
    await harness.drain(3);

    let mail = await harness.pool.query(
      `SELECT count(*) FROM deliveries WHERE event_id = $1 AND target = 'mailer'`,
      [result.eventId],
    );
    expect(Number(mail.rows[0].count)).toBe(0);

    harness.targets.ledger.reachable = true;
    await harness.drain();

    mail = await harness.pool.query(
      `SELECT state FROM deliveries WHERE event_id = $1 AND target = 'mailer'`,
      [result.eventId],
    );
    expect(mail.rows[0].state).toBe('done');
  });
});

describe('8. a dead letter can be revived', () => {
  it('runs again with a clean slate', async () => {
    harness.targets.slack.reachable = false;
    await harness.intake.accept({ ...ORDER, externalId: 'evt_revive' });
    await harness.drain();

    const { rows } = await harness.pool.query(
      `SELECT id FROM deliveries WHERE target = 'slack' AND state = 'dead'`,
    );
    harness.targets.slack.reachable = true;
    expect(await harness.queue.retryDead(Number(rows[0].id))).toBe(true);
    await harness.drain();

    const after = await harness.pool.query(
      `SELECT state FROM deliveries WHERE target = 'slack'`,
    );
    expect(after.rows[0].state).toBe('done');
    expect(harness.targets.slack.received).toHaveLength(1);
  });
});

describe('9. lost stays zero through arbitrary chaos', () => {
  it('accounts for every event in one of the visible states', async () => {
    for (let i = 0; i < 20; i++) {
      harness.targets.hubspot.reachable = i % 3 !== 0;
      harness.targets.slack.reachable = i % 4 !== 0;
      await harness.intake.accept({ ...ORDER, externalId: `evt_chaos_${i}` });
      await harness.worker.tick();
    }
    harness.targets.hubspot.reachable = true;
    harness.targets.slack.reachable = true;
    await harness.drain(200);

    const { rows } = await harness.pool.query<{ state: string; n: string }>(
      'SELECT state, count(*) AS n FROM deliveries GROUP BY state',
    );
    const byState = Object.fromEntries(rows.map((r) => [r.state, Number(r.n)]));
    const total = Object.values(byState).reduce((sum, n) => sum + n, 0);

    // Every delivery is accounted for. Nothing vanished.
    expect(byState.done ?? 0).toBe(total - (byState.dead ?? 0));
    expect(byState.pending ?? 0).toBe(0);
    expect(byState.inflight ?? 0).toBe(0);
    // Twenty events over eighty deliveries against a real database. The default five
    // seconds is close enough to that work that a loaded machine trips it, and a CI
    // runner is a loaded machine. This one is a small soak, not a single scenario.
  }, 30_000);
});
