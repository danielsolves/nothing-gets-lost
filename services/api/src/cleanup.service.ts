// services/api/src/cleanup.service.ts
// Nightly tidy-up (spec 14). Visitor email addresses and OAuth tokens live 24 hours.
//
// The order row survives with its address replaced — the delivery history stays
// readable for anyone still looking at the proof log, without keeping a list of who
// visited.
import type { Pool } from 'pg';

export class CleanupService {
  constructor(private readonly pool: Pool) {}

  /** Returns how many rows were touched. */
  async run(): Promise<number> {
    const orders = await this.pool.query(
      `UPDATE orders SET customer_email = '[deleted]'
        WHERE created_at < now() - interval '24 hours'
          AND customer_email <> '[deleted]'`,
    );
    const tokens = await this.pool.query(
      'DELETE FROM oauth_tokens WHERE expires_at <= now()',
    );
    return (orders.rowCount ?? 0) + (tokens.rowCount ?? 0);
  }
}
