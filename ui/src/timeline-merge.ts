// ui/src/timeline-merge.ts
// Folds one incoming log line into the list the page is showing.
//
// The stream pushes the whole board every second, the log included. That is the
// right call on the server: no change feed to maintain, and a visitor who arrives
// halfway through somebody else's experiment sees the world as it is. The cost is
// that the same line arrives again every second, and this is where that is caught.
//
// Deliveries were already folded by id. Log lines carry no id, so identity is the
// three fields that make a line what it is: when it happened, which event it
// belongs to, and what it says. Two attempts on the same target differ in `at`;
// two targets failing in the same millisecond differ in `text`.
import type { TimelineEntry } from '@ngl/contracts';

/** Enough to read back through a full retry schedule, few enough to stay a panel. */
export const TIMELINE_KEPT = 40;

function identity(entry: TimelineEntry): string {
  return `${entry.at}|${entry.eventId}|${entry.text}`;
}

export function mergeTimeline(
  current: TimelineEntry[], incoming: TimelineEntry,
): TimelineEntry[] {
  const key = identity(incoming);
  if (current.some((entry) => identity(entry) === key)) return current;

  // Sorted rather than simply prepended: the board arrives oldest-last within a
  // tick, and a reconnect replays it in whatever order the stream feels like.
  return [incoming, ...current]
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, TIMELINE_KEPT);
}
