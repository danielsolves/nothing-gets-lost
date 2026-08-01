// @vitest-environment jsdom
// ui/test/McpServer.test.tsx
// The panel that hands a reader the backlog through a client we did not write.
//
// What is under test is mostly copy and one derived value. The url has to follow the
// host the page is served from, because the alternative is writing it down twice and
// having it be wrong on one of them, on a page whose argument is that a reader can go
// and check.
import { describe, it, expect, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { McpServer } from '../src/McpServer';

afterEach(cleanup);

describe('McpServer', () => {
  it('names itself, because it stands beside another panel', () => {
    render(<McpServer />);
    expect(screen.getByRole('heading', { name: 'The MCP server' })).toBeInTheDocument();
  });

  it('builds the url from where the page is served, not from a written-down host', () => {
    render(<McpServer />);
    expect(screen.getByTestId('mcp-url')).toHaveTextContent(`${window.location.origin}/mcp`);
  });

  it('names both tools, so a reader with a client knows what to ask for', () => {
    render(<McpServer />);
    const tools = screen.getByTestId('mcp-tools');
    expect(tools).toHaveTextContent('backlog_list');
    expect(tools).toHaveTextContent('backlog_entry');
  });

  it('says out loud that nothing here writes', () => {
    // An open port that answers questions and an open port that moves other
    // visitors' work are different things, and only one of them is this.
    const { container } = render(<McpServer />);
    expect(container).toHaveTextContent(/nothing here writes/i);
  });

  it('offers the url to be copied', () => {
    render(<McpServer />);
    expect(screen.getByTestId('mcp-copy')).toBeInTheDocument();
  });
});
