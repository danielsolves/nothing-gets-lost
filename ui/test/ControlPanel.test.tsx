// @vitest-environment jsdom
// ui/test/ControlPanel.test.tsx
// Pins the panel the demo lives on: a switch per target, the three mischief
// buttons, a reset, and "cut" carrying the invitation that starts the story.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import { ControlPanel } from '../src/ControlPanel';

const switches = {
  hubspot: 'up', stripe: 'up', slack: 'up', ledger: 'up', mailer: 'up',
} as const;

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })));
});

// Testing Library only auto-cleans when vitest runs with globals; this project
// imports its test hooks explicitly, so the unmount is wired by hand.
afterEach(cleanup);

describe('ControlPanel', () => {
  it('offers a switch for every target', () => {
    render(<ControlPanel switches={switches} />);
    for (const target of ['hubspot', 'stripe', 'slack', 'ledger', 'mailer']) {
      expect(screen.getByTestId(`switch-${target}`)).toBeInTheDocument();
    }
  });

  it('sends the new state when a switch is flipped', () => {
    render(<ControlPanel switches={switches} />);
    fireEvent.click(screen.getByTestId('switch-hubspot-cut'));
    expect(fetch).toHaveBeenCalledWith('/api/switches/hubspot', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ state: 'cut' }),
    }));
  });

  it('offers the three chaos buttons', () => {
    render(<ControlPanel switches={switches} />);
    expect(screen.getByTestId('chaos-duplicate_webhook')).toBeInTheDocument();
    expect(screen.getByTestId('chaos-garbage_payload')).toBeInTheDocument();
    expect(screen.getByTestId('chaos-hallucinate')).toBeInTheDocument();
  });

  it('sends a reset', () => {
    render(<ControlPanel switches={switches} />);
    fireEvent.click(screen.getByTestId('reset-all'));
    expect(fetch).toHaveBeenCalledWith('/api/reset', expect.objectContaining({
      method: 'POST',
    }));
  });

  it('marks the cut switch as the loudest invitation', () => {
    render(<ControlPanel switches={switches} />);
    expect(screen.getByTestId('switch-hubspot-cut')).toHaveAttribute('data-invite', 'true');
  });
});
