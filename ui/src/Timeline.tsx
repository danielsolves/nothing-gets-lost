// ui/src/Timeline.tsx
// The running log. Failures are shown with their next retry time, so waiting reads
// as "held" rather than "broken" — that difference is the whole point.
//
// It scrolls inside a fixed height rather than growing. In normal flow it pushed
// the counters, the diagram and the walkthrough off the first screen within a
// minute, which turned the strongest evidence into the reason nobody sees it.
import type { TimelineEntry } from '@ngl/contracts';

export function Timeline({ entries }: { entries: TimelineEntry[] }) {
  // A visitor landing on a quiet page must still be told what this box is for,
  // otherwise the first screen shows a heading with nothing underneath it.
  if (entries.length === 0) {
    return (
      <p className="timeline-empty" data-testid="timeline-empty">
        Nothing has happened yet. Place an order below, or cut a connection first
        and then place one.
      </p>
    );
  }

  return (
    <div
      className="timeline-scroll"
      data-testid="timeline-scroll"
      role="log"
      aria-label="Delivery log, newest first"
      tabIndex={0}
    >
      <ol className="timeline" data-testid="timeline">
        {entries.map((entry) => (
          <li key={`${entry.at}-${entry.eventId}-${entry.text}`} className={`level-${entry.level}`}>
            <time>{new Date(entry.at).toLocaleTimeString()}</time>
            <span>{entry.text}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
