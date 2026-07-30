// services/api/src/sql.controller.ts
// POST /api/sql — the public read-only console (spec 9.6). Every rejection comes
// back as 400 with the reason in plain words, because a stranger typing SQL into a
// web page deserves to be told what was wrong rather than to see a blank panel.
import {
  BadRequestException, Body, Controller, HttpException, HttpStatus, Inject, Post, Req,
} from '@nestjs/common';
import type { Request } from 'express';
import type { SqlRequest, SqlResponse } from '@ngl/contracts';
import { SqlService } from './sql.service';
import { LIMITS, RateLimiter, hashIp } from './rate-limit.guard';
import { RATE_LIMITER } from './orders.controller';

@Controller('api')
export class SqlController {
  // Token spelled out: esbuild emits no decorator metadata to infer it from.
  constructor(
    @Inject(SqlService) private readonly sql: SqlService,
    @Inject(RATE_LIMITER) private readonly limiter: RateLimiter,
  ) {}

  @Post('sql')
  async run(@Body() body: SqlRequest, @Req() request: Request): Promise<SqlResponse> {
    if (typeof body?.query !== 'string' || body.query.trim() === '') {
      throw new BadRequestException('A query is required.');
    }

    const within = await this.limiter.check(
      'sql', hashIp(request.ip ?? 'unknown'), LIMITS.sql,
    );
    if (!within) {
      throw new HttpException(
        `That is ${LIMITS.sql} queries this hour from your address. Try again next hour.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    try {
      return await this.sql.run(body.query);
    } catch (error) {
      throw new BadRequestException((error as Error).message);
    }
  }
}
