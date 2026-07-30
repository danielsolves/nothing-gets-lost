// services/mediator/src/worker.service.ts
// Claims due deliveries, hands them to the matching target, records the outcome.
// Also releases deliveries whose worker died mid-flight.
//
// One failed delivery must never stop the others, so every item is handled
// independently and errors are turned into reschedules rather than thrown.
import type { Pool } from 'pg';
import type { QueueRepository } from './queue.repository';
import { idempotencyKey, type DeliveryTarget } from './target.interface';

const BATCH_SIZE = 10;
const TICK_MS = 500;
const STUCK_AFTER_SECONDS = 60;

export class WorkerService {
  private timer: NodeJS.Timeout | undefined;
  private readonly byTarget = new Map<string, DeliveryTarget>();

  constructor(
    private readonly queue: QueueRepository,
    targets: DeliveryTarget[],
    private readonly pool?: Pool,
  ) {
    for (const target of targets) this.byTarget.set(target.target, target);
  }

  /** Returns how many deliveries were handled. Used directly in tests. */
  async tick(): Promise<number> {
    await this.queue.releaseStuck(STUCK_AFTER_SECONDS);
    const claimed = await this.queue.claimDue(BATCH_SIZE);

    for (const delivery of claimed) {
      const target = this.byTarget.get(delivery.target);
      if (!target) {
        await this.queue.markFailed(
          delivery.id, `no target registered for "${delivery.target}"`,
        );
        continue;
      }
      try {
        const payload = await this.loadPayload(delivery.eventId);
        const outcome = await target.deliver({
          eventId: delivery.eventId,
          idempotencyKey: idempotencyKey(delivery.eventId, delivery.target),
          payload,
        });
        await this.queue.markDone(delivery.id, outcome.remoteRef, outcome.remoteAt);
      } catch (error) {
        await this.queue.markFailed(delivery.id, (error as Error).message);
      }
    }
    return claimed.length;
  }

  private async loadPayload(eventId: string): Promise<unknown> {
    if (!this.pool) return {};
    const { rows } = await this.pool.query<{ payload: unknown }>(
      'SELECT payload FROM events WHERE id = $1', [eventId],
    );
    return rows[0]?.payload ?? {};
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.tick().catch((error) => {
        console.error('[worker] tick failed', error);
      });
    }, TICK_MS);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }
}
