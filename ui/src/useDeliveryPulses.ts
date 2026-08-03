// ui/src/useDeliveryPulses.ts
// Holds each dot for as long as it takes to travel, then forgets it.
//
// The deciding is in pulses.ts, which is a pure function and is where the tests are.
// This file is the part that needs a component to exist: remembering the previous
// snapshot, and cleaning up after itself so a page left open overnight is not holding
// ten thousand finished animations.
import { useEffect, useRef, useState } from 'react';
import type { DeliveryView } from '@ngl/contracts';
import { pulsesFrom, type Pulse } from './pulses';

/**
 * Long enough to read as travel, short enough to keep up with a busy queue. Also
 * how long the hub waits before admitting an order has landed, because what it is
 * waiting for is the arrival dot finishing its run.
 */
export const PULSE_MS = 900;

/** A pulse plus the one thing that makes two dots on the same line distinguishable. */
export interface LivePulse extends Pulse {
  key: string;
}

/** One board, the memory of what it looked like last time, and one flag. */
interface Watched {
  previous: DeliveryView[] | undefined;
  // Whether an empty list is a board this page watched empty. It starts false because
  // the list is empty before the first board arrives too, and those two empties mean
  // opposite things: see pulses.ts. Once the page has watched a board of orders become
  // no orders, an empty list is something it has seen, so the order the visitor sends
  // straight after pressing reset is announced instead of arriving in silence.
  watchedEmpty: boolean;
}

function fresh(): Watched {
  return { previous: undefined, watchedEmpty: false };
}

/** Reads one board against its own memory and moves that memory on. */
function look(seen: Watched, board: DeliveryView[]): Pulse[] {
  const before = seen.previous;
  const pulses = pulsesFrom(before, board, { boardWasEmptied: seen.watchedEmpty });
  if (before !== undefined && before.length > 0 && board.length === 0) {
    seen.watchedEmpty = true;
  }
  seen.previous = board;
  return pulses;
}

/**
 * @param arriving the board as it stands, which is what says an order has turned up.
 * @param working the board the page is prepared to talk about: the same one, held
 *   back while an arrival dot is still travelling. See useArrivalHold. Defaults to
 *   `arriving`, which is one board and the behaviour of every test here.
 *
 * Two boards and not one, because the dot coming in and the dots going out answer to
 * different moments. The arrival is the thing being waited for, so it must be read
 * live or there would be nothing to start the wait with. Everything else is a
 * consequence of that order having landed, and reading it live sent calls out of the
 * hub before the order had visibly reached it: deliveries left for the systems while
 * the order was still on the wire from the button.
 *
 * It is the same split that puts the tiles on the held board. "Delivering" on the
 * Stripe tile is a statement about state exactly as the hub's counters are, and one
 * of them waiting while the other ran ahead was one fault showing in two places.
 */
export function useDeliveryPulses(
  arriving: DeliveryView[], working: DeliveryView[] = arriving,
): LivePulse[] {
  const seenArriving = useRef<Watched>(fresh());
  const seenWorking = useRef<Watched>(fresh());
  const counter = useRef(0);
  const [live, setLive] = useState<LivePulse[]>([]);

  useEffect(() => {
    // Both boards are read every time, each against its own memory, even on the many
    // renders where they are the same array. They are two streams that happen to
    // coincide whenever nothing is being held back, and skipping one of them on those
    // renders leaves its memory stuck at whatever it last saw: every later delivery is
    // then measured against a board from minutes ago and quietly draws nothing. There
    // is no double counting, because each look contributes only its own kind.
    const found = [
      ...look(seenArriving.current, arriving).filter((pulse) => pulse.kind === 'arrival'),
      ...look(seenWorking.current, working).filter((pulse) => pulse.kind !== 'arrival'),
    ];
    if (found.length === 0) return undefined;

    // The same delivery can pulse repeatedly as its retries fail, so the key cannot
    // be the delivery id: React would reuse the node and the dot would not restart.
    const keyed = found.map((pulse) => ({ ...pulse, key: `${pulse.id}-${counter.current++}` }));
    setLive((current) => [...current, ...keyed]);

    const timer = setTimeout(() => {
      const spent = new Set(keyed.map((pulse) => pulse.key));
      setLive((current) => current.filter((pulse) => !spent.has(pulse.key)));
    }, PULSE_MS);
    return () => clearTimeout(timer);
  }, [arriving, working]);

  return live;
}
