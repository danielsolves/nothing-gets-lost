// services/mediator/src/worker.service.ts
// Claims due deliveries, hands them to the matching target, records the outcome.
// Also releases deliveries whose worker died mid-flight.
//
// One failed delivery must never stop the others, so every item is handled
// independently and errors are turned into reschedules rather than thrown.
//
// Independently also means at the same time. The systems an order goes to know
// nothing about each other: HubSpot does not need to hear that Slack has the
// message. A batch used to be worked through one item at a time, which made an order
// cost the sum of four round trips rather than the slowest of them, and it made the
// execution disagree with everything around it. The queue claims with FOR UPDATE
// SKIP LOCKED precisely so that several workers can share the rows, and the picture
// on the page is a hub with five spokes, not a chain.
//
// The one real ordering in this system is the confirmation mail, and it is not
// expressed here: CompletionService only queues it once every other delivery for the
// event is done (spec 6.7).
import type { Pool } from 'pg';
import type { ClaimedDelivery, QueueRepository } from './queue.repository';
import type { CompletionService } from './completion.service';
import { idempotencyKey, isTerminal, type DeliveryTarget } from './target.interface';

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
    private readonly completion?: CompletionService,
  ) {
    for (const target of targets) this.byTarget.set(target.target, target);
  }

  /** Returns how many deliveries were handled. Used directly in tests. */
  async tick(): Promise<number> {
    await this.queue.releaseStuck(STUCK_AFTER_SECONDS);
    const claimed = await this.queue.claimDue(BATCH_SIZE);
    // Promise.all and not a loop: see the head of this file. The batch is capped at
    // BATCH_SIZE, so this fans out to at most ten calls, and each of them holds a
    // pooled connection only for the length of a single statement. The waiting is
    // done in target.deliver, which holds none.
    await Promise.all(claimed.map((delivery) => this.handle(delivery)));
    return claimed.length;
  }

  /**
   * One delivery, start to finish. Never throws: the whole point of handling them
   * independently is that a target being down is a fact about that target.
   */
  private async handle(delivery: ClaimedDelivery): Promise<void> {
    const target = this.byTarget.get(delivery.target);
    if (!target) {
      await this.queue.markFailed(
        delivery.id, `no target registered for "${delivery.target}"`,
      );
      return;
    }
    try {
      const payload = await this.loadPayload(delivery.eventId);
      // Here rather than at the claim, and after the payload is loaded: what the
      // page times is the hop to the system, not this worker's own queueing.
      await this.queue.markSending(delivery.id);
      const outcome = await target.deliver({
        eventId: delivery.eventId,
        idempotencyKey: idempotencyKey(delivery.eventId, delivery.target),
        payload,
      });
      await this.queue.markDone(delivery.id, outcome.remoteRef, outcome.remoteAt);
      if (outcome.receiptUrl) {
        await this.keepReceipt(delivery.eventId, outcome.receiptUrl);
      }
      // Asked after this row is already done, by every sibling that finishes. Under
      // a fan-out several of them ask at once, and that is safe both ways: whichever
      // commits last sees the whole set settled, and a second insert from a sibling
      // that saw the same thing is swallowed by ON CONFLICT DO NOTHING.
      if (delivery.target !== 'mailer') {
        await this.completion?.enqueueMailIfComplete(delivery.eventId);
      }
    } catch (error) {
      // Some failures heal on the next attempt and some never will. Spending six
      // attempts to reach a conclusion we already have would only make the page
      // promise a recovery that cannot come.
      if (isTerminal(error)) {
        await this.queue.markDead(delivery.id, (error as Error).message);
      } else {
        await this.queue.markFailed(delivery.id, (error as Error).message);
      }
    }
  }

  /**
   * Merged into the event rather than replacing it, and read from the event by both
   * the verify button and the proof chain. The deliveries table has no column for a
   * third-party page, and adding one for a single target would be worse than this.
   */
  private async keepReceipt(eventId: string, receiptUrl: string): Promise<void> {
    if (!this.pool) return;
    await this.pool.query(
      `UPDATE events SET payload = payload || jsonb_build_object('receipt_url', $2::text)
        WHERE id = $1`,
      [eventId, receiptUrl],
    );
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
