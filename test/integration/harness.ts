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

  /** Runs the loop until nothing is due, so tests do not sleep. */
  async function drain(maxTicks = 50): Promise<void> {
    for (let i = 0; i < maxTicks; i++) {
      await pool.query(`UPDATE deliveries SET next_at = now() WHERE state = 'pending'`);
      if ((await worker.tick()) === 0) return;
    }
  }

  return {
    pool, queue, intake, completion, worker, targets, drain,
    async stop() { await pool.end(); await container.stop(); },
  };
}
