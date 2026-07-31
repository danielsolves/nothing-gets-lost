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
import { useState } from 'react';
import { Connections } from './Connections';
import { CountersBar } from './Counters';
import { Deeper } from './Deeper';
import { Diagram } from './Diagram';
import { OrderForm } from './OrderForm';
import { ProofPanel } from './ProofPanel';
import { Mediator } from './Mediator';
import { SqlConsole } from './SqlConsole';
import { Stage } from './Stage';
import { useStream } from './useStream';

export function App() {
  const {
    counters, switches, deliveries, timeline, viewers, connected, extractorMode,
  } = useStream();
  // The order the visitor just sent, and whether a confirmation mail is coming for
  // it. Without an address there is no second witness, and the proof panel has to
  // say so rather than wait for a timestamp that will never arrive.
  const [placed, setPlaced] = useState<{ eventId: string; expectMail: boolean } | null>(null);
  // One open card at a time, and open doubles as selected: the order being read is
  // the one marked in the diagram.
  const [openOrder, setOpenOrder] = useState<string | null>(null);

  return (
    <>
      {/* Two fixed decorative layers, both pointer-transparent. */}
      <div className="aurora" aria-hidden="true" />
      <div className="grain" aria-hidden="true" />

      <main className="page">
        <Stage connected={connected} viewers={viewers} />

        {/* The counters stay above everything: spec 2 wants the running score
            on screen for every second of the demo, lost included. */}
        <CountersBar counters={counters} />

        {/* The machine: hub in the middle, the systems it delivers to around it.
            The hub carries the queue and the log, so neither needs a panel of its
            own further down the page. */}
        <section className="board">
          {/* Above the machine, not below it. This was the fine print at the foot
              of the control panel drawer, and then the fine print under the
              diagram, where nobody reads it. It is the sentence that stops a
              visitor taking the whole thing for an animation, so it goes where it
              is read. */}
          <p className="board-note">
            Every action here is real. Stripe runs in test mode with real webhooks.
            HubSpot is up. We simply stop being able to reach it, which is the most
            common real-world outage.
          </p>

          <Diagram
            extractorMode={extractorMode}
            switches={switches}
            deliveries={deliveries}
            openOrder={openOrder}
            orderForm={
              <OrderForm
                onPlaced={(eventId, expectMail) => setPlaced({ eventId, expectMail })}
              />
            }
            hub={
              <Mediator
                counters={counters}
                deliveries={deliveries}
                timeline={timeline}
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

        <Deeper connect={<Connections />} sql={<SqlConsole />} />
      </main>
    </>
  );
}
