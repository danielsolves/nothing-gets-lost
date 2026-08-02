// ui/src/McpConsole.tsx
// Pick one of the four tools, set what it takes, run it, read what the server said.
//
// The panel used to name the tools and stop. That asked a reader to install an MCP
// client before they could find out whether this server was worth installing one
// for, which is the wrong way round: almost nobody does the work, so the claim was
// read as a claim and the open port might as well not have been there.
//
// What comes back is printed as it arrived, event-stream framing, escaped newlines
// and all. Parsing the envelope and drawing a tidy table was the obvious kindness
// and it was rejected, because a drawing of the answer is this page's word again and
// the whole reason for this panel is that our word should not be needed. The request
// is printed beside it for the same reason: with both in view a reader can repeat the
// call from a terminal against the address above and compare the two.
//
// The call goes to /api/mcp on this host rather than to the MCP port directly. The
// port answers with permissive CORS and would take the call, but it is only routed on
// the page's own origin on the public host: on a clone started with `docker compose
// up` the page is on one port and the server on another, with nothing mapping /mcp.
// A console that works on the live site and is dead in every checkout would be worse
// than none. The api hands the bytes over and hands the answer back untouched, and
// what it fronts is a server with no tool that writes and no credential that could.
import { useState } from 'react';
import {
  BACKLOG_LIST, MCP_TOOLS, callRequest, initialValues,
  type FieldValues, type McpField, type McpTool,
} from './mcp-tools';

interface Answer {
  status: number;
  sent: string;
  body: string;
}

export function McpConsole() {
  const [tool, setTool] = useState<McpTool>(BACKLOG_LIST);
  const [values, setValues] = useState<FieldValues>(() => initialValues(BACKLOG_LIST));
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [calls, setCalls] = useState(1);

  function choose(next: McpTool): void {
    setTool(next);
    setValues(initialValues(next));
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
      const response = await fetch('/api/mcp', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(request),
      });
      setAnswer({ status: response.status, sent, body: await response.text() });
    } catch {
      setAnswer(null);
      setFailed('The call did not get through. Nothing was reached, so there is no '
        + 'response body to show you.');
    } finally {
      setRunning(false);
    }
  }

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

      {failed !== null && (
        <p className="mcp-failed" data-testid="mcp-failed" role="status">{failed}</p>
      )}

      {answer !== null && (
        <div className="mcp-answer">
          <p className="mcp-status" data-testid="mcp-status">
            POST /api/mcp answered {answer.status}. What went out first, then what came
            back, byte for byte.
          </p>
          <pre className="mcp-sent" data-testid="mcp-sent" aria-label="The request that was sent">
            {answer.sent}
          </pre>
          <pre
            className="mcp-response"
            data-testid="mcp-response"
            aria-label="The response body, exactly as it arrived"
          >
            {answer.body}
          </pre>
        </div>
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
