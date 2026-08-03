// services/api/test/autoreset.service.test.ts
// Pins the ten quiet minutes after which the demo repairs itself: an untouched
// outage is undone, a fresh one is left alone, and quiet is measured from the
// most recent flip rather than the oldest.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Pool } from 'pg';
import { runMigrations } from '@ngl/db';
import { AutoResetService } from '../src/autoreset.service';

let container: StartedPostgreSqlContainer;
let pool: Pool;
let autoReset: AutoResetService;

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine').start();
  pool = new Pool({ connectionString: container.getConnectionUri() });
  await runMigrations(pool);
  autoReset = new AutoResetService(pool);
}, 120_000);

afterAll(async () => { await pool.end(); await container.stop(); });
beforeEach(async () => { await pool.query(`UPDATE switches SET state = 'up', changed_at = now()`); });

describe('AutoResetService', () => {
  it('does nothing while everything is already up', async () => {
    expect(await autoReset.tick(new Date())).toBe(false);
  });

  it('leaves a recent change alone', async () => {
    await pool.query(`UPDATE switches SET state = 'cut', changed_at = now() WHERE target = 'hubspot'`);
    expect(await autoReset.tick(new Date())).toBe(false);
    const { rows } = await pool.query(`SELECT state FROM switches WHERE target = 'hubspot'`);
    expect(rows[0].state).toBe('cut');
  });

  it('restores everything after ten quiet minutes', async () => {
    await pool.query(
      `UPDATE switches SET state = 'cut', changed_at = now() - interval '11 minutes'
        WHERE target = 'hubspot'`,
    );
    expect(await autoReset.tick(new Date())).toBe(true);
    const { rows } = await pool.query(`SELECT state FROM switches WHERE target = 'hubspot'`);
    expect(rows[0].state).toBe('up');
  });

  it('measures quiet from the most recent change, not the oldest', async () => {
    await pool.query(
      `UPDATE switches SET state = 'cut', changed_at = now() - interval '11 minutes'
        WHERE target = 'hubspot'`,
    );
    await pool.query(
      `UPDATE switches SET state = 'slow', changed_at = now() WHERE target = 'slack'`,
    );
    expect(await autoReset.tick(new Date())).toBe(false);
  });
});
