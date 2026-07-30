// ui/src/App.tsx
// The one page (spec 2). Order is the argument: the claim, the counters that back
// it, the diagram, then the log — a phone shows them in exactly that sequence, and
// a visitor who reads only the first screen has still seen the point.
import { useState } from 'react';
import { ControlPanel } from './ControlPanel';
import { CountersBar } from './Counters';
import { Diagram } from './Diagram';
import { OwnOrder } from './OwnOrder';
import { Timeline } from './Timeline';
import { useStream } from './useStream';

export function App() {
  const { counters, switches, deliveries, timeline, viewers, connected } = useStream();
  const [placed, setPlaced] = useState<string | null>(null);

  return (
    <main className="page">
      <header className="claim">
        <h1>Nothing gets lost. Not even when you break it.</h1>
        <p className="sub">
          Every order below runs through real systems. Cut one off and watch what
          happens to the ones already on their way.
        </p>
        <CountersBar counters={counters} />
        <p className="status">
          <span className={connected ? 'live' : 'offline'} data-testid="connection">
            {connected ? 'live' : 'reconnecting'}
          </span>
          {viewers > 1 && (
            <span data-testid="presence">
              Somebody else is experimenting right now — you are watching their
              events too.
            </span>
          )}
        </p>
      </header>

      <section className="board">
        <Diagram switches={switches} deliveries={deliveries} />
        <ControlPanel switches={switches} />
      </section>

      <section className="log">
        <h2>What just happened</h2>
        <Timeline entries={timeline} />
      </section>

      <OwnOrder onPlaced={setPlaced} />
      {placed && (
        <p className="placed" data-testid="placed">
          Your order is event {placed}. Watch it in the log above — and in your
          inbox.
        </p>
      )}
    </main>
  );
}
