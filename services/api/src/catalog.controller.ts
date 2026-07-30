// services/api/src/catalog.controller.ts
// GET /api/catalog — the eight products. Read from the database rather than from a
// constant so the page, the order pricing and the extractor's SKU check can never
// disagree about what exists (spec 8.3).
import { Controller, Get, Inject } from '@nestjs/common';
import type { Pool } from 'pg';
import type { CatalogItem } from '@ngl/contracts';
import { POOL } from './tokens';

@Controller('api')
export class CatalogController {
  constructor(@Inject(POOL) private readonly pool: Pool) {}

  @Get('catalog')
  async read(): Promise<CatalogItem[]> {
    const { rows } = await this.pool.query<CatalogItem>(
      'SELECT sku, name, cents FROM products ORDER BY name',
    );
    return rows;
  }
}
