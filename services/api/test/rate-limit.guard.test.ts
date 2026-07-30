// services/api/test/rate-limit.guard.test.ts
// The link is public, so the caps exist for strangers rather than for customers
// (spec 11). The last two checks matter most: an address is never stored raw, and
// a cap lifts by itself once the hour is over.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Pool } from 'pg';
import { runMigrations } from '@ngl/db';
import { RateLimiter, hashIp } from '../src/rate-limit.guard';

let container: StartedPostgreSqlContainer;
let pool: Pool;
let limiter: RateLimiter;

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine').start();
  pool = new Pool({ connectionString: container.getConnectionUri() });
  await runMigrations(pool);
  limiter = new RateLimiter(pool);
}, 120_000);

afterAll(async () => { await pool.end(); await container.stop(); });
beforeEach(async () => { await pool.query('TRUNCATE rate_limits'); });

const ip = hashIp('203.0.113.7');

describe('RateLimiter', () => {
  it('allows up to the limit', async () => {
    for (let i = 0; i < 5; i++) {
      expect(await limiter.check('model', ip, 5)).toBe(true);
    }
  });

  it('refuses beyond the limit', async () => {
    for (let i = 0; i < 5; i++) await limiter.check('model', ip, 5);
    expect(await limiter.check('model', ip, 5)).toBe(false);
  });

  it('counts buckets separately', async () => {
    for (let i = 0; i < 5; i++) await limiter.check('model', ip, 5);
    expect(await limiter.check('sql', ip, 20)).toBe(true);
  });

  it('counts visitors separately', async () => {
    for (let i = 0; i < 5; i++) await limiter.check('model', ip, 5);
    expect(await limiter.check('model', hashIp('198.51.100.4'), 5)).toBe(true);
  });

  it('never stores the raw address', async () => {
    await limiter.check('model', ip, 5);
    const { rows } = await pool.query('SELECT ip_hash FROM rate_limits');
    expect(rows[0].ip_hash).not.toContain('203.0.113.7');
  });

  it('starts a fresh window in the next hour', async () => {
    for (let i = 0; i < 5; i++) await limiter.check('model', ip, 5);
    await pool.query(`UPDATE rate_limits SET window_at = window_at - interval '2 hours'`);
    expect(await limiter.check('model', ip, 5)).toBe(true);
  });
});
