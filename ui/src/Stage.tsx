// ui/src/Stage.tsx
// The first twenty-five seconds (specification section 1): what this is, that it is
// running right now, and one obvious thing to press.
//
// It replaced a five-step walkthrough. The walkthrough worked, but once the diagram
// itself became clickable there were two things on screen telling a visitor what to
// do, and that is worse than one thing that is obvious. What survives from it is the
// single loudest button and the one line that says the boxes are the controls.
import { useState } from 'react';

export function Stage(props: { connected: boolean; viewers: number }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/demo-order', { method: 'POST' });
      if (!response.ok) throw new Error(`That did not work (${response.status}).`);
    } catch (problem) {
      setError((problem as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <header className="stage">
      <h1>Nothing gets lost. Not even when you break it.</h1>

      <p className="sub">
        One order, four real systems: a payment, a CRM entry, an invoice and a
        notification. Below is the machine that carries it between them, running right
        now. Send an order through, then cut one of the systems off and watch what
        happens to the orders already on their way.
      </p>

      <p className="status">
        <span className={props.connected ? 'live' : 'offline'} data-testid="connection">
          {props.connected ? 'live' : 'reconnecting'}
        </span>
        <span className="status-note">
          Everything on this page is happening as you watch. Nothing is a recording.
        </span>
        {props.viewers > 1 && (
          <span data-testid="presence">
            Somebody else is experimenting right now. You are watching their events too.
          </span>
        )}
      </p>

      <div className="stage-actions">
        <button
          type="button"
          className="stage-cta"
          data-testid="send-order"
          disabled={busy}
          onClick={() => void send()}
        >
          {busy ? 'Sending' : 'Send an order through'}
        </button>
        <span className="stage-hint" data-testid="stage-hint">
          Then open the menu on any system below and break it. Nothing will be lost.
        </span>
      </div>

      {error && <p className="error" data-testid="stage-error">{error}</p>}
    </header>
  );
}
