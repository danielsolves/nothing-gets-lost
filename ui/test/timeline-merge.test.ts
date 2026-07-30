// ui/test/timeline-merge.test.ts
// The stream pushes the whole board once a second, including the whole log. That is
// deliberate on the server side: it needs no change feed and a visitor who arrives
// mid-experiment gets the current world. It does mean the page receives the same
// log line over and over, and it has to recognise it.
//
// Deliveries were already deduplicated by id. Log lines were not, so after a minute
// on the page each of four real events was drawn about sixty times and the panel
// pushed the rest of the page off the screen.
import { describe, it, expect } from 'vitest';
import type { TimelineEntry } from '@ngl/contracts';
import { mergeTimeline, TIMELINE_KEPT } from '../src/timeline-merge';

const entry = (at: string, text: string): TimelineEntry => ({
  at, text, eventId: 'evt-1', level: 'info',
});

describe('mergeTimeline', () => {
  it('keeps a line it has not seen', () => {
    const merged = mergeTimeline([], entry('2026-07-30T22:29:29.980Z', 'Invoice confirmed'));
    expect(merged).toHaveLength(1);
  });

  it('ignores the same line arriving again a second later', () => {
    const line = entry('2026-07-30T22:29:29.980Z', 'Invoice confirmed');
    const merged = mergeTimeline(mergeTimeline([], line), line);
    expect(merged).toHaveLength(1);
  });

  it('survives the same line arriving sixty times', () => {
    const line = entry('2026-07-30T22:29:29.980Z', 'Invoice confirmed');
    let merged: TimelineEntry[] = [];
    for (let i = 0; i < 60; i++) merged = mergeTimeline(merged, line);
    expect(merged).toHaveLength(1);
  });

  it('tells two lines apart when only the text differs', () => {
    const at = '2026-07-30T22:29:29.980Z';
    const merged = mergeTimeline(
      mergeTimeline([], entry(at, 'Stripe: attempt 3 failed')),
      entry(at, 'Slack: attempt 3 failed'),
    );
    expect(merged).toHaveLength(2);
  });

  it('tells two attempts apart when only the time differs', () => {
    const merged = mergeTimeline(
      mergeTimeline([], entry('2026-07-30T22:29:29.980Z', 'Stripe: attempt 3 failed')),
      entry('2026-07-30T22:29:33.100Z', 'Stripe: attempt 3 failed'),
    );
    expect(merged).toHaveLength(2);
  });

  it('shows the newest line first whatever order they arrive in', () => {
    const merged = mergeTimeline(
      mergeTimeline([], entry('2026-07-30T22:29:29.980Z', 'older')),
      entry('2026-07-30T22:30:22.739Z', 'newer'),
    );
    expect(merged.map((e) => e.text)).toEqual(['newer', 'older']);
  });

  it('stops growing, so a long session cannot eat the page', () => {
    let merged: TimelineEntry[] = [];
    for (let i = 0; i < TIMELINE_KEPT + 25; i++) {
      merged = mergeTimeline(merged, entry(`2026-07-30T22:${String(i).padStart(2, '0')}:00.000Z`, `line ${i}`));
    }
    expect(merged).toHaveLength(TIMELINE_KEPT);
  });

  it('drops the oldest line when it runs out of room', () => {
    let merged: TimelineEntry[] = [];
    for (let i = 0; i < TIMELINE_KEPT + 1; i++) {
      merged = mergeTimeline(merged, entry(`2026-07-30T22:${String(i).padStart(2, '0')}:00.000Z`, `line ${i}`));
    }
    expect(merged.some((e) => e.text === 'line 0')).toBe(false);
    expect(merged[0].text).toBe(`line ${TIMELINE_KEPT}`);
  });
});
