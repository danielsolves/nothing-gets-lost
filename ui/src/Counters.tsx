// ui/src/Counters.tsx
// The header. "lost: 0" gets its own emphasis because it is the claim the whole
// page exists to support — everything else is context for that one number.
import type { Counters } from '@ngl/contracts';

export function CountersBar({ counters }: { counters: Counters }) {
  return (
    <div className="counters">
      <Counter testId="received" label="received" value={counters.received} />
      <Counter testId="delivered" label="delivered" value={counters.delivered} />
      {counters.waiting > 0 && (
        <Counter testId="waiting" label="waiting" value={counters.waiting} tone="warn" />
      )}
      {counters.duplicatesDropped > 0 && (
        <Counter testId="duplicates" label="duplicates dropped"
                 value={counters.duplicatesDropped} />
      )}
      {counters.needsHuman > 0 && (
        <Counter testId="needs-human" label="needs a human"
                 value={counters.needsHuman} tone="warn" />
      )}
      <Counter testId="lost" label="lost" value={counters.lost} emphasis />
    </div>
  );
}

function Counter(props: {
  testId: string; label: string; value: number;
  emphasis?: boolean; tone?: 'warn';
}) {
  return (
    <div
      className={`counter ${props.tone ?? ''} ${props.emphasis ? 'emphasis' : ''}`}
      data-testid={props.testId}
      data-emphasis={props.emphasis ? 'true' : undefined}
    >
      <span className="value">{props.value}</span>
      <span className="label">{props.label}</span>
    </div>
  );
}
