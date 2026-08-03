// ui/src/order-time.ts
// When an order arrived, in words a visitor can use. The wire carries the instant and
// says nothing about how it should read, which is the right split: how it reads is a
// decision about the person in front of the screen, and it is made here.
//
// Absolute, not relative. "3 minutes ago" cannot be held up against a Stripe receipt
// or the timestamp on a confirmation mail, which is the only reason to put a time on
// the card at all. It also re-words itself on a board that ticks every second, the
// same trap the retry log fell into.
//
// The retry gap lives here too. It is the same kind of decision made for the same
// reader, and it used to sit in activity.ts, where only the hub line and the tiles
// could reach it. The order card needs it as well, and one copy of a rounding rule
// is the only way two places can agree about what "in a minute" means.
//
// Seconds for today and no seconds for anything older. During a demo four orders can
// land inside one minute, and four cards all headed 14:32 say less than the uuid
// fragment they replaced. A day later the second is noise and the date is not.
const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function sameDay(one: Date, other: Date): boolean {
  return one.getFullYear() === other.getFullYear()
    && one.getMonth() === other.getMonth()
    && one.getDate() === other.getDate();
}

/** In the viewer's own timezone, because that is the clock they are comparing to. */
export function formatArrival(receivedAt: string, now: Date): string {
  const at = new Date(receivedAt);
  // Better to print the raw value than a plausible wrong time. It cannot happen from
  // our own server, and it is the sort of thing that must not take the page with it.
  if (Number.isNaN(at.getTime())) return receivedAt;

  const clock = `${pad(at.getHours())}:${pad(at.getMinutes())}`;
  if (sameDay(at, now)) return `${clock}:${pad(at.getSeconds())}`;

  // getMonth is 0 to 11 by definition, but the compiler has no way to know the index
  // is in range, and a cast to tell it would be the worse trade.
  return `${at.getDate()} ${MONTHS[at.getMonth()] ?? ''} ${clock}`;
}

/**
 * How long until the next attempt, rounded up and never down. The number is a
 * promise about the future and the retry schedule reaches ten minutes (see
 * services/mediator/src/backoff.ts), so a line counting 600 seconds would be true
 * and unreadable.
 */
function gapText(seconds: number): string {
  if (seconds < 60) return seconds === 1 ? '1 second' : `${seconds} seconds`;
  const minutes = Math.ceil(seconds / 60);
  return minutes === 1 ? '1 minute' : `${minutes} minutes`;
}

/**
 * Null when there is no honest number to give: either the row carries no next
 * attempt, or the moment has passed and the worker has not picked it up yet. Saying
 * "in 0 seconds" of a retry nobody has started would be a claim the data does not
 * make, so the caller is expected to stop its sentence before the "when".
 */
export function retryGap(nextAt: string | null, now: Date): string | null {
  if (nextAt === null) return null;
  const due = Date.parse(nextAt);
  if (Number.isNaN(due)) return null;
  const seconds = Math.ceil((due - now.getTime()) / 1000);
  return seconds > 0 ? gapText(seconds) : null;
}
