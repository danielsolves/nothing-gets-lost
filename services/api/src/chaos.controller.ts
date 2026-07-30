// services/api/src/chaos.controller.ts
// POST /api/chaos/:kind — the three mischief buttons. Unknown kinds are refused
// rather than guessed, so a typo in the page can never fire something else.
import { Controller, Inject, Param, Post } from '@nestjs/common';
import { CHAOS_KINDS, type ChaosKind } from '@ngl/contracts';
import { ChaosService } from './chaos.service';

function isChaosKind(value: string): value is ChaosKind {
  return (CHAOS_KINDS as readonly string[]).includes(value);
}

@Controller('api/chaos')
export class ChaosController {
  // Token spelled out: esbuild emits no decorator metadata to infer it from.
  constructor(@Inject(ChaosService) private readonly chaos: ChaosService) {}

  @Post(':kind')
  async run(@Param('kind') kind: string): Promise<{ ok: boolean; detail: string }> {
    if (!isChaosKind(kind)) return { ok: false, detail: `unknown mischief: ${kind}` };
    return this.chaos.run(kind);
  }
}
