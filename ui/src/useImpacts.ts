// ui/src/useImpacts.ts
// The moment a dot reaches the system it was travelling to, so the tile can show
// that it arrived.
//
// A dot ran to the edge of a tile and vanished, and the tile did not move. What the
// drawing showed was a thing approaching a system, never a thing being taken in by
// one, so the arrival was the one part of the journey a visitor had to infer. The
// tile now takes the hit in the dot's own colour, which is also what says whether
// what landed was a delivery or a delivery giving up.
//
// Timed off the same clock as the animation rather than off a delivery state. The dot
// is what the visitor is watching, so the flash has to agree with the dot even if the
// board behind it says something new in the meantime.
import { useEffect, useRef, useState } from 'react';
import { SWITCHABLE_TARGETS, type SwitchableTarget } from '@ngl/contracts';
import type { PulseKind } from './pulses';
import { PULSE_MS, type LivePulse } from './useDeliveryPulses';

/**
 * When the dot is at the far end, as a share of its run.
 *
 * `packet-through` in the stylesheet holds the dot at the system from 82% until it is
 * absorbed, so the hit belongs there. Written as a share rather than as a number of
 * milliseconds because the two have to move together: a duration copied by hand would
 * drift the first time either is tuned, and a flash that fires while the dot is still
 * in the gap is worse than none, since it announces an arrival that has not happened.
 */
const IMPACT_AT = 0.82;

/** How long the tile stays lit. Short: it is a hit, not a state. */
const FLASH_MS = 420;

export type Impacts = Partial<Record<SwitchableTarget, PulseKind>>;

function isSwitchable(target: string): target is SwitchableTarget {
  return (SWITCHABLE_TARGETS as readonly string[]).includes(target);
}

export function useImpacts(pulses: LivePulse[]): Impacts {
  const [struck, setStruck] = useState<Impacts>({});
  // Every dot already answered for, so a re-render on an unrelated board does not
  // fire the same arrival twice.
  const seen = useRef(new Set<string>());

  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];

    for (const pulse of pulses) {
      if (seen.current.has(pulse.key)) continue;
      seen.current.add(pulse.key);
      if (!isSwitchable(pulse.target)) continue;
      const target = pulse.target;
      const kind = pulse.kind;

      timers.push(setTimeout(() => {
        setStruck((current) => ({ ...current, [target]: kind }));
        timers.push(setTimeout(() => {
          setStruck((current) => {
            // Only if this hit is still the one showing. A second dot landing inside
            // the flash owns the tile now, and clearing it here would cut that one
            // short on a timer belonging to the hit before it.
            if (current[target] !== kind) return current;
            const next = { ...current };
            delete next[target];
            return next;
          });
        }, FLASH_MS));
      }, PULSE_MS * IMPACT_AT));
    }

    return () => { for (const timer of timers) clearTimeout(timer); };
  }, [pulses]);

  return struck;
}
