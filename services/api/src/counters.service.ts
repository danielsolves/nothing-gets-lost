// services/api/src/counters.service.ts
// The header counters (spec 3).
//
// lost is not computed — it is the constant 0, and that is the entire product.
// A delivery in the dead letter box is NOT lost: it is visibly stuck, with its last
// error readable and a retry button next to it. Conflating the two would give away
// the one distinction the demo exists to make.
import type { Pool } from 'pg';
import type { Counters } from '@ngl/contracts';

export class CountersService {
  constructor(private readonly pool: Pool) {}

  async read(): Promise<Counters> {
    const { rows } = await this.pool.query<{
      received: string; delivered: string; waiting: string;
      needs_human: string; duplicates: string;
    }>(
      `SELECT
         (SELECT count(*) FROM events) AS received,
         (SELECT count(*) FROM deliveries WHERE state = 'done') AS delivered,
         (SELECT count(*) FROM deliveries WHERE state IN ('pending','inflight')) AS waiting,
         (SELECT count(*) FROM deliveries WHERE state = 'dead') AS needs_human,
         (SELECT count(*) FROM dropped_duplicates) AS duplicates`,
    );
    const row = rows[0];
    if (!row) throw new Error('the counter query returned no row');
    return {
      received: Number(row.received),
      delivered: Number(row.delivered),
      waiting: Number(row.waiting),
      duplicatesDropped: Number(row.duplicates),
      needsHuman: Number(row.needs_human),
      lost: 0,
    };
  }
}
