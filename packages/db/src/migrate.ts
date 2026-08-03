// packages/db/src/migrate.ts
// Applies every .sql file in migrations/ once, in filename order, inside a
// transaction. Records applied files so a restart is a no-op. Also runnable
// directly (`npm run migrate`), which is how docker compose seeds the database.
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Pool } from 'pg';

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

export async function runMigrations(pool: Pool): Promise<void> {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       filename text PRIMARY KEY,
       applied_at timestamptz NOT NULL DEFAULT now())`,
  );
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
  for (const filename of files) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rowCount } = await client.query(
        'SELECT 1 FROM schema_migrations WHERE filename = $1', [filename],
      );
      if (rowCount === 0) {
        await client.query(readFileSync(join(MIGRATIONS_DIR, filename), 'utf8'));
        await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [filename]);
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw new Error(`Migration ${filename} failed: ${(error as Error).message}`);
    } finally {
      client.release();
    }
  }
}

/**
 * The read-only role's real password, from the environment rather than the repository.
 *
 * Migration 005 creates `ngl_ro` with a password anyone can read in the checkout,
 * which is right for a demo somebody clones and wrong for a public host. Migrations
 * are never edited once applied and cannot read the environment anyway, so the real
 * one is set here, after them, every time the migrator runs. Unset leaves the demo
 * password standing, which is what a local checkout wants.
 *
 * ALTER ROLE takes no bind parameters, so the value is inlined. It is checked against
 * a conservative alphabet first rather than escaped and hoped for: a password this
 * process cannot quote with certainty is a password that should not reach the
 * database, and saying so beats being clever about apostrophes.
 */
export async function setReadonlyPassword(
  pool: Pool, password: string | undefined,
): Promise<void> {
  if (!password) return;
  if (!/^[A-Za-z0-9_.~-]{16,}$/.test(password)) {
    throw new Error(
      'DATABASE_READONLY_PASSWORD must be at least 16 characters of letters, digits, '
      + 'underscore, dot, tilde or hyphen',
    );
  }
  await pool.query(`ALTER ROLE ngl_ro PASSWORD '${password}'`);
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  const { getPool } = await import('./pool');
  const pool = getPool();
  try {
    await runMigrations(pool);
    await setReadonlyPassword(pool, process.env.DATABASE_READONLY_PASSWORD);
  } finally {
    await pool.end();
  }
}
