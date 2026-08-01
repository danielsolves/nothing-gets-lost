// services/api/src/rate-limit.guard.ts
// Caps per hour and visitor (spec 11).
//
// Addresses are hashed, never stored raw. A demo that lectures about care while
// keeping a list of visitor IPs would be arguing against itself.
//
// One bucket, and it is worth saying why rather than leaving two constants standing
// that nothing reads. Spec 11 named three. `sql` belonged to the public SQL console,
// which has been removed. `model` was declared and never checked: the extractor is
// reached through the chaos endpoint and was never counted, so the number described
// an intention rather than a limit, and a limit that is only written down is worse
// than none because it is quoted as if it held.
import { createHash } from 'node:crypto';
import type { Pool } from 'pg';

/** Per hour, per visitor. Orders are the only thing this service meters. */
export const LIMITS = { orders: 30 } as const;
export type Bucket = keyof typeof LIMITS;

export function hashIp(address: string): string {
  const salt = process.env.IP_HASH_SALT ?? 'nothing-gets-lost';
  return createHash('sha256').update(`${salt}:${address}`).digest('hex').slice(0, 32);
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
