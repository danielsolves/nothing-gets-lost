// test/integration/harness.ts
// Boots a real Postgres and wires the real mediator to fake third parties. Only the
// remote systems are fake — queue, retries, idempotency and the worker loop are the
// production code paths.
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Pool } from 'pg';
import { runMigrations } from '@ngl/db';
import { QueueRepository } from '../../services/mediator/src/queue.repository';
import { IntakeService } from '../../services/mediator/src/intake.service';
import { CompletionService } from '../../services/mediator/src/completion.service';
import { WorkerService } from '../../services/mediator/src/worker.service';
import type { DeliveryTarget } from '../../services/mediator/src/target.interface';
import type { Target } from '@ngl/contracts';

export interface FakeTarget extends DeliveryTarget {
  received: string[];
  reachable: boolean;
}

export function fakeTarget(target: Target): FakeTarget {
  const state: FakeTarget = {
    target,
    received: [],
    reachable: true,
    async deliver(ctx) {
      if (!state.reachable) throw new Error(`${target} unreachable (ECONNRESET)`);
      // Idempotent by key, exactly like the real adapters.
      if (!state.received.includes(ctx.idempotencyKey)) {
        state.received.push(ctx.idempotencyKey);
      }
      return { remoteRef: `ref-${state.received.length}`, remoteAt: new Date() };
    },
  };
  return state;
}

export async function startHarness() {
  const container: StartedPostgreSqlContainer =
    await new PostgreSqlContainer('postgres:16-alpine').start();
  const pool = new Pool({ connectionString: container.getConnectionUri() });

  /**
   * pg emits errors on behalf of pooled clients that have no listener of their own,
   * and an emitted error with no listener at all ends the run.
   *
   * That is how a green suite turned red on 2026-08-03 without a line of production
   * code changing. `pool.end()` resolves once every client has been released, but the
   * sockets are still closing when `container.stop()` kills Postgres a moment later,
   * and every backend still attached is handed a FATAL 57P01. Vitest reported it as an
   * unhandled error and failed the whole file.
   *
   * Only the shutdown window is exempt, and only for the codes a deliberate shutdown
   * actually produces. Anything else, and anything at all before `stop()` is called,
   * is a real error and is rethrown so it still fails the run.
   */
  let stopping = false;
  const SHUTDOWN_CODES = new Set(['57P01', 'ECONNRESET', 'EPIPE']);
  pool.on('error', (err: Error & { code?: string }) => {
    if (stopping && err.code !== undefined && SHUTDOWN_CODES.has(err.code)) return;
    throw err;
  });

  await runMigrations(pool);

  const queue = new QueueRepository(pool);
  const intake = new IntakeService(pool, queue);
  const completion = new CompletionService(pool);
  const targets = {
    hubspot: fakeTarget('hubspot'),
    stripe: fakeTarget('stripe'),
    ledger: fakeTarget('ledger'),
    slack: fakeTarget('slack'),
    mailer: fakeTarget('mailer'),
  };
  const worker = new WorkerService(queue, Object.values(targets), pool, completion);

  /**
   * Runs the loop until nothing is left, so tests do not sleep.
   *
   * One round works through everything that is already due, and only then pulls
   * the scheduled future forward once. Doing that per tick instead rewrites every
   * pending row on every batch of ten, which is quadratic and is what made the
   * soak run take longer than its timeout.
   */
  async function drain(maxRounds = 50): Promise<void> {
    for (let round = 0; round < maxRounds; round++) {
      let handled = 0;
      for (;;) {
        const done = await worker.tick();
        if (done === 0) break;
        handled += done;
      }
      const { rowCount } = await pool.query(
        `UPDATE deliveries SET next_at = now()
          WHERE state = 'pending' AND next_at > now()`,
      );
      if (handled === 0 && (rowCount ?? 0) === 0) return;
    }
  }

  return {
    pool, queue, intake, completion, worker, targets, drain,
    async stop() {
      stopping = true;
      await pool.end();
      await container.stop();
    },
  };
}
