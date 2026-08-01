// packages/contracts/src/stream.ts
// The SSE payload shape. Both ends of it are in one hand now, so it can be changed,
// but only in a single step that moves the page and the api service together: the
// stream negotiates no version, and a browser holding an old page reconnects to a
// new server without either of them noticing.
import type { Target, DeliveryState, SwitchState, SwitchableTarget } from './targets';

export interface Counters {
  received: number;
  delivered: number;
  waiting: number;
  duplicatesDropped: number;
  needsHuman: number;
  /** Always 0. It is the product. */
  lost: number;
}

export interface DeliveryView {
  id: number;
  eventId: string;
  target: Target;
  state: DeliveryState;
  attempts: number;
  nextAt: string | null;
  lastError: string | null;
  remoteRef: string | null;
  remoteAt: string | null;
  /**
   * When the call went out, and when we had the answer back. Both are our own
   * clock, and the gap between them is the round trip as this machine measured it.
   *
   * Deliberately not the same thing as remoteAt. That is the timestamp the far end
   * put on the record, which is what makes it evidence and also what makes it
   * useless for timing: it is their clock, and it says when they wrote the record,
   * not when we heard about it. These two are ours, and they are only ever used to
   * say how long the hop took.
   */
  sentAt: string | null;
  answeredAt: string | null;
}

/**
 * One line of a basket, already priced.
 *
 * The name and the money are here rather than being looked up in the browser because
 * the page does not hold the catalogue: the order form fetches it, and only once
 * somebody opens the form. A card that read "2 x MUG-BLUE" until a visitor happened
 * to open an unrelated panel would be a worse card than one that never tried.
 */
export interface OrderLine {
  sku: string;
  name: string;
  qty: number;
  /** The whole line, so a reader never has to multiply to check the total. */
  cents: number;
}

/**
 * What was actually ordered, and where it came in from.
 *
 * The three travel together because they are absent together: they all come from the
 * orders row, and an event can reach the queue without one. A Stripe payment webhook
 * does exactly that today.
 */
export interface OrderBooking {
  source: 'form' | 'email';
  lines: OrderLine[];
  /** The figure Stripe was charged, read back rather than re-added. */
  totalCents: number;
}

/**
 * One order, once. It is a list of its own rather than four more fields on every
 * delivery row: an order has five deliveries, and repeating its number, its arrival
 * time and its whole basket five times would make the payload argue with itself the
 * moment one copy was written differently from the next.
 */
export interface OrderView {
  eventId: string;
  /** From a sequence on events. Stable for life, the same on every screen, and it
   *  is what `SELECT * FROM v_events WHERE number = ...` takes. */
  number: number;
  /** When the order arrived, not when any delivery was created or attempted. */
  receivedAt: string;
  booking: OrderBooking | null;
}

export interface TimelineEntry {
  at: string;
  eventId: string;
  text: string;
  level: 'info' | 'warn' | 'error' | 'success';
}

/**
 * Everything the page draws about the pipeline, as it stands at one moment.
 *
 * One value rather than four, because the four are read together and are only true
 * together: a counter saying one delivery is waiting next to a queue drawing three
 * cards is a page that has stopped being evidence of anything.
 */
export interface BoardSnapshot {
  counters: Counters;
  switches: Record<SwitchableTarget, SwitchState>;
  deliveries: DeliveryView[];
  /** The orders those deliveries belong to, one entry each. */
  orders: OrderView[];
  timeline: TimelineEntry[];
}

/**
 * Two events, and the difference between them is who is being described.
 *
 * `board` is the state of the pipeline and replaces whatever the page is holding.
 * It used to be a stream of single rows the page merged into what it already had,
 * which meant nothing could ever be taken away: reset emptied the tables and the
 * page went on showing orders that no longer existed. A snapshot has no such hole,
 * and it needs no reset event either, which is why there is not one here.
 *
 * `presence` is about the visitors rather than the pipeline, and it arrives when
 * somebody joins or leaves rather than on the tick, so it stays its own event.
 */
export type StreamEvent =
  | { type: 'board'; payload: BoardSnapshot }
  | { type: 'presence'; payload: { viewers: number } };
