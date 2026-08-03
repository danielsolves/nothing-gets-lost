// services/extractor/src/catalog.check.ts
// The second check (spec 8.3). The schema proves the answer LOOKS like an order;
// this proves the articles actually exist. A model can invent a plausible article
// number, but not one that is in the table.
import type { Pool } from 'pg';

export interface CatalogEntry { sku: string; name: string; cents: number }

export async function loadCatalog(pool: Pool): Promise<CatalogEntry[]> {
  const { rows } = await pool.query<CatalogEntry>(
    'SELECT sku, name, cents FROM products ORDER BY sku',
  );
  return rows;
}

export function findUnknownSkus(
  items: Array<{ sku: string }>, catalog: CatalogEntry[],
): string[] {
  const known = new Set(catalog.map((entry) => entry.sku));
  return items.map((item) => item.sku).filter((sku) => !known.has(sku));
}
