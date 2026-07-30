// services/api/src/stream.controller.ts
// Server-sent events. Chosen over websockets on purpose: the traffic is one-way,
// SSE reconnects by itself, and it survives proxies without extra configuration.
import { Controller, Res, Sse } from '@nestjs/common';
import type { Response } from 'express';
import { Observable, merge } from 'rxjs';
import type { StreamEvent } from '@ngl/contracts';
import { CountersService } from './counters.service';
import { PresenceService } from './presence.service';

const COUNTER_INTERVAL_MS = 1000;

@Controller('api')
export class StreamController {
  constructor(
    private readonly counters: CountersService,
    private readonly presence: PresenceService,
  ) {}

  @Sse('stream')
  stream(@Res({ passthrough: true }) response: Response): Observable<{ data: StreamEvent }> {
    const leave = this.presence.join();
    response.on('close', leave);

    return merge(this.presence$(), this.counters$());
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

  /** Polls the counters once a second — cheap, and it needs no change feed. */
  private counters$(): Observable<{ data: StreamEvent }> {
    return new Observable<{ data: StreamEvent }>((subscriber) => {
      const timer = setInterval(() => {
        void this.counters.read().then((payload) =>
          subscriber.next({ data: { type: 'counters', payload } }));
      }, COUNTER_INTERVAL_MS);
      return () => clearInterval(timer);
    });
  }
}
