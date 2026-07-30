// ui/src/Guide.tsx
// The walkthrough. A visitor has sixty seconds and is not a developer, so the page
// asks for exactly one thing at a time and says what to look for while it happens
// (spec 2). Everything deeper sits behind the tabs below and stays out of the way.
import { useState } from 'react';
import type { SwitchState, SwitchableTarget } from '@ngl/contracts';

export type StepId = 'send' | 'cut' | 'sendAgain' | 'restore' | 'yours';

const ORDER: StepId[] = ['send', 'cut', 'sendAgain', 'restore', 'yours'];

interface Step {
  title: string;
  body: string;
  cta: string;
  /** What to watch while the action runs. Shown next to the button, not after. */
  watch: string;
}

const STEPS: Record<StepId, Step> = {
  send: {
    title: 'Send one order through',
    body: 'It runs through a payment provider, a CRM, an invoice service and a chat '
      + 'notification. Four systems, one order.',
    cta: 'Send a test order',
    watch: 'Watch the counters and the log below.',
  },
  cut: {
    title: 'Now break it on purpose',
    body: 'We will not stop the CRM. We will cut the line to it, which is what '
      + 'actually happens in production far more often than a provider going down.',
    cta: 'Cut the line to HubSpot',
    watch: 'The CRM box turns red. Nothing else changes yet.',
  },
  sendAgain: {
    title: 'Send another order while it is broken',
    body: 'The payment still goes through. The CRM cannot be reached. This is the '
      + 'moment where most integrations quietly lose the order.',
    cta: 'Send a second order',
    watch: 'Waiting climbs. Lost stays at zero. Nothing is dropped, it is held.',
  },
  restore: {
    title: 'Put the line back',
    body: 'Everything that piled up should now go through by itself, and each item '
      + 'exactly once, with no duplicate contact and no second invoice.',
    cta: 'Reconnect HubSpot',
    watch: 'Waiting drains to zero. Delivered climbs. Lost never moved.',
  },
  yours: {
    title: 'Now do it with your own address',
    body: 'Place an order with your own email. You get a Stripe receipt served by '
      + 'stripe.com and a confirmation mail stamped by your own provider. The gap '
      + 'between those two timestamps is the outage you just caused, and neither '
      + 'timestamp is ours to fake.',
    cta: 'Take me to the form',
    watch: 'The form is right below.',
  },
};

interface GuideProps {
  switches: Record<SwitchableTarget, SwitchState>;
  onFinished: () => void;
}

export function Guide({ switches, onFinished }: GuideProps) {
  const [index, setIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [finished, setFinished] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const id = ORDER[index] ?? 'yours';
  const step = STEPS[id];
  const isLast = index === ORDER.length - 1;

  async function run(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      if (id === 'send' || id === 'sendAgain') await post('/api/demo-order');
      if (id === 'cut') await post('/api/switches/hubspot', { state: 'cut' });
      if (id === 'restore') await post('/api/switches/hubspot', { state: 'up' });
      if (id === 'yours') { onFinished(); setFinished(true); }
      setIndex((current) => Math.min(current + 1, ORDER.length - 1));
    } catch (problem) {
      setError((problem as Error).message);
    } finally {
      setBusy(false);
    }
  }

  // Only the last step's own action ends the walkthrough. Deriving this from the
  // counters disabled the final button before it could ever be pressed.
  const done = isLast && finished;

  return (
    <section className="guide" data-testid="guide">
      <ol className="guide-track" aria-label="Walkthrough progress">
        {ORDER.map((each, position) => (
          <li
            key={each}
            className={position < index ? 'past' : position === index ? 'now' : 'ahead'}
            aria-current={position === index ? 'step' : undefined}
          >
            <span>{position + 1}</span>
          </li>
        ))}
      </ol>

      <div className="guide-body">
        <p className="guide-count">Step {index + 1} of {ORDER.length}</p>
        <h2>{step.title}</h2>
        <p>{step.body}</p>

        <div className="guide-actions">
          <button
            type="button"
            className="guide-cta"
            onClick={() => void run()}
            disabled={busy || done}
            data-testid="guide-cta"
          >
            {busy ? 'Working' : step.cta}
          </button>
          <span className="guide-watch">{step.watch}</span>
        </div>

        {error && <p className="error" data-testid="guide-error">{error}</p>}

        {switches.hubspot === 'cut' && id !== 'cut' && (
          <p className="guide-note" data-testid="guide-cut-note">
            HubSpot is cut right now. Anything for it is being held, not dropped.
          </p>
        )}
      </div>
    </section>
  );
}

async function post(url: string, body?: unknown): Promise<void> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  if (!response.ok) {
    const detail = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new Error(detail?.message ?? `That did not work (${response.status}).`);
  }
}
