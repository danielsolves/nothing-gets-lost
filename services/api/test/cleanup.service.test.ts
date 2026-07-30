// services/api/test/cleanup.service.test.ts
// Pins the nightly tidy-up of spec 14: a visitor's address is gone a day later,
// a fresh one is untouched, the order row itself survives, and lapsed OAuth
// tokens leave the disk rather than merely being ignored.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Pool } from 'pg';
import { runMigrations } from '@ngl/db';
import { CleanupService } from '../src/cleanup.service';

let container: StartedPostgreSqlContainer;
let pool: Pool;
let cleanup: CleanupService;

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine').start();
  pool = new Pool({ connectionString: container.getConnectionUri() });
  await runMigrations(pool);
  cleanup = new CleanupService(pool);
}, 120_000);

afterAll(async () => { await pool.end(); await container.stop(); });
beforeEach(async () => { await pool.query('TRUNCATE events CASCADE; TRUNCATE oauth_tokens;'); });

async function seedOrder(ageHours: number): Promise<void> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO events (external_id, kind, payload)
     VALUES ('evt_' || gen_random_uuid(), 'order.placed', '{}'::jsonb) RETURNING id`,
  );
  await pool.query(
    `INSERT INTO orders (event_id, customer_name, customer_email, items, total_cents,
                         source, created_at)
     VALUES ($1, 'M. Berger', 'private@example.com', '[]'::jsonb, 100, 'form',
             now() - make_interval(hours => $2))`,
    [rows[0].id, ageHours],
  );
}

describe('CleanupService', () => {
  it('erases email addresses older than a day', async () => {
    await seedOrder(30);
    expect(await cleanup.run()).toBeGreaterThan(0);
    const { rows } = await pool.query('SELECT customer_email FROM orders');
    expect(rows[0].customer_email).toBe('[deleted]');
  });

  it('leaves recent orders alone', async () => {
    await seedOrder(2);
    await cleanup.run();
    const { rows } = await pool.query('SELECT customer_email FROM orders');
    expect(rows[0].customer_email).toBe('private@example.com');
  });

  it('keeps the order itself, only the address goes', async () => {
    await seedOrder(30);
    await cleanup.run();
    const { rows } = await pool.query('SELECT count(*) FROM orders');
    expect(Number(rows[0].count)).toBe(1);
  });

  it('purges expired oauth tokens', async () => {
    await pool.query(
      `INSERT INTO oauth_tokens (provider, encrypted, iv, auth_tag, expires_at)
       VALUES ('slack', '\\x00', '\\x00', '\\x00', now() - interval '1 hour')`,
    );
    await cleanup.run();
    const { rows } = await pool.query('SELECT count(*) FROM oauth_tokens');
    expect(Number(rows[0].count)).toBe(0);
  });
});
