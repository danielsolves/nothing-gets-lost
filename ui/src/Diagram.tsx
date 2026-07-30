// ui/src/Diagram.tsx
// Six boxes and the traffic between them. A box turns grey when its switch is not
// up, so the visitor sees the consequence of their own click without reading text.
import type { DeliveryView, SwitchState, SwitchableTarget } from '@ngl/contracts';

const BOXES: Array<{ target: SwitchableTarget; label: string }> = [
  { target: 'stripe', label: 'Stripe' },
  { target: 'hubspot', label: 'HubSpot' },
  { target: 'ledger', label: 'Invoices' },
  { target: 'slack', label: 'Slack' },
  { target: 'mailer', label: 'Confirmation mail' },
];

export function Diagram(props: {
  switches: Record<SwitchableTarget, SwitchState>;
  deliveries: DeliveryView[];
}) {
  const waitingFor = (target: SwitchableTarget) =>
    props.deliveries.filter(
      (delivery) =>
        delivery.target === target &&
        (delivery.state === 'pending' || delivery.state === 'inflight'),
    ).length;

  return (
    <div className="diagram">
      <div className="mediator">
        <strong>The mediator</strong>
        <span>queue · retry · exactly once</span>
      </div>
      <div className="targets">
        {BOXES.map((box) => (
          <div
            key={box.target}
            className={`target state-${props.switches[box.target]}`}
            data-testid={`box-${box.target}`}
          >
            <span className="name">{box.label}</span>
            {waitingFor(box.target) > 0 && (
              <span className="waiting">{waitingFor(box.target)} waiting</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
