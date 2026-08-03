// services/mcp/src/http.ts
// The port the MCP client talks to: POST /mcp for the transport, GET /health for
// the container.
//
// A fresh McpServer and a fresh transport per request, with no session id. The
// stateless mode of the streamable transport is what suits this server: it holds no
// conversation, every tool call is a question about the database at that moment, and
// two clients that shared a transport would be a bug waiting for a second visitor.
import http from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { registerBacklogTools, type BacklogReader } from './tools';
import { registerOrderTools, type OrderReader } from './orders.tools';
import { callerOf, RateLimiter } from './rate-limit';

export const SERVER_NAME = 'nothing-gets-lost';
export const TOOL_COUNT = 4;

const DEFAULT_PORT = 3007;
const DEFAULT_RATE_MAX = 60;
const DEFAULT_RATE_WINDOW_MS = 60_000;

/** Everything a fresh server is built from. Two readers today, both read only. */
export interface McpReaders {
  backlog: BacklogReader;
  orders: OrderReader;
}

export interface McpHttpOptions extends McpReaders {
  port?: number;
  host?: string;
  rateMax?: number;
  rateWindowMs?: number;
}

function cors(response: http.ServerResponse): void {
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  response.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, mcp-session-id, mcp-protocol-version',
  );
  response.setHeader('Access-Control-Expose-Headers', 'mcp-session-id, mcp-protocol-version');
}

function sendJson(response: http.ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify(body));
}

/** Built per request. Registration is cheap; a shared one would not be. */
function serverFor(readers: McpReaders): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: '1.0.0' });
  registerBacklogTools(server, readers.backlog);
  registerOrderTools(server, readers.orders);
  return server;
}

export function createMcpHttpServer(options: McpHttpOptions): http.Server {
  const limiter = new RateLimiter({
    max: options.rateMax ?? DEFAULT_RATE_MAX,
    windowMs: options.rateWindowMs ?? DEFAULT_RATE_WINDOW_MS,
  });

  const readers: McpReaders = { backlog: options.backlog, orders: options.orders };

  return http.createServer((request, response) => {
    void handle(request, response, readers, limiter).catch((error: unknown) => {
      console.error('[mcp] request failed', error);
      if (!response.headersSent) sendJson(response, 500, { error: 'Internal error' });
      else response.end();
    });
  });
}

async function handle(
  request: http.IncomingMessage,
  response: http.ServerResponse,
  readers: McpReaders,
  limiter: RateLimiter,
): Promise<void> {
  const url = new URL(request.url ?? '/', 'http://mcp.invalid');
  cors(response);

  if (request.method === 'OPTIONS') {
    response.writeHead(204);
    response.end();
    return;
  }

  // Before the rate limit, so a container health check can never be throttled out.
  if (url.pathname === '/health') {
    sendJson(response, 200, { status: 'ok', tools: TOOL_COUNT, transport: 'http' });
    return;
  }

  if (!limiter.allow(callerOf(request.headers, request.socket.remoteAddress))) {
    sendJson(response, 429, { error: 'Too many requests' });
    return;
  }

  if (url.pathname !== '/mcp' && url.pathname !== '/') {
    sendJson(response, 404, { error: 'Not found' });
    return;
  }

  if (request.method === 'DELETE') {
    // Nothing to tear down, because nothing was kept. Answered rather than refused,
    // so a client that closes politely is not told it did something wrong.
    sendJson(response, 200, { status: 'ok' });
    return;
  }

  if (request.method !== 'POST') {
    sendJson(response, 405, { error: 'Use POST to talk to this MCP server' });
    return;
  }

  const server = serverFor(readers);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  try {
    await server.connect(transport);
    await transport.handleRequest(request, response);
  } finally {
    await transport.close();
    await server.close();
  }
}

export function startMcpHttpServer(options: McpHttpOptions): http.Server {
  const server = createMcpHttpServer(options);
  server.listen(options.port ?? DEFAULT_PORT, options.host ?? '0.0.0.0');
  return server;
}
