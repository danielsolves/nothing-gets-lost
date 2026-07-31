// services/mediator/src/hubspot-catalogue.log.ts
// Which HubSpot product each catalogue sku became, and who is allowed to create one.
//
// The same shape as slack-send.log.ts and for the same reason: HubSpot offers no
// idempotency key, so the claim is written here before the call goes out and
// completed after it returns. The three answers map onto the three things that can
// actually be true of a sku:
//
//   fresh     nobody has mirrored it, and this caller now holds the claim
//   mirrored  it is already a product, here is its id
//   unknown   an earlier attempt called HubSpot and never came back
//
// "unknown" is only reachable when the worker died between the create and its own
// catch block. Anything the worker lives through calls release() and reads "fresh"
// next time, which is what keeps the control panel demo healing.
//
// The one thing this cannot answer on its own is whether an unknown claim created a
// product or died before it. HubSpot's search index settles a few seconds behind a
// create, so age is the tiebreaker, and claimedAt is handed out for the caller to
// weigh. See hubspot.catalogue.ts.
import type { Pool } from 'pg';

export type ClaimResult =
  | { status: 'fresh' }
  | { status: 'mirrored'; productId: string }
  | { status: 'unknown'; claimedAt: Date };

export interface CatalogueLog {
  claim(sku: string): Promise<ClaimResult>;
  record(sku: string, productId: string): Promise<void>;
  release(sku: string): Promise<void>;
}

export class PgCatalogueLog implements CatalogueLog {
  constructor(private readonly pool: Pool) {}

  async claim(sku: string): Promise<ClaimResult> {
    // Claiming and reading in one statement: two workers racing here must not both
    // come away thinking they are the one who gets to create the product.
    const { rows } = await this.pool.query(
      `INSERT INTO hubspot_products (sku)
       VALUES ($1)
       ON CONFLICT (sku) DO NOTHING
       RETURNING sku`,
      [sku],
    );
    if (rows.length === 1) return { status: 'fresh' };

    const existing = await this.pool.query<{ product_id: string | null; claimed_at: Date }>(
      'SELECT product_id, claimed_at FROM hubspot_products WHERE sku = $1',
      [sku],
    );
    const row = existing.rows[0];
    // Gone between the two statements. Start over rather than guess.
    if (!row) return { status: 'fresh' };
    if (row.product_id) return { status: 'mirrored', productId: row.product_id };
    return { status: 'unknown', claimedAt: row.claimed_at };
  }

  async record(sku: string, productId: string): Promise<void> {
    await this.pool.query(
      `UPDATE hubspot_products
          SET product_id = $2, mirrored_at = now()
        WHERE sku = $1`,
      [sku, productId],
    );
  }

  /** Called when HubSpot itself told us no product was created. */
  async release(sku: string): Promise<void> {
    await this.pool.query(
      'DELETE FROM hubspot_products WHERE sku = $1 AND product_id IS NULL',
      [sku],
    );
  }
}
