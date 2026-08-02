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
// The order is this file's decision, and it is not the order the server registers
// them in. The owner met backlog_list first, on a healthy demo where the backlog is
// empty, and read the true answer "total: 0" as a broken console. orders_list leads
// now, because it answers with rows on any run of this demo, and orders_entry follows
// it because the number one prints is the argument the other takes. The backlog pair
// comes after, in the same list-then-detail shape, and by then the reader has seen
// what an answer from this server looks like.
//
// Two arguments a reader cannot guess are no longer guessed for them. "Order number:
// 1" was a default that answers found: false on every run of this demo, which teaches
// a reader that the console is broken. Those fields start empty and fill themselves
// from the newest row of the list answer the reader has just read, and the panel says
// where the number came from.
//
// What is not copied is the vocabulary. The systems come from the shared contract,
// because a list of target names written out here would be the one that goes stale.
//
// Nothing in this file can describe a tool that writes, because the server has none.
// If one ever arrives it arrives behind a key, and not by being added here.
import { TARGETS } from '@ngl/contracts';
import { NOTHING_KNOWN, type KnownIds } from './mcp-answer';

export type McpToolName = 'backlog_list' | 'backlog_entry' | 'orders_list' | 'orders_entry';

/** Where the number in a box came from, for a field the reader cannot fill by guessing. */
export interface FedBy {
  /** Which number a previous answer supplies. */
  from: keyof KnownIds;
  /** Said under the form: what is in the box and where it came from, or where to look. */
  note: (value: number | null) => string;
}

export interface NumberField {
  kind: 'number';
  name: string;
  label: string;
  min: number;
  max?: number;
  initial: string;
  /** What the number means, where the label has no room to say it. */
  hint?: string;
  fed?: FedBy;
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

function limitField(initial: string): NumberField {
  return {
    kind: 'number', name: 'limit', label: 'How many',
    min: 1, max: 100, initial, hint: '1 to 100',
  };
}

export const ORDERS_LIST: McpTool = {
  name: 'orders_list',
  summary: 'Orders already taken, newest first: the basket as it was priced at the '
    + 'time, what was charged, and how every system it was queued for fared.',
  // Three rather than the twenty the server would default to. Each order carries its
  // basket and five deliveries, so twenty is a wall of escaped JSON nobody reads. The
  // number is on screen and goes out in the request, so a reader who wants twenty
  // types twenty and can see that they did.
  fields: [limitField('3')],
};

export const ORDERS_ENTRY: McpTool = {
  name: 'orders_entry',
  summary: 'One order, found by the number printed on the card a visitor can read out '
    + 'loud. No customer name and no address, for any order.',
  fields: [
    {
      kind: 'number', name: 'orderNumber', label: 'Order number', min: 1, initial: '',
      fed: {
        from: 'orderNumber',
        note: (value) => (value === null
          ? 'Run orders_list first and the newest number it returns arrives here filled '
            + 'in. Any number printed on an order card in the queue above works too.'
          : `${value} is the newest order number in the orders_list answer you just `
            + 'read. Any other number printed on a card in the queue above works too.'),
      },
    },
  ],
};

export const BACKLOG_LIST: McpTool = {
  name: 'backlog_list',
  summary: 'Deliveries this workflow could not complete and has parked for a person to '
    + 'review. Each one has used up its retries, so nothing moves it on its own.',
  fields: [
    {
      kind: 'choice',
      name: 'target',
      // The owner read "System: Every system" as a question he had to answer before
      // running anything. The field stays, because the server takes the argument and
      // a console that quietly drops arguments is another layer of ours between the
      // reader and the server, but it now says on its face that it can be left alone,
      // and it is no longer on the tool a reader meets first.
      label: 'System filter',
      hint: 'optional',
      options: TARGET_OPTIONS,
      initial: '',
    },
    limitField('20'),
  ],
};

export const BACKLOG_ENTRY: McpTool = {
  name: 'backlog_entry',
  summary: 'One parked delivery in full, with the order behind it and what was in the '
    + 'basket. The id is the one backlog_list prints.',
  fields: [
    {
      kind: 'number', name: 'id', label: 'Delivery id', min: 1, initial: '',
      fed: {
        from: 'deliveryId',
        note: (value) => (value === null
          ? 'Run backlog_list first: the ids it prints are the ones this tool takes. '
            + 'Until a system is switched off in the machine above there are none.'
          : `${value} is the first delivery id in the backlog_list answer above.`),
      },
    },
  ],
};

export const MCP_TOOLS: readonly McpTool[] = [
  ORDERS_LIST, ORDERS_ENTRY, BACKLOG_LIST, BACKLOG_ENTRY,
];

export type FieldValues = Readonly<Record<string, string>>;

/**
 * What the form holds when a tool is chosen. A fed field takes the number the reader
 * has already been shown, and stays empty when there is none: an invented default is
 * a guess wearing the clothes of an answer.
 */
export function initialValues(tool: McpTool, known: KnownIds = NOTHING_KNOWN): FieldValues {
  return Object.fromEntries(tool.fields.map((field) => {
    if (field.kind === 'number' && field.fed !== undefined) {
      const value = known[field.fed.from];
      return [field.name, value === null ? field.initial : String(value)];
    }
    return [field.name, field.initial];
  }));
}

/** Where the number in the box came from, for the tools that take one. */
export function provenance(tool: McpTool, known: KnownIds): string | null {
  for (const field of tool.fields) {
    if (field.kind === 'number' && field.fed !== undefined) {
      return field.fed.note(known[field.fed.from]);
    }
  }
  return null;
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
