// ui/src/Queue.tsx
// The queue, drawn. One card per order, five checkpoints, quiet until asked.
//
// The specification calls the mediator the heart of the repo and defends building
// the queue by hand with "take a ready-made one and the most interesting part
// becomes invisible". It was invisible anyway: a box captioned "queue · retry ·
// exactly once" that a visitor had to take on faith. This is that box opened up.
//
// Opening a card is also what selects it. One interaction rather than two competing
// ones, and it means the order being read is the one lit up in the diagram.
import type { DeliveryView } from '@ngl/contracts';
import { groupIntoOrders, type OrderStep } from './order-cards';

export function Queue(props: {
  deliveries: DeliveryView[];
  openOrder: string | null;
  onToggle: (eventId: string) => void;
}) {
  const orders = groupIntoOrders(props.deliveries);

  if (orders.length === 0) {
    return (
      <p className="queue-empty" data-testid="queue-empty">
        Nothing in the queue. Send an order through and it appears here, one card
        with one checkpoint per system it has to reach.
      </p>
    );
  }

  return (
    <ol className="queue" data-testid="queue">
      {orders.map((order) => {
        const open = props.openOrder === order.eventId;
        return (
          <li key={order.eventId}>
            <button
              type="button"
              className="order-card"
              data-testid={`order-card-${order.eventId}`}
              data-selected={open ? 'true' : undefined}
              aria-expanded={open}
              onClick={() => props.onToggle(order.eventId)}
            >
              <span className="order-head">
                <span className="order-id">#{order.shortId}</span>
                <span className="order-progress" data-testid={`order-progress-${order.eventId}`}>
                  {order.doneCount} of {order.total}
                </span>
              </span>

              <span className="order-dots">
                {order.steps.map((step) => (
                  <span
                    key={step.target}
                    className="order-dot"
                    data-testid={`order-dot-${order.eventId}-${step.target}`}
                    data-state={step.state}
                    title={`${step.label}: ${step.state}`}
                  />
                ))}
              </span>

              <span className="order-headline" data-testid={`order-headline-${order.eventId}`}>
                {order.headline}
              </span>
            </button>

            {open && (
              <dl className="order-detail" data-testid={`order-detail-${order.eventId}`}>
                {order.steps.map((step) => (
                  <div key={step.target} data-state={step.state}>
                    <dt>{step.label}</dt>
                    <dd>{describe(step)}</dd>
                  </div>
                ))}
              </dl>
            )}
          </li>
        );
      })}
    </ol>
  );
}

/**
 * One line per checkpoint, saying the thing a visitor would otherwise have to open
 * the SQL console to learn: how many attempts, what came back, what went wrong.
 */
function describe(step: OrderStep): string {
  switch (step.state) {
    case 'waiting':
      return 'not queued yet, it waits for the rest of the chain';
    case 'done':
      return step.remoteRef
        ? `delivered, their id ${step.remoteRef}`
        : 'delivered';
    case 'inflight':
      return `attempt ${step.attempts} going out now`;
    case 'dead':
      return `gave up after ${step.attempts} attempts, needs a human` +
        (step.lastError ? ` (${step.lastError})` : '');
    default:
      if (step.attempts === 0) return 'queued, not tried yet';
      return `attempt ${step.attempts} failed, waiting to retry` +
        (step.lastError ? ` (${step.lastError})` : '');
  }
}
