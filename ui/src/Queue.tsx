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
//
// The head carries the order number and the moment the order arrived. It used to
// carry the first block of the event uuid, which no visitor could say out loud, put
// in a mail, or tell from the one above it.
import type { DeliveryView, OrderView } from '@ngl/contracts';
import { groupIntoOrders, type OrderStep } from './order-cards';
import { OrderCheck } from './OrderCheck';
import { OrderContents } from './OrderContents';
import { formatArrival, retryGap } from './order-time';

export function Queue(props: {
  deliveries: DeliveryView[];
  orders: OrderView[];
  openOrder: string | null;
  onToggle: (eventId: string) => void;
}) {
  // Read once for the whole list. Two cards that arrived a second apart must not be
  // measured against two different answers to "is that today", and two countdowns in
  // one list must not be counting against two different clocks.
  const now = new Date();
  const orders = groupIntoOrders(props.deliveries, props.orders, now);

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
          // One box per order, and opening the order makes that box taller. The
          // detail used to be a sibling of the card: a second bordered, tinted
          // block under a card that never changed size, which read as two things
          // about one order. It also cannot live inside the button, because a
          // button may not contain a definition list, so the card is the shell and
          // the button is only its head.
          <li
            key={order.eventId}
            className="order-card"
            data-testid={`order-card-${order.eventId}`}
            data-open={open ? 'true' : 'false'}
          >
            <button
              type="button"
              className="order-summary"
              data-testid={`order-summary-${order.eventId}`}
              data-selected={open ? 'true' : undefined}
              aria-expanded={open}
              onClick={() => props.onToggle(order.eventId)}
            >
              <span className="order-head">
                <span className="order-id">#{order.number}</span>
                {/* The machine-readable instant stays in the markup whatever the
                    card decided to print, so nothing is lost by shortening it. */}
                <time
                  className="order-at"
                  dateTime={order.receivedAt}
                  data-testid={`order-at-${order.eventId}`}
                >
                  {formatArrival(order.receivedAt, now)}
                </time>
              </span>

              <span className="order-marks">
                <span className="order-checks">
                  {order.steps.map((step) => (
                    <OrderCheck
                      key={step.target}
                      label={step.label}
                      state={step.state}
                      testId={`order-check-${order.eventId}-${step.target}`}
                    />
                  ))}
                </span>
                <span
                  className="order-progress"
                  data-testid={`order-progress-${order.eventId}`}
                >
                  {order.doneCount} of {order.total}
                </span>
              </span>

              <span className="order-headline" data-testid={`order-headline-${order.eventId}`}>
                {order.headline}
              </span>
            </button>

            {/* Always rendered, folded shut by a grid row of 0fr. A block that is
                added to the page when the card opens has no height to grow from, so
                it can only appear; one that is already there can unfold. The queue
                holds a dozen cards at most, so the markup this costs is small next
                to what it buys. */}

            <div
              className="order-fold"
              data-testid={`order-fold-${order.eventId}`}
              data-open={open ? 'true' : 'false'}
              aria-hidden={open ? undefined : 'true'}
            >
              <div className="order-detail" data-testid={`order-detail-${order.eventId}`}>
                <OrderContents eventId={order.eventId} booking={order.booking} />

                <dl className="order-steps">
                  {order.steps.map((step) => (
                    <div key={step.target} data-state={step.state}>
                      <dt>
                        <OrderCheck
                          label={step.label}
                          state={step.state}
                          testId={`order-step-check-${order.eventId}-${step.target}`}
                        />
                        <span className="order-step-label">{step.label}</span>
                      </dt>
                      <dd>{describe(step, now)}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            </div>
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
function describe(step: OrderStep, now: Date): string {
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
    default: {
      if (step.attempts === 0) return 'queued, not tried yet';
      const gap = retryGap(step.nextAt, now);
      const waiting = gap ? `retrying in ${gap}` : 'waiting to retry';
      return `attempt ${step.attempts} failed, ${waiting}` +
        (step.lastError ? ` (${step.lastError})` : '');
    }
  }
}
