// ui/src/pulses.ts
// Decides when a dot travels along a line in the diagram.
//
// The rule is the whole point: a dot exists because a delivery changed state, never
// because a timer came round. Specification section 7 refuses stage props at the place
// where the visitor is deciding whether to believe the page, and an animation that runs
// on its own would be one, sitting exactly there.
//
// Identity is (id, state, attempts) rather than (id, state). A cut line produces the
// same state name over and over as the retries fail; only the attempt counter tells
// the second failure from the first, and the visitor watching an outage needs to see
// each retry go out.
import { SWITCHABLE_TARGETS, type DeliveryView, type SwitchableTarget } from '@ngl/contracts';

export type PulseKind = 'delivered' | 'held' | 'parked';

export interface Pulse {
  /** The delivery this dot stands for. Also its React key. */
  id: number;
  target: SwitchableTarget;
  kind: PulseKind;
}

const DRAWN: ReadonlySet<string> = new Set<string>(SWITCHABLE_TARGETS);

function drawn(delivery: DeliveryView): delivery is DeliveryView & { target: SwitchableTarget } {
  return DRAWN.has(delivery.target);
}

function kindOf(delivery: DeliveryView): PulseKind | null {
  if (delivery.state === 'done') return 'delivered';
  if (delivery.state === 'dead') return 'parked';
  // A queued row has not been anywhere yet, so nothing has travelled.
  if (delivery.attempts === 0) return null;
  return 'held';
}

function signature(delivery: DeliveryView): string {
  return `${delivery.state}:${delivery.attempts}`;
}

/**
 * @param previous the delivery list as it was last render, or undefined on the first
 *   one. Undefined means no dots: a visitor arriving mid-experiment must not be shown
 *   a burst for every delivery already on the board.
 */
export function pulsesFrom(
  previous: DeliveryView[] | undefined, current: DeliveryView[],
): Pulse[] {
  if (previous === undefined) return [];

  const before = new Map(previous.map((delivery) => [delivery.id, signature(delivery)]));
  const pulses: Pulse[] = [];

  for (const delivery of current) {
    if (!drawn(delivery)) continue;
    const was = before.get(delivery.id);

    // A row we are seeing for the first time is not a change we witnessed, it is a
    // row we just learned about. Without this, a page load fired a dot for every
    // delivery on the board: the list starts empty, that empty list becomes the
    // baseline, and the first real snapshot then looks like forty things moving at
    // once. The next genuine transition of the same row still pulses, because by
    // then there is something to compare against.
    if (was === undefined) continue;
    if (was === signature(delivery)) continue;

    const kind = kindOf(delivery);
    if (kind === null) continue;
    pulses.push({ id: delivery.id, target: delivery.target, kind });
  }

  return pulses;
}
