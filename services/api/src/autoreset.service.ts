// services/api/src/autoreset.service.ts
// Ten quiet minutes and the world repairs itself (spec 3).
//
// Ten, not two: a visitor who flips a switch and then reads the log for three
// minutes must not look up and find their outage silently undone. Long enough that
// nothing moves under their hands, short enough that the next visitor never lands
// on a dead demo.
import type { Pool } from 'pg';

const QUIET_MINUTES = 10;

export class AutoResetService {
  constructor(private readonly pool: Pool) {}

  /** Returns true when a reset actually happened. */
  async tick(now: Date): Promise<boolean> {
    // Quiet is measured over the switches that are still disturbed. Counting the
    // ones already up would restart the clock every time the demo repairs itself,
    // and an outage nobody is watching would then never be undone.
    const { rows } = await this.pool.query<{ last: Date | null; disturbed: string }>(
      `SELECT max(changed_at) FILTER (WHERE state <> 'up') AS last,
              count(*) FILTER (WHERE state <> 'up') AS disturbed
         FROM switches`,
    );
    const row = rows[0];
    if (!row) return false;
    if (Number(row.disturbed) === 0) return false;
    const last = row.last;
    if (!last) return false;

    const quietMs = now.getTime() - new Date(last).getTime();
    if (quietMs < QUIET_MINUTES * 60_000) return false;

    await this.pool.query(`UPDATE switches SET state = 'up', changed_at = now()`);
    return true;
  }
}
