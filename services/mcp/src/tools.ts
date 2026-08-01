// services/mcp/src/tools.ts
// The two tools this server offers, and nothing that writes.
//
// The page claims that a delivery which cannot be made is not dropped but parked for
// a person. A claim like that is worth as much as the reader's ability to check it,
// so the backlog is readable two ways that do not go through the page at all: as SQL
// against v_backlog in the console, and as these tools from any MCP client.
//
// Read only, on purpose and not only for now. Putting a delivery back in the queue is
// a real button that belongs to whoever runs this demo, and an open port that any
// client can use to move other visitors' work is a different thing from an open port
// that answers questions. If a retry tool ever arrives it arrives behind a key.
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { TARGETS, type Target } from '@ngl/contracts';
import { z } from 'zod';
import type { BacklogDetail, BacklogEntry } from './backlog.repository';

/** What the tools need. The repository satisfies it; a test can too. */
export interface BacklogReader {
  list(options: { target?: Target; limit?: number }): Promise<BacklogEntry[]>;
  count(target?: Target): Promise<number>;
  entry(id: number): Promise<BacklogDetail | null>;
}

const targetArg = z.enum(TARGETS)
  .describe('Only deliveries to this system, e.g. "hubspot"');

export function registerBacklogTools(server: McpServer, backlog: BacklogReader): void {
  server.tool(
    'backlog_list',
    'Deliveries this workflow could not complete and has parked for a person to '
    + 'review. Each one has used up its retries, so nothing moves it on its own. '
    + 'Returns how many are waiting and the oldest of them first.',
    {
      target: targetArg.optional(),
      limit: z.number().int().min(1).max(100).default(20)
        .describe('How many entries to return (1-100)'),
    },
    async ({ target, limit }) => {
      const [entries, total] = await Promise.all([
        backlog.list({ target, limit }),
        backlog.count(target),
      ]);
      return json({ total, returned: entries.length, entries });
    },
  );

  server.tool(
    'backlog_entry',
    'One parked delivery in full, with the order behind it and what was in the '
    + 'basket. Takes the delivery id from backlog_list.',
    { id: z.number().int().positive().describe('Delivery id, as listed by backlog_list') },
    async ({ id }) => {
      const entry = await backlog.entry(id);
      if (entry === null) {
        // Not an error. "There is no delivery 41 in the backlog" is an answer, and a
        // client that gets a thrown tool call cannot tell it from a broken server.
        return json({ found: false, id });
      }
      return json({ found: true, entry });
    },
  );
}

function json(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
}
