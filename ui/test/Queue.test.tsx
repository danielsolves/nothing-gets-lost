// @vitest-environment jsdom
// ui/test/Queue.test.tsx
// The queue, drawn. Until now the mediator was a box captioned "queue · retry ·
// exactly once" and the visitor had to take the rest on faith, which is the exact
// opposite of what the specification builds the queue by hand for.
//
// One card per order, five checkpoints, quiet until asked. Opening a card is also
// what selects it, so there is one interaction rather than two competing ones and
// the card you are reading is the one lit up in the diagram.
import { describe, it, expect, afterEach, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, fireEvent, within } from '@testing-library/react';
import type { DeliveryView, Target } from '@ngl/contracts';
import { Queue } from '../src/Queue';

afterEach(cleanup);

let nextId = 1;
function d(
  eventId: string, target: Target, state: DeliveryView['state'],
  extra: Partial<DeliveryView> = {},
): DeliveryView {
  return {
    id: nextId++, eventId, target, state, attempts: 1,
    nextAt: null, lastError: null, remoteRef: null, remoteAt: null, ...extra,
  };
}

const EVENT = '3f8a1c2d-0000-4000-8000-000000000000';

const oneOrder: DeliveryView[] = [
  d(EVENT, 'stripe', 'done', { remoteRef: 'pi_1' }),
  d(EVENT, 'ledger', 'done', { remoteRef: 'INV-1010' }),
  d(EVENT, 'hubspot', 'pending', {
    attempts: 3, nextAt: '2026-07-30T22:29:37.000Z', lastError: 'ECONNRESET',
  }),
];

const props = { deliveries: oneOrder, openOrder: null, onToggle: () => {} };

describe('Queue', () => {
  it('explains itself while the queue is empty', () => {
    render(<Queue {...props} deliveries={[]} />);
    expect(screen.getByTestId('queue-empty')).toBeInTheDocument();
  });

  it('draws one card per order', () => {
    render(<Queue {...props} />);
    expect(screen.getAllByTestId(/^order-card-/)).toHaveLength(1);
  });

  it('gives the card a handle short enough to read', () => {
    render(<Queue {...props} />);
    expect(screen.getByTestId(`order-card-${EVENT}`)).toHaveTextContent('3f8a1c2d');
  });

  it('counts the checkpoints that are through', () => {
    render(<Queue {...props} />);
    expect(screen.getByTestId(`order-progress-${EVENT}`)).toHaveTextContent('2 of 5');
  });

  it('says in one line what is holding the order up', () => {
    render(<Queue {...props} />);
    expect(screen.getByTestId(`order-headline-${EVENT}`)).toHaveTextContent(/HubSpot/);
  });

  it('draws a checkpoint per target, carrying its state', () => {
    render(<Queue {...props} />);
    const dots = screen.getAllByTestId(/^order-dot-/);
    expect(dots).toHaveLength(5);
    expect(screen.getByTestId(`order-dot-${EVENT}-stripe`)).toHaveAttribute('data-state', 'done');
    expect(screen.getByTestId(`order-dot-${EVENT}-hubspot`)).toHaveAttribute('data-state', 'pending');
    // Never enqueued yet, which is not the same as failed (spec 6.7).
    expect(screen.getByTestId(`order-dot-${EVENT}-mailer`)).toHaveAttribute('data-state', 'waiting');
  });

  it('stays quiet until it is opened', () => {
    render(<Queue {...props} />);
    expect(screen.queryByTestId(`order-detail-${EVENT}`)).not.toBeInTheDocument();
  });

  it('shows every checkpoint in detail once it is opened', () => {
    render(<Queue {...props} openOrder={EVENT} />);
    const detail = screen.getByTestId(`order-detail-${EVENT}`);
    expect(within(detail).getByText(/pi_1/)).toBeInTheDocument();
    expect(within(detail).getByText(/INV-1010/)).toBeInTheDocument();
    expect(within(detail).getByText(/ECONNRESET/)).toBeInTheDocument();
    expect(within(detail).getByText(/attempt 3/i)).toBeInTheDocument();
  });

  it('opens on a click, because opening is also what selects', () => {
    const onToggle = vi.fn();
    render(<Queue {...props} onToggle={onToggle} />);
    fireEvent.click(screen.getByTestId(`order-card-${EVENT}`));
    expect(onToggle).toHaveBeenCalledWith(EVENT);
  });

  it('tells assistive tech whether a card is open', () => {
    const { rerender } = render(<Queue {...props} />);
    expect(screen.getByTestId(`order-card-${EVENT}`)).toHaveAttribute('aria-expanded', 'false');
    rerender(<Queue {...props} openOrder={EVENT} />);
    expect(screen.getByTestId(`order-card-${EVENT}`)).toHaveAttribute('aria-expanded', 'true');
  });

  it('marks the open card as the selected one', () => {
    render(<Queue {...props} openOrder={EVENT} />);
    expect(screen.getByTestId(`order-card-${EVENT}`)).toHaveAttribute('data-selected', 'true');
  });

  it('can be reached and opened from the keyboard', () => {
    render(<Queue {...props} />);
    expect(screen.getByTestId(`order-card-${EVENT}`).tagName).toBe('BUTTON');
  });
});
