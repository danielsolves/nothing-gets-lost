// services/api/src/verify.controller.ts
// GET /api/verify/:target/:eventId — the check-it-yourself button (spec 9.2).
// It hands the read-back straight through, indisputable flag and all, so the page
// can label a Stripe receipt as proof and a read-back on our own portal as an
// indication.
import { BadRequestException, Controller, Get, Inject, Param } from '@nestjs/common';
import { isTarget, type VerifyResponse } from '@ngl/contracts';
import { VerifyService } from './verify.service';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Controller('api/verify')
export class VerifyController {
  // Token spelled out: esbuild emits no decorator metadata to infer it from.
  constructor(@Inject(VerifyService) private readonly verifier: VerifyService) {}

  @Get(':target/:eventId')
  async read(
    @Param('target') target: string,
    @Param('eventId') eventId: string,
  ): Promise<VerifyResponse> {
    if (!isTarget(target)) throw new BadRequestException(`unknown target: ${target}`);
    if (!UUID.test(eventId)) throw new BadRequestException('that is not an event id');
    return this.verifier.verify(target, eventId);
  }
}
