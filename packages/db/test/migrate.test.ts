// packages/db/test/migrate.test.ts
// Proves the migration runner creates every table the spec requires and that a
// second run is a no-op — a restarting container must not fail on its own schema.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Pool } from 'pg';
import { runMigrations } from '../src/migrate';

let container: StartedPostgreSqlContainer;
let pool: Pool;

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine').start();
  pool = new Pool({ connectionString: container.getConnectionUri() });
  await runMigrations(pool);
}, 120_000);

afterAll(async () => {
  await pool.end();
  await container.stop();
});

describe('migrations', () => {
  it('creates every table the spec requires', async () => {
    const { rows } = await pool.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`,
    );
    const names = rows.map((r) => r.table_name).sort();
    expect(names).toEqual([
      'custom_webhook', 'deliveries', 'dropped_duplicates', 'events', 'invoices',
      'oauth_tokens', 'orders', 'products', 'rate_limits', 'schema_migrations',
      'sent_mail', 'switches',
    ]);
  });

  it('is idempotent', async () => {
    await expect(runMigrations(pool)).resolves.not.toThrow();
  });
});
