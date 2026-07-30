// services/api/src/state.controller.ts
// GET /api/state — the whole world in one response. A visitor who arrives in the
// middle of somebody else's experiment gets the current picture before the SSE
// stream takes over, so the page is never briefly empty (spec 3).
import { Controller, Get, Inject } from '@nestjs/common';
import type { StateResponse } from '@ngl/contracts';
import { CountersService } from './counters.service';
import { DeliveriesService } from './deliveries.service';
import { PresenceService } from './presence.service';
import { SwitchStore } from './switch.store';

const RECENT_DELIVERIES = 60;
const RECENT_TIMELINE = 40;

@Controller('api')
export class StateController {
  // The tokens are spelled out because the services run under esbuild, which
  // emits no decorator metadata for Nest to infer them from.
  constructor(
    @Inject(CountersService) private readonly counters: CountersService,
    @Inject(DeliveriesService) private readonly deliveries: DeliveriesService,
    @Inject(PresenceService) private readonly presence: PresenceService,
    @Inject(SwitchStore) private readonly switches: SwitchStore,
  ) {}

  @Get('state')
  async read(): Promise<StateResponse> {
    const [counters, switches, deliveries, timeline] = await Promise.all([
      this.counters.read(),
      this.switches.all(),
      this.deliveries.recent(RECENT_DELIVERIES),
      this.deliveries.timeline(RECENT_TIMELINE),
    ]);
    return {
      counters,
      switches,
      deliveries,
      timeline,
      viewers: Math.max(this.presence.count(), 1),
      // Derived from the key itself, not from a separate flag: the extractor
      // falls back to recorded answers whenever the key is missing, and a page
      // about honesty must not claim live model calls it is not making.
      extractorMode: process.env.ANTHROPIC_API_KEY ? 'live' : 'recorded',
    };
  }
}
