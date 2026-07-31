// services/api/src/state.controller.ts
// GET /api/state — the whole world in one response. A visitor who arrives in the
// middle of somebody else's experiment gets the current picture before the SSE
// stream takes over, so the page is never briefly empty (spec 3).
//
// The board itself is read by BoardService, which the stream uses too: this endpoint
// and the next tick must describe the same world in the same words.
import { Controller, Get, Inject } from '@nestjs/common';
import type { StateResponse } from '@ngl/contracts';
import { BoardService } from './board.service';
import { PresenceService } from './presence.service';

@Controller('api')
export class StateController {
  // The tokens are spelled out because the services run under esbuild, which
  // emits no decorator metadata for Nest to infer them from.
  constructor(
    @Inject(BoardService) private readonly board: BoardService,
    @Inject(PresenceService) private readonly presence: PresenceService,
  ) {}

  @Get('state')
  async read(): Promise<StateResponse> {
    return {
      ...await this.board.read(),
      viewers: Math.max(this.presence.count(), 1),
      // Derived from the key itself, not from a separate flag: the extractor
      // falls back to recorded answers whenever the key is missing, and a page
      // about honesty must not claim live model calls it is not making.
      extractorMode: process.env.ANTHROPIC_API_KEY ? 'live' : 'recorded',
    };
  }
}
