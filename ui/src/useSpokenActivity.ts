// ui/src/useSpokenActivity.ts
// What each system tile is allowed to say, and when it is allowed to say it.
//
// A delivery makes two journeys on this page and the words have to wait for both.
// useArrivalHold covers the first: the hub says nothing about an order until the dot
// carrying it has reached the hub. This covers the second. A dot then leaves the hub
// for a system, and the system tile was printing "Answered in 984 ms" the instant it
// set off, so a visitor read a system's answer while the call to it was still
// visibly in the air. The dot stopped being the thing happening and became decoration
// laid over a result that had already been announced.
//
// So a tile holds its line for as long as its own dot is travelling. It is the same
// rule as the hub's, one leg further out, and it is worth having twice: the whole
// claim of this page is that what is drawn is what happened, and a drawing that
// reports an outcome before the thing carrying it has arrived is telling the story
// out of order.
//
// Held by value rather than by board. The tile line is computed fresh on every render
// from a list that is rebuilt every second, so holding the object would compare two
// equal lines as different and release nothing. Two lines are the same line when they
// read the same and carry the same tone, because that is all a reader can see.
import { useEffect, useMemo, useRef, useState } from 'react';
import { SWITCHABLE_TARGETS, type DeliveryView, type SwitchableTarget } from '@ngl/contracts';
import { activityFor, type Activity } from './activity';
import { PULSE_MS, type LivePulse } from './useDeliveryPulses';

export type SpokenActivity = Record<SwitchableTarget, Activity | null>;

function same(a: Activity | null, b: Activity | null): boolean {
  if (a === null || b === null) return a === b;
  return a.text === b.text && a.tone === b.tone;
}

function blank(): SpokenActivity {
  const out = {} as SpokenActivity;
  for (const target of SWITCHABLE_TARGETS) out[target] = null;
  return out;
}

function isSwitchable(target: string): target is SwitchableTarget {
  return (SWITCHABLE_TARGETS as readonly string[]).includes(target);
}

export function useSpokenActivity(
  deliveries: DeliveryView[], pulses: LivePulse[],
): SpokenActivity {
  // Recomputed only when the board is, so the effect below has something stable to
  // key on. Rebuilt every render it would look like new work every render and the
  // holds would never expire.
  const wanted = useMemo(() => {
    const out = blank();
    for (const target of SWITCHABLE_TARGETS) out[target] = activityFor(target, deliveries);
    return out;
  }, [deliveries]);

  const [spoken, setSpoken] = useState<SpokenActivity>(wanted);
  // When each tile's dot is due to land. A tile with nothing in the air has a
  // deadline in the past and speaks at once, which is every tile most of the time.
  const landsAt = useRef<Record<string, number>>({});

  useEffect(() => {
    for (const pulse of pulses) {
      if (isSwitchable(pulse.target)) landsAt.current[pulse.target] = Date.now() + PULSE_MS;
    }

    const timers: ReturnType<typeof setTimeout>[] = [];
    const ready = blank();
    let anyReady = false;

    for (const target of SWITCHABLE_TARGETS) {
      const wait = (landsAt.current[target] ?? 0) - Date.now();
      if (wait <= 0) {
        ready[target] = wanted[target];
        anyReady = true;
        continue;
      }
      // Still travelling. The line it is carrying is fixed now and released on
      // landing, so a board that arrives in between does not overtake the dot.
      const line = wanted[target];
      timers.push(setTimeout(() => {
        setSpoken((current) => (same(current[target], line)
          ? current
          : { ...current, [target]: line }));
      }, wait));
    }

    if (anyReady) {
      setSpoken((current) => {
        let changed = false;
        const next = { ...current };
        for (const target of SWITCHABLE_TARGETS) {
          if ((landsAt.current[target] ?? 0) - Date.now() > 0) continue;
          if (same(current[target], ready[target])) continue;
          next[target] = ready[target];
          changed = true;
        }
        return changed ? next : current;
      });
    }

    return () => { for (const timer of timers) clearTimeout(timer); };
  }, [wanted, pulses]);

  return spoken;
}
