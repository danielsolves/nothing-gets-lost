// ui/src/Timeline.tsx
// The running log. Failures are shown with their next retry time, so waiting reads
// as "held" rather than "broken" — that difference is the whole point.
import type { TimelineEntry } from '@ngl/contracts';

export function Timeline({ entries }: { entries: TimelineEntry[] }) {
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
