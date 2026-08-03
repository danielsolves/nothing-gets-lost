// ui/test/mcp-answer.test.ts
// Reading what the MCP server sent: the same bytes unframed and unescaped, the
// numbers a reader needs for the next call, and what an empty answer means.
//
// The decisive assertions are the ones about what the decoder refuses to do. It adds
// no field, drops no field, and when the bytes are not an answer it can unwrap it
// says so by returning nothing rather than by inventing a tidy rendering. The panel
// prints the raw body either way, so a decoder that guesses would be the one place
// on this page where our word replaced the server's.
import { describe, it, expect } from 'vitest';
import {
  NOTHING_KNOWN, answerNote, idsIn, mergeIds, readAnswer,
} from '../src/mcp-answer';

function textFrame(text: string, extra: Record<string, unknown> = {}): string {
  const envelope = {
    result: { content: [{ type: 'text', text }], ...extra },
    jsonrpc: '2.0',
    id: 1,
  };
  return `event: message\ndata: ${JSON.stringify(envelope)}\n\n`;
}

function frame(payload: unknown): string {
  return textFrame(JSON.stringify(payload, null, 2));
}

const EMPTY_BACKLOG = frame({ total: 0, returned: 0, entries: [] });
const ORDERS = frame({
  total: 8,
  returned: 2,
  orders: [{ orderNumber: 1119, totalCents: 10200 }, { orderNumber: 1118 }],
});
const BACKLOG = frame({
  total: 2,
  returned: 2,
  entries: [{ id: 41, orderNumber: 1117 }, { id: 40, orderNumber: 1116 }],
});

describe('readAnswer', () => {
  it('drops the event-stream framing and unescapes the text the tool returned', () => {
    const read = readAnswer(EMPTY_BACKLOG);
    expect(read.readable).toBe('{\n  "total": 0,\n  "returned": 0,\n  "entries": []\n}');
  });

  it('keeps every field the server sent, and adds none', () => {
    const read = readAnswer(ORDERS);
    expect(read.readable).toContain('"orderNumber": 1119');
    expect(read.readable).toContain('"totalCents": 10200');
    expect(read.readable).not.toContain('event:');
  });

  // A JSON-RPC error, or a 502 from something in front of the server, arrives as
  // plain JSON with no event-stream framing and no content array. It is still an
  // answer and still worth unescaping.
  it('reads a plain JSON body that was never framed', () => {
    const read = readAnswer('{"error":"The MCP server did not answer"}');
    expect(read.readable).toBe('{\n  "error": "The MCP server did not answer"\n}');
  });

  // The refusal a reader gets for a missing argument is not JSON inside the text
  // field, it is a sentence. Printed as it stands rather than dropped.
  it('passes a text answer that is not JSON through as it stands', () => {
    const read = readAnswer(textFrame('MCP error -32602: Required', { isError: true }));
    expect(read.readable).toBe('MCP error -32602: Required');
  });

  it('says nothing when the bytes are not something it can unwrap', () => {
    expect(readAnswer('<html>502 Bad Gateway</html>').readable).toBeNull();
    expect(readAnswer('').readable).toBeNull();
  });

  it('hands back the tool payload so the panel can read numbers out of it', () => {
    expect(readAnswer(ORDERS).payload).toMatchObject({ total: 8 });
  });
});

describe('idsIn', () => {
  it('takes the newest order number from an orders_list answer', () => {
    expect(idsIn(readAnswer(ORDERS).payload).orderNumber).toBe(1119);
  });

  it('takes the delivery id and the order number from a backlog_list answer', () => {
    expect(idsIn(readAnswer(BACKLOG).payload)).toEqual({
      orderNumber: 1117, deliveryId: 41,
    });
  });

  it('finds nothing in an empty list, rather than a number nobody has', () => {
    expect(idsIn(readAnswer(EMPTY_BACKLOG).payload)).toEqual(NOTHING_KNOWN);
  });

  it('finds nothing in an answer it does not recognise', () => {
    expect(idsIn(undefined)).toEqual(NOTHING_KNOWN);
    expect(idsIn({ orders: 'no' })).toEqual(NOTHING_KNOWN);
  });

  // A backlog call after an orders call must not wipe the order number it found: the
  // form fills itself from whatever the reader has actually been shown so far.
  it('keeps what was already known when the newer answer holds nothing', () => {
    const held = { orderNumber: 1119, deliveryId: null };
    expect(mergeIds(held, NOTHING_KNOWN)).toEqual(held);
    expect(mergeIds(held, { orderNumber: 1117, deliveryId: 41 })).toEqual({
      orderNumber: 1117, deliveryId: 41,
    });
  });
});

describe('answerNote', () => {
  // The one this whole file exists for. An empty backlog is the healthy state of the
  // demo and it is what a first visitor sees, so "total: 0" has to read as an answer
  // and as an invitation rather than as a broken call.
  it('says an empty backlog means nothing is parked, and how to fill it', () => {
    const note = answerNote(readAnswer(EMPTY_BACKLOG));
    expect(note).toMatch(/nothing is parked/i);
    expect(note).toMatch(/switch a system off/i);
  });

  it('says an empty order list means none has been placed since the reset', () => {
    const note = answerNote(readAnswer(frame({ total: 0, returned: 0, orders: [] })));
    expect(note).toMatch(/no order/i);
  });

  it('says where the numbers come from when no order carries the one asked for', () => {
    const note = answerNote(readAnswer(frame({ found: false, orderNumber: 9999 })));
    expect(note).toMatch(/no order carries/i);
    expect(note).toMatch(/orders_list/);
  });

  it('says the same for a delivery id nothing is parked under', () => {
    const note = answerNote(readAnswer(frame({ found: false, id: 41 })));
    expect(note).toMatch(/backlog_list/);
  });

  // Pressing Run with an empty box gets a schema error back. It is the server doing
  // its job, and it must not be readable as this console being broken.
  it('says a refusal is the server refusing, not the console failing', () => {
    const note = answerNote(readAnswer(
      textFrame('MCP error -32602: Invalid arguments for tool orders_entry', { isError: true }),
    ));
    expect(note).toMatch(/refused the call/i);
  });

  // An answer with rows in it speaks for itself. A sentence under every one of those
  // would be this page talking over the server again.
  it('stays quiet when the answer has rows in it', () => {
    expect(answerNote(readAnswer(ORDERS))).toBeNull();
    expect(answerNote(readAnswer(BACKLOG))).toBeNull();
    expect(answerNote(readAnswer('<html>502</html>'))).toBeNull();
  });
});
