// ui/src/SqlConsole.tsx
// The invitation matters more than the feature. Perhaps one visitor in thirty types
// anything here — but the sentence above the box tells the other twenty-nine that
// there is nothing to hide, and that works without a single click.
import { useState } from 'react';
import type { SqlResponse } from '@ngl/contracts';

const EXAMPLE = "SELECT target, state, attempts\n  FROM v_deliveries\n ORDER BY id DESC;";

export function SqlConsole() {
  const [query, setQuery] = useState(EXAMPLE);
  const [result, setResult] = useState<SqlResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(): Promise<void> {
    setError(null);
    const response = await fetch('/api/sql', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query }),
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as { message?: string };
      setError(body.message ?? 'Query rejected');
      setResult(null);
      return;
    }
    setResult((await response.json()) as SqlResponse);
  }

  return (
    <section className="sql-console">
      <h2>Do not trust my screen. Ask the database yourself.</h2>
      <textarea value={query} rows={4} data-testid="sql-input"
                onChange={(event) => setQuery(event.target.value)} />
      <button type="button" data-testid="sql-run" onClick={() => void run()}>Run</button>

      {error && <p className="error" data-testid="sql-error">{error}</p>}

      {result && (
        <>
          <table data-testid="sql-result">
            <thead>
              <tr>{result.columns.map((column) => <th key={column}>{column}</th>)}</tr>
            </thead>
            <tbody>
              {result.rows.map((row, index) => (
                <tr key={index}>
                  {row.map((cell, cellIndex) => (
                    <td key={cellIndex}>{cell === null ? 'null' : String(cell)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {result.truncated && <p className="fine-print">Showing the first 200 rows.</p>}
        </>
      )}

      <p className="fine-print">
        Read-only account, four views, two second limit. SELECT only.
      </p>
    </section>
  );
}
