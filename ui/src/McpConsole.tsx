// ui/src/McpConsole.tsx
// Pick one of the four tools, set what it takes, run it, read what the server said.
//
// The panel used to name the tools and stop. That asked a reader to install an MCP
// client before they could find out whether this server was worth installing one
// for, which is the wrong way round: almost nobody does the work, so the claim was
// read as a claim and the open port might as well not have been there.
//
// The call goes to /mcp on this page's own origin, which is the address printed under
// this console. It went to /api/mcp for a while, because only the outer nginx on the
// public host mapped /mcp onto the MCP port, so a clone had the page on one port and
// the server on another with nothing joining them. The ui container routes /mcp
// itself now, so the relay is gone and the console calls the address it shows. That
// was worth doing for its own sake: this panel exists so that nothing of ours stands
// between the reader and the server, and a hop through our api was exactly something
// of ours standing there.
//
// It arrives on orders_list. backlog_list was first, and on a healthy demo the
// backlog is empty, so the first thing this console ever said was total: 0, which
// reads as nothing having happened. Orders are the rows a reader recognises, and the
// number one of them prints is the argument orders_entry takes, so the reader is
// handed the next call by the last answer rather than asked to invent it.
//
// What comes back is printed as it arrived and again decoded, in McpAnswer, for the
// reasons written there.
import { useState } from 'react';
import { McpAnswer } from './McpAnswer';
import { NOTHING_KNOWN, idsIn, mergeIds, readAnswer, type KnownIds } from './mcp-answer';
import {
  MCP_TOOLS, ORDERS_LIST, callRequest, initialValues, provenance,
  type FieldValues, type McpField, type McpTool,
} from './mcp-tools';

interface Answer {
  status: number;
  sent: string;
  body: string;
}

export function McpConsole() {
  const [tool, setTool] = useState<McpTool>(ORDERS_LIST);
  const [values, setValues] = useState<FieldValues>(() => initialValues(ORDERS_LIST));
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [calls, setCalls] = useState(1);
  // Only ever numbers the server has printed on this screen. Nothing is remembered
  // that the reader has not been shown.
  const [known, setKnown] = useState<KnownIds>(NOTHING_KNOWN);

  function choose(next: McpTool): void {
    setTool(next);
    setValues(initialValues(next, known));
    // The old answer belonged to the old tool. Left on screen under a new form it
    // reads as the answer to a question nobody asked.
    setAnswer(null);
    setFailed(null);
  }

  function set(name: string, value: string): void {
    setValues((held) => ({ ...held, [name]: value }));
  }

  async function run(): Promise<void> {
    const request = callRequest(tool, values, calls);
    const sent = JSON.stringify(request, null, 2);
    setCalls(calls + 1);
    setRunning(true);
    setFailed(null);
    try {
      const response = await fetch('/mcp', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          // The streamable transport picks the shape of its reply from this, and
          // refuses the call outright without it.
          accept: 'application/json, text/event-stream',
        },
        body: JSON.stringify(request),
      });
      const body = await response.text();
      setAnswer({ status: response.status, sent, body });
      setKnown((held) => mergeIds(held, idsIn(readAnswer(body).payload)));
    } catch {
      setAnswer(null);
      setFailed('The call did not get through. Nothing was reached, so there is no '
        + 'response body to show you.');
    } finally {
      setRunning(false);
    }
  }

  const source = provenance(tool, known);

  return (
    <div className="mcp-console">
      <div className="mcp-picker" role="group" aria-label="Tool to run">
        {MCP_TOOLS.map((each) => (
          <button
            key={each.name}
            type="button"
            aria-pressed={each.name === tool.name}
            onClick={() => choose(each)}
          >
            {each.name}
          </button>
        ))}
      </div>

      <p className="mcp-summary" data-testid="mcp-summary">{tool.summary}</p>

      <div className="mcp-args">
        {tool.fields.map((field) => (
          <McpFieldControl
            key={field.name}
            field={field}
            value={values[field.name] ?? ''}
            onChange={(next) => set(field.name, next)}
          />
        ))}
        <button
          type="button"
          className="mcp-go"
          data-testid="mcp-run"
          disabled={running}
          onClick={() => void run()}
        >
          {running ? 'Asking' : 'Run it'}
        </button>
      </div>

      {source !== null && (
        <p className="mcp-provenance" data-testid="mcp-provenance">{source}</p>
      )}

      {failed !== null && (
        <p className="mcp-failed" data-testid="mcp-failed" role="status">{failed}</p>
      )}

      {answer !== null && (
        <McpAnswer status={answer.status} sent={answer.sent} body={answer.body} />
      )}
    </div>
  );
}

/** One argument. A select where the schema is an enum, a number box otherwise. */
function McpFieldControl(props: {
  field: McpField;
  value: string;
  onChange: (value: string) => void;
}) {
  const { field } = props;
  const id = `mcp-arg-${field.name}`;

  return (
    <label className="mcp-arg" htmlFor={id}>
      <span>{field.label}{field.hint === undefined ? '' : ` (${field.hint})`}</span>
      {field.kind === 'choice' ? (
        <select
          id={id}
          data-testid={`mcp-field-${field.name}`}
          value={props.value}
          onChange={(event) => props.onChange(event.target.value)}
        >
          {field.options.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      ) : (
        <input
          id={id}
          type="number"
          inputMode="numeric"
          min={field.min}
          max={field.max}
          data-testid={`mcp-field-${field.name}`}
          value={props.value}
          onChange={(event) => props.onChange(event.target.value)}
        />
      )}
    </label>
  );
}
