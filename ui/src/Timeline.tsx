// ui/src/Timeline.tsx
// The running log. Failures are shown with their next retry time, so waiting reads
// as "held" rather than "broken" — that difference is the whole point.
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
    <ol className="timeline" data-testid="timeline">
      {entries.map((entry, index) => (
        <li key={`${entry.at}-${index}`} className={`level-${entry.level}`}>
          <time>{new Date(entry.at).toLocaleTimeString()}</time>
          <span>{entry.text}</span>
        </li>
      ))}
    </ol>
  );
}
