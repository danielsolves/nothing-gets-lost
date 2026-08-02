// ui/src/McpServer.tsx
// The backlog and the order history, readable from a client that is not this page,
// and runnable from this page first.
//
// The Backlog tab says a delivery nobody could complete is parked for a person
// rather than dropped. That claim is worth what a reader can do with it, and reading
// it off the panel that makes it is worth nothing. So the same rows are served over
// MCP, read only, and a reader with any MCP client can ask for them without going
// through anything we render.
//
// For a long time that was all this panel did: it printed the url, named the tools
// and stopped. The gap was that checking it cost a client, a config file and a
// restart, so almost every reader took the claim on trust after all, which is the one
// thing the panel was built to make unnecessary. It now runs the tools where the
// reader is standing and prints the answer exactly as the server sent it, and the
// install note is for the reader who would rather leave the page entirely.
//
// A paragraph used to stand under the console admitting that Run went to /api/mcp
// rather than to the address printed here, because only the public host mapped /mcp
// onto the MCP port. The ui container routes /mcp itself now, the relay in the api is
// gone, and the paragraph with it: the console calls the address it prints, which is
// what this panel always claimed and briefly was not. An explanation of a detour is
// worth nothing next to not taking one.
//
// It sits beside the visitor's own endpoint because the two are the same argument
// from opposite ends: one puts our data in a client we do not control, the other
// puts our deliveries on a server we do not control.
//
// Both the url and the install command are built from where the page is being served
// rather than written down, so they are right on localhost, right on the public host
// and right in a clone, without either being a second place to keep in step.
import { useState } from 'react';
import { McpConsole } from './McpConsole';

export function McpServer() {
  const [copied, setCopied] = useState<string | null>(null);
  const url = `${window.location.origin}/mcp`;
  const install = `claude mcp add --transport http ngl ${url}`;

  const copy = (text: string) => {
    void navigator.clipboard?.writeText(text).then(() => setCopied(text));
  };

  return (
    <section className="mcp outside-panel">
      <h3>The MCP server</h3>

      <p className="endpoint-lede">
        Everything the queue and the backlog show is also served over MCP, straight out
        of the same database and read only. Pick a tool, set what it takes and run it.
        Run posts to the address below, and what comes back is printed as it arrived,
        envelope and all, with the same bytes underneath it unescaped so they can be
        read.
      </p>

      <McpConsole />

      <div className="mcp-url">
        <code data-testid="mcp-url">{url}</code>
        <button type="button" data-testid="mcp-copy" onClick={() => copy(url)}>
          {copied === url ? 'Copied' : 'Copy'}
        </button>
      </div>

      {/* One line, for the client most readers of this page already have. Setup notes
          for four other clients would be a maintenance job for a panel whose subject
          is not client configuration. */}
      <p className="mcp-note">
        Any MCP client takes that address over streamable HTTP. For Claude Code it is
        one command:
      </p>

      <div className="mcp-url mcp-install">
        <code data-testid="mcp-install">{install}</code>
        <button type="button" data-testid="mcp-install-copy" onClick={() => copy(install)}>
          {copied === install ? 'Copied' : 'Copy'}
        </button>
      </div>

      {/* Said out loud, because an open port that answers questions and an open port
          that moves other people's work are different things and only one of them is
          here. Putting a delivery back in the queue belongs to whoever runs this. */}
      <p className="mcp-note">
        Nothing here writes. There is no tool that retries a delivery or changes one,
        and the process behind the port holds a database login that could not write if
        one existed.
      </p>
    </section>
  );
}
