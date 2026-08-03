// ui/test/mcp-tools.test.ts
// The catalogue the panel offers, the order it offers it in, and the request it
// builds from a filled-in form.
//
// The assertions that matter are about what is left out. An argument the visitor did
// not fill in must not be sent as an empty string: the server has a default for the
// limit and treats a missing target as "every system", and sending "" would turn both
// of those into a validation error the reader would have to interpret.
//
// The other one is types. Every numeric argument on this server is declared as an
// integer, and a form hands back strings, so a request that forwards what the input
// held is refused by the schema before it reaches the database.
//
// The order is pinned too, and it is not the order the server registers them in. The
// owner met backlog_list first, on a healthy demo where the backlog is empty, and
// read "total: 0" as a broken console. The two order tools answer with rows on any
// run, and the number one of them prints is the argument the other takes.
import { describe, it, expect } from 'vitest';
import { TARGETS } from '@ngl/contracts';
import {
  MCP_TOOLS, BACKLOG_LIST, BACKLOG_ENTRY, ORDERS_LIST, ORDERS_ENTRY,
  callRequest, initialValues, provenance,
} from '../src/mcp-tools';
import { NOTHING_KNOWN } from '../src/mcp-answer';

describe('mcp-tools', () => {
  it('offers the four tools the server registers, and nothing it does not', () => {
    expect(MCP_TOOLS.map((tool) => tool.name).sort()).toEqual([
      'backlog_entry', 'backlog_list', 'orders_entry', 'orders_list',
    ]);
  });

  it('leads with the orders, because they answer with rows on any run', () => {
    expect(MCP_TOOLS.map((tool) => tool.name)).toEqual([
      'orders_list', 'orders_entry', 'backlog_list', 'backlog_entry',
    ]);
    expect(MCP_TOOLS[0]).toBe(ORDERS_LIST);
  });

  // A tool that writes cannot appear here because none exists, but a name invented
  // in this file would be a promise the server never made.
  it('names no tool that changes anything', () => {
    const names = MCP_TOOLS.map((tool) => tool.name).join(' ');
    expect(names).not.toMatch(/retry|delete|write|update|create/);
  });

  it('takes the systems from the shared vocabulary rather than listing them again', () => {
    const target = BACKLOG_LIST.fields.find((field) => field.name === 'target');
    const values = target?.kind === 'choice' ? target.options.map((o) => o.value) : [];
    for (const known of TARGETS) expect(values).toContain(known);
  });

  // The owner read "System: Every system" as a question he had to answer. The field
  // stays, because the server takes the argument and a console that hides arguments
  // is another layer of ours between the reader and the server, but it now says on
  // its face that it can be left alone.
  it('says on the filter itself that it is optional', () => {
    const target = BACKLOG_LIST.fields.find((field) => field.name === 'target');
    expect(target?.hint).toMatch(/optional/i);
    expect(initialValues(BACKLOG_LIST).target).toBe('');
  });

  // Twenty orders, each with a basket and five deliveries, is a wall of escaped JSON
  // nobody reads. The number is on screen and goes out in the request, so a reader
  // who wants twenty types twenty.
  it('asks for few enough orders that the answer can be read', () => {
    expect(Number(initialValues(ORDERS_LIST).limit)).toBeLessThanOrEqual(5);
    expect(initialValues(BACKLOG_LIST).limit).toBe('20');
  });

  // "Order number: 1" is a guess dressed as a default, and it answers found: false.
  it('guesses no order number when no answer has supplied one', () => {
    expect(initialValues(ORDERS_ENTRY).orderNumber).toBe('');
    expect(initialValues(BACKLOG_ENTRY).id).toBe('');
  });

  it('fills the number in from what a list answer returned', () => {
    const known = { orderNumber: 1119, deliveryId: 41 };
    expect(initialValues(ORDERS_ENTRY, known).orderNumber).toBe('1119');
    expect(initialValues(BACKLOG_ENTRY, known).id).toBe('41');
  });

  it('says where the number in the box came from', () => {
    const note = provenance(ORDERS_ENTRY, { orderNumber: 1119, deliveryId: null });
    expect(note).toContain('1119');
    expect(note).toMatch(/orders_list/);
  });

  it('says where to get one when nothing has supplied it yet', () => {
    const note = provenance(ORDERS_ENTRY, NOTHING_KNOWN) ?? '';
    expect(note).toMatch(/orders_list/);
    expect(note).toMatch(/card/i);
  });

  it('says nothing about provenance for a tool that takes no such number', () => {
    expect(provenance(ORDERS_LIST, NOTHING_KNOWN)).toBeNull();
  });

  it('builds a tools/call envelope for the chosen tool', () => {
    const request = callRequest(ORDERS_LIST, { limit: '5' }, 7);
    expect(request).toEqual({
      jsonrpc: '2.0',
      id: 7,
      method: 'tools/call',
      params: { name: 'orders_list', arguments: { limit: 5 } },
    });
  });

  it('sends numbers as numbers, because the schema declares integers', () => {
    const request = callRequest(BACKLOG_ENTRY, { id: '41' }, 1);
    expect(request.params.arguments).toEqual({ id: 41 });
  });

  it('leaves an unfilled argument out instead of sending an empty string', () => {
    const request = callRequest(BACKLOG_LIST, { target: '', limit: '' }, 1);
    expect(request.params.arguments).toEqual({});
  });

  it('sends the target once one is chosen', () => {
    const request = callRequest(BACKLOG_LIST, { target: 'hubspot', limit: '3' }, 1);
    expect(request.params.arguments).toEqual({ target: 'hubspot', limit: 3 });
  });

  // Correcting it here would hide the server's own answer, and the server's answer is
  // the thing this panel exists to show.
  it('forwards a number that is not one and lets the server refuse it', () => {
    const request = callRequest(ORDERS_ENTRY, { orderNumber: 'twelve' }, 1);
    expect(request.params.arguments).toEqual({ orderNumber: 'twelve' });
  });
});
