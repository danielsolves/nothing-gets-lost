// ui/src/activity.ts
// One plain line about what is happening: per system tile, and for the mediator
// as a whole.
//
// A tile said nothing about itself unless something was queued at it, and the
// mediator only admitted what it was doing to a visitor who clicked into the Log
// tab. Both were quietly busy and looked idle, which is the one impression this
// page cannot afford: the specification refuses stage props exactly where the
// visitor is deciding whether to believe it. So the words are computed from the
// delivery rows and from nothing else, kept pure the way order-cards.ts is, so
// what the page claims can be checked without a browser.
//
// The same fact is worded twice here, and the difference is the space it has to
// live in. A tile is a 150 pixel square whose first two rows are already the
// system name and a one word note, so its line is written for a reader looking
// straight at it and never names the system again: "Delivering", not "Delivering
// to Stripe". The mediator line speaks for the whole machine, where which system
// is the point of the sentence.
//
// The raw error never appears in either. `lastError` is a driver's sentence about
// a socket, worth having in the backlog entry and meaningless on a tile.
import type { DeliveryView, SwitchableTarget, Target } from '@ngl/contracts';
import { retryGap } from './order-time';

/**
 * Three tones rather than one state per delivery: the line exists to be read at a
 * glance, and the only distinction that earns a colour is whether the reader has
 * to do something. `bad` is the parked delivery waiting for a human, `work` is
 * something moving, `wait` is everything that will resolve on its own, including
 * the quiet states. Idle shares the quiet tone because idle is the opposite of a
 * thing worth shouting about.
 */
export type Tone = 'work' | 'wait' | 'bad';

export interface Activity {
  text: string;
  tone: Tone;
}

/**
 * Proper names for the boxes on the page, so a line names the same thing the
 * visitor is looking at. The visitor's own endpoint is the exception: it has no
 * tile and no name of its own, so it is theirs, in lower case, and the sentence
 * capital is put back at the end.
 *
 * Used by `currentWork` only. A tile line never names its own system, because the
 * tile prints the name two rows above it, so the map is deliberately unused by
 * `activityFor` rather than missing something.
 */
const LABELS: Record<Target, string> = {
  stripe: 'Stripe', hubspot: 'HubSpot', ledger: 'Invoices',
  slack: 'Slack', mailer: 'Confirmation mail', custom_webhook: 'your endpoint',
};

function sentence(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function line(text: string, tone: Tone): Activity {
  return { text: sentence(text), tone };
}

function attemptsWord(attempts: number): string {
  return attempts === 1 ? '1 attempt' : `${attempts} attempts`;
}

function isRetrying(delivery: DeliveryView): boolean {
  return delivery.state === 'pending' && delivery.attempts > 0;
}

function isQueued(delivery: DeliveryView): boolean {
  return delivery.state === 'pending' && delivery.attempts === 0;
}

/** Ids are a sequence, so the lowest is the one that has been waiting longest. */
function oldest(rows: DeliveryView[]): DeliveryView | null {
  return rows.reduce<DeliveryView | null>(
    (best, row) => (best === null || row.id < best.id ? row : best), null,
  );
}

/** The next retry due. A row without a time cannot be next, so it never wins. */
function soonest(rows: DeliveryView[]): DeliveryView | null {
  return rows.reduce<DeliveryView | null>((best, row) => {
    if (row.nextAt === null) return best;
    if (best === null || best.nextAt === null) return row;
    return Date.parse(row.nextAt) < Date.parse(best.nextAt) ? row : best;
  }, oldest(rows));
}

/**
 * Which of several true sentences a tile gets to say. Live work first, then what
 * needs a human, then what is only waiting.
 *
 * Putting the parked delivery second rather than first is the decision worth
 * defending. It is the most urgent row on the board, but it is also permanent:
 * nothing clears it except a human or a reset. Ranked top it would pin the tile to
 * "needs a human" for the rest of the session, and every delivery that went out
 * afterwards would go out unannounced, which is the silence this file exists to
 * end. Ranked second it still beats everything that is merely waiting, and waiting
 * is the state that resolves itself.
 *
 * Every line here is a sentence with its subject left out, because the subject is
 * the tile it is printed on. The longest one it can produce is "2 orders waiting
 * to retry, next in 10 minutes"; the four everyday ones are half that.
 */
export function activityFor(
  target: SwitchableTarget, deliveries: DeliveryView[], now: Date = new Date(),
): Activity | null {
  const mine = deliveries.filter((delivery) => delivery.target === target);

  const going = mine.filter((delivery) => delivery.state === 'inflight');
  if (going.length === 1) return line('delivering', 'work');
  if (going.length > 1) return line(`delivering ${going.length} orders`, 'work');

  const parked = mine.filter((delivery) => delivery.state === 'dead');
  const worst = oldest(parked);
  if (parked.length > 1) return line(`${parked.length} orders need a human`, 'bad');
  if (worst) return line(`needs a human after ${attemptsWord(worst.attempts)}`, 'bad');

  const retrying = mine.filter(isRetrying);
  const next = soonest(retrying);
  if (next) {
    const gap = retryGap(next.nextAt, now);
    if (retrying.length > 1) {
      const rest = `${retrying.length} orders waiting to retry`;
      return line(gap ? `${rest}, next in ${gap}` : rest, 'wait');
    }
    // The attempt number stays even though it costs characters. It is the one
    // thing on the tile that shows the retry count climbing rather than a
    // delivery sitting still.
    const failed = `attempt ${next.attempts} failed, trying again`;
    return line(gap ? `${failed} in ${gap}` : failed, 'wait');
  }

  const queued = mine.filter(isQueued);
  if (queued.length === 1) return line('queued', 'wait');
  if (queued.length > 1) return line(`${queued.length} orders queued`, 'wait');

  // Everything is delivered. "Delivered" on its own would be one more thing to read
  // for no news, but how long the system took to answer is news, and it is the news
  // this page exists to carry: a number that only exists because something at the
  // other end really answered. Measured on our clock either side of the call, which
  // is why it is worded as a round trip and not as their processing time.
  const settled = lastAnswered(mine);
  if (settled !== null) return line(`answered in ${settled}`, 'wait');

  return null;
}

/**
 * The order behind the most recent settled delivery to a system, or null when that
 * system has not delivered anything yet.
 *
 * This is what the tile offers to go and check. The most recent rather than any of
 * them, because a visitor pressing a button on the HubSpot tile means "the thing you
 * just did", and because the drawing shows the state now.
 */
export function lastDeliveredEvent(
  target: SwitchableTarget, deliveries: DeliveryView[],
): string | null {
  let best: { at: number; eventId: string } | null = null;

  for (const delivery of deliveries) {
    if (delivery.target !== target) continue;
    if (delivery.state !== 'done') continue;
    const at = delivery.answeredAt === null ? 0 : Date.parse(delivery.answeredAt);
    if (best === null || at > best.at) best = { at, eventId: delivery.eventId };
  }

  return best?.eventId ?? null;
}

/**
 * How long the most recent settled delivery took, or null when none of them carries
 * both timestamps. Rows written before the timings existed say nothing rather than
 * guessing, because a made-up duration on this page costs more than a blank tile.
 */
function lastAnswered(deliveries: DeliveryView[]): string | null {
  let best: { at: number; text: string } | null = null;

  for (const delivery of deliveries) {
    if (delivery.state !== 'done') continue;
    if (delivery.sentAt === null || delivery.answeredAt === null) continue;
    const sent = Date.parse(delivery.sentAt);
    const answered = Date.parse(delivery.answeredAt);
    if (Number.isNaN(sent) || Number.isNaN(answered) || answered < sent) continue;
    if (best === null || answered > best.at) {
      best = { at: answered, text: roundTrip(answered - sent) };
    }
  }

  return best?.text ?? null;
}

/**
 * Milliseconds under a second and seconds above it. A hop that took 312 ms reads as
 * a machine talking to a machine; the same number as "0.3 s" reads as a rounding,
 * and the point of printing it at all is that it is a measurement.
 */
export function roundTrip(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

/**
 * The mediator's own line, above its tabs. Never null: this one has a fixed place
 * on the page, and a blank space where a sentence belongs reads as broken rather
 * than as calm.
 *
 * It names one delivery and counts the rest. "Waiting" counts the pending and
 * in-flight rows, exactly as the counter beside it does, so the two never
 * contradict each other; parked rows are counted by the "needs a human" counter
 * and by the line itself as soon as nothing is in flight.
 *
 * It takes no clock, unlike the tile line. Every countdown it used to print has
 * moved onto the card of the order it was about, and a parameter kept for a reading
 * nothing does any more is a claim that this line still depends on the time.
 */
export function currentWork(deliveries: DeliveryView[]): Activity {
  if (deliveries.length === 0) return line('nothing has come in yet', 'wait');

  const waiting = deliveries.filter(
    (delivery) => delivery.state === 'pending' || delivery.state === 'inflight',
  );
  const rest = (besides: number) => {
    const others = waiting.length - besides;
    return others > 0 ? `, ${others} more waiting` : '';
  };

  const going = oldest(deliveries.filter((delivery) => delivery.state === 'inflight'));
  if (going) return line(`delivering to ${LABELS[going.target]}${rest(1)}`, 'work');

  const parked = deliveries.filter((delivery) => delivery.state === 'dead');
  const worst = oldest(parked);
  if (parked.length > 1) return line(`${parked.length} orders need a human${rest(0)}`, 'bad');
  if (worst) {
    const label = LABELS[worst.target];
    return line(`${label} needs a human after ${attemptsWord(worst.attempts)}${rest(0)}`, 'bad');
  }

  const next = soonest(deliveries.filter(isRetrying));
  if (next) {
    // Named, not counted down to. The countdown is a promise about one delivery, and
    // printed here it sat above the whole queue: a visitor read "in 4 seconds" over
    // twelve cards with no way to tell which of them it was about. It is on the card
    // of the order it belongs to instead.
    return line(`waiting to retry ${LABELS[next.target]}${rest(1)}`, 'wait');
  }

  const queued = oldest(deliveries.filter(isQueued));
  if (queued) return line(`queued for ${LABELS[queued.target]}${rest(1)}`, 'wait');

  return line('everything delivered, nothing waiting', 'wait');
}
