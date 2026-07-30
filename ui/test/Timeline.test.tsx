// @vitest-environment jsdom
// ui/test/Timeline.test.tsx
// The log has to stay a panel, not a column. It sat in normal flow and grew with
// every line, so after a minute the counters, the diagram and the walkthrough had
// been pushed off the first screen by a list of retry messages.
//
// Fixed height, its own scrollbar, and reachable from the keyboard, because a
// scrollable region that only a mouse can reach is not finished.
import { describe, it, expect, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { TimelineEntry } from '@ngl/contracts';
import { Timeline } from '../src/Timeline';

// Testing Library only auto-cleans when vitest runs with globals; this project
// imports its test hooks explicitly, so the unmount is wired by hand.
afterEach(cleanup);

const entries: TimelineEntry[] = Array.from({ length: 30 }, (_, i) => ({
  at: `2026-07-30T22:${String(i).padStart(2, '0')}:00.000Z`,
  eventId: 'evt-1',
  text: `line ${i}`,
  level: 'info',
}));

describe('Timeline', () => {
  it('explains itself while nothing has happened', () => {
    render(<Timeline entries={[]} />);
    expect(screen.getByTestId('timeline-empty')).toBeInTheDocument();
  });

  it('shows the lines it is given', () => {
    render(<Timeline entries={entries.slice(0, 3)} />);
    expect(screen.getByText('line 0')).toBeInTheDocument();
    expect(screen.getByText('line 2')).toBeInTheDocument();
  });

  it('scrolls inside itself instead of stretching the page', () => {
    render(<Timeline entries={entries} />);
    expect(screen.getByTestId('timeline-scroll')).toBeInTheDocument();
  });

  it('lets a keyboard reach the scrollable region', () => {
    render(<Timeline entries={entries} />);
    expect(screen.getByTestId('timeline-scroll')).toHaveAttribute('tabindex', '0');
  });

  it('names the region, so a screen reader says what is scrolling', () => {
    render(<Timeline entries={entries} />);
    expect(screen.getByRole('log')).toHaveAccessibleName();
  });
});
