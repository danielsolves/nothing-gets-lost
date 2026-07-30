// ui/src/ControlPanel.tsx
// The actual demo. Everything else is context for these buttons.
//
// "cut" is styled as the loudest control on the page because it is an invitation:
// most visitors accept it, and the moment they do is the moment the demo earns its
// keep.
import {
  CHAOS_KINDS, SWITCHABLE_TARGETS, SWITCH_STATES,
  type ChaosKind, type SwitchState, type SwitchableTarget,
} from '@ngl/contracts';

const LABELS: Record<SwitchableTarget, string> = {
  hubspot: 'HubSpot', stripe: 'Stripe', slack: 'Slack',
  ledger: 'Invoices', mailer: 'Mail',
};

const CHAOS_LABELS: Record<ChaosKind, string> = {
  duplicate_webhook: 'Deliver the payment twice',
  garbage_payload: 'Send garbage',
  hallucinate: 'Make the AI hallucinate',
};

async function post(path: string, body?: unknown): Promise<void> {
  await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

export function ControlPanel({
  switches,
}: { switches: Record<SwitchableTarget, SwitchState> }) {
  return (
    <aside className="control-panel">
      <h2>Break it on purpose</h2>

      {SWITCHABLE_TARGETS.map((target) => (
        <div className="switch-row" key={target} data-testid={`switch-${target}`}>
          <span className="switch-label">{LABELS[target]}</span>
          <div className="switch-states">
            {SWITCH_STATES.map((state) => (
              <button
                key={state}
                type="button"
                data-testid={`switch-${target}-${state}`}
                data-invite={state === 'cut' ? 'true' : undefined}
                className={switches[target] === state ? 'active' : ''}
                onClick={() => void post(`/api/switches/${target}`, { state })}
              >
                {state === 'up' ? 'reachable' : state}
              </button>
            ))}
          </div>
        </div>
      ))}

      <h3>One-off mischief</h3>
      {CHAOS_KINDS.map((kind) => (
        <button
          key={kind}
          type="button"
          className="chaos"
          data-testid={`chaos-${kind}`}
          onClick={() => void post(`/api/chaos/${kind}`)}
        >
          {CHAOS_LABELS[kind]}
        </button>
      ))}

      <button
        type="button"
        className="reset"
        data-testid="reset-all"
        onClick={() => void post('/api/reset')}
      >
        Reset everything
      </button>

      <p className="fine-print">
        Every action here is real. Stripe runs in test mode with real webhooks.
        HubSpot is up — we simply stop being able to reach it, which is the most
        common real-world outage.
      </p>
    </aside>
  );
}
