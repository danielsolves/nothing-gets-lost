// services/api/src/rate-limit.guard.ts
// Caps per hour and visitor (spec 11).
//
// Addresses are hashed, never stored raw. A demo that lectures about care while
// keeping a list of visitor IPs would be arguing against itself.
//
// Spec 11 named three buckets and two of them were fiction. `sql` belonged to the
// public SQL console, which has been removed. `model` was declared and never checked:
// the extractor was reachable only through the chaos buttons, whose text nobody could
// change, so the number described an intention rather than a limit, and a limit that
// is only written down is worse than none, because it gets quoted as if it held. It
// is real now and it is checked, because the page has a field a stranger can type an
// order mail into.
//
// The three below are real. Two of them exist because sending mail changes who this
// form can hurt. Everything else the demo does lands in accounts we own, and the
// worst a visitor can do with thirty orders an hour is make our own CRM untidy. A
// confirmation mail goes to an address the visitor types, which makes the form a way
// to send mail from our domain to strangers. The damage there is not ours to clean up
// and not money: it is whether mail from this domain is delivered at all, which is
// lost slowly and got back with difficulty.
//
// So the loud button, which asks for no address and can send to nobody, keeps its
// thirty. An order that carries an address is metered twice over: against the visitor,
// so one browser cannot pump; and against the address, so many browsers cannot gang up
// on one inbox.
//
// The third exists for a different reason. Reading a mail is the one press on this
// page that somebody else bills us for, by the token, and it is the one thing here
// that a script can turn into an invoice rather than into untidy data. So it is
// counted apart from orders and it is counted tightly.
import { createHash, randomBytes } from 'node:crypto';
import type { Pool } from 'pg';

/**
 * The salt when nobody set one.
 *
 * It used to be a constant written on the line below, which was defensible while this
 * repository was private and worth nothing the moment it was not. `rate_limits` holds
 * a hash of every visitor address and of every recipient a confirmation mail was asked
 * for, and both are cheap to guess one at a time, so a published salt does not make
 * the column harder to read, it makes it a lookup table: hash the address you are
 * curious about and look for the row.
 *
 * Refusing to start without IP_HASH_SALT is the other obvious answer and it is the
 * wrong one here. Spec 8.5 asks that a stranger who cloned this and set no environment
 * at all still gets a running demo, and a showcase that fails on clone argues against
 * its own point. Random, once per process, keeps the demo booting and keeps the column
 * opaque. The price is that the hour counters start over at a restart, because the
 * same address hashes to something else afterwards and lands in a new row: somebody
 * who had spent their allowance gets it back at a deploy. That is cheaper than a
 * published salt, and it never happens on the live host, where the variable is set.
 */
const PROCESS_SALT = randomBytes(32).toString('hex');

/**
 * Per hour. `orders` is per visitor, `mail` is per visitor, `mailTo` is per recipient
 * address, `model` is per visitor.
 *
 * The mail numbers are small on purpose and are still generous for the thing they
 * allow: a reader who wants to watch a confirmation arrive needs one, and a reader
 * who wants to watch one arrive, break the mailer and watch a retry needs two.
 *
 * `model` is ten, which is the same kind of number arrived at the same way. The page
 * offers three mails to read, one that goes through and two that are refused, and a
 * reader who then writes one of their own and edits it twice has used six. Ten covers
 * that with room to spare and still bounds a scripted visitor to about a cent an hour,
 * which is the point: the cap is there so that a stranger cannot spend our money in
 * bulk, not to ration the demonstration. It is a third of the orders cap because an
 * order costs us a row in our own database and a reading costs a call to someone
 * else's api.
 */
export const LIMITS = { orders: 30, mail: 5, mailTo: 3, model: 10 } as const;
export type Bucket = keyof typeof LIMITS;

/**
 * The subject of a bucket, salted and truncated.
 *
 * Whatever is being metered goes through here, never the raw value, and the column it
 * lands in is called `ip_hash` for the one subject that existed when it was created.
 * It holds an opaque hash of whatever identifies the caller for that bucket; the
 * bucket name says which. A demo that lectures about care while keeping a list of
 * visitor addresses would be arguing against itself.
 */
function hashSubject(subject: string): string {
  // Empty counts as unset. `env_file` turns an empty line in .env into an empty string
  // rather than into nothing at all, and .env.example ships this line empty, so `??`
  // would leave the demo salting with '' in exactly the case this fallback exists for.
  const salt = process.env.IP_HASH_SALT || PROCESS_SALT;
  return createHash('sha256').update(`${salt}:${subject}`).digest('hex').slice(0, 32);
}

export function hashIp(address: string): string {
  return hashSubject(address);
}

/**
 * Case and surrounding space folded away first, so `A@b.com ` and `a@b.com` are one
 * inbox to this counter. They are one inbox to every mail server too, and a cap that
 * a capital letter walks through is not a cap.
 */
export function hashRecipient(address: string): string {
  return hashSubject(`to:${address.trim().toLowerCase()}`);
}

export class RateLimiter {
  constructor(private readonly pool: Pool) {}

  /** Returns true when the call is within the limit. */
  async check(bucket: string, ipHash: string, limit: number): Promise<boolean> {
    const { rows } = await this.pool.query<{ count: number }>(
      `INSERT INTO rate_limits (bucket, ip_hash, window_at, count)
       VALUES ($1, $2, date_trunc('hour', now()), 1)
       ON CONFLICT (bucket, ip_hash, window_at)
       DO UPDATE SET count = rate_limits.count + 1
       RETURNING count`,
      [bucket, ipHash],
    );
    return (rows[0]?.count ?? 0) <= limit;
  }
}
