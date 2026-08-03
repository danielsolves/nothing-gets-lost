// services/api/src/board.service.ts
// One read of the whole board, in one place, because two callers must agree about
// what the board is: /api/state hands the page its first picture and the stream
// hands it every picture after that. While the two had windows of their own, the
// queue shrank from sixty rows to forty a second after the page loaded, which on
// this page reads exactly like twenty deliveries disappearing.
import type { BoardSnapshot } from '@ngl/contracts';
import { CountersService } from './counters.service';
import { DeliveriesService } from './deliveries.service';
import { OrderViewsService } from './order-views.service';
import { SwitchStore } from './switch.store';

/** Enough rows to scroll back through a busy minute, few enough to stay a panel. */
export const BOARD_DELIVERIES = 60;
export const BOARD_TIMELINE = 40;

export class BoardService {
  constructor(
    private readonly counters: CountersService,
    private readonly deliveries: DeliveriesService,
    private readonly orders: OrderViewsService,
    private readonly switches: SwitchStore,
  ) {}

  async read(): Promise<BoardSnapshot> {
    const [counters, switches, deliveries, timeline] = await Promise.all([
      this.counters.read(),
      this.switches.all(),
      this.deliveries.recent(BOARD_DELIVERIES),
      this.deliveries.timeline(BOARD_TIMELINE),
    ]);
    // Second, not alongside: the window is whatever the delivery read returned, and
    // asking for orders before knowing that would either fetch the wrong set or
    // fetch the whole table to throw most of it away.
    const orders = await this.orders.forEvents(
      [...new Set(deliveries.map((delivery) => delivery.eventId))],
    );
    return { counters, switches, deliveries, orders, timeline };
  }
}
