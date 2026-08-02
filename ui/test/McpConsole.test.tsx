// @vitest-environment jsdom
// ui/test/McpConsole.test.tsx
// Picking a tool, filling in what it takes, running it, reading what came back.
//
// The assertion this file is really for is the one about the response body. The panel
// exists because a reader should not have to take our word for anything, and a panel
// that parses the answer and re-draws it is our word again with extra steps. So the
// text the server sent is printed as it arrived, event-stream framing and escaped
// newlines included, and the test pins that rather than pinning a tidy rendering.
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { McpConsole } from '../src/McpConsole';

afterEach(cleanup);

const FRAME = 'event: message\ndata: {"result":{"content":[{"type":"text",'
  + '"text":"{\\n  \\"total\\": 0,\\n  \\"entries\\": []\\n}"}]},"jsonrpc":"2.0","id":1}\n\n';

let sent: Array<{ url: string; body: unknown }>;
let reply: { status: number; text: string } | Error;

beforeEach(() => {
  sent = [];
  reply = { status: 200, text: FRAME };
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    sent.push({ url, body: JSON.parse(String(init?.body ?? 'null')) });
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

describe('McpConsole', () => {
  it('offers every tool the server has', () => {
    render(<McpConsole />);
    for (const name of ['backlog_list', 'backlog_entry', 'orders_list', 'orders_entry']) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
    }
  });

  // A picker with nothing picked asks the reader to make a choice before they know
  // what any of the choices are. One is chosen, and pressing run is the whole errand.
  it('arrives with a tool already chosen, so run is the only required act', () => {
    render(<McpConsole />);
    expect(screen.getByRole('button', { name: 'backlog_list' })).toHaveAttribute(
      'aria-pressed', 'true',
    );
    expect(screen.getByTestId('mcp-run')).toBeEnabled();
  });

  it('says what the chosen tool answers', () => {
    render(<McpConsole />);
    expect(screen.getByTestId('mcp-summary')).toHaveTextContent(/parked for a person/i);
  });

  it('swaps the fields when another tool is chosen', () => {
    render(<McpConsole />);
    expect(screen.getByTestId('mcp-field-limit')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'orders_entry' }));
    expect(screen.queryByTestId('mcp-field-limit')).not.toBeInTheDocument();
    expect(screen.getByTestId('mcp-field-orderNumber')).toBeInTheDocument();
  });

  it('posts a tools/call for the chosen tool with the values on screen', async () => {
    render(<McpConsole />);
    fireEvent.change(screen.getByTestId('mcp-field-limit'), { target: { value: '3' } });
    fireEvent.change(screen.getByTestId('mcp-field-target'), { target: { value: 'hubspot' } });
    run();

    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0].url).toBe('/api/mcp');
    expect(sent[0].body).toMatchObject({
      jsonrpc: '2.0',
      method: 'tools/call',
      params: { name: 'backlog_list', arguments: { target: 'hubspot', limit: 3 } },
    });
  });

  it('prints the response body exactly as it arrived', async () => {
    render(<McpConsole />);
    run();
    const shown = await screen.findByTestId('mcp-response');
    expect(shown.textContent).toBe(FRAME);
  });

  // Without the request beside the answer, the answer is a screenshot. With it, a
  // reader can repeat the call from a terminal and compare.
  it('shows the request it sent, so the call can be repeated without us', async () => {
    render(<McpConsole />);
    run();
    const shown = await screen.findByTestId('mcp-sent');
    expect(shown.textContent).toContain('"name": "backlog_list"');
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

  // Every field on this panel is an argument to a read-only tool. A method other than
  // tools/call, or a second endpoint, would be a capability nobody agreed to.
  it('never posts anything but a tools/call to the one endpoint', async () => {
    render(<McpConsole />);
    fireEvent.click(screen.getByRole('button', { name: 'orders_list' }));
    run();
    await waitFor(() => expect(sent).toHaveLength(1));
    for (const call of sent) {
      expect(call.url).toBe('/api/mcp');
      expect(call.body).toMatchObject({ method: 'tools/call' });
    }
  });
});
