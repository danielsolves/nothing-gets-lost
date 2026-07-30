// ui/src/App.tsx
// The one page (spec 2). It is a walkthrough, not a dashboard: the claim, the live
// evidence, then one instruction at a time. Everything that is not part of those
// sixty seconds sits behind the tabs at the bottom, so a first-time visitor is
// never asked to choose between nine things at once.
import { useRef, useState } from 'react';
import { Connections } from './Connections';
import { ControlPanel } from './ControlPanel';
import { CountersBar } from './Counters';
import { Deeper } from './Deeper';
import { Diagram } from './Diagram';
import { Guide } from './Guide';
import { OwnOrder } from './OwnOrder';
import { ProofPanel } from './ProofPanel';
import { SqlConsole } from './SqlConsole';
import { Timeline } from './Timeline';
import { useStream } from './useStream';

export function App() {
  const {
    counters, switches, deliveries, timeline, viewers, connected, extractorMode,
  } = useStream();
  const [placed, setPlaced] = useState<string | null>(null);
  const [ownOrderOpen, setOwnOrderOpen] = useState(false);
  const ownOrder = useRef<HTMLDivElement>(null);

  function revealOwnOrder(): void {
    setOwnOrderOpen(true);
    // The form is the payoff of the walkthrough, so take the visitor to it rather
    // than leaving them to find it.
    requestAnimationFrame(() => {
      ownOrder.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  return (
    <>
      {/* Two fixed decorative layers, both pointer-transparent. */}
      <div className="aurora" aria-hidden="true" />
      <div className="grain" aria-hidden="true" />

      <main className="page">
        <header className="claim">
          <h1>Nothing gets lost. Not even when you break it.</h1>
          <p className="sub">
            An order here runs through four real systems. Break one on purpose and
            watch what happens to the orders already on their way.
          </p>
          <p className="status">
            <span className={connected ? 'live' : 'offline'} data-testid="connection">
              {connected ? 'live' : 'reconnecting'}
            </span>
            {extractorMode === 'recorded' && (
              <span data-testid="extractor-mode">
                Recorded operation. No model key is configured, so the reading step
                replays answers captured earlier.
              </span>
            )}
            {viewers > 1 && (
              <span data-testid="presence">
                Somebody else is experimenting right now. You are watching their
                events too.
              </span>
            )}
          </p>
        </header>

        <Guide switches={switches} onFinished={revealOwnOrder} />

        {/* The live evidence stays on screen for every step of the walkthrough. */}
        <CountersBar counters={counters} />

        <section className="board">
          <Diagram switches={switches} deliveries={deliveries} />
          <div className="log">
            <h2>What just happened</h2>
            <Timeline entries={timeline} />
          </div>
        </section>

        <div ref={ownOrder}>
          {ownOrderOpen ? (
            <OwnOrder onPlaced={setPlaced} />
          ) : (
            <p className="own-order-locked" data-testid="own-order-locked">
              The last step of the walkthrough opens the form for your own order.
            </p>
          )}
        </div>

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
