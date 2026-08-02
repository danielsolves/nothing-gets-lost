// @vitest-environment jsdom
// ui/test/McpServer.test.tsx
// The panel that hands a reader the same records through a client we did not write,
// and lets them run one from here first.
//
// Two things are pinned. The first is that both addresses follow the host the page is
// served from: writing them down would be a second place to keep in step, on a page
// whose whole argument is that a reader can go and check, and it would be wrong on
// every clone of this repository.
//
// The second is that the panel is not only prose any more. It used to name the tools
// and stop, which asked a reader to install a client before they could learn whether
// the server was worth installing one for.
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { McpServer } from '../src/McpServer';

afterEach(cleanup);

beforeEach(() => {
  vi.stubGlobal('fetch', async () => new Response('', { status: 200 }));
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('McpServer', () => {
  it('names itself, because it stands beside another panel', () => {
    render(<McpServer />);
    expect(screen.getByRole('heading', { name: 'The MCP server' })).toBeInTheDocument();
  });

  it('builds the url from where the page is served, not from a written-down host', () => {
    render(<McpServer />);
    expect(screen.getByTestId('mcp-url')).toHaveTextContent(`${window.location.origin}/mcp`);
  });

  // One line, and it is the line for the client most readers of this page already
  // have. It is built from the same origin as the url above so the two cannot drift.
  it('gives the one command that connects Claude to it', () => {
    render(<McpServer />);
    expect(screen.getByTestId('mcp-install')).toHaveTextContent(
      `claude mcp add --transport http ngl ${window.location.origin}/mcp`,
    );
  });

  it('offers both the address and the command to be copied', () => {
    render(<McpServer />);
    expect(screen.getByTestId('mcp-copy')).toBeInTheDocument();
    expect(screen.getByTestId('mcp-install-copy')).toBeInTheDocument();
  });

  it('holds a runnable console, not a list of tool names', () => {
    render(<McpServer />);
    expect(screen.getByTestId('mcp-run')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'orders_list' })).toBeInTheDocument();
  });

  it('says out loud that nothing here writes', () => {
    // An open port that answers questions and an open port that moves other
    // visitors' work are different things, and only one of them is this.
    const { container } = render(<McpServer />);
    expect(container).toHaveTextContent(/nothing here writes/i);
  });

  // The run button goes through this host's api, and a panel about not taking our
  // word for things cannot be quiet about the one hop it adds.
  it('admits that running it from here goes through us', () => {
    const { container } = render(<McpServer />);
    expect(container).toHaveTextContent(/\/api\/mcp/);
  });
});
