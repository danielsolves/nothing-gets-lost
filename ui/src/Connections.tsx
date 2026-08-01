// ui/src/Connections.tsx
// Optional on purpose. Five proofs work without connecting anything; this is for the
// visitor who wants the record to land in a system they own.
import { useEffect, useState } from 'react';
import type { ConnectionsResponse } from '@ngl/contracts';

export function Connections() {
  const [state, setState] = useState<ConnectionsResponse | null>(null);
  const [webhookUrl, setWebhookUrl] = useState('');
  const [error, setError] = useState<string | null>(null);

  const reload = () =>
    fetch('/api/connections')
      .then((response) => response.json() as Promise<ConnectionsResponse>)
      .then(setState);

  useEffect(() => { void reload(); }, []);

  async function disconnect(kind: 'slack' | 'hubspot'): Promise<void> {
    await fetch(`/api/connections/${kind}/disconnect`, { method: 'POST' });
    await reload();
  }

  async function saveWebhook(): Promise<void> {
    setError(null);
    const response = await fetch('/api/webhook-target', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: webhookUrl }),
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as { message?: string };
      setError(body.message ?? 'Rejected');
      return;
    }
    await reload();
  }

  if (!state) return null;

  return (
    <section className="connections">
      <h2>Optional: send it to a system you own</h2>
      <p>Everything on this page can be verified without this. It is here for the
         visitor who wants the record to land somewhere we do not control.</p>

      <div className="connection">
        <span>Your Slack workspace</span>
        {state.slack.connected
          ? <button type="button" onClick={() => void disconnect('slack')}>Disconnect</button>
          : <a className="button" href="/oauth/slack/start">Add to Slack</a>}
      </div>

      <div className="connection">
        <span>Your HubSpot portal</span>
        {state.hubspot.connected
          ? <button type="button" onClick={() => void disconnect('hubspot')}>Disconnect</button>
          : <a className="button" href="/oauth/hubspot/start">Connect HubSpot</a>}
        <small>A test portal is fine. You do not need your production system.</small>
      </div>

      {/* Three children, not two: this row needs its own grid track for the input. */}
      <div className="connection webhook">
        <span>
          Your own endpoint
          {/* It said only "Your own endpoint", which names a field and explains
              nothing. A visitor who does not already know what a webhook target is
              cannot tell whether this is for them, and the one who does cannot tell
              what we will send or how often. */}
          <small>
            A url of yours that we POST every delivery to, with the same retries as
            the systems above. Watch it from your side and you are not taking our
            word for any of this.
          </small>
        </span>
        <input placeholder="https://your-server.example/hook" value={webhookUrl}
               data-testid="webhook-url"
               onChange={(event) => setWebhookUrl(event.target.value)} />
        <button type="button" onClick={() => void saveWebhook()}>Save</button>
        {error && <p className="error">{error}</p>}
      </div>

      <p className="fine-print">
        Tokens are encrypted and deleted after 24 hours. Scopes: writing one Slack
        message, reading and writing HubSpot contacts. Nothing else.
      </p>
    </section>
  );
}
