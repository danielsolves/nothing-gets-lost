// ui/src/McpAnswer.tsx
// What came back from the MCP server: the request that produced it, the bytes exactly
// as they arrived, and the same bytes decoded.
//
// The panel printed the raw body and nothing else, on the principle that a drawing of
// an answer is this page's word again. The principle holds; the result did not. A
// tool answer is a JSON string inside a JSON envelope inside an event-stream frame,
// so it reached the reader as two long soft-wrapped lines full of \n and could not be
// read at all. An unreadable answer proves as little as no answer.
//
// So both, stacked, in the order the derivation runs: what went out, what came back
// byte for byte, then the same bytes with the framing and the escaping taken off,
// captioned with every step that was taken and the fact that nothing was added. Two
// columns side by side were rejected: they halve the line length of two blocks of
// JSON that are already wrapping, and on a phone they stack anyway, in an order
// nobody chose. Replacing the raw body with a table was rejected for the older
// reason. Collapsing the raw body behind a toggle was rejected too, because the thing
// a reader must not have to take on trust is the thing that would be hidden.
//
// The empty answer gets a sentence beside it and never in place of it. total: 0 from
// backlog_list is the healthy state of this demo and it was the first thing the
// console ever said to anybody, read as a broken call. It is the demonstration: the
// backlog is empty because nothing has been broken yet, and breaking something on
// purpose fills it.
import { useMemo } from 'react';
import { answerNote, readAnswer } from './mcp-answer';

const DECODED_CAPTION = 'The same bytes as above, with nothing added and nothing '
  + 'dropped: the event-stream framing removed, the JSON-RPC envelope parsed, and the '
  + 'JSON string the tool put inside it unescaped.';

export function McpAnswer(props: { status: number; sent: string; body: string }) {
  const read = useMemo(() => readAnswer(props.body), [props.body]);
  const note = useMemo(() => answerNote(read), [read]);

  return (
    <div className="mcp-answer">
      <p className="mcp-status" data-testid="mcp-status">
        POST /mcp answered {props.status}.
      </p>

      <Pane id="mcp-sent" label="What went out" text={props.sent} />
      <Pane id="mcp-response" label="What came back, byte for byte" text={props.body} />

      {read.readable !== null && (
        <Pane
          id="mcp-decoded"
          label="The same answer, readable"
          caption={DECODED_CAPTION}
          text={read.readable}
        />
      )}

      {note !== null && (
        <p className="mcp-empty-note" data-testid="mcp-note" role="status">{note}</p>
      )}
    </div>
  );
}

/** One block of text under a heading that says what it is. */
function Pane(props: { id: string; label: string; caption?: string; text: string }) {
  const labelId = `${props.id}-label`;

  return (
    <div className={`mcp-pane ${props.id}-pane`}>
      <p className="mcp-pane-label" id={labelId}>{props.label}</p>
      {props.caption !== undefined && (
        <p className="mcp-pane-caption" data-testid={`${props.id}-caption`}>{props.caption}</p>
      )}
      <pre className={props.id} data-testid={props.id} aria-labelledby={labelId}>{props.text}</pre>
    </div>
  );
}
