// services/api/src/reset.controller.ts
// POST /api/reset — the visible way out. It puts every switch back up and clears
// the events, because a visitor who presses "reset everything" means the counters
// too; the ten-minute auto reset (spec 3) only touches the switches.
import { Controller, Inject, Post } from '@nestjs/common';
import type { Pool } from 'pg';
import { SwitchStore } from './switch.store';
import { POOL } from './tokens';

@Controller('api')
export class ResetController {
  constructor(
    @Inject(POOL) private readonly pool: Pool,
    @Inject(SwitchStore) private readonly switches: SwitchStore,
  ) {}

  @Post('reset')
  async reset(): Promise<{ ok: boolean }> {
    await this.switches.resetAll();
    await this.pool.query('TRUNCATE events CASCADE');
    return { ok: true };
  }
}
