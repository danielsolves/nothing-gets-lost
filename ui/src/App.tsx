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
          <Diagram
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

          {/* This used to be the fine print at the bottom of the control panel
              drawer. The drawer has gone and the sentence has not: it is the one
              that stops a visitor reading the whole thing as an animation. */}
          <p className="board-note">
            Every action here is real. Stripe runs in test mode with real webhooks.
            HubSpot is up. We simply stop being able to reach it, which is the most
            common real-world outage.
          </p>
        </section>

        {/* Spec 8.5 wants this said out loud. It sits here, next to the machine it
            is about, rather than beside the live badge where it read as a denial of
            the whole page. It describes one step: reading a free-text order mail. */}
        {extractorMode === 'recorded' && (
          <p className="extractor-note" data-testid="extractor-mode">
            One step is not live: reading a free-text order mail. No model key is
            configured, so that step replays answers captured earlier. Everything
            else above is running now.
          </p>
        )}

        {placed && (
          <>
            <p className="placed" data-testid="placed">
              Your order is event {placed.eventId}. Watch it in the queue above
              {placed.expectMail ? ', and in your inbox.' : '.'}
            </p>
            {/* The proof chain is at its strongest for an order the visitor placed
                themselves with their own address: the second timestamp is then
                stamped by their own mail server. */}
            <ProofPanel eventId={placed.eventId} expectMail={placed.expectMail} />
          </>
        )}

        <Deeper connect={<Connections />} sql={<SqlConsole />} />
      </main>
    </>
  );
}
