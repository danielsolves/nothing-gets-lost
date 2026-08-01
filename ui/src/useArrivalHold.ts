// ui/src/useArrivalHold.ts
// Keeps the hub a beat behind the wire, but only for the beat an order spends
// travelling to it.
//
// Sending an order draws a dot from the shop into the hub. The board that carries
// that order also carries its deliveries, so the counters rose the moment it landed,
// which was roughly a second before the dot arrived. A visitor watched the hub
// answer for an order that was still visibly on its way, and the travel stopped
// being the thing happening and became decoration laid over it.
//
// So the hub reads a board that is held until the dot has landed. Nothing else on
// the page is: the diagram, the tiles and the dot itself all read the live list, and
// they must, because the dot is the thing being waited for.
//
// The rule for what counts as an arrival is the one pulses.ts uses, an event id that
// was not in the previous list, and it is written out again here rather than shared.
// Wiring the two together would make the hub hold its breath because a dot is on
// screen rather than because an order arrived, and then switching the animation off
// would quietly stop the numbers being right.
import { useEffect, useRef, useState } from 'react';
import type { Counters, DeliveryView, OrderView } from '@ngl/contracts';
import { ARRIVAL_MS } from './useDeliveryPulses';

/**
 * Everything the hub draws, held or released as one. Three values rather than the
 * delivery list alone, because they are only true together: counters released a beat
 * ahead of the rows they count would have the hub contradicting its own queue for
 * the length of the animation, which is a worse fault than the one being fixed.
 */
export interface HubBoard {
  counters: Counters;
  deliveries: DeliveryView[];
  orders: OrderView[];
}

function eventIdsOf(deliveries: DeliveryView[]): Set<string> {
  return new Set(deliveries.map((delivery) => delivery.eventId));
}

export function useArrivalHold(live: HubBoard): HubBoard {
  const [shown, setShown] = useState(live);
  // Undefined until the first board has been read. The first one is the world as it
  // already was rather than something that arrived, so it is shown at once: a page
  // opening on an empty hub for nine hundred milliseconds would be a worse lie than
  // the one this file exists to fix.
  const known = useRef<Set<string> | undefined>(undefined);
  // When the dot in flight is due to land. Boards arrive every second and the dot
  // travels for less than that, so an ordinary tick lands inside the window carrying
  // no new order of its own. Without a deadline that tick would look like nothing to
  // wait for and would release what the previous one was holding back.
  const landsAt = useRef(0);

  // Keyed to the whole board, which is why the caller has to hand over a value that
  // only changes when the board does. Keyed to its three fields instead, the effect
  // would be reaching past the object it was given and the linter would be right to
  // say so; keyed to a fresh literal, it would re-run forever.
  useEffect(() => {
    const ids = eventIdsOf(live.deliveries);
    const before = known.current;
    known.current = ids;

    const arriving = before !== undefined
      && [...ids].some((eventId) => !before.has(eventId));
    if (arriving) landsAt.current = Date.now() + ARRIVAL_MS;

    const wait = landsAt.current - Date.now();
    if (wait <= 0) {
      setShown(live);
      return undefined;
    }
    const timer = setTimeout(() => setShown(live), wait);
    return () => clearTimeout(timer);
  }, [live]);

  return shown;
}
