// ui/src/Diagram.tsx
// The machine: the mediator at the centre, the five systems it delivers to placed
// around it, and a line from the hub out to each one.
//
// This is the interface, not a picture of one. Breaking something used to mean
// scrolling past the whole page and opening a drawer called "Control panel", while
// the success criterion in specification section 1 is that a stranger breaks
// something on purpose within sixty seconds. So the tile you want to break is the
// button that breaks it, and the consequence lands on that same tile.
//
// The hub is the biggest thing on the page on purpose. The specification calls the
// mediator the heart of the repo and defends building the queue by hand with "take
// a ready-made one and the most interesting part becomes invisible". Drawing it as
// a small box with a four-word caption made it invisible anyway. It now carries its
// own live state and opens into the full queue.
import type { DeliveryView, SwitchState, SwitchableTarget } from '@ngl/contracts';
import { useDeliveryPulses } from './useDeliveryPulses';
import { SystemMark } from './SystemMark';

interface Spoke { target: SwitchableTarget; label: string; note: string }

/** The two a visitor is most likely to reach for sit on the left, nearest the eye. */
const LEFT: Spoke[] = [
  { target: 'stripe', label: 'Stripe', note: 'payment' },
  { target: 'hubspot', label: 'HubSpot', note: 'CRM' },
];

const RIGHT: Spoke[] = [
  { target: 'ledger', label: 'Invoices', note: 'our own service' },
  { target: 'slack', label: 'Slack', note: 'notification' },
  { target: 'mailer', label: 'Confirmation mail', note: 'last in the chain' },
];

export function Diagram(props: {
  switches: Record<SwitchableTarget, SwitchState>;
  deliveries: DeliveryView[];
  /** The order opened in the queue, if any. Its path is marked here. */
  openOrder?: string | null;
  /** The hub itself, passed in so this file stays layout and wiring. */
  hub: React.ReactNode;
}) {
  const pulses = useDeliveryPulses(props.deliveries);

  // Opening a card in the queue lights up that order's path here, so the queue and
  // the systems read as one thing seen twice rather than as neighbours.
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

  const column = (spokes: Spoke[], side: 'left' | 'right') => (
    <ul className="spokes" data-side={side}>
      {spokes.map((spoke) => {
        const state = props.switches[spoke.target];
        const held = waitingFor(spoke.target);
        const mark = tracked(spoke.target);
        const travelling = pulses.filter((pulse) => pulse.target === spoke.target);

        const wire = (
          <span
            className="line"
            data-testid={`line-${spoke.target}`}
            data-state={state}
            data-tracked={mark}
            aria-hidden="true"
          >
            {travelling.map((pulse) => (
              <span key={pulse.key} className={`dot dot-${pulse.kind}`} />
            ))}
          </span>
        );

        const tile = (
          <button
            type="button"
            className="target"
            data-testid={`box-${spoke.target}`}
            data-state={state}
            data-tracked={mark}
            aria-label={
              state === 'up' ? `Cut the line to ${spoke.label}` : `Reconnect ${spoke.label}`
            }
            onClick={() => cut(spoke.target, state)}
          >
            <SystemMark target={spoke.target} />
            <span className="name">{spoke.label}</span>
            <span className="note">{spoke.note}</span>
            {held > 0 && <span className="waiting">{held} waiting</span>}
            <span className="verb" aria-hidden="true">
              {state === 'up' ? 'cut the line' : 'reconnect'}
            </span>
          </button>
        );

        // The wire always sits between the tile and the hub, so it swaps sides.
        return (
          <li className="spoke" key={spoke.target}>
            {side === 'left' ? tile : wire}
            {side === 'left' ? wire : tile}
          </li>
        );
      })}
    </ul>
  );

  return (
    <div className="hub" data-testid="diagram">
      {column(LEFT, 'left')}

      {props.hub}

      {column(RIGHT, 'right')}
    </div>
  );
}
