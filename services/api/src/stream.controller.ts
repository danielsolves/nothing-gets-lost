// services/api/src/stream.controller.ts
// Server-sent events. Chosen over websockets on purpose: the traffic is one-way,
// SSE reconnects by itself, and it survives proxies without extra configuration.
import { Controller, Inject, Res, Sse } from '@nestjs/common';
import { Observable, merge } from 'rxjs';
import type { StreamEvent } from '@ngl/contracts';
import { BoardService } from './board.service';
import { PresenceService } from './presence.service';

const BOARD_INTERVAL_MS = 1000;

/**
 * All this controller wants from the response: express fires `close` when the
 * browser goes away, which is when a viewer stops being one. Named as the one
 * method rather than typed as the whole express response, so the stream can be
 * subscribed to in a test without standing up a socket.
 */
export interface StreamConnection {
  on(event: 'close', listener: () => void): void;
}

@Controller('api')
export class StreamController {
  // Tokens spelled out: esbuild emits no decorator metadata to infer them from.
  constructor(
    @Inject(PresenceService) private readonly presence: PresenceService,
    @Inject(BoardService) private readonly board: BoardService,
  ) {}

  @Sse('stream')
  stream(@Res({ passthrough: true }) response: StreamConnection): Observable<{ data: StreamEvent }> {
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
   * Whole, and as one value the page puts in place of what it was holding. Pushing
   * the rows one at a time let the page merge them, and a merge can only ever add:
   * reset truncated the tables and the page went on drawing orders that no longer
   * existed. A snapshot says what is there and, by saying nothing about them, what
   * is not. It repairs every other kind of drift too, the nightly cleanup included,
   * and it is why there is no reset event for reset to send.
   *
   * Switches have to be in here. Without them a target cut from the control panel
   * or the walkthrough stays green on every other screen, and the page would be
   * showing a state the system is not in.
   */
  private board$(): Observable<{ data: StreamEvent }> {
    return new Observable<{ data: StreamEvent }>((subscriber) => {
      const tick = async (): Promise<void> => {
        subscriber.next({ data: { type: 'board', payload: await this.board.read() } });
      };
      const timer = setInterval(() => { void tick(); }, BOARD_INTERVAL_MS);
      void tick();
      return () => clearInterval(timer);
    });
  }
}
