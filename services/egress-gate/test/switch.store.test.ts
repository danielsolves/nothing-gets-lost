// services/egress-gate/test/switch.store.test.ts
// Drives the switch store against a real Postgres, because the switch states live in
// the database and the control panel in task 19 reads them back from there.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Pool } from 'pg';
import { runMigrations } from '@ngl/db';
import { SwitchStore } from '../src/switch.store';

let container: StartedPostgreSqlContainer;
let pool: Pool;
let store: SwitchStore;

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine').start();
  pool = new Pool({ connectionString: container.getConnectionUri() });
  await runMigrations(pool);
  store = new SwitchStore(pool);
}, 120_000);

afterAll(async () => { await pool.end(); await container.stop(); });
beforeEach(async () => { await store.resetAll(); });

describe('SwitchStore', () => {
  it('starts with every target up', async () => {
    expect(await store.all()).toEqual({
      hubspot: 'up', stripe: 'up', paypal: 'up', slack: 'up', ledger: 'up',
      mailer: 'up',
    });
  });

  it('stores and reads a switch state', async () => {
    await store.set('hubspot', 'cut');
    expect(await store.get('hubspot')).toBe('cut');
    expect(await store.get('slack')).toBe('up');
  });

  it('resets everything back to up', async () => {
    await store.set('hubspot', 'cut');
    await store.set('ledger', 'slow');
    await store.resetAll();
    expect(await store.all()).toEqual({
      hubspot: 'up', stripe: 'up', paypal: 'up', slack: 'up', ledger: 'up',
      mailer: 'up',
    });
  });

  it('reports when a switch was last touched, for the ten-minute auto-reset', async () => {
    const before = await store.lastChangeAt();
    await store.set('slack', 'error');
    const after = await store.lastChangeAt();
    expect(after.getTime()).toBeGreaterThanOrEqual(before.getTime());
  });
});
