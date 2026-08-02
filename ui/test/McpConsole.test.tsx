// @vitest-environment jsdom
// ui/test/McpConsole.test.tsx
// Picking a tool, filling in what it takes, running it, reading what came back.
//
// Three things are pinned here that the owner's first run got wrong.
//
// The call goes to /mcp on this page's own origin, which is the address the panel
// prints. It used to go to /api/mcp because only the public host mapped /mcp onto the
// MCP port; nginx in the ui container maps it now, so the console calls the address
// it shows and the panel no longer has to explain a hop.
//
// The tool it arrives on is orders_list. backlog_list was first, and on a healthy
// demo the backlog is empty, so the first thing the console ever said was total: 0.
//
// And a number a reader cannot guess is not asked for as a guess: orders_entry is
// filled in from the answer orders_list just gave, or it says where to find one.
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { McpConsole } from '../src/McpConsole';

afterEach(cleanup);

function frame(payload: unknown): string {
  const envelope = {
    result: { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }] },
    jsonrpc: '2.0',
    id: 1,
  };
  return `event: message\ndata: ${JSON.stringify(envelope)}\n\n`;
}

const ORDERS = frame({
  total: 8, returned: 1, orders: [{ orderNumber: 1119, totalCents: 10200 }],
});
const EMPTY_BACKLOG = frame({ total: 0, returned: 0, entries: [] });

let sent: Array<{ url: string; headers: Record<string, string>; body: unknown }>;
let reply: { status: number; text: string } | Error;

beforeEach(() => {
  sent = [];
  reply = { status: 200, text: ORDERS };
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const headers: Record<string, string> = {};
    for (const [name, value] of Object.entries(init?.headers ?? {})) {
      headers[name] = String(value);
    }
    sent.push({ url, headers, body: JSON.parse(String(init?.body ?? 'null')) });
    if (reply instanceof Error) throw reply;
    return new Response(reply.text, {
      status: reply.status,
      headers: { 'content-type': 'text/event-stream' },
    });
  });
});
afterEach(() => { vi.unstubAllGlobals(); });

function run(): void {
  fireEvent.click(screen.getByTestId('mcp-run'));
}

function choose(name: string): void {
  fireEvent.click(screen.getByRole('button', { name }));
}

describe('McpConsole', () => {
  it('offers every tool the server has', () => {
    render(<McpConsole />);
    for (const name of ['backlog_list', 'backlog_entry', 'orders_list', 'orders_entry']) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
    }
  });

  // A picker with nothing picked asks the reader to make a choice before they know
  // what any of the choices are. One is chosen, and pressing run is the whole errand.
  it('arrives on orders_list, which answers with rows a reader recognises', () => {
    render(<McpConsole />);
    expect(screen.getByRole('button', { name: 'orders_list' })).toHaveAttribute(
      'aria-pressed', 'true',
    );
    expect(screen.getByTestId('mcp-run')).toBeEnabled();
    expect(screen.getByTestId('mcp-summary')).toHaveTextContent(/orders already taken/i);
  });

  it('swaps the fields when another tool is chosen', () => {
    render(<McpConsole />);
    expect(screen.getByTestId('mcp-field-limit')).toBeInTheDocument();
    choose('orders_entry');
    expect(screen.queryByTestId('mcp-field-limit')).not.toBeInTheDocument();
    expect(screen.getByTestId('mcp-field-orderNumber')).toBeInTheDocument();
  });

  it('posts a tools/call for the chosen tool with the values on screen', async () => {
    render(<McpConsole />);
    choose('backlog_list');
    fireEvent.change(screen.getByTestId('mcp-field-limit'), { target: { value: '3' } });
    fireEvent.change(screen.getByTestId('mcp-field-target'), { target: { value: 'hubspot' } });
    run();

    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0].body).toMatchObject({
      jsonrpc: '2.0',
      method: 'tools/call',
      params: { name: 'backlog_list', arguments: { target: 'hubspot', limit: 3 } },
    });
  });

  // The address the panel prints, on this page's own origin, and nothing of ours in
  // between. The accept header is what the streamable transport picks its reply shape
  // from, and without it the server refuses the call outright.
  it('calls the same /mcp the panel tells the reader to use', async () => {
    render(<McpConsole />);
    run();
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0].url).toBe('/mcp');
    expect(sent[0].headers.accept).toContain('text/event-stream');
    expect(sent[0].headers['content-type']).toBe('application/json');
  });

  it('prints the response body exactly as it arrived, and the same bytes decoded', async () => {
    render(<McpConsole />);
    run();
    expect((await screen.findByTestId('mcp-response')).textContent).toBe(ORDERS);
    expect(screen.getByTestId('mcp-decoded').textContent).toContain('"orderNumber": 1119');
  });

  // Without the request beside the answer, the answer is a screenshot. With it, a
  // reader can repeat the call from a terminal and compare.
  it('shows the request it sent, so the call can be repeated without us', async () => {
    render(<McpConsole />);
    run();
    const shown = await screen.findByTestId('mcp-sent');
    expect(shown.textContent).toContain('"name": "orders_list"');
    expect(shown.textContent).toContain('"method": "tools/call"');
  });

  it('shows the status the server answered with', async () => {
    reply = { status: 429, text: '{"error":"Too many requests"}' };
    render(<McpConsole />);
    run();
    expect(await screen.findByTestId('mcp-status')).toHaveTextContent('429');
  });

  it('says the call did not get through rather than going quiet', async () => {
    reply = new Error('Failed to fetch');
    render(<McpConsole />);
    run();
    expect(await screen.findByTestId('mcp-failed')).toHaveTextContent(/did not get through/i);
  });

  it('asks for nothing while a call is in flight', async () => {
    render(<McpConsole />);
    run();
    expect(screen.getByTestId('mcp-run')).toBeDisabled();
    await waitFor(() => expect(screen.getByTestId('mcp-run')).toBeEnabled());
  });

  // The owner's words: "with orders_entry I do not know what to put in Order number".
  // The number is not invented here, it is the newest one the server just returned.
  it('carries the newest order number from the list into orders_entry', async () => {
    render(<McpConsole />);
    run();
    await screen.findByTestId('mcp-response');
    choose('orders_entry');
    expect(screen.getByTestId('mcp-field-orderNumber')).toHaveValue(1119);
    expect(screen.getByTestId('mcp-provenance')).toHaveTextContent(/1119/);
    expect(screen.getByTestId('mcp-provenance')).toHaveTextContent(/orders_list/);
  });

  it('says where to find a number when no list has been run yet', () => {
    render(<McpConsole />);
    choose('orders_entry');
    expect(screen.getByTestId('mcp-field-orderNumber')).toHaveValue(null);
    expect(screen.getByTestId('mcp-provenance')).toHaveTextContent(/orders_list/);
  });

  // The empty backlog is the case that made the owner think the console was broken.
  it('says what an empty backlog means, beside the empty answer', async () => {
    reply = { status: 200, text: EMPTY_BACKLOG };
    render(<McpConsole />);
    choose('backlog_list');
    run();
    expect(await screen.findByTestId('mcp-note')).toHaveTextContent(/nothing is parked/i);
    expect(screen.getByTestId('mcp-response').textContent).toBe(EMPTY_BACKLOG);
  });

  it('drops the answer to the old question when another tool is chosen', async () => {
    render(<McpConsole />);
    run();
    await screen.findByTestId('mcp-response');
    choose('backlog_list');
    expect(screen.queryByTestId('mcp-response')).not.toBeInTheDocument();
  });

  // Every field on this panel is an argument to a read-only tool. A method other than
  // tools/call, or a second endpoint, would be a capability nobody agreed to.
  it('never posts anything but a tools/call to the one endpoint', async () => {
    render(<McpConsole />);
    choose('backlog_entry');
    run();
    await waitFor(() => expect(sent).toHaveLength(1));
    for (const call of sent) {
      expect(call.url).toBe('/mcp');
      expect(call.body).toMatchObject({ method: 'tools/call' });
    }
  });
});
