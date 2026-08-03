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
//
// Under that, one mark per checkpoint, and each mark is that system's own: the same
// Stripe S and HubSpot sprocket the tiles wear, so the queue and the drawing are one
// picture seen twice. A count stood beside them for a while and has gone; five marks
// that can each be read are already the count.
import { isIndisputable, type DeliveryView, type OrderView } from '@ngl/contracts';
import { groupIntoOrders, type OrderStep } from './order-cards';
import { OrderCheck } from './OrderCheck';
import { OrderContents } from './OrderContents';
import { formatArrival, retryGap } from './order-time';
import { StepProof } from './StepProof';

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
                {/* "Order #1042" and not "#1042". The number on its own does not
                    say what it numbers, and this is the handle a visitor reads out
                    loud, puts in a mail, or asks the database for. */}
                <span className="order-id">Order #{order.number}</span>
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

              {/* No "2 of 5" beside these any more. It stood next to five marks
                  that already said it, and a second copy of a count can only ever
                  agree with the first one or be a bug. */}
              <span className="order-checks">
                {order.steps.map((step) => (
                  <OrderCheck
                    key={step.target}
                    target={step.target}
                    label={step.label}
                    state={step.state}
                    attempts={step.attempts}
                    testId={`order-check-${order.eventId}-${step.target}`}
                  />
                ))}
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
                          target={step.target}
                          label={step.label}
                          state={step.state}
                          attempts={step.attempts}
                          testId={`order-step-check-${order.eventId}-${step.target}`}
                        />
                        <span className="order-step-label">{step.label}</span>
                      </dt>
                      <dd>
                        {describe(step, now)}
                        {/* Only where something was actually written, and only where
                            the answer is not our own. A step that has not been
                            delivered has no record to go and look at. A step read
                            back through our own account with our own token has one,
                            and offering it would be this page vouching for itself:
                            the same button came off the system tiles for that reason,
                            and the same target must not get two verdicts on two
                            surfaces. No order number here, because this is the card
                            of the order and the button is already about one. */}
                        {step.state === 'done' && isIndisputable(step.target) && (
                          <StepProof
                            eventId={order.eventId}
                            target={step.target}
                            label={step.label}
                          />
                        )}
                      </dd>
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
 * One line per checkpoint, saying the thing that is otherwise only in the delivery
 * row itself: how many attempts, what came back, what went wrong.
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
    // Where it went, not only that it stopped. "Gave up" was true and was also the
    // end of the sentence, so a reader was left to guess whether anything had
    // happened to the order afterwards. It is in the backlog, the backlog has a
    // name, and the panel beside the systems lists it.
    case 'dead':
      return `written to the backlog after ${step.attempts} attempts, `
        + 'a person has to review it'
        + (step.lastError ? ` (${step.lastError})` : '');
    default: {
      if (step.attempts === 0) return 'queued, not tried yet';
      const gap = retryGap(step.nextAt, now);
      const waiting = gap ? `retrying in ${gap}` : 'waiting to retry';
      return `attempt ${step.attempts} failed, ${waiting}` +
        (step.lastError ? ` (${step.lastError})` : '');
    }
  }
}
