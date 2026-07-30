// services/api/src/proof.controller.ts
// GET /api/proof/:eventId — the proof chain of spec 9.1, polled by the proof panel —
// and /download, the same event as the take-away proof log of spec 9.5.
// Neither carries data of its own: only timestamps foreign systems assigned.
import { BadRequestException, Controller, Get, Inject, Param, Res } from '@nestjs/common';
import type { Response } from 'express';
import type { ProofResponse } from '@ngl/contracts';
import { ProofLogService, type ProofLog } from './proof-log.service';
import { ProofService } from './proof.service';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Controller('api/proof')
export class ProofController {
  // Tokens spelled out: esbuild emits no decorator metadata to infer them from.
  constructor(
    @Inject(ProofService) private readonly proof: ProofService,
    @Inject(ProofLogService) private readonly log: ProofLogService,
  ) {}

  @Get(':eventId')
  async read(@Param('eventId') eventId: string): Promise<ProofResponse> {
    if (!UUID.test(eventId)) throw new BadRequestException('that is not an event id');
    return this.proof.build(eventId);
  }

  /** Handed to somebody else's developer, so it arrives as a file, not as a page. */
  @Get(':eventId/download')
  async download(
    @Param('eventId') eventId: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<ProofLog> {
    if (!UUID.test(eventId)) throw new BadRequestException('that is not an event id');
    response.setHeader('content-type', 'application/json; charset=utf-8');
    response.setHeader(
      'content-disposition', `attachment; filename="proof-log-${eventId}.json"`,
    );
    return this.log.build(eventId);
  }
}
