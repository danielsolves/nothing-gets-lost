// services/api/test/sql.service.test.ts
// Pins the four defences of the public SQL console against a real Postgres: one
// statement, SELECT only, a row cap, and a role that cannot write or see anything
// but the four views. The last case proves the guard is not the only thing holding.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Pool } from 'pg';
import { runMigrations } from '@ngl/db';
import { SqlService } from '../src/sql.service';

let container: StartedPostgreSqlContainer;
let admin: Pool;
let readonly: Pool;
let service: SqlService;

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine').start();
  admin = new Pool({ connectionString: container.getConnectionUri() });
  await runMigrations(admin);
  readonly = new Pool({
    connectionString: container.getConnectionUri().replace(/\/\/[^:]+:[^@]+@/, '//ngl_ro:ngl_ro@'),
  });
  service = new SqlService(readonly);
}, 120_000);

afterAll(async () => { await admin.end(); await readonly.end(); await container.stop(); });

describe('SqlService', () => {
  it('runs a select against a permitted view', async () => {
    const result = await service.run('SELECT * FROM v_deliveries');
    expect(result.columns).toContain('target');
  });

  it('refuses anything that is not a select', async () => {
    for (const query of [
      "INSERT INTO events (external_id, kind, payload) VALUES ('x','order.placed','{}')",
      'UPDATE deliveries SET state = 1',
      'DELETE FROM events',
      'DROP TABLE events',
      'TRUNCATE events',
      'CREATE TABLE evil (id int)',
    ]) {
      await expect(service.run(query)).rejects.toThrow(/only select/i);
    }
  });

  it('refuses more than one statement', async () => {
    await expect(service.run('SELECT 1; DROP TABLE events'))
      .rejects.toThrow(/one statement/i);
  });

  it('refuses a select on a table that is not one of the four views', async () => {
    await expect(service.run('SELECT * FROM orders')).rejects.toThrow(/permission denied/i);
  });

  it('caps the number of rows and says so', async () => {
    const result = await service.run('SELECT generate_series(1, 500) AS n');
    expect(result.rowCount).toBe(200);
    expect(result.truncated).toBe(true);
  });

  it('aborts a query that runs too long', async () => {
    await expect(service.run('SELECT pg_sleep(5)')).rejects.toThrow(/timeout|canceling/i);
  }, 15_000);

  it('cannot write even when the statement guard is bypassed', async () => {
    // Defence in depth: the role itself is read only, so even a guard bug is contained.
    await expect(readonly.query('DELETE FROM events')).rejects.toThrow(/read-only|permission/i);
  });
});
