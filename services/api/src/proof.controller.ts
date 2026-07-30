// services/api/src/proof.controller.ts
// GET /api/proof/:eventId — the proof chain of spec 9.1, polled by the proof panel.
// It carries no data of its own: two foreign timestamps and the gap between them.
import { BadRequestException, Controller, Get, Inject, Param } from '@nestjs/common';
import type { ProofResponse } from '@ngl/contracts';
import { ProofService } from './proof.service';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Controller('api/proof')
export class ProofController {
  // Token spelled out: esbuild emits no decorator metadata to infer it from.
  constructor(@Inject(ProofService) private readonly proof: ProofService) {}

  @Get(':eventId')
  async read(@Param('eventId') eventId: string): Promise<ProofResponse> {
    if (!UUID.test(eventId)) throw new BadRequestException('that is not an event id');
    return this.proof.build(eventId);
  }
}
