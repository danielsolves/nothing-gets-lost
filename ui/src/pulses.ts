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
//
// A settled delivery drew a second dot coming back for a while, on the grounds that
// an answer is as real as the call. It is, and the tile still prints how long it
// took, but two dots per delivery on five wires is a great deal of movement to say
// one thing. What the drawing shows is the mediator sending to a system.
//
// Which fixes when a dot may fire: at the send. One consequence is worth stating
// plainly rather than discovering later. A dot drawn as the call goes out cannot be
// coloured by how the call turned out, because nothing knows yet. The failed attempt
// no longer bounces back in amber; what a reader learns about the outcome, they
// learn from the tile, the wire and the queue, all of which say it in words.
import { SWITCHABLE_TARGETS, type DeliveryView, type SwitchableTarget } from '@ngl/contracts';

/**
 * `held` used to be here: an amber dot that ran out and came back, drawn when an
 * attempt failed. It went with the retiming. A dot fires as the call leaves, and at
 * that moment nothing knows whether it will be answered, so no dot can be coloured
 * by the outcome without waiting for it, which is the thing being fixed.
 */
export type PulseKind = 'delivered' | 'parked' | 'arrival';

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

/**
 * A dot stands for a call leaving the mediator, so it is timed by the send and not
 * by the answer. The drawing says "the hub is talking to that system now"; timed by
 * the reply it said "the hub finished talking to that system a moment ago", which is
 * the same picture drawn one round trip late and is wrong about the one thing the
 * animation is for.
 *
 * `sentAt` and not the state, because the board arrives once a second and a delivery
 * that answers in 300 ms is never seen in flight at all. The stamp survives into the
 * settled row, so the dot fires on the frame where the page learns the call went
 * out, whether or not it also learns the outcome in the same frame.
 */
function kindOf(delivery: DeliveryView): PulseKind | null {
  // Given up on. Not a call at all but a decision, and worth its own dot: this is
  // the moment a delivery stops moving by itself.
  if (delivery.state === 'dead') return 'parked';
  // Queued and never picked up. Nothing has travelled.
  if (delivery.sentAt === null) return null;
  return 'delivered';
}

/**
 * What makes one dot different from the next.
 *
 * The attempt counter, because a cut line produces attempt after attempt and the
 * visitor watching an outage needs to see each retry go out. Then whether that
 * attempt has left, so that learning the outcome of a call already drawn does not
 * draw it a second time: `inflight` and `done` at the same attempt are one send.
 * `dead` is kept apart because it is the one transition that is not a send.
 */
function signature(delivery: DeliveryView): string {
  if (delivery.state === 'dead') return `${delivery.attempts}:dead`;
  return `${delivery.attempts}:${delivery.sentAt === null ? 'waiting' : 'sent'}`;
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
/**
 * The orders that turned up between these two snapshots.
 *
 * Read twice below, once to draw the dot coming in and once to decide whether a row
 * being seen for the first time is news or history, and the two must agree: a row
 * that belongs to an order this page watched arrive is work it watched begin.
 */
function newEvents(
  previous: DeliveryView[], current: DeliveryView[], boardWasEmptied: boolean,
): Set<string> {
  // An empty previous list is the shape the list has before the first one lands, so
  // treating it as a baseline would fire an arrival for every order on the board on
  // every page load. Unless the caller watched the board empty, in which case the
  // empty list is a fact about the board rather than the absence of one, and the
  // first order after a reset is announced like any other.
  if (previous.length === 0 && !boardWasEmptied) return new Set();

  const known = new Set(previous.map((delivery) => delivery.eventId));
  const fresh = new Set<string>();
  for (const delivery of current) {
    if (!known.has(delivery.eventId)) fresh.add(delivery.eventId);
  }
  return fresh;
}

function arrivals(current: DeliveryView[], fresh: Set<string>): Pulse[] {
  const standsFor = new Map<string, number>();

  for (const delivery of current) {
    if (!fresh.has(delivery.eventId)) continue;
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
  const fresh = newEvents(previous, current, boardWasEmptied);

  // Arrivals first, because an order reaches the hub before anything it queues can
  // move, and a snapshot that holds both should read in that order.
  const pulses: Pulse[] = arrivals(current, fresh);

  for (const delivery of current) {
    if (!drawn(delivery)) continue;
    const was = before.get(delivery.id);

    // A row seen for the first time is usually not a change we witnessed but a row we
    // just learned about, and firing on it made a page load look like forty things
    // moving at once: the list starts empty, that empty list becomes the baseline, and
    // the first real snapshot arrives looking like a burst.
    //
    // Unless it belongs to an order that turned up in this very snapshot. Then its
    // rows are not history, they are the work that order just started, and the guard
    // was swallowing the one case the animation exists for. Boards arrive once a
    // second and the worker fans a batch out in a few hundred milliseconds, so an
    // order sent and delivered inside one board interval was never seen queued at
    // all: every row was a first sighting, every dot was skipped, and whether the
    // page drew anything came down to which side of the tick the order landed on.
    if (was === undefined && !fresh.has(delivery.eventId)) continue;
    if (was === signature(delivery)) continue;

    const kind = kindOf(delivery);
    if (kind === null) continue;
    pulses.push({ id: delivery.id, target: delivery.target, kind });
  }

  return pulses;
}
