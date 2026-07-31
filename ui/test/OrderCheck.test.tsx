// @vitest-environment jsdom
// ui/test/OrderCheck.test.tsx
// The five coloured dots in the card head became checkboxes, and the same indicator
// now sits in front of each system in the opened card, so the head and the detail are
// the same fact at two sizes.
//
// Not an input. Nothing here is settable by a visitor, so a real checkbox would
// promise something it cannot do and would put forty tab stops in a scrolling list.
// It is an image with a name, which is what a state indicator actually is.
import { describe, it, expect, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { OrderCheck } from '../src/OrderCheck';

afterEach(cleanup);

describe('OrderCheck', () => {
  it('is not something a visitor can tick', () => {
    render(<OrderCheck label="Stripe" state="done" />);
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(document.querySelector('input')).toBeNull();
  });

  it('says the checkpoint and its state in words, not in colour', () => {
    render(<OrderCheck label="Stripe" state="done" />);
    expect(screen.getByRole('img', { name: 'Stripe: delivered' })).toBeInTheDocument();
  });

  it('gives each of the five states its own name', () => {
    const states = ['done', 'inflight', 'pending', 'dead', 'waiting'] as const;
    const names = states.map((state) => {
      cleanup();
      render(<OrderCheck label="Slack" state={state} />);
      return screen.getByRole('img').getAttribute('aria-label');
    });
    expect(new Set(names).size).toBe(5);
  });

  it('carries the state for the sheet to draw, since a tick cannot hold five', () => {
    render(<OrderCheck label="Slack" state="inflight" />);
    expect(screen.getByRole('img')).toHaveAttribute('data-state', 'inflight');
  });

  it('ticks a checkpoint that is through', () => {
    render(<OrderCheck label="Invoice" state="done" />);
    expect(screen.getByRole('img')).toHaveTextContent('✓');
  });

  it('crosses one that gave up, so colour is not the only difference', () => {
    // Delivered and needs-a-human are the two a red-green reader cannot separate,
    // and they are the two it matters most to separate.
    render(<OrderCheck label="HubSpot" state="dead" />);
    expect(screen.getByRole('img')).toHaveTextContent('✕');
  });

  it('leaves the box empty for a checkpoint nothing has happened to yet', () => {
    render(<OrderCheck label="Confirmation mail" state="waiting" />);
    expect(screen.getByRole('img')).toHaveTextContent('');
  });

  it('can be found by test id when a card needs to point at one', () => {
    render(<OrderCheck label="Slack" state="pending" testId="order-check-evt-slack" />);
    expect(screen.getByTestId('order-check-evt-slack')).toBeInTheDocument();
  });
});
