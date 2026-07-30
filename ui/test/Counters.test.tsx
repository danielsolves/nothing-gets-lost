// @vitest-environment jsdom
// ui/test/Counters.test.tsx
// Pins the header: every counter is shown, waiting only appears when something is
// actually waiting, and "lost" keeps the emphasis that carries the whole claim.
import { describe, it, expect, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { CountersBar } from '../src/Counters';

// Testing Library only auto-cleans when vitest runs with globals; this project
// imports its test hooks explicitly, so the unmount is wired by hand.
afterEach(cleanup);

const base = {
  received: 47, delivered: 47, waiting: 0,
  duplicatesDropped: 3, needsHuman: 1, lost: 0,
};

describe('CountersBar', () => {
  it('shows every counter', () => {
    render(<CountersBar counters={base} />);
    expect(screen.getByTestId('received')).toHaveTextContent('47');
    expect(screen.getByTestId('delivered')).toHaveTextContent('47');
    expect(screen.getByTestId('duplicates')).toHaveTextContent('3');
    expect(screen.getByTestId('needs-human')).toHaveTextContent('1');
  });

  it('gives lost its own emphasis — it is the product', () => {
    render(<CountersBar counters={base} />);
    const lost = screen.getByTestId('lost');
    expect(lost).toHaveTextContent('0');
    expect(lost).toHaveAttribute('data-emphasis', 'true');
  });

  it('shows waiting only when something is actually waiting', () => {
    const { rerender } = render(<CountersBar counters={base} />);
    expect(screen.queryByTestId('waiting')).toBeNull();
    rerender(<CountersBar counters={{ ...base, waiting: 3 }} />);
    expect(screen.getByTestId('waiting')).toHaveTextContent('3');
  });
});
