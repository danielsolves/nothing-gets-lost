// services/mcp/src/orders.tools.ts
// The two tools that read the order history, and neither of them writes either.
//
// A file of its own rather than two more registrations in tools.ts, which is about
// the backlog and says so in its first line. The two surfaces are read by different
// people for different reasons: the backlog is a worklist, this is a receipt book.
//
// Both tools answer the same shape, and the list holds nothing back. The obvious
// alternative was a thin summary per row with the basket and the deliveries only on
// the detail tool, and it was rejected: a reader who wants to know what happened to
// last night's orders would then call the second tool once per row, and two shapes
// of the same order are two descriptions that have to be kept true of each other.
//
// The descriptions say what is not in the answer as well as what is. A client that
// has to discover by experiment that there is no customer name will ask for one.
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { PastOrder } from './orders.repository';

/** What the tools need. The repository satisfies it; a test can too. */
export interface OrderReader {
  list(options: { limit?: number }): Promise<PastOrder[]>;
  count(): Promise<number>;
  byNumber(orderNumber: number): Promise<PastOrder | null>;
}

const WITHOUT_IDENTITY = 'The customer name and the address a visitor typed are never '
  + 'part of the answer, for any order.';

export function registerOrderTools(server: McpServer, orders: OrderReader): void {
  server.tool(
    'orders_list',
    'Orders this workflow has already taken, newest first. Each one carries the '
    + 'number the visitor was shown, when it arrived, the basket as it was priced at '
    + 'the time, the total that was charged, and how every system it was queued for '
    + 'fared. Returns how many orders exist and that many of the newest. '
    + WITHOUT_IDENTITY,
    {
      limit: z.number().int().min(1).max(100).default(20)
        .describe('How many orders to return (1-100)'),
    },
    async ({ limit }) => {
      const [past, total] = await Promise.all([orders.list({ limit }), orders.count()]);
      return json({ total, returned: past.length, orders: past });
    },
  );

  server.tool(
    'orders_entry',
    'One order in full, found by the number printed on the card a visitor can read '
    + 'out loud. Same shape as one row of orders_list. ' + WITHOUT_IDENTITY,
    {
      orderNumber: z.number().int().positive()
        .describe('The visitor-facing order number, as listed by orders_list'),
    },
    async ({ orderNumber }) => {
      const order = await orders.byNumber(orderNumber);
      if (order === null) {
        // Not an error. "No order carries the number 999" is an answer, and a client
        // that gets a thrown tool call cannot tell it from a broken server.
        return json({ found: false, orderNumber });
      }
      return json({ found: true, order });
    },
  );
}

function json(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
}
