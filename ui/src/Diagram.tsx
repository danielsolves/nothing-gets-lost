// ui/src/Diagram.tsx
// The mediator, the five systems it delivers to, and the lines between them.
//
// This is the interface, not a picture of one. Breaking something used to mean
// scrolling past the whole page and opening a drawer called "Control panel", while
// the success criterion in specification section 1 is that a stranger breaks
// something on purpose within sixty seconds. So the box you want to break is the
// button that breaks it, and the consequence lands on that same box.
//
// One action here, cut and restore. The panel in the drawer keeps all four states
// and the chaos buttons: full range for anyone who wants it, the loud action on the
// page.
import type { DeliveryView, SwitchState, SwitchableTarget } from '@ngl/contracts';
import { useDeliveryPulses } from './useDeliveryPulses';
import { SystemMark } from './SystemMark';

const BOXES: Array<{ target: SwitchableTarget; label: string; note: string }> = [
  { target: 'stripe', label: 'Stripe', note: 'payment' },
  { target: 'hubspot', label: 'HubSpot', note: 'CRM' },
  { target: 'ledger', label: 'Invoices', note: 'our own service' },
  { target: 'slack', label: 'Slack', note: 'notification' },
  { target: 'mailer', label: 'Confirmation mail', note: 'last in the chain' },
];

export function Diagram(props: {
  switches: Record<SwitchableTarget, SwitchState>;
  deliveries: DeliveryView[];
  /** The order opened in the queue, if any. Its path is marked here. */
  openOrder?: string | null;
}) {
  const pulses = useDeliveryPulses(props.deliveries);

  // Opening a card in the queue lights up that order's path here, so the two
  // panels read as one thing seen twice rather than as neighbours.
  const tracked = (target: SwitchableTarget): 'open' | 'done' | undefined => {
    if (!props.openOrder) return undefined;
    const step = props.deliveries.find(
      (delivery) => delivery.eventId === props.openOrder && delivery.target === target,
    );
    if (!step) return undefined;
    return step.state === 'done' ? 'done' : 'open';
  };

  const waitingFor = (target: SwitchableTarget) =>
    props.deliveries.filter(
      (delivery) =>
        delivery.target === target &&
        (delivery.state === 'pending' || delivery.state === 'inflight'),
    ).length;

  // Anything other than "up" is a fault the visitor wants gone, so one click ends it.
  // Only a reachable system can be cut, which keeps this a toggle rather than a menu.
  const cut = (target: SwitchableTarget, state: SwitchState) => {
    const next = state === 'up' ? 'cut' : 'up';
    void fetch(`/api/switches/${target}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ state: next }),
    });
  };

  return (
    <div className="diagram" data-testid="diagram">
      <div className="mediator" data-testid="mediator">
        <strong>The mediator</strong>
        <span className="mediator-sub">everything goes through here</span>
        <ul className="mediator-jobs">
          <li>holds the queue</li>
          <li>retries with a growing gap</li>
          <li>delivers exactly once</li>
          <li>parks what needs a human</li>
        </ul>
      </div>

      <ul className="wires">
        {BOXES.map((box) => {
          const state = props.switches[box.target];
          const held = waitingFor(box.target);
          const mark = tracked(box.target);
          const travelling = pulses.filter((pulse) => pulse.target === box.target);

          return (
            <li className="wire" key={box.target}>
              <span
                className="line"
                data-testid={`line-${box.target}`}
                data-state={state}
                data-tracked={mark}
                aria-hidden="true"
              >
                {travelling.map((pulse) => (
                  <span key={pulse.key} className={`dot dot-${pulse.kind}`} />
                ))}
              </span>

              <button
                type="button"
                className="target"
                data-testid={`box-${box.target}`}
                data-state={state}
                data-tracked={mark}
                aria-label={
                  state === 'up'
                    ? `Cut the line to ${box.label}`
                    : `Reconnect ${box.label}`
                }
                onClick={() => cut(box.target, state)}
              >
                <SystemMark target={box.target} />
                <span className="name">{box.label}</span>
                <span className="note">{box.note}</span>
                {held > 0 && <span className="waiting">{held} waiting</span>}
                <span className="verb" aria-hidden="true">
                  {state === 'up' ? 'cut the line' : 'reconnect'}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
