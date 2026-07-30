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

const invokedDirectly =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  const { getPool } = await import('./pool');
  const pool = getPool();
  try {
    await runMigrations(pool);
  } finally {
    await pool.end();
  }
}
