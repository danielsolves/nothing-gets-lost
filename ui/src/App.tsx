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
import { ControlPanel } from './ControlPanel';
import { CountersBar } from './Counters';
import { Deeper } from './Deeper';
import { Diagram } from './Diagram';
import { OwnOrder } from './OwnOrder';
import { ProofPanel } from './ProofPanel';
import { Queue } from './Queue';
import { SqlConsole } from './SqlConsole';
import { Stage } from './Stage';
import { Timeline } from './Timeline';
import { useStream } from './useStream';

export function App() {
  const {
    counters, switches, deliveries, timeline, viewers, connected, extractorMode,
  } = useStream();
  const [placed, setPlaced] = useState<string | null>(null);
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

        {/* The queue on the left, the systems on the right. The same thing twice:
            a card is an order, a wire is one of its checkpoints. */}
        <section className="board">
          <section className="queue-panel">
            <h2>In the queue</h2>
            <Queue
              deliveries={deliveries}
              openOrder={openOrder}
              onToggle={(eventId) =>
                setOpenOrder((current) => (current === eventId ? null : eventId))}
            />
          </section>
          <Diagram switches={switches} deliveries={deliveries} openOrder={openOrder} />
        </section>

        <section className="log">
          <h2>What just happened</h2>
          <Timeline entries={timeline} />
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

        {/* No longer locked behind finishing a walkthrough there no longer is. */}
        <OwnOrder onPlaced={setPlaced} />

        {placed && (
          <>
            <p className="placed" data-testid="placed">
              Your order is event {placed}. Watch it in the log above, and in your
              inbox.
            </p>
            {/* The proof chain only means anything for an order the visitor placed
                themselves: the second timestamp is stamped by their own mail server. */}
            <ProofPanel eventId={placed} />
          </>
        )}

        <Deeper
          panel={<ControlPanel switches={switches} />}
          connect={<Connections />}
          sql={<SqlConsole />}
        />
      </main>
    </>
  );
}
