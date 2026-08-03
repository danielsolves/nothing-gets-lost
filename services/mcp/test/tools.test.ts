// services/mcp/test/tools.test.ts
// The tools through a real MCP client rather than a spy on the registration.
//
// Registering two names proves nothing a client cares about. A client cares that the
// argument schema accepts what the description told it to send, that the answer comes
// back as text it can read, and that asking for something absent is an answer rather
// than a thrown call. All three go through the protocol here, over a linked pair of
// in-memory transports, so the only thing faked is the database.
import { describe, it, expect } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { Target } from '@ngl/contracts';
import type { BacklogDetail, BacklogEntry } from '../src/backlog.repository';
import { registerBacklogTools, type BacklogReader } from '../src/tools';

const PARKED: BacklogEntry = {
  id: 41,
  eventId: '11111111-2222-3333-4444-555555555555',
  orderNumber: 1042,
  target: 'hubspot',
  attempts: 6,
  lastError: 'ECONNRESET',
  parkedAt: '2026-08-01T10:00:00.000Z',
  customerName: 'R. Vogel',
  customerEmail: 'r***@example.com',
  totalCents: 8400,
};

/** Records what it was asked, so a test can check the arguments arrived. */
function reader(entries: BacklogEntry[] = [PARKED]) {
  const asked: { list: { target?: Target; limit?: number }[]; entry: number[] } = {
    list: [], entry: [],
  };
  const backlog: BacklogReader = {
    async list(options) {
      asked.list.push(options);
      const mine = options.target
        ? entries.filter((entry) => entry.target === options.target)
        : entries;
      return mine.slice(0, options.limit ?? 20);
    },
    async count(target) {
      return target ? entries.filter((entry) => entry.target === target).length : entries.length;
    },
    async entry(id) {
      asked.entry.push(id);
      const found = entries.find((entry) => entry.id === id);
      if (!found) return null;
      const detail: BacklogDetail = { ...found, lines: [{ sku: 'MUG-BLUE', qty: 2 }] };
      return detail;
    },
  };
  return { backlog, asked };
}

const TEXT_RESULT = z.object({
  content: z.array(z.object({ type: z.literal('text'), text: z.string() })).min(1),
});

/**
 * A refused call comes back as an ordinary result carrying isError, not as a thrown
 * request. That is the protocol working: a client is told which argument was wrong
 * and can fix it, rather than losing the connection over a typo.
 */
const REFUSED_RESULT = TEXT_RESULT.extend({ isError: z.literal(true) });

async function connect(backlog: BacklogReader) {
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  registerBacklogTools(server, backlog);
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  await Promise.all([client.connect(clientSide), server.connect(serverSide)]);
  return {
    client,
    async call(name: string, args: Record<string, unknown>): Promise<unknown> {
      const result = TEXT_RESULT.parse(await client.callTool({ name, arguments: args }));
      return JSON.parse(result.content[0].text);
    },
    /** The complaint text of a call the tool would not accept. */
    async refuse(name: string, args: Record<string, unknown>): Promise<string> {
      const result = REFUSED_RESULT.parse(await client.callTool({ name, arguments: args }));
      return result.content[0].text;
    },
    async close() { await client.close(); await server.close(); },
  };
}

describe('the backlog tools', () => {
  it('offers exactly the two read tools', async () => {
    const session = await connect(reader().backlog);
    const { tools } = await session.client.listTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual(['backlog_entry', 'backlog_list']);
    await session.close();
  });

  it('lists what is parked, with the count beside it', async () => {
    const session = await connect(reader().backlog);
    expect(await session.call('backlog_list', {})).toEqual({
      total: 1, returned: 1, entries: [PARKED],
    });
    await session.close();
  });

  it('passes the target and the limit through to the reader', async () => {
    const { backlog, asked } = reader();
    const session = await connect(backlog);
    await session.call('backlog_list', { target: 'hubspot', limit: 5 });
    expect(asked.list).toEqual([{ target: 'hubspot', limit: 5 }]);
    await session.close();
  });

  // The description promises twenty when nobody says. A default the client cannot
  // rely on is worse than no default, because it is invisible until a page is missing.
  it('asks for twenty when no limit is given', async () => {
    const { backlog, asked } = reader();
    const session = await connect(backlog);
    await session.call('backlog_list', {});
    expect(asked.list[0]?.limit).toBe(20);
    await session.close();
  });

  it('refuses a system that does not exist', async () => {
    const session = await connect(reader().backlog);
    const refusal = await session.refuse('backlog_list', { target: 'facebook' });
    expect(refusal).toContain('target');
    await session.close();
  });

  it('refuses a limit above a hundred', async () => {
    const session = await connect(reader().backlog);
    const refusal = await session.refuse('backlog_list', { limit: 500 });
    expect(refusal).toContain('limit');
    await session.close();
  });

  it('gives one entry with the basket behind it', async () => {
    const session = await connect(reader().backlog);
    expect(await session.call('backlog_entry', { id: 41 })).toEqual({
      found: true,
      entry: { ...PARKED, lines: [{ sku: 'MUG-BLUE', qty: 2 }] },
    });
    await session.close();
  });

  it('answers that an id is not parked rather than failing', async () => {
    const session = await connect(reader().backlog);
    expect(await session.call('backlog_entry', { id: 999 })).toEqual({ found: false, id: 999 });
    await session.close();
  });

  it('never hands out an address it was given whole', async () => {
    const session = await connect(reader().backlog);
    const answer = JSON.stringify(await session.call('backlog_list', {}));
    expect(answer).toContain('r***@example.com');
    expect(answer).not.toContain('rita@example.com');
    await session.close();
  });
});
