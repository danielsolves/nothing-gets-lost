// services/mcp/test/http.test.ts
// The port itself: an MCP client speaking the real transport over a real socket,
// plus the four answers that are not MCP at all.
//
// The tools are tested through linked in-memory transports next door. This is here
// because the wiring between them and HTTP is where a stateless streamable transport
// goes wrong: a session id that should not exist, a transport left open between
// requests, a body read twice.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type http from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { z } from 'zod';
import { createMcpHttpServer, TOOL_COUNT } from '../src/http';
import type { BacklogReader } from '../src/tools';

const ENTRY = {
  id: 7,
  eventId: '11111111-2222-3333-4444-555555555555',
  orderNumber: 1007,
  target: 'slack' as const,
  attempts: 6,
  lastError: 'channel_not_found',
  parkedAt: '2026-08-01T09:00:00.000Z',
  customerName: 'B. Krause',
  customerEmail: 'b***@example.com',
  totalCents: 2400,
};

const backlog: BacklogReader = {
  async list() { return [ENTRY]; },
  async count() { return 1; },
  async entry(id) { return id === ENTRY.id ? { ...ENTRY, lines: [] } : null; },
};

/** Narrowed rather than asserted: a server on a pipe has a string address. */
function portOf(listening: http.Server): number {
  const address = listening.address();
  if (address === null || typeof address === 'string') {
    throw new Error('the test server is not listening on a port');
  }
  return address.port;
}

async function listen(listening: http.Server): Promise<string> {
  await new Promise<void>((resolve) => listening.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${portOf(listening)}`;
}

async function stop(listening: http.Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    listening.close((error) => (error ? reject(error) : resolve()));
  });
}

let server: http.Server;
let base: string;

beforeAll(async () => {
  server = createMcpHttpServer({ backlog, rateMax: 50, rateWindowMs: 60_000 });
  base = await listen(server);
});

afterAll(async () => { await stop(server); });

const TEXT_RESULT = z.object({
  content: z.array(z.object({ type: z.literal('text'), text: z.string() })).min(1),
});

describe('the MCP port', () => {
  it('reports its health without being asked to authenticate', async () => {
    const response = await fetch(`${base}/health`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: 'ok', tools: TOOL_COUNT, transport: 'http',
    });
  });

  it('serves the tools over the real transport', async () => {
    const client = new Client({ name: 'test-client', version: '0.0.0' });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`)));

    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual(['backlog_entry', 'backlog_list']);

    const result = TEXT_RESULT.parse(
      await client.callTool({ name: 'backlog_list', arguments: {} }),
    );
    expect(JSON.parse(result.content[0].text)).toEqual({
      total: 1, returned: 1, entries: [ENTRY],
    });

    await client.close();
  });

  // Two clients in a row, because a transport kept between requests would let the
  // second one inherit the first one's session and fail on a mismatched id.
  it('serves a second client after the first has gone', async () => {
    for (const round of [1, 2]) {
      const client = new Client({ name: `client-${round}`, version: '0.0.0' });
      await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`)));
      const { tools } = await client.listTools();
      expect(tools).toHaveLength(TOOL_COUNT);
      await client.close();
    }
  });

  it('says what to do with a GET', async () => {
    const response = await fetch(`${base}/mcp`);
    expect(response.status).toBe(405);
  });

  it('has nothing else on it', async () => {
    const response = await fetch(`${base}/backlog`);
    expect(response.status).toBe(404);
  });

  it('answers a browser asking whether it may call', async () => {
    const response = await fetch(`${base}/mcp`, { method: 'OPTIONS' });
    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
  });

  it('turns a caller away once it has had its window', async () => {
    // A separate server, so the shared one keeps its untouched allowance.
    const strict = createMcpHttpServer({ backlog, rateMax: 2, rateWindowMs: 60_000 });
    const strictBase = await listen(strict);
    const noisy = { 'x-forwarded-for': '9.9.9.9' };

    const statuses: number[] = [];
    while (statuses.length < 3) {
      const response = await fetch(`${strictBase}/mcp`, { method: 'DELETE', headers: noisy });
      statuses.push(response.status);
    }
    expect(statuses).toEqual([200, 200, 429]);

    // Another caller still gets its own allowance.
    const other = await fetch(`${strictBase}/mcp`, {
      method: 'DELETE', headers: { 'x-forwarded-for': '8.8.8.8' },
    });
    expect(other.status).toBe(200);

    // The health check is answered before the limit is counted, so a container is
    // never restarted because a stranger was noisy.
    const health = await fetch(`${strictBase}/health`, { headers: noisy });
    expect(health.status).toBe(200);

    await stop(strict);
  });
});
