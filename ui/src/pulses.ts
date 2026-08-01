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
//
// Arrivals obey the same rule from the other end. An order coming in is not a state
// change of any delivery, so it needs its own evidence: an event id in the list that
// was not in the list before. Nothing here polls for it and nothing announces it.
import { SWITCHABLE_TARGETS, type DeliveryView, type SwitchableTarget } from '@ngl/contracts';

export type PulseKind = 'delivered' | 'answer' | 'held' | 'parked' | 'arrival';

/**
 * An arrival travels the wire into the mediator rather than one of the outgoing
 * ones, so a pulse can name the way in as well as a system.
 *
 * Still called `shop` now that the shop is a button at the top of the machine rather
 * than a tile beside it. The name says where the order came from, which has not
 * changed, and renaming it would touch the mediator and the stored contract for a
 * word only this file and the stylesheet ever read.
 */
export type PulseTarget = SwitchableTarget | 'shop';

export interface Pulse {
  /** The delivery this dot stands for. Also its React key. */
  id: number;
  target: PulseTarget;
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

/**
 * A settled delivery is two things that happened, not one: a call went out and an
 * answer came back. Drawn as a single dot absorbed at the far end, the picture said
 * the first half and left the second to be taken on trust, which on this page is the
 * half that matters. The system answering is the evidence that it is a system.
 *
 * Both halves are real and both are timed: `sentAt` and `answeredAt` are stamped by
 * this machine on either side of the call. The return dot is only drawn when the row
 * carries both, so it is never an animation standing in for a measurement we do not
 * have. An older row that predates the timestamps simply draws the one dot it can
 * account for.
 */
function answered(delivery: DeliveryView): boolean {
  return delivery.state === 'done'
    && delivery.sentAt !== null
    && delivery.answeredAt !== null;
}

function signature(delivery: DeliveryView): string {
  return `${delivery.state}:${delivery.attempts}`;
}

/**
 * One dot for one order turning up, never one per delivery that order queued: an
 * order fans out to four or five systems in the same snapshot, and four dots on the
 * wire into the hub would say four orders came in when one did. The event id is what
 * an order is here; the deliveries are what it then does.
 *
 * The lowest of its delivery ids stands for the order, so the dot does not depend on
 * the order the rows happen to be listed in.
 *
 * Deliberately not a `delivered` dot pointed the other way. This one runs into the
 * hub rather than out of it, and one kind covering both would mean any later change
 * to how a confirmed delivery looks restyled the arrival as a side effect.
 *
 * A delivery carries no origin, so an order read out of the mail draws on the shop
 * wire too. Correcting that means a new field on the delivery contract and a mediator
 * that fills it in everywhere, and every order appearing out of the middle of the
 * picture was the worse of the two.
 */
function arrivals(
  previous: DeliveryView[], current: DeliveryView[], boardWasEmptied: boolean,
): Pulse[] {
  // An empty previous list is the shape the list has before the first one lands, so
  // treating it as a baseline would fire an arrival for every order on the board on
  // every page load. Unless the caller watched the board empty, in which case the
  // empty list is a fact about the board rather than the absence of one, and the
  // first order after a reset is announced like any other.
  if (previous.length === 0 && !boardWasEmptied) return [];

  const known = new Set(previous.map((delivery) => delivery.eventId));
  const standsFor = new Map<string, number>();

  for (const delivery of current) {
    if (known.has(delivery.eventId)) continue;
    const lowest = standsFor.get(delivery.eventId);
    if (lowest === undefined || delivery.id < lowest) {
      standsFor.set(delivery.eventId, delivery.id);
    }
  }

  const pulses: Pulse[] = [];
  for (const id of standsFor.values()) pulses.push({ id, target: 'shop', kind: 'arrival' });
  return pulses;
}

/**
 * @param previous the delivery list as it was last render, or undefined on the first
 *   one. Undefined means no dots: a visitor arriving mid-experiment must not be shown
 *   a burst for every delivery already on the board.
 * @param options.boardWasEmptied that an empty `previous` is a board the page watched
 *   empty rather than one it has not seen yet. Only the caller can know which, and
 *   the default is the careful one: a caller that says nothing gets no arrivals.
 */
export function pulsesFrom(
  previous: DeliveryView[] | undefined, current: DeliveryView[],
  { boardWasEmptied = false }: { boardWasEmptied?: boolean } = {},
): Pulse[] {
  if (previous === undefined) return [];

  const before = new Map(previous.map((delivery) => [delivery.id, signature(delivery)]));

  // Arrivals first, because an order reaches the hub before anything it queues can
  // move, and a snapshot that holds both should read in that order.
  const pulses: Pulse[] = arrivals(previous, current, boardWasEmptied);

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
    if (answered(delivery)) {
      pulses.push({ id: delivery.id, target: delivery.target, kind: 'answer' });
    }
  }

  return pulses;
}
