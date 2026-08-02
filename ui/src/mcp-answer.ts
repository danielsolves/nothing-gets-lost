// ui/src/mcp-answer.ts
// What the MCP server sent, read three ways: the same bytes unframed and unescaped,
// the numbers a reader needs for the next call, and what an empty answer means.
//
// The console prints the response byte for byte and always will. That is the whole
// point of the panel, and it was also unreadable: the tool's answer is a JSON string
// inside a JSON envelope inside an event-stream frame, so a healthy reply arrives as
// two long soft-wrapped lines full of \n. The owner ran it and could not tell an
// answer from a failure.
//
// So the bytes are decoded as well as printed, and this file is the decoding. It
// drops the framing, parses the envelope, and unescapes the string the tool put in
// it. It adds no field, drops no field and reformats nothing else, and when the bytes
// are not something it can unwrap it returns nothing rather than a guess: the panel
// then shows the raw body alone, which is still the answer. A prettier fallback that
// invented structure would be this page's word standing where the server's should be,
// and that is the one thing this panel may not do.
//
// The words for an empty answer are here rather than in the tool catalogue, and they
// are chosen by what the payload holds rather than by which tool was pressed. An
// answer explains itself or it does not; keying the sentence to the button would let
// the console say "nothing is parked" over a reply that never mentioned the backlog.

/** The numbers a reader has been shown and can therefore be offered for a next call. */
export interface KnownIds {
  orderNumber: number | null;
  deliveryId: number | null;
}

export const NOTHING_KNOWN: KnownIds = { orderNumber: null, deliveryId: null };

export interface ReadAnswer {
  /** The same bytes, unframed and unescaped, or null when they do not decode. */
  readable: string | null;
  /** The JSON the tool itself returned, when the text field held JSON. */
  payload: unknown;
}

const NOTHING_READ: ReadAnswer = { readable: null, payload: undefined };

const EMPTY_BACKLOG_NOTE = 'Nothing is parked right now, and that is the healthy '
  + 'answer rather than a failed call: every delivery this workflow took on has gone '
  + 'through. Switch a system off in the machine above and place an order. Its '
  + 'delivery runs out of retries, the queue parks it for a person instead of '
  + 'dropping it, and this same call then lists it.';

const EMPTY_ORDERS_NOTE = 'No order has been taken since the last reset. Place one '
  + 'with the order button above, and this same call lists it with every system it '
  + 'was queued for.';

const NO_SUCH_ORDER_NOTE = 'No order carries that number, which is an answer and not '
  + 'an error. orders_list returns the numbers that exist, newest first, and every '
  + 'card in the queue above prints one.';

const NO_SUCH_ENTRY_NOTE = 'No parked delivery has that id, which is an answer and '
  + 'not an error. backlog_list prints the ids that exist, and on a run where nothing '
  + 'has been broken on purpose there are none.';

const REFUSED_NOTE = 'The server refused the call rather than guessing at what was '
  + 'meant: an argument it needs was missing or was not a number. Its reason is in its '
  + 'own words above, and the line under the form says where to get the number.';

/** The prefix the MCP SDK puts on a tool call it would not run. */
const REFUSAL = 'MCP error';

export function readAnswer(body: string): ReadAnswer {
  const envelope = parseJson(unframe(body));
  if (envelope === undefined) return NOTHING_READ;

  const texts = textsOf(envelope);
  const first = texts[0];
  // No text content: a JSON-RPC error, or something in front of the server answering
  // for it. Still an answer, and worth indenting.
  if (first === undefined) return { readable: pretty(envelope), payload: undefined };

  return { readable: texts.map(unescaped).join('\n\n'), payload: parseJson(first) };
}

/**
 * The newest row's numbers, so the detail tools can offer an argument the reader has
 * actually been shown. A backlog row carries both; an order row carries one.
 */
export function idsIn(payload: unknown): KnownIds {
  const row = firstRow(payload);
  return { orderNumber: numberAt(row, 'orderNumber'), deliveryId: numberAt(row, 'id') };
}

/** What is known after an answer: what it supplied, over what was already there. */
export function mergeIds(held: KnownIds, found: KnownIds): KnownIds {
  return {
    orderNumber: found.orderNumber ?? held.orderNumber,
    deliveryId: found.deliveryId ?? held.deliveryId,
  };
}

/**
 * What an answer with nothing in it means, said beside the answer and never instead
 * of it. An answer with rows in it speaks for itself and gets no sentence: a comment
 * under every reply would be this page talking over the server.
 *
 * A refusal counts as one of these. Pressing Run with an empty box returns a schema
 * error, and a reader who cannot tell that apart from a broken console learns the
 * wrong thing from the one panel built to be checkable.
 */
export function answerNote(read: ReadAnswer): string | null {
  if (read.readable !== null && read.readable.startsWith(REFUSAL)) return REFUSED_NOTE;

  const payload = read.payload;
  if (!isRecord(payload)) return null;

  if (payload.total === 0 && Array.isArray(payload.entries)) return EMPTY_BACKLOG_NOTE;
  if (payload.total === 0 && Array.isArray(payload.orders)) return EMPTY_ORDERS_NOTE;
  if (payload.found === false && typeof payload.orderNumber === 'number') {
    return NO_SUCH_ORDER_NOTE;
  }
  if (payload.found === false && typeof payload.id === 'number') return NO_SUCH_ENTRY_NOTE;

  return null;
}

/**
 * The event-stream framing off, if there is any. A body with no `data:` line is
 * handed back untouched: a JSON-RPC error and anything answering in front of the
 * server arrive as plain JSON, and those are answers too.
 */
function unframe(body: string): string {
  const data = body.split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice('data:'.length).trim());
  return data.length > 0 ? data.join('\n') : body;
}

function textsOf(envelope: unknown): string[] {
  if (!isRecord(envelope)) return [];
  const result = envelope.result;
  if (!isRecord(result)) return [];
  const content = result.content;
  if (!Array.isArray(content)) return [];

  const texts: string[] = [];
  for (const part of content) {
    if (isRecord(part) && typeof part.text === 'string') texts.push(part.text);
  }
  return texts;
}

/** JSON gets indented; anything else is a sentence the server wrote, and stands. */
function unescaped(text: string): string {
  const value = parseJson(text);
  return value === undefined ? text : pretty(value);
}

function firstRow(payload: unknown): unknown {
  if (!isRecord(payload)) return undefined;
  for (const key of ['orders', 'entries']) {
    const rows = payload[key];
    if (Array.isArray(rows) && rows.length > 0) return rows[0];
  }
  return undefined;
}

function numberAt(row: unknown, key: string): number | null {
  if (!isRecord(row)) return null;
  const value = row[key];
  return typeof value === 'number' ? value : null;
}

function pretty(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    // Not JSON. Said by returning nothing, because every caller here has something
    // truthful to do with that and none of them wants an exception.
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
