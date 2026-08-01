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

export function useDeliveryPulses(deliveries: DeliveryView[]): LivePulse[] {
  const previous = useRef<DeliveryView[] | undefined>(undefined);
  // Whether an empty list is a board this page watched empty. It starts false because
  // the list is empty before the first board arrives too, and those two empties mean
  // opposite things: see pulses.ts. Once the page has watched a board of orders become
  // no orders, an empty list is something it has seen, so the order the visitor sends
  // straight after pressing reset is announced instead of arriving in silence.
  const watchedEmpty = useRef(false);
  const counter = useRef(0);
  const [live, setLive] = useState<LivePulse[]>([]);

  useEffect(() => {
    const before = previous.current;
    const fresh = pulsesFrom(before, deliveries, { boardWasEmptied: watchedEmpty.current });
    if (before !== undefined && before.length > 0 && deliveries.length === 0) {
      watchedEmpty.current = true;
    }
    previous.current = deliveries;
    if (fresh.length === 0) return;

    // The same delivery can pulse repeatedly as its retries fail, so the key cannot
    // be the delivery id: React would reuse the node and the dot would not restart.
    const keyed = fresh.map((pulse) => ({ ...pulse, key: `${pulse.id}-${counter.current++}` }));
    setLive((current) => [...current, ...keyed]);

    const timer = setTimeout(() => {
      const spent = new Set(keyed.map((pulse) => pulse.key));
      setLive((current) => current.filter((pulse) => !spent.has(pulse.key)));
    }, PULSE_MS);
    return () => clearTimeout(timer);
  }, [deliveries]);

  return live;
}
