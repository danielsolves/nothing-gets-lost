// ui/src/Backlog.tsx
// The backlog, under the systems it could not reach.
//
// It is here rather than inside the mediator for two reasons. The mediator holds
// what is still moving; this holds what has stopped, and folding the two together is
// what let a parked delivery disappear into a list of things that were merely slow.
// And the space under the tiles was empty: the hub is about twice their height, so
// the right-hand column ended halfway down the machine with nothing under it.
//
// The panel is always drawn, empty or not. Empty is the state this demo is in almost
// all the time, and an empty backlog that explains itself is the strongest thing on
// the page: it says what would land here, and it hands over the two ways to check
// that claim from outside the page.
import type { DeliveryView, OrderView } from '@ngl/contracts';
import { backlogOf } from './backlog-rows';

export function Backlog(props: {
  deliveries: DeliveryView[];
  orders: OrderView[];
}) {
  const rows = backlogOf(props.deliveries, props.orders);

  return (
    <section className="backlog" data-testid="backlog">
      <header className="backlog-head">
        <span className="backlog-titles">
          <span className="backlog-title">Backlog</span>
          <span className="backlog-sub">waiting for a person</span>
        </span>
        {rows.length > 0 && (
          <span className="backlog-count" data-testid="backlog-count">
            {rows.length}
          </span>
        )}
      </header>

      {rows.length === 0 ? (
        <p className="backlog-empty" data-testid="backlog-empty">
          Nothing is waiting. A delivery that uses up its six attempts is written
          here and stays until a person deals with it. Retrying will not clear it and
          neither will this page.
        </p>
      ) : (
        <ul className="backlog-list" data-testid="backlog-list">
          {rows.map((row) => (
            <li key={row.id} className="backlog-row" data-testid={`backlog-row-${row.id}`}>
              <span className="backlog-order">
                {row.number === null ? `id ${row.id}` : `#${row.number}`}
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
      )}

      {/* The point of the panel. Whatever it says above, these two lines are how a
          reader finds out whether it is true, and neither of them is this page. */}
      <p className="backlog-check" data-testid="backlog-check">
        Read it yourself: <code>SELECT * FROM v_backlog</code> in the SQL console, or
        the <code>backlog_list</code> tool on the MCP server at <code>/mcp</code>.
      </p>
    </section>
  );
}
