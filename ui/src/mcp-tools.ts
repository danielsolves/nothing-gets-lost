// ui/src/mcp-tools.ts
// The four tools the MCP server registers, described well enough for the page to
// draw a form for each and build the call from what the form holds.
//
// It is a second copy of a schema the server already publishes, and the obvious
// alternative was to fetch tools/list on mount and render the JSON Schema that comes
// back. That was rejected: the schema says an argument is an integer between 1 and
// 100, and it does not say that the field should be called "How many" or that
// leaving the target unset means every system. Generating a form from it produces
// labels like "limit" and a reader who has to guess. Two of the four tools also take
// an id the reader has to have got from the other two, and only prose can say so.
//
// What is not copied is the vocabulary. The systems come from the shared contract,
// because a list of target names written out here would be the one that goes stale.
//
// Nothing in this file can describe a tool that writes, because the server has none.
// If one ever arrives it arrives behind a key, and not by being added here.
import { TARGETS } from '@ngl/contracts';

export type McpToolName = 'backlog_list' | 'backlog_entry' | 'orders_list' | 'orders_entry';

export interface NumberField {
  kind: 'number';
  name: string;
  label: string;
  min: number;
  max?: number;
  initial: string;
  /** What the number means, where the label has no room to say it. */
  hint?: string;
}

export interface ChoiceField {
  kind: 'choice';
  name: string;
  label: string;
  options: readonly { value: string; label: string }[];
  initial: string;
  hint?: string;
}

export type McpField = NumberField | ChoiceField;

export interface McpTool {
  name: McpToolName;
  /** One sentence, shown under the picker once the tool is chosen. */
  summary: string;
  fields: readonly McpField[];
}

/** Empty first, because the server treats a missing target as every system. */
const TARGET_OPTIONS = [
  { value: '', label: 'Every system' },
  ...TARGETS.map((target) => ({ value: target, label: target })),
];

const LIMIT_FIELD: NumberField = {
  kind: 'number',
  name: 'limit',
  label: 'How many',
  min: 1,
  max: 100,
  initial: '20',
  hint: '1 to 100',
};

export const BACKLOG_LIST: McpTool = {
  name: 'backlog_list',
  summary: 'Deliveries this workflow could not complete and has parked for a person to '
    + 'review. Each one has used up its retries, so nothing moves it on its own.',
  fields: [
    {
      kind: 'choice',
      name: 'target',
      label: 'System',
      options: TARGET_OPTIONS,
      initial: '',
    },
    LIMIT_FIELD,
  ],
};

export const BACKLOG_ENTRY: McpTool = {
  name: 'backlog_entry',
  summary: 'One parked delivery in full, with the order behind it and what was in the '
    + 'basket. The id is the one backlog_list prints.',
  fields: [
    { kind: 'number', name: 'id', label: 'Delivery id', min: 1, initial: '1' },
  ],
};

export const ORDERS_LIST: McpTool = {
  name: 'orders_list',
  summary: 'Orders already taken, newest first: the basket as it was priced at the '
    + 'time, what was charged, and how every system it was queued for fared.',
  fields: [LIMIT_FIELD],
};

export const ORDERS_ENTRY: McpTool = {
  name: 'orders_entry',
  summary: 'One order, found by the number printed on the card a visitor can read out '
    + 'loud. No customer name and no address, for any order.',
  fields: [
    { kind: 'number', name: 'orderNumber', label: 'Order number', min: 1, initial: '1' },
  ],
};

export const MCP_TOOLS: readonly McpTool[] = [
  BACKLOG_LIST, BACKLOG_ENTRY, ORDERS_LIST, ORDERS_ENTRY,
];

export type FieldValues = Readonly<Record<string, string>>;

export function initialValues(tool: McpTool): FieldValues {
  return Object.fromEntries(tool.fields.map((field) => [field.name, field.initial]));
}

export interface McpCallRequest {
  jsonrpc: '2.0';
  id: number;
  method: 'tools/call';
  params: { name: McpToolName; arguments: Record<string, string | number> };
}

/**
 * The exact request the page posts.
 *
 * A field left blank is left out rather than sent as an empty string: the server has
 * a default for the limit and reads a missing target as every system, and "" would
 * turn both of those into a schema error the reader would have to decode.
 *
 * Something typed into a number field that is not a number goes as it was typed. The
 * temptation is to correct it here, and correcting it would hide the server's own
 * refusal, which is the one thing this panel exists to show.
 */
export function callRequest(
  tool: McpTool, values: FieldValues, id: number,
): McpCallRequest {
  const args: Record<string, string | number> = {};

  for (const field of tool.fields) {
    const typed = (values[field.name] ?? '').trim();
    if (typed === '') continue;

    if (field.kind === 'number') {
      const parsed = Number(typed);
      args[field.name] = Number.isFinite(parsed) ? parsed : typed;
      continue;
    }

    args[field.name] = typed;
  }

  return { jsonrpc: '2.0', id, method: 'tools/call', params: { name: tool.name, arguments: args } };
}
