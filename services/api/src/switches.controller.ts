// services/api/src/switches.controller.ts
// Sets a switch. The ledger is special: besides recording the state we tell the
// service itself to close its listening socket, so at least one target is off in
// the literal sense rather than cut at the gate (spec 7).
import { Body, Controller, Inject, Param, Post } from '@nestjs/common';
import { isSwitchableTarget, type SwitchState } from '@ngl/contracts';
import { SwitchStore } from './switch.store';

const LEDGER_INTERNAL = process.env.LEDGER_INTERNAL_URL ?? 'http://ledger:3004';

@Controller('api/switches')
export class SwitchesController {
  // Token spelled out: esbuild emits no decorator metadata to infer it from.
  constructor(@Inject(SwitchStore) private readonly switches: SwitchStore) {}

  @Post(':target')
  async set(
    @Param('target') target: string,
    @Body() body: { state: SwitchState },
  ): Promise<{ ok: boolean }> {
    if (!isSwitchableTarget(target)) return { ok: false };
    await this.switches.set(target, body.state);

    if (target === 'ledger') {
      const path = body.state === 'cut' ? 'close' : 'listen';
      await fetch(`${LEDGER_INTERNAL}/internal/${path}`, { method: 'POST' })
        .catch(() => undefined); // closing its own socket kills the response
    }
    return { ok: true };
  }
}
