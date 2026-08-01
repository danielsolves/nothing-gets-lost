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
// The head used to be a fragment of the event uuid. It is the order number now, said
// as "Order #1042" rather than as a bare number, with the moment the order arrived on
// the right, and the five state dots have become each system's own mark, repeated in
// front of that system once the card is open.
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
    nextAt: null, lastError: null, remoteRef: null, remoteAt: null, sentAt: null, answeredAt: null, ...extra,
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

  it('grows the card itself instead of opening a second box beneath it', () => {
    // The detail used to be a sibling of the card: its own bordered, tinted block
    // sitting under a card that never changed size. Two boxes for one order, and
    // the lower one carried a strip of its own background below every shut card.
    // One box now, and opening an order makes that box taller.
    render(<Queue {...props} openOrder={EVENT} />);
    const card = screen.getByTestId(`order-card-${EVENT}`);
    expect(card).toContainElement(screen.getByTestId(`order-summary-${EVENT}`));
    expect(card).toContainElement(screen.getByTestId(`order-detail-${EVENT}`));
  });

  it('draws one card per order', () => {
    render(<Queue {...props} />);
    expect(screen.getAllByTestId(/^order-card-/)).toHaveLength(1);
  });

  it('heads the card with the order number rather than a piece of a uuid', () => {
    // "Order #1042" and not "#1042". A number on its own does not say what it
    // numbers, and this is the handle a visitor reads out loud or puts in a mail.
    render(<Queue {...props} />);
    expect(screen.getByTestId(`order-card-${EVENT}`)).toHaveTextContent('Order #1042');
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

  it('prints no tally beside the marks, because the marks are the tally', () => {
    // "2 of 5" stood next to five marks that already said it. A second copy of a
    // count can only ever agree with the first one or be a bug.
    render(<Queue {...props} />);
    expect(screen.queryByTestId(`order-progress-${EVENT}`)).not.toBeInTheDocument();
    expect(screen.getByTestId(`order-summary-${EVENT}`)).not.toHaveTextContent(/\d of \d/);
  });

  it('says in one line what is holding the order up', () => {
    render(<Queue {...props} />);
    expect(screen.getByTestId(`order-headline-${EVENT}`)).toHaveTextContent(/HubSpot/);
  });

  it('draws a mark per checkpoint, carrying what has happened to it', () => {
    render(<Queue {...props} />);
    const checks = screen.getAllByTestId(/^order-check-/);
    expect(checks).toHaveLength(5);
    expect(screen.getByTestId(`order-check-${EVENT}-stripe`))
      .toHaveAttribute('data-look', 'delivered');
    // Three attempts in, so it is retrying and not merely queued. The card would
    // have said the same word for both before the mark could tell them apart.
    expect(screen.getByTestId(`order-check-${EVENT}-hubspot`))
      .toHaveAttribute('data-look', 'retrying');
    // Never enqueued yet, which is not the same as failed (spec 6.7).
    expect(screen.getByTestId(`order-check-${EVENT}-mailer`))
      .toHaveAttribute('data-look', 'waiting');
  });

  it('wears each system own mark, the one its tile in the drawing wears', () => {
    // The card and the diagram are the same five systems. Anonymous boxes made a
    // visitor open the card to learn which checkpoint was which.
    render(<Queue {...props} />);
    const head = screen.getByTestId(`order-summary-${EVENT}`);
    for (const target of ['stripe', 'hubspot', 'ledger', 'slack', 'mailer']) {
      expect(within(head).getByTestId(`mark-${target}`)).toBeInTheDocument();
    }
  });

  it('never lists order mail among the systems an order is delivered to', () => {
    // It is one of the two ways an order gets in, not somewhere it goes. A sixth
    // checkbox for it would claim a delivery that never happens.
    render(<Queue {...props} openOrder={EVENT} />);
    const head = screen.getByTestId(`order-summary-${EVENT}`);
    expect(within(head).queryByText(/order mail/i)).not.toBeInTheDocument();
  });

  it('stays quiet until it is opened, and out of a reader ear', () => {
    // The detail is in the markup whether the card is open or not, because a block
    // that appears from nothing cannot be animated from a height of nothing. Closed,
    // it is clipped to no height and hidden from assistive tech, so a screen reader
    // does not recite twelve baskets nobody asked for. Nothing inside it can take
    // focus, so aria-hidden is the whole of what has to be said.
    render(<Queue {...props} />);
    const fold = screen.getByTestId(`order-fold-${EVENT}`);
    expect(fold).toHaveAttribute('data-open', 'false');
    expect(fold).toHaveAttribute('aria-hidden', 'true');
  });

  it('unfolds and stops hiding itself once it is opened', () => {
    render(<Queue {...props} openOrder={EVENT} />);
    const fold = screen.getByTestId(`order-fold-${EVENT}`);
    expect(fold).toHaveAttribute('data-open', 'true');
    expect(fold).not.toHaveAttribute('aria-hidden');
  });

  it('shows every checkpoint in detail once it is opened', () => {
    render(<Queue {...props} openOrder={EVENT} />);
    const detail = screen.getByTestId(`order-detail-${EVENT}`);
    expect(within(detail).getByText(/pi_1/)).toBeInTheDocument();
    expect(within(detail).getByText(/INV-1010/)).toBeInTheDocument();
    expect(within(detail).getByText(/ECONNRESET/)).toBeInTheDocument();
    expect(within(detail).getByText(/attempt 3/i)).toBeInTheDocument();
  });

  it('repeats the same mark in front of each system in the detail', () => {
    render(<Queue {...props} openOrder={EVENT} />);
    expect(screen.getByTestId(`order-step-check-${EVENT}-stripe`))
      .toHaveAttribute('data-look', 'delivered');
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
    fireEvent.click(screen.getByTestId(`order-summary-${EVENT}`));
    expect(onToggle).toHaveBeenCalledWith(EVENT);
  });

  it('tells assistive tech whether a card is open', () => {
    const { rerender } = render(<Queue {...props} />);
    expect(screen.getByTestId(`order-summary-${EVENT}`))
      .toHaveAttribute('aria-expanded', 'false');
    rerender(<Queue {...props} openOrder={EVENT} />);
    expect(screen.getByTestId(`order-summary-${EVENT}`))
      .toHaveAttribute('aria-expanded', 'true');
  });

  it('marks the open card as the selected one', () => {
    render(<Queue {...props} openOrder={EVENT} />);
    expect(screen.getByTestId(`order-summary-${EVENT}`)).toHaveAttribute('data-selected', 'true');
  });

  it('can be reached and opened from the keyboard', () => {
    render(<Queue {...props} />);
    expect(screen.getByTestId(`order-summary-${EVENT}`).tagName).toBe('BUTTON');
  });

  it('puts no tab stop in the card head for something nobody can tick', () => {
    render(<Queue {...props} />);
    const head = screen.getByTestId(`order-summary-${EVENT}`);
    expect(within(head).queryAllByRole('checkbox')).toHaveLength(0);
    expect(head.querySelectorAll('input')).toHaveLength(0);
  });
});
