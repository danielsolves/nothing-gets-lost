// packages/db/test/readonly-password.test.ts
// The read-only role's password comes from the environment on a public host, not
// from migration 005 where anyone reading the repository can see it.
//
// The claim worth pinning is the refusal. ALTER ROLE takes no bind parameters, so
// the value is inlined, and a value this process cannot quote with certainty must
// not reach the database. A silent escape would be the kind of cleverness that reads
// fine and is a hole.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Pool } from 'pg';
import { runMigrations, setReadonlyPassword } from '../src/migrate';

let container: StartedPostgreSqlContainer;
let pool: Pool;

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine').start();
  pool = new Pool({ connectionString: container.getConnectionUri() });
  await runMigrations(pool);
}, 120_000);

afterAll(async () => { await pool.end(); await container.stop(); });

describe('setReadonlyPassword', () => {
  it('leaves the demo password alone when none is set', async () => {
    // A clone runs on one command and no filled in variables. Refusing to migrate
    // over an unset password would take that away for no gain.
    await expect(setReadonlyPassword(pool, undefined)).resolves.not.toThrow();
    await expect(setReadonlyPassword(pool, '')).resolves.not.toThrow();
  });

  it('moves the role onto the password the host supplied', async () => {
    await setReadonlyPassword(pool, 'K7nWq2xRt5vLbYcE9mHu');

    const readonly = new Pool({
      connectionString: container.getConnectionUri()
        .replace(/\/\/[^@]+@/, '//ngl_ro:K7nWq2xRt5vLbYcE9mHu@'),
    });
    try {
      const { rows } = await readonly.query('SELECT count(*) FROM v_deliveries');
      expect(Number(rows[0].count)).toBe(0);
    } finally {
      await readonly.end();
    }
  });

  it('refuses a password it cannot quote with certainty', async () => {
    // An apostrophe is the one that would end the literal early. It is refused
    // rather than escaped, and so is everything else outside the alphabet.
    for (const bad of ["hunter2'; DROP TABLE events; --", 'sixteen chars ok', 'a b c d e f g h']) {
      await expect(setReadonlyPassword(pool, bad)).rejects.toThrow(/at least 16 characters/);
    }
  });

  it('refuses a password that is merely short', async () => {
    await expect(setReadonlyPassword(pool, 'short-one')).rejects.toThrow(/at least 16/);
  });

  it('keeps the role read only whatever password it carries', async () => {
    // The password is a lock on the door. The role being unable to write is the
    // reason an open MCP port is safe at all, and moving one must not move
    // the other.
    await setReadonlyPassword(pool, 'Zq4mTp8sVnCk2wXdR6yB');

    const readonly = new Pool({
      connectionString: container.getConnectionUri()
        .replace(/\/\/[^@]+@/, '//ngl_ro:Zq4mTp8sVnCk2wXdR6yB@'),
    });
    try {
      await expect(readonly.query("INSERT INTO events (external_id, kind, payload) "
        + "VALUES ('x', 'order.placed', '{}'::jsonb)")).rejects.toThrow();
    } finally {
      await readonly.end();
    }
  });
});
