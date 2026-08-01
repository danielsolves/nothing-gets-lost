// ui/src/App.tsx
// The one page (spec 2). The claim, then the machine itself. Everything that is not
// part of the first sixty seconds sits behind the strip at the bottom, so a
// first-time visitor is never asked to choose between nine things at once.
//
// It used to open with a five-step walkthrough. Once the diagram became clickable
// that meant two things on screen telling the visitor what to do, so the walkthrough
// went and the diagram carries it: one loud button to send an order, and every system
// in the picture is the switch that breaks it.
//
// A bar of counters used to sit above the machine, for the reason spec 2 wants a
// running score on screen. The hub then grew a row of the same numbers. Showing
// "lost 0" in two places does not make it twice as true, so the bar went and the hub
// kept them: they belong next to the queue they are counting.
//
// Two whole sections have gone since, and the reason is the same for both. The proof
// chain panel rendered two foreign timestamps and the gap between them, and the SQL
// console let a visitor query our database. Both were our screen asking to be
// believed about our own data. What survives is what a stranger can check without
// us: the Stripe receipt on stripe.com, the confirmation mail in their own inbox,
// every delivery arriving at an endpoint of theirs, and the backlog through the MCP
// server.
import { useMemo, useState } from 'react';
import { Connections } from './Connections';
import { Diagram } from './Diagram';
import { McpServer } from './McpServer';
import { OrderForm } from './OrderForm';
import { Mediator } from './Mediator';
import { Outside } from './Outside';
import { Stage } from './Stage';
import { useArrivalHold } from './useArrivalHold';
import { useStream } from './useStream';

export function App() {
  const {
    counters, switches, deliveries, orders, timeline, extractorMode, viewers,
  } = useStream();
  // One open card at a time, and open doubles as selected: the order being read is
  // the one marked in the diagram.
  const [openOrder, setOpenOrder] = useState<string | null>(null);

  // The hub reads a board held back until the dot carrying a new order has finished
  // travelling to it; the diagram reads the live one, because the dot is the thing
  // being waited for. Memoised because the hold is keyed to this value: rebuilt every
  // render, it would look like a new board every render and never settle.
  const board = useMemo(
    () => ({ counters, deliveries, orders }), [counters, deliveries, orders],
  );
  const held = useArrivalHold(board);

  return (
    <>
      {/* Two fixed decorative layers, both pointer-transparent. */}
      <div className="aurora" aria-hidden="true" />
      <div className="grain" aria-hidden="true" />

      <main className="page">
        <Stage />

        {/* The machine: hub in the middle, the systems it delivers to around it.
            The hub carries the queue, the log and the backlog, so none of the three
            needs a panel of its own further down the page. */}
        <section className="board">
          <Diagram
            extractorMode={extractorMode}
            switches={switches}
            deliveries={deliveries}
            orders={orders}
            openOrder={openOrder}
            orderForm={
              // Nothing listens any more. The panel that did fed on it is gone, and
              // an order announces itself where it belongs: as a card in the queue.
              <OrderForm onPlaced={() => {}} />
            }
            hub={
              <Mediator
                counters={held.counters}
                deliveries={held.deliveries}
                orders={held.orders}
                timeline={timeline}
                viewers={viewers}
                openOrder={openOrder}
                onToggleOrder={(eventId) =>
                  setOpenOrder((current) => (current === eventId ? null : eventId))}
              />
            }
          />
        </section>

        <Outside endpoint={<Connections />} mcp={<McpServer />} />
      </main>
    </>
  );
}
