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
import { createHash } from 'node:crypto';
import type { Pool } from 'pg';

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
  const salt = process.env.IP_HASH_SALT ?? 'nothing-gets-lost';
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
