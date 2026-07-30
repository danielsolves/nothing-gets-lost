// packages/db/src/pool.ts
// Single Postgres pool for every service. Services never construct their own —
// one pool per process keeps connection counts predictable in docker compose.
import { Pool } from 'pg';

let pool: Pool | undefined;

export function getPool(): Pool {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error('DATABASE_URL is not set');
    pool = new Pool({ connectionString, max: 10 });
  }
  return pool;
}
