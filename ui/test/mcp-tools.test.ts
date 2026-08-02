// ui/test/mcp-tools.test.ts
// The catalogue the panel offers and the request it builds from a filled-in form.
//
// The assertions that matter are about what is left out. An argument the visitor did
// not fill in must not be sent as an empty string: the server has a default for the
// limit and treats a missing target as "every system", and sending "" would turn both
// of those into a validation error the reader would have to interpret.
//
// The other one is types. Every numeric argument on this server is declared as an
// integer, and a form hands back strings, so a request that forwards what the input
// held is refused by the schema before it reaches the database.
import { describe, it, expect } from 'vitest';
import { TARGETS } from '@ngl/contracts';
import {
  MCP_TOOLS, BACKLOG_LIST, BACKLOG_ENTRY, ORDERS_LIST, ORDERS_ENTRY,
  callRequest, initialValues,
} from '../src/mcp-tools';

describe('mcp-tools', () => {
  it('offers the four tools the server registers, and nothing it does not', () => {
    expect(MCP_TOOLS.map((tool) => tool.name)).toEqual([
      'backlog_list', 'backlog_entry', 'orders_list', 'orders_entry',
    ]);
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

  it('lets the target be left unset, because the server treats that as every system', () => {
    expect(initialValues(BACKLOG_LIST).target).toBe('');
  });

  it('starts the lists at the limit the server would have defaulted to', () => {
    expect(initialValues(BACKLOG_LIST).limit).toBe('20');
    expect(initialValues(ORDERS_LIST).limit).toBe('20');
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
