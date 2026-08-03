// @vitest-environment jsdom
// ui/test/McpAnswer.test.tsx
// What a reader sees after pressing Run: the request, the bytes that came back, and
// the same bytes decoded.
//
// The owner ran the console and got back one soft-wrapped line of JSON inside JSON,
// double escaped. It was the true answer and it was unreadable, so the panel proved
// nothing. These tests pin the fix and its limit: the raw body stays, byte for byte,
// and the readable version stands underneath it as a second view of the same bytes,
// labelled as derived. A panel that showed only the tidy version would be this page's
// word again, which is the one thing this panel may not be.
import { describe, it, expect, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { McpAnswer } from '../src/McpAnswer';

afterEach(cleanup);

const EMPTY = 'event: message\ndata: {"result":{"content":[{"type":"text",'
  + '"text":"{\\n  \\"total\\": 0,\\n  \\"returned\\": 0,\\n  \\"entries\\": []\\n}"}]},'
  + '"jsonrpc":"2.0","id":1}\n\n';

const ORDERS = 'event: message\ndata: {"result":{"content":[{"type":"text",'
  + '"text":"{\\n  \\"total\\": 8,\\n  \\"orders\\": [\\n    {\\n      '
  + '\\"orderNumber\\": 1119\\n    }\\n  ]\\n}"}]},"jsonrpc":"2.0","id":1}\n\n';

function show(body: string, status = 200) {
  return render(<McpAnswer status={status} sent='{"id": 1}' body={body} />);
}

describe('McpAnswer', () => {
  it('prints the response body exactly as it arrived', () => {
    show(EMPTY);
    expect(screen.getByTestId('mcp-response').textContent).toBe(EMPTY);
  });

  it('prints the same bytes again with the framing and the escaping gone', () => {
    show(EMPTY);
    const decoded = screen.getByTestId('mcp-decoded').textContent ?? '';
    expect(decoded).toContain('"total": 0');
    expect(decoded).not.toContain('event: message');
    expect(decoded).not.toContain('\\n');
  });

  // Without this the second pane is just a second answer, and a reader has to take
  // it on trust that it says what the first one says.
  it('says the readable pane is the first pane decoded, and names every step', () => {
    show(EMPTY);
    const caption = screen.getByTestId('mcp-decoded-caption').textContent ?? '';
    expect(caption).toMatch(/same bytes/i);
    expect(caption).toMatch(/nothing added/i);
  });

  it('shows the request that produced it', () => {
    show(ORDERS);
    expect(screen.getByTestId('mcp-sent').textContent).toContain('"id": 1');
  });

  it('shows the status the server answered with', () => {
    show('{"error":"nope"}', 429);
    expect(screen.getByTestId('mcp-status')).toHaveTextContent('429');
  });

  // An empty backlog is the healthy state, and it was the first thing the console
  // ever said to the owner. The words go beside the response, not instead of it.
  it('says in words what an empty backlog means, with the response still there', () => {
    show(EMPTY);
    expect(screen.getByTestId('mcp-note')).toHaveTextContent(/nothing is parked/i);
    expect(screen.getByTestId('mcp-response').textContent).toBe(EMPTY);
  });

  it('adds no words to an answer that has rows in it', () => {
    show(ORDERS);
    expect(screen.queryByTestId('mcp-note')).not.toBeInTheDocument();
  });

  // Bytes we cannot unwrap are still the answer. Guessing at a rendering would be
  // worse than admitting there is nothing to add.
  it('offers no decoded pane when the bytes are not an answer it can unwrap', () => {
    show('<html>502 Bad Gateway</html>');
    expect(screen.queryByTestId('mcp-decoded')).not.toBeInTheDocument();
    expect(screen.getByTestId('mcp-response').textContent).toBe('<html>502 Bad Gateway</html>');
  });
});
