// ui/src/Backlog.tsx
// What the machine could not deliver, as the mediator's third panel.
//
// It began as a box of its own under the systems, which put two panels on the page
// about the same thing: the mediator holds the queue and the log, and this is the
// third thing it holds. The tab strip it now sits in is labelled "what the mediator
// holds", so the panel had been arguing with its own neighbour.
//
// Not a system in the drawing either, which was the other idea. A system is
// somewhere we deliver to, drawn with a line to it. Nothing is delivered to the
// backlog; it is where a delivery stops. Drawing it as a node would say the opposite
// of what it is.
//
// It had a shape of its own for a while: one flat row of order number, system name
// and a grey sentence that ended in the driver's words inside brackets. Two
// notations for one thing, and a visitor who had just learned to read an order card
// one tab away had to learn the second one here. Worse, the one fact the panel
// exists to carry, what went wrong, was the last few words of the quietest line.
//
// So it draws the queue's card. The same shell, the same head, the same five marks,
// the same fold, and the fault stands where the queue puts its headline: what came
// back, whole, on a line of its own, with which system and who has it now underneath.
//
// The markup is written out here rather than lifted into a shell both panels share.
// The two heads differ in most of what a head is: this one has no order number to
// print when the order is not on the board, no arrival to print with it, and it
// leads with faults instead of a headline. A shell taking a slot for each of those
// is an indirection for two callers that would still read as two heads.
//
// The fold does not repeat the per-step account the queue card gives. The marks in
// the head already say what happened to every checkpoint, and the queue holds the
// same order one tab away with the full version. What it carries instead is what a
// person triaging the entry needs and could not get here before: what was in the
// order, and the id to ask somebody other than this page about.
//
// It opens its own cards rather than sharing the queue's open one. Opening a queue
// card also lights that order up in the drawing; a backlog is read to decide what to
// do about an entry, which is not the same errand.
import { useState } from 'react';
import type { DeliveryView, OrderView } from '@ngl/contracts';
import { backlogCards } from './backlog-rows';
import { formatArrival } from './order-time';
import { OrderCheck } from './OrderCheck';
import { OrderContents } from './OrderContents';

export function Backlog(props: {
  deliveries: DeliveryView[];
  orders: OrderView[];
}) {
  const [open, setOpen] = useState<string | null>(null);
  // Read once for the whole list, the way the queue does it: two entries that
  // arrived a second apart must not be measured against two different answers to
  // "is that today".
  const now = new Date();
  const cards = backlogCards(props.deliveries, props.orders);

  if (cards.length === 0) {
    return (
      <p className="backlog-empty" data-testid="backlog-empty">
        Nothing is waiting. A delivery that uses up its six attempts is written here
        and stays until a person deals with it. Retrying will not clear it and
        neither will this page. The entries can be read from outside this page with
        the <code>backlog_list</code> tool on the MCP server.
      </p>
    );
  }

  return (
    <>
      <ol className="queue" data-testid="backlog-list">
        {cards.map((card) => {
          const shown = open === card.eventId;
          const ids = card.faults.map((fault) => fault.id).join(', ');

          return (
            <li
              key={card.eventId}
              className="order-card"
              data-testid={`backlog-card-${card.id}`}
              data-open={shown ? 'true' : 'false'}
            >
              <button
                type="button"
                className="order-summary"
                data-testid={`backlog-summary-${card.id}`}
                aria-expanded={shown}
                onClick={() =>
                  setOpen((current) => (current === card.eventId ? null : card.eventId))}
              >
                <span className="order-head">
                  {/* The order number where there is one. Where there is not, the
                      delivery id, which is the handle v_backlog and backlog_entry
                      answer to and therefore still something a reader can use. */}
                  <span className="order-id">
                    {card.number === null ? `id ${card.id}` : `Order #${card.number}`}
                  </span>
                  {card.receivedAt !== null && (
                    <time
                      className="order-at"
                      dateTime={card.receivedAt}
                      data-testid={`backlog-at-${card.id}`}
                    >
                      {formatArrival(card.receivedAt, now)}
                    </time>
                  )}
                </span>

                {/* Every checkpoint, not only the stopped one. Whether the invoice
                    went out while Slack did not is the first thing a person picking
                    this up asks, and the old row could not answer it at all. */}
                <span className="order-checks">
                  {card.steps.map((step) => (
                    <OrderCheck
                      key={step.target}
                      target={step.target}
                      label={step.label}
                      state={step.state}
                      attempts={step.attempts}
                      testId={`backlog-mark-${card.id}-${step.target}`}
                    />
                  ))}
                </span>

                {card.faults.map((fault) => (
                  <span
                    key={fault.id}
                    className="backlog-fault"
                    data-testid={`backlog-fault-${fault.id}`}
                  >
                    <b className="backlog-fault-why" data-testid={`backlog-why-${fault.id}`}>
                      {fault.why}
                    </b>
                    <span className="backlog-fault-how">{fault.how}</span>
                  </span>
                ))}
              </button>

              {/* Folded exactly as a queue card folds, and always in the markup for
                  the same reason: a block added on the click has no height to grow
                  from, so it can only appear. */}
              <div
                className="order-fold"
                data-testid={`backlog-fold-${card.id}`}
                data-open={shown ? 'true' : 'false'}
                aria-hidden={shown ? undefined : 'true'}
              >
                <div className="order-detail" data-testid={`backlog-detail-${card.id}`}>
                  <OrderContents eventId={card.eventId} booking={card.booking} />

                  <p className="backlog-ids" data-testid={`backlog-ids-${card.id}`}>
                    {card.faults.length === 1
                      ? `It is in the backlog as id ${ids}.`
                      : `They are in the backlog as ids ${ids}.`}
                    {' '}
                    The MCP server hands over the whole entry, and the order behind
                    it, with <code>backlog_entry</code>.
                  </p>
                </div>
              </div>
            </li>
          );
        })}
      </ol>

      {/* The point of the panel. Whatever it lists above, this is how a reader finds
          out whether the list is true, and it is not this page. */}
      <p className="backlog-check" data-testid="backlog-check">
        Ask for these yourself with the <code>backlog_list</code> tool on the MCP
        server, which reads them straight out of the database.
      </p>
    </>
  );
}
