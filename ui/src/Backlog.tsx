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
import type { DeliveryView, OrderView } from '@ngl/contracts';
import { backlogOf } from './backlog-rows';

export function Backlog(props: {
  deliveries: DeliveryView[];
  orders: OrderView[];
}) {
  const rows = backlogOf(props.deliveries, props.orders);

  if (rows.length === 0) {
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
      <ul className="backlog-list" data-testid="backlog-list">
        {rows.map((row) => (
          <li key={row.id} className="backlog-row" data-testid={`backlog-row-${row.id}`}>
            <span className="backlog-order">
              {row.number === null ? `id ${row.id}` : `Order #${row.number}`}
            </span>
            <span className="backlog-target">{row.label}</span>
            <span className="backlog-note">
              written to the backlog after {row.attempts}{' '}
              {row.attempts === 1 ? 'attempt' : 'attempts'}, a person has to review it
              {row.lastError ? ` (${row.lastError})` : ''}
            </span>
          </li>
        ))}
      </ul>

      {/* The point of the panel. Whatever it lists above, this is how a reader finds
          out whether the list is true, and it is not this page. */}
      <p className="backlog-check" data-testid="backlog-check">
        Ask for these yourself with the <code>backlog_list</code> tool on the MCP
        server, which reads them straight out of the database.
      </p>
    </>
  );
}
