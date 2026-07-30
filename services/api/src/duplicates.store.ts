// services/api/src/duplicates.store.ts
// Records a webhook that was dropped because its external id was already known.
//
// Intake deliberately leaves no trace of a dropped duplicate, so the counter needs
// its own record. Without it the header would show "duplicates dropped: 0" even
// while the deduplication was doing its job on every replay.
import type { Pool } from 'pg';

export class DuplicatesStore {
  constructor(private readonly pool: Pool) {}

  async record(externalId: string): Promise<void> {
    await this.pool.query(
      'INSERT INTO dropped_duplicates (external_id) VALUES ($1)', [externalId],
    );
  }

  async count(): Promise<number> {
    const { rows } = await this.pool.query<{ n: string }>(
      'SELECT count(*) AS n FROM dropped_duplicates',
    );
    return Number(rows[0]?.n ?? 0);
  }
}
