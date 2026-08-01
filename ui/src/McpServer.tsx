// ui/src/McpServer.tsx
// The backlog, readable from a client that is not this page.
//
// The Backlog tab says a delivery nobody could complete is parked for a person
// rather than dropped. That claim is worth what a reader can do with it, and reading
// it off the panel that makes it is worth nothing. So the same rows are served over
// MCP, read only, and a reader with any MCP client can ask for them without going
// through anything we render.
//
// It sits beside the visitor's own endpoint because the two are the same argument
// from opposite ends: one puts our data in a client we do not control, the other
// puts our deliveries on a server we do not control.
//
// The url is built from where the page is being served rather than written down, so
// it is right on localhost and right on the public host without either being a
// second place to keep in step.
import { useState } from 'react';

export function McpServer() {
  const [copied, setCopied] = useState(false);
  const url = `${window.location.origin}/mcp`;

  const copy = () => {
    void navigator.clipboard?.writeText(url).then(() => setCopied(true));
  };

  return (
    <section className="mcp outside-panel">
      <h3>The MCP server</h3>

      <p className="endpoint-lede">
        Everything the Backlog tab shows is also served over MCP, straight out of the
        same database and read only. Point any MCP client at this url and ask it
        yourself: what comes back has not been through anything we drew.
      </p>

      <div className="mcp-url">
        <code data-testid="mcp-url">{url}</code>
        <button type="button" data-testid="mcp-copy" onClick={copy}>
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>

      {/* Named rather than described in prose. A reader who has an MCP client open
          wants the tool names; a reader who has not is not going to be talked into
          installing one by a paragraph here. */}
      <dl className="mcp-tools" data-testid="mcp-tools">
        <div>
          <dt>backlog_list</dt>
          <dd>Every delivery parked for a person, oldest first, with the count.</dd>
        </div>
        <div>
          <dt>backlog_entry</dt>
          <dd>One of them in full, with the order behind it and what was in it.</dd>
        </div>
      </dl>

      {/* Said out loud, because an open port that answers questions and an open port
          that moves other people's work are different things and only one of them is
          here. Putting a delivery back in the queue belongs to whoever runs this. */}
      <p className="mcp-note">
        Nothing here writes. There is no tool that retries a delivery or changes one.
      </p>
    </section>
  );
}
