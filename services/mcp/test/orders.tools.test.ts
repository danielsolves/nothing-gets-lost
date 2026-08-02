// services/mcp/test/orders.tools.test.ts
// The order tools through a real MCP client, the same way the backlog tools are
// tested next door: a linked pair of in-memory transports, with the database as the
// only faked thing.
//
// What is checked here is the contract a client depends on. The argument schema
// accepts what the description asked for, a limit nobody gave is the one the
// description promised, a number no order carries comes back as an ordinary answer
// rather than a thrown call, and an argument out of range is refused by name.
//
// The proof that no identity can leave through these tools is deliberately not here.
// It cannot be: this reader hands back whatever the fixture holds, so an assertion
// against it would only be testing the fixture. It lives in orders.repository.test.ts,
// where a real order is placed by the real service and read back through the real
// read-only role.
import { describe, it, expect } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { PastOrder } from '../src/orders.repository';
import { registerOrderTools, type OrderReader } from '../src/orders.tools';

const ORDER: PastOrder = {
  orderNumber: 1042,
  eventId: '11111111-2222-3333-4444-555555555555',
  receivedAt: '2026-08-01T10:00:00.000Z',
  totalCents: 7300,
  lines: [
    { sku: 'MUG-BLUE', name: 'Blue mug', qty: 2, cents: 2400 },
    { sku: 'TEAPOT', name: 'Teapot', qty: 1, cents: 4900 },
  ],
  deliveries: [
    { target: 'stripe', state: 'done', attempts: 1, remoteRef: 'pi_1' },
    { target: 'hubspot', state: 'done', attempts: 2, remoteRef: 'contact-7' },
    { target: 'ledger', state: 'done', attempts: 1, remoteRef: 'INV-1000' },
    { target: 'slack', state: 'done', attempts: 1, remoteRef: '1754040000.1' },
    { target: 'mailer', state: 'dead', attempts: 6, remoteRef: null },
  ],
};

const OLDER: PastOrder = { ...ORDER, orderNumber: 1041, lines: [], deliveries: [] };

/** Records what it was asked, so a test can check the arguments arrived. */
function reader(orders: PastOrder[] = [ORDER, OLDER]) {
  const asked: { list: { limit?: number }[]; byNumber: number[] } = { list: [], byNumber: [] };
  const past: OrderReader = {
    async list(options) {
      asked.list.push(options);
      return orders.slice(0, options.limit ?? 20);
    },
    async count() { return orders.length; },
    async byNumber(orderNumber) {
      asked.byNumber.push(orderNumber);
      return orders.find((order) => order.orderNumber === orderNumber) ?? null;
    },
  };
  return { past, asked };
}

const TEXT_RESULT = z.object({
  content: z.array(z.object({ type: z.literal('text'), text: z.string() })).min(1),
});

/** A refused call is an ordinary result carrying isError, never a thrown request. */
const REFUSED_RESULT = TEXT_RESULT.extend({ isError: z.literal(true) });

async function connect(past: OrderReader) {
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  registerOrderTools(server, past);
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

describe('the order tools', () => {
  it('offers exactly the two read tools', async () => {
    const session = await connect(reader().past);
    const { tools } = await session.client.listTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual(['orders_entry', 'orders_list']);
    await session.close();
  });

  it('lists what was ordered, with the count beside it', async () => {
    const session = await connect(reader().past);
    expect(await session.call('orders_list', {})).toEqual({
      total: 2, returned: 2, orders: [ORDER, OLDER],
    });
    await session.close();
  });

  it('passes the limit through to the reader', async () => {
    const { past, asked } = reader();
    const session = await connect(past);
    await session.call('orders_list', { limit: 1 });
    expect(asked.list).toEqual([{ limit: 1 }]);
    await session.close();
  });

  // The description promises twenty when nobody says. A default the client cannot
  // rely on is worse than no default, because it is invisible until a page is missing.
  it('asks for twenty when no limit is given', async () => {
    const { past, asked } = reader();
    const session = await connect(past);
    await session.call('orders_list', {});
    expect(asked.list[0]?.limit).toBe(20);
    await session.close();
  });

  it('refuses a limit above a hundred', async () => {
    const session = await connect(reader().past);
    expect(await session.refuse('orders_list', { limit: 500 })).toContain('limit');
    await session.close();
  });

  it('gives one order by the number the visitor was shown', async () => {
    const session = await connect(reader().past);
    expect(await session.call('orders_entry', { orderNumber: 1042 })).toEqual({
      found: true, order: ORDER,
    });
    await session.close();
  });

  it('answers that no order carries a number rather than failing', async () => {
    const session = await connect(reader().past);
    expect(await session.call('orders_entry', { orderNumber: 999 })).toEqual({
      found: false, orderNumber: 999,
    });
    await session.close();
  });

  it('refuses a number that could not be an order number', async () => {
    const session = await connect(reader().past);
    expect(await session.refuse('orders_entry', { orderNumber: -3 })).toContain('orderNumber');
    await session.close();
  });

  // The four fields a delivery reports, and the fifth it does not. last_error is on
  // the view and the backlog tools do return it; here it would be a third party's
  // sentence about an order, free to quote whatever value it disliked.
  it('reports every system that was queued, with its reference where there is one', async () => {
    const session = await connect(reader().past);
    const answer = await session.call('orders_entry', { orderNumber: 1042 });
    const { order } = z.object({
      order: z.object({
        deliveries: z.array(z.object({
          target: z.string(), state: z.string(),
          attempts: z.number(), remoteRef: z.string().nullable(),
        }).strict()),
      }),
    }).parse(answer);
    expect(order.deliveries.map((delivery) => delivery.target)).toEqual(
      ['stripe', 'hubspot', 'ledger', 'slack', 'mailer'],
    );
    expect(order.deliveries.at(-1)?.remoteRef).toBeNull();
    await session.close();
  });
});
