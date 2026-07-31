// @vitest-environment jsdom
// ui/test/Queue.test.tsx
// The queue, drawn. Until now the mediator was a box captioned "queue · retry ·
// exactly once" and the visitor had to take the rest on faith, which is the exact
// opposite of what the specification builds the queue by hand for.
//
// One card per order, five checkpoints, quiet until asked. Opening a card is also
// what selects it, so there is one interaction rather than two competing ones and
// the card you are reading is the one lit up in the diagram.
//
// The head used to be a fragment of the event uuid. It is the order number now, with
// the moment the order arrived on the right, and the five state dots have become
// small checkboxes that repeat in front of each system once the card is open.
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, fireEvent, within } from '@testing-library/react';
import type { DeliveryView, OrderView, Target } from '@ngl/contracts';
import { Queue } from '../src/Queue';

afterEach(() => { cleanup(); vi.useRealTimers(); });

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

/** Half past two in the afternoon, wherever this test happens to be running. */
const ARRIVED = new Date(2026, 6, 31, 14, 32, 7);
const TODAY = new Date(2026, 6, 31, 14, 40, 0);

const oneOrder: DeliveryView[] = [
  d(EVENT, 'stripe', 'done', { remoteRef: 'pi_1' }),
  d(EVENT, 'ledger', 'done', { remoteRef: 'INV-1010' }),
  d(EVENT, 'hubspot', 'pending', {
    attempts: 3, nextAt: '2026-07-30T22:29:37.000Z', lastError: 'ECONNRESET',
  }),
];

const order: OrderView = {
  eventId: EVENT,
  number: 1042,
  receivedAt: ARRIVED.toISOString(),
  booking: {
    source: 'form',
    lines: [
      { sku: 'TEAPOT', name: 'Teapot', qty: 1, cents: 4900 },
      { sku: 'MUG-BLUE', name: 'Blue mug', qty: 2, cents: 2400 },
    ],
    totalCents: 7300,
  },
};

const props = {
  deliveries: oneOrder, orders: [order], openOrder: null, onToggle: () => {},
};

beforeEach(() => { vi.useFakeTimers({ now: TODAY }); });

describe('Queue', () => {
  it('explains itself while the queue is empty', () => {
    render(<Queue {...props} deliveries={[]} orders={[]} />);
    expect(screen.getByTestId('queue-empty')).toBeInTheDocument();
  });

  it('draws one card per order', () => {
    render(<Queue {...props} />);
    expect(screen.getAllByTestId(/^order-card-/)).toHaveLength(1);
  });

  it('heads the card with the order number rather than a piece of a uuid', () => {
    render(<Queue {...props} />);
    expect(screen.getByTestId(`order-card-${EVENT}`)).toHaveTextContent('#1042');
    expect(screen.getByTestId(`order-card-${EVENT}`)).not.toHaveTextContent('3f8a1c2d');
  });

  it('puts the moment the order arrived on the other side of the head', () => {
    render(<Queue {...props} />);
    expect(screen.getByTestId(`order-at-${EVENT}`)).toHaveTextContent('14:32:07');
  });

  it('keeps the exact instant in the markup, whatever the card chose to show', () => {
    render(<Queue {...props} />);
    expect(screen.getByTestId(`order-at-${EVENT}`))
      .toHaveAttribute('datetime', ARRIVED.toISOString());
  });

  it('counts the checkpoints that are through', () => {
    render(<Queue {...props} />);
    expect(screen.getByTestId(`order-progress-${EVENT}`)).toHaveTextContent('2 of 5');
  });

  it('says in one line what is holding the order up', () => {
    render(<Queue {...props} />);
    expect(screen.getByTestId(`order-headline-${EVENT}`)).toHaveTextContent(/HubSpot/);
  });

  it('draws a checkbox per checkpoint, carrying its state', () => {
    render(<Queue {...props} />);
    const checks = screen.getAllByTestId(/^order-check-/);
    expect(checks).toHaveLength(5);
    expect(screen.getByTestId(`order-check-${EVENT}-stripe`))
      .toHaveAttribute('data-state', 'done');
    expect(screen.getByTestId(`order-check-${EVENT}-hubspot`))
      .toHaveAttribute('data-state', 'pending');
    // Never enqueued yet, which is not the same as failed (spec 6.7).
    expect(screen.getByTestId(`order-check-${EVENT}-mailer`))
      .toHaveAttribute('data-state', 'waiting');
  });

  it('never lists order mail among the systems an order is delivered to', () => {
    // It is one of the two ways an order gets in, not somewhere it goes. A sixth
    // checkbox for it would claim a delivery that never happens.
    render(<Queue {...props} openOrder={EVENT} />);
    const card = screen.getByTestId(`order-card-${EVENT}`);
    expect(within(card).queryByText(/order mail/i)).not.toBeInTheDocument();
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

  it('repeats the same checkbox in front of each system in the detail', () => {
    render(<Queue {...props} openOrder={EVENT} />);
    expect(screen.getByTestId(`order-step-check-${EVENT}-stripe`))
      .toHaveAttribute('data-state', 'done');
    expect(screen.getAllByTestId(/^order-step-check-/)).toHaveLength(5);
  });

  it('shows what was ordered once the card is open', () => {
    render(<Queue {...props} openOrder={EVENT} />);
    const detail = screen.getByTestId(`order-detail-${EVENT}`);
    expect(within(detail).getByText(/2 x Blue mug/)).toBeInTheDocument();
    expect(within(detail).getByText(/1 x Teapot/)).toBeInTheDocument();
  });

  it('shows the total, which is the figure on the Stripe receipt', () => {
    render(<Queue {...props} openOrder={EVENT} />);
    expect(screen.getByTestId(`order-total-${EVENT}`)).toHaveTextContent('73.00 EUR');
  });

  it('says where the order came in from', () => {
    render(<Queue {...props} openOrder={EVENT} />);
    expect(screen.getByTestId(`order-origin-${EVENT}`)).toHaveTextContent(/shop/i);
  });

  it('opens a card that has no basket behind it rather than breaking on it', () => {
    render(
      <Queue {...props} openOrder={EVENT}
             orders={[{ ...order, booking: null }]} />,
    );
    expect(screen.getByTestId(`order-origin-${EVENT}`)).toHaveTextContent(/no basket/i);
    expect(screen.getByTestId(`order-detail-${EVENT}`)).toBeInTheDocument();
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

  it('puts no tab stop in the card head for something nobody can tick', () => {
    render(<Queue {...props} />);
    const card = screen.getByTestId(`order-card-${EVENT}`);
    expect(within(card).queryAllByRole('checkbox')).toHaveLength(0);
    expect(card.querySelectorAll('input')).toHaveLength(0);
  });
});
