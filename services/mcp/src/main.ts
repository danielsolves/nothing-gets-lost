// services/mcp/src/main.ts
// The MCP server as a process: one read-only pool, the backlog tools, one port.
//
// It builds its own pool rather than calling getPool() like every other service,
// and that is the whole point of the service: getPool() returns the connection the
// application writes with. This one connects as ngl_ro, so the strongest sentence
// about this open port is not "it has no write tools" but "it holds no credential
// that could write".
import { Pool } from 'pg';
import { BacklogRepository } from './backlog.repository';
import { OrdersRepository } from './orders.repository';
import { startMcpHttpServer } from './http';

const POOL_MAX = 4;
const PORT = Number(process.env.MCP_PORT ?? 3007);

function readonlyPool(): Pool {
  const connectionString = process.env.DATABASE_URL_READONLY;
  if (!connectionString) throw new Error('DATABASE_URL_READONLY is not set');
  return new Pool({ connectionString, max: POOL_MAX });
}

const pool = readonlyPool();
const server = startMcpHttpServer({
  backlog: new BacklogRepository(pool),
  orders: new OrdersRepository(pool),
  port: PORT,
});

console.log(`[mcp] backlog and order tools on :${PORT}/mcp`);

const shutdown = (): void => {
  server.close(() => {
    void pool.end().then(() => process.exit(0));
  });
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
