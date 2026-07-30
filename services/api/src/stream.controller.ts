// services/api/src/stream.controller.ts
// Server-sent events. Chosen over websockets on purpose: the traffic is one-way,
// SSE reconnects by itself, and it survives proxies without extra configuration.
import { Controller, Inject, Res, Sse } from '@nestjs/common';
import type { Response } from 'express';
import { Observable, merge } from 'rxjs';
import type { StreamEvent } from '@ngl/contracts';
import { CountersService } from './counters.service';
import { PresenceService } from './presence.service';
import { DeliveriesService } from './deliveries.service';
import { SwitchStore } from './switch.store';

const COUNTER_INTERVAL_MS = 1000;
const TIMELINE_LIMIT = 25;
const DELIVERY_LIMIT = 40;

@Controller('api')
export class StreamController {
  // Tokens spelled out: esbuild emits no decorator metadata to infer them from.
  constructor(
    @Inject(CountersService) private readonly counters: CountersService,
    @Inject(PresenceService) private readonly presence: PresenceService,
    @Inject(DeliveriesService) private readonly deliveries: DeliveriesService,
    @Inject(SwitchStore) private readonly switches: SwitchStore,
  ) {}

  @Sse('stream')
  stream(@Res({ passthrough: true }) response: Response): Observable<{ data: StreamEvent }> {
    const leave = this.presence.join();
    response.on('close', leave);

    return merge(this.presence$(), this.board$());
  }

  /** Emits the current viewer count immediately and on every join or leave. */
  private presence$(): Observable<{ data: StreamEvent }> {
    return new Observable<{ data: StreamEvent }>((subscriber) => {
      const send = (viewers: number) =>
        subscriber.next({ data: { type: 'presence', payload: { viewers } } });
      send(this.presence.count());
      return this.presence.onChange(send);
    });
  }

  /**
   * Polls once a second and pushes the whole board: counters, switch states,
   * deliveries and the log. Cheap, and it needs no change feed.
   *
   * Switches have to be in here. Without them a target cut from the control panel
   * or the walkthrough stays green on every other screen, and the page would be
   * showing a state the system is not in.
   */
  private board$(): Observable<{ data: StreamEvent }> {
    return new Observable<{ data: StreamEvent }>((subscriber) => {
      const tick = async (): Promise<void> => {
        const [counters, switches, deliveries, timeline] = await Promise.all([
          this.counters.read(),
          this.switches.all(),
          this.deliveries.recent(DELIVERY_LIMIT),
          this.deliveries.timeline(TIMELINE_LIMIT),
        ]);
        subscriber.next({ data: { type: 'counters', payload: counters } });
        subscriber.next({ data: { type: 'switches', payload: switches } });
        for (const delivery of deliveries) {
          subscriber.next({ data: { type: 'delivery', payload: delivery } });
        }
        for (const entry of timeline) {
          subscriber.next({ data: { type: 'timeline', payload: entry } });
        }
      };
      const timer = setInterval(() => { void tick(); }, COUNTER_INTERVAL_MS);
      void tick();
      return () => clearInterval(timer);
    });
  }
}
