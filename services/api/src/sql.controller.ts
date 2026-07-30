// services/api/src/sql.controller.ts
// POST /api/sql — the public read-only console (spec 9.6). Every rejection comes
// back as 400 with the reason in plain words, because a stranger typing SQL into a
// web page deserves to be told what was wrong rather than to see a blank panel.
import { BadRequestException, Body, Controller, Inject, Post } from '@nestjs/common';
import type { SqlRequest, SqlResponse } from '@ngl/contracts';
import { SqlService } from './sql.service';

@Controller('api')
export class SqlController {
  // Token spelled out: esbuild emits no decorator metadata to infer it from.
  constructor(@Inject(SqlService) private readonly sql: SqlService) {}

  @Post('sql')
  async run(@Body() body: SqlRequest): Promise<SqlResponse> {
    if (typeof body?.query !== 'string' || body.query.trim() === '') {
      throw new BadRequestException('A query is required.');
    }
    try {
      return await this.sql.run(body.query);
    } catch (error) {
      throw new BadRequestException((error as Error).message);
    }
  }
}
