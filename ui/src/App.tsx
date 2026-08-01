// ui/src/App.tsx
// The one page (spec 2). The claim, then the machine itself, then the evidence it
// produces. Everything that is not part of the first sixty seconds sits behind the
// tabs at the bottom, so a first-time visitor is never asked to choose between nine
// things at once.
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
import { useMemo, useState } from 'react';
import { Backlog } from './Backlog';
import { Connections } from './Connections';
import { Deeper, type DeeperTab } from './Deeper';
import { Diagram } from './Diagram';
import { OrderForm } from './OrderForm';
import { ProofPanel } from './ProofPanel';
import { Mediator } from './Mediator';
import { SqlConsole } from './SqlConsole';
import { Stage } from './Stage';
import { useArrivalHold } from './useArrivalHold';
import { useStream } from './useStream';

export function App() {
  const {
    counters, switches, deliveries, orders, timeline, extractorMode, connected, viewers,
  } = useStream();
  // The order the visitor just sent, and whether a confirmation mail is coming for
  // it. Without an address there is no second witness, and the proof panel has to
  // say so rather than wait for a timestamp that will never arrive.
  const [placed, setPlaced] = useState<{ eventId: string; expectMail: boolean } | null>(null);
  // One open card at a time, and open doubles as selected: the order being read is
  // the one marked in the diagram.
  const [openOrder, setOpenOrder] = useState<string | null>(null);
  // Which of the further tools is open. Held here rather than inside Deeper because
  // a tile can send the visitor to one of them: the check on a system we read back
  // ourselves offers connecting your own account as the way out of taking our word.
  const [deeper, setDeeper] = useState<DeeperTab | null>(null);

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
            The hub carries the queue and the log, so neither needs a panel of its
            own further down the page. */}
        <section className="board">
          <Diagram
            extractorMode={extractorMode}
            onConnectOwn={() => setDeeper('connect')}
            switches={switches}
            deliveries={deliveries}
            openOrder={openOrder}
            orderForm={
              <OrderForm
                onPlaced={(eventId, expectMail) => setPlaced({ eventId, expectMail })}
              />
            }
            backlog={
              <Backlog deliveries={held.deliveries} orders={held.orders} />
            }
            hub={
              <Mediator
                counters={held.counters}
                deliveries={held.deliveries}
                orders={held.orders}
                timeline={timeline}
                connected={connected}
                viewers={viewers}
                openOrder={openOrder}
                onToggleOrder={(eventId) =>
                  setOpenOrder((current) => (current === eventId ? null : eventId))}
              />
            }
          />
        </section>

        {/* The proof chain is at its strongest for an order the visitor placed
            themselves with their own address: the second timestamp is then stamped
            by their own mail server.

            There is no line here announcing the event id any more. It said "Your
            order is event 366efd15-025e-4d46-b3ca-4951a3312e0a", which is not a
            thing anybody reads, and the card in the queue now carries the order's
            own number. */}
        {placed && (
          <ProofPanel eventId={placed.eventId} expectMail={placed.expectMail} />
        )}

        <Deeper
          connect={<Connections />}
          sql={<SqlConsole />}
          open={deeper}
          onOpen={setDeeper}
        />
      </main>
    </>
  );
}
