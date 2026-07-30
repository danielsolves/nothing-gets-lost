// services/api/src/webhook-target.store.ts
// Holds the one url a visitor asked us to deliver to. Stored rather than kept in
// memory: the mediator reads it from another process, and a restart must not turn
// the target off while its deliveries are still queued (spec 10.2).
import type { Pool } from 'pg';

export class WebhookTargetStore {
  constructor(private readonly pool: Pool) {}

  async get(): Promise<string | null> {
    const { rows } = await this.pool.query<{ url: string }>(
      'SELECT url FROM custom_webhook WHERE id',
    );
    return rows[0]?.url ?? null;
  }

  /** Upsert, so a second visitor replaces the url instead of adding to it. */
  async set(url: string): Promise<void> {
    await this.pool.query(
      `INSERT INTO custom_webhook (id, url) VALUES (true, $1)
       ON CONFLICT (id) DO UPDATE SET url = EXCLUDED.url, updated_at = now()`,
      [url],
    );
  }

  async clear(): Promise<void> {
    await this.pool.query('DELETE FROM custom_webhook');
  }
}
