// services/mediator/src/queue.repository.ts
// The queue itself (spec 6.3). Built by hand on purpose: a library would hide the
// one part visitors are supposed to see — claim, retry, exactly-once, dead letter.
//
// FOR UPDATE SKIP LOCKED is what lets several workers run without handing the same
// row to two of them. Attempts are incremented at claim time, not at failure time,
// so a worker that dies mid-call still counts its attempt.
import type { Pool } from 'pg';
import type { Target } from '@ngl/contracts';
import { nextDelaySeconds } from './backoff';

export interface ClaimedDelivery {
  id: number;
  eventId: string;
  target: Target;
  attempts: number;
}

export class QueueRepository {
  constructor(private readonly pool: Pool) {}

  /** Returns false when the delivery already existed — that is the dedupe. */
  async enqueue(eventId: string, target: Target): Promise<boolean> {
    const { rowCount } = await this.pool.query(
      `INSERT INTO deliveries (event_id, target)
       VALUES ($1, $2)
       ON CONFLICT (event_id, target) DO NOTHING`,
      [eventId, target],
    );
    return rowCount === 1;
  }

  async claimDue(limit: number): Promise<ClaimedDelivery[]> {
    const { rows } = await this.pool.query<{
      id: string; event_id: string; target: Target; attempts: number;
    }>(
      `UPDATE deliveries
          SET state = 'inflight', locked_at = now(),
              attempts = attempts + 1, updated_at = now()
        WHERE id IN (
          SELECT id FROM deliveries
           WHERE state = 'pending' AND next_at <= now()
           ORDER BY next_at
           FOR UPDATE SKIP LOCKED
           LIMIT $1)
      RETURNING id, event_id, target, attempts`,
      [limit],
    );
    return rows.map((r) => ({
      id: Number(r.id), eventId: r.event_id, target: r.target, attempts: r.attempts,
    }));
  }

  async markDone(id: number, remoteRef: string | null, remoteAt: Date | null): Promise<void> {
    await this.pool.query(
      `UPDATE deliveries
          SET state = 'done', locked_at = NULL, last_error = NULL,
              remote_ref = $2, remote_at = $3, updated_at = now()
        WHERE id = $1`,
      [id, remoteRef, remoteAt],
    );
  }

  async markFailed(id: number, error: string): Promise<'retrying' | 'dead'> {
    const { rows } = await this.pool.query<{ attempts: number }>(
      'SELECT attempts FROM deliveries WHERE id = $1', [id],
    );
    const attempts = rows[0]?.attempts ?? 0;
    const delaySeconds = nextDelaySeconds(attempts);

    if (delaySeconds === null) {
      await this.pool.query(
        `UPDATE deliveries
            SET state = 'dead', locked_at = NULL, last_error = $2, updated_at = now()
          WHERE id = $1`,
        [id, error],
      );
      return 'dead';
    }

    await this.pool.query(
      `UPDATE deliveries
          SET state = 'pending', locked_at = NULL, last_error = $2,
              next_at = now() + make_interval(secs => $3), updated_at = now()
        WHERE id = $1`,
      [id, error, delaySeconds],
    );
    return 'retrying';
  }

  /** A worker that dies between the call and markDone leaves a row inflight. */
  async releaseStuck(olderThanSeconds: number): Promise<number> {
    const { rowCount } = await this.pool.query(
      `UPDATE deliveries
          SET state = 'pending', locked_at = NULL, updated_at = now()
        WHERE state = 'inflight'
          AND locked_at < now() - make_interval(secs => $1)`,
      [olderThanSeconds],
    );
    return rowCount ?? 0;
  }

  /**
   * Puts a dead letter back in the queue. attempts is reset so the visitor gets the
   * full retry schedule again — the point of the button is to show recovery, not to
   * squeeze one more attempt out of an exhausted row.
   */
  async retryDead(id: number): Promise<boolean> {
    const { rowCount } = await this.pool.query(
      `UPDATE deliveries
          SET state = 'pending', attempts = 0, last_error = NULL,
              next_at = now(), locked_at = NULL, updated_at = now()
        WHERE id = $1 AND state = 'dead'`,
      [id],
    );
    return rowCount === 1;
  }
}
