// ui/src/Connections.tsx
// One field: a url of the visitor's own that every delivery is also posted to.
//
// There were two more things here, "Add to Slack" and "Connect HubSpot", and they
// are gone. Nobody hands a portfolio page OAuth with write access to their CRM, and
// asking cost an encrypted store of other people's credentials, a data protection
// surface and a branch in three places, for no visitor at all.
//
// What is left does the same job at a fraction of the hurdle. A record lands in a
// system we do not control, with the retry mechanic visible from the other side, and
// it takes thirty seconds and no login: paste a webhook.site url and watch the
// deliveries arrive.
//
// No heading at all. It carried a section title and then a row title under it, which
// was worth it while three rows shared the panel. With one row left, the tab that
// opens this already says "Your own endpoint", and a panel that repeats its own tab
// back at the reader is a line of text that says nothing.
import { useState } from 'react';

export function Connections() {
  const [webhookUrl, setWebhookUrl] = useState('');
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      setSaved(false);
      return;
    }
    setSaved(true);
  }

  return (
    <section className="connections">
      {/* The description sits under the tab at full width rather than in a
          column beside the field. Squeezed into a third of the row it broke into
          four short lines next to a field that had the rest of the space, which read
          as a caption for the input instead of as what it is: the reason to use this
          at all. */}
      <p className="endpoint-lede">
        A url of yours that we POST every delivery to, with the same retry schedule
        the five systems get. Watch it from your side and you are not taking our word
        for any of this. A throwaway url from a service like webhook.site does the
        job: no login, nothing to install, and you see the retries land.
      </p>

      <div className="endpoint-form">
        <input
          placeholder="https://your-server.example/hook"
          value={webhookUrl}
          data-testid="webhook-url"
          aria-label="Your own endpoint url"
          onChange={(event) => setWebhookUrl(event.target.value)}
        />
        <button type="button" onClick={() => void saveWebhook()}>Save</button>
      </div>

      {/* Said afterwards, because nothing else on the page changes when this works:
          the deliveries go out to a url only the visitor can watch. */}
      {saved && !error && (
        <p className="endpoint-saved" data-testid="webhook-saved" role="status">
          Saved. Every delivery from the next order onwards is posted there too, and
          a failure retries on the same schedule as everything else.
        </p>
      )}
      {error && <p className="error" data-testid="webhook-error">{error}</p>}
    </section>
  );
}
