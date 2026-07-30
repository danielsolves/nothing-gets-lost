// services/api/src/rate-limit.guard.ts
// Caps per hour and visitor (spec 11).
//
// Addresses are hashed, never stored raw — a demo that lectures about care while
// keeping a list of visitor IPs would be arguing against itself.
//
// The model bucket does not produce an error when exhausted: extraction falls back
// to the recorded answers with a visible note. A stranger who hits the cap should
// still see a working demo, just an honestly labelled one.
import { createHash } from 'node:crypto';
import type { Pool } from 'pg';

/** The three buckets from spec 11, with their per-hour, per-visitor limits. */
export const LIMITS = { model: 5, orders: 30, sql: 20 } as const;
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
