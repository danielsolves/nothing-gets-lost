// services/extractor/src/extract.controller.ts
// The extractor's only door: POST /internal/extract. It is internal because a
// rejected extraction carries the raw model answer verbatim, which belongs on
// the operator's screen (spec 8.4) and nowhere else.
import { BadRequestException, Body, Controller, Inject, Post } from '@nestjs/common';
import type { ExtractService, ExtractResult } from './extract.service';

export const EXTRACT_SERVICE = Symbol('EXTRACT_SERVICE');

interface ExtractRequest {
  text: string;
  hallucinate?: boolean;
}

function isExtractRequest(value: unknown): value is ExtractRequest {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.text !== 'string') return false;
  return candidate.hallucinate === undefined
    || typeof candidate.hallucinate === 'boolean';
}

@Controller('internal')
export class ExtractController {
  constructor(@Inject(EXTRACT_SERVICE) private readonly extractor: ExtractService) {}

  @Post('extract')
  async extract(@Body() body: unknown): Promise<ExtractResult> {
    if (!isExtractRequest(body)) {
      throw new BadRequestException('expected { text: string, hallucinate?: boolean }');
    }
    // A model that answers badly comes back as a rejected extraction with status
    // 200, never as a 500 — only our own failures are server errors.
    return this.extractor.extract(body.text, { hallucinate: body.hallucinate });
  }
}
