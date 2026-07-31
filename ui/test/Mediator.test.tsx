// @vitest-environment jsdom
// ui/test/Mediator.test.tsx
// The hub is a panel, not a caption. It carries its own live state, the queue it
// holds, and the log of what it just did.
//
// The specification calls the mediator the heart of the repo and defends building
// the queue by hand with "take a ready-made one and the most interesting part
// becomes invisible". A box saying "queue · retry · exactly once" made it invisible
// anyway. Everything a visitor would otherwise have to take on faith lives here.
import { describe, it, expect, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, fireEvent, within } from '@testing-library/react';
import type { Counters, DeliveryView, TimelineEntry } from '@ngl/contracts';
import { Mediator } from '../src/Mediator';

afterEach(cleanup);

const EVENT = '3f8a1c2d-0000-4000-8000-000000000000';

const counters: Counters = {
  received: 3, delivered: 9, waiting: 2, duplicatesDropped: 1, needsHuman: 1, lost: 0,
};

const deliveries: DeliveryView[] = [
  {
    id: 1, eventId: EVENT, target: 'stripe', state: 'done', attempts: 1,
    nextAt: null, lastError: null, remoteRef: 'pi_1', remoteAt: null,
  },
  {
    id: 2, eventId: EVENT, target: 'hubspot', state: 'pending', attempts: 3,
    nextAt: null, lastError: 'ECONNRESET', remoteRef: null, remoteAt: null,
  },
];

const timeline: TimelineEntry[] = [
  { at: '2026-07-31T12:00:00.000Z', eventId: EVENT, text: 'Stripe: confirmed', level: 'success' },
];

const props = {
  counters, deliveries, timeline,
  openOrder: null,
  onToggleOrder: () => {},
};

describe('Mediator', () => {
  it('names itself and says what it is', () => {
    render(<Mediator {...props} />);
    expect(screen.getByText('The mediator')).toBeInTheDocument();
  });

  it('shows the counts that carry the claim', () => {
    render(<Mediator {...props} />);
    expect(screen.getByTestId('hub-waiting')).toHaveTextContent('2');
    expect(screen.getByTestId('hub-lost')).toHaveTextContent('0');
  });

  it('keeps its explanation out of the way until asked', () => {
    render(<Mediator {...props} />);
    expect(screen.queryByTestId('hub-help')).not.toBeInTheDocument();
  });

  it('explains what it does when the question mark is used', () => {
    render(<Mediator {...props} />);
    fireEvent.click(screen.getByTestId('hub-help-toggle'));
    const help = screen.getByTestId('hub-help');
    expect(within(help).getByText(/exactly once/i)).toBeInTheDocument();
  });

  it('explains on hover too, since a question mark invites a pointer', () => {
    render(<Mediator {...props} />);
    fireEvent.mouseEnter(screen.getByTestId('hub-help-toggle'));
    expect(screen.getByTestId('hub-help')).toBeInTheDocument();
  });

  it('opens on the queue, because that is what the hub is', () => {
    render(<Mediator {...props} />);
    expect(screen.getByTestId('hub-tab-queue')).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('hub-panel-queue')).toBeInTheDocument();
  });

  it('switches to the log and back', () => {
    render(<Mediator {...props} />);
    fireEvent.click(screen.getByTestId('hub-tab-log'));
    expect(screen.getByTestId('hub-panel-log')).toBeInTheDocument();
    expect(screen.queryByTestId('hub-panel-queue')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('hub-tab-queue'));
    expect(screen.getByTestId('hub-panel-queue')).toBeInTheDocument();
  });

  it('shows the orders it is holding, not a promise of them', () => {
    render(<Mediator {...props} />);
    const panel = screen.getByTestId('hub-panel-queue');
    expect(within(panel).getByTestId(`order-card-${EVENT}`)).toBeInTheDocument();
  });

  it('shows what just happened under the log tab', () => {
    render(<Mediator {...props} />);
    fireEvent.click(screen.getByTestId('hub-tab-log'));
    expect(within(screen.getByTestId('hub-panel-log')).getByText(/Stripe: confirmed/))
      .toBeInTheDocument();
  });
});
