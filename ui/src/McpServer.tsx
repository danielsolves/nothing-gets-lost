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
        Everything the Backlog and the queue show is also served over MCP, straight out
        of the same database and read only. Pick a tool, set what it takes and run it:
        what comes back is printed here as it arrived, envelope and all, so there is
        nothing of ours between you and the answer but the wire.
      </p>

      <McpConsole />

      {/* Said where the reader has just watched a call happen, because the run button
          adds a hop and a panel about not needing our word cannot be quiet about it.
          The port itself is not reachable from this page in a checkout: it is on an
          address of its own, and only the public host maps /mcp onto it. */}
      <p className="mcp-note">
        Run posts to <code>/api/mcp</code> on this host, which hands the bytes to the
        MCP server and hands its answer back untouched. That hop exists because the
        server has a port of its own and only the public host maps <code>/mcp</code> onto
        it, and a console that worked on the live site and nowhere else would prove
        nothing. The address below cuts us out of it.
      </p>

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
