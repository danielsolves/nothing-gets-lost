// packages/db/test/token.store.test.ts
// Pins the visitor token store against a real database: the token is never on disk in
// clear text, an expired row counts as absent, and a wrong key fails loudly.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Pool } from 'pg';
import { randomBytes } from 'node:crypto';
import { runMigrations } from '@ngl/db';
import { TokenStore } from '../src/token.store';

let container: StartedPostgreSqlContainer;
let pool: Pool;
let store: TokenStore;

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine').start();
  pool = new Pool({ connectionString: container.getConnectionUri() });
  await runMigrations(pool);
  store = new TokenStore(pool, randomBytes(32));
}, 120_000);

afterAll(async () => { await pool.end(); await container.stop(); });
beforeEach(async () => { await pool.query('TRUNCATE oauth_tokens'); });

describe('TokenStore', () => {
  it('stores and returns a token', async () => {
    await store.save('slack', 'xoxb-secret', 'C123');
    const loaded = await store.load('slack');
    expect(loaded?.token).toBe('xoxb-secret');
    expect(loaded?.targetRef).toBe('C123');
  });

  it('never writes the token in clear text', async () => {
    await store.save('slack', 'xoxb-secret', 'C123');
    const { rows } = await pool.query('SELECT encrypted FROM oauth_tokens');
    expect(rows[0].encrypted.toString('utf8')).not.toContain('xoxb-secret');
  });

  it('replaces an earlier token for the same provider', async () => {
    await store.save('slack', 'first', 'C1');
    await store.save('slack', 'second', 'C2');
    const { rows } = await pool.query('SELECT count(*) FROM oauth_tokens');
    expect(Number(rows[0].count)).toBe(1);
    expect((await store.load('slack'))?.token).toBe('second');
  });

  it('forgets a token on request', async () => {
    await store.save('hubspot', 'pat-x', null);
    await store.forget('hubspot');
    expect(await store.load('hubspot')).toBeNull();
  });

  it('treats an expired token as absent', async () => {
    await store.save('slack', 'xoxb-old', 'C1');
    await pool.query(`UPDATE oauth_tokens SET expires_at = now() - interval '1 hour'`);
    expect(await store.load('slack')).toBeNull();
  });

  it('purges expired tokens so nothing lingers past its day', async () => {
    await store.save('slack', 'xoxb-old', 'C1');
    await pool.query(`UPDATE oauth_tokens SET expires_at = now() - interval '1 hour'`);
    expect(await store.purgeExpired()).toBe(1);
    const { rows } = await pool.query('SELECT count(*) FROM oauth_tokens');
    expect(Number(rows[0].count)).toBe(0);
  });

  it('refuses a wrong key rather than returning nonsense', async () => {
    await store.save('slack', 'xoxb-secret', 'C1');
    const other = new TokenStore(pool, randomBytes(32));
    await expect(other.load('slack')).rejects.toThrow();
  });
});
