// @vitest-environment jsdom
// ui/test/OrderContents.test.tsx
// An opened card used to show five checkpoints and nothing about the order they were
// carrying. A visitor watching their own order struggle could not see what was in it.
//
// Two things go in the same block, because they answer the same question: where the
// order came in from, and what was in it. Order mail is one of the two ways in, which
// is why it appears here as an origin and not as a sixth checkpoint.
import { describe, it, expect, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import type { OrderBooking } from '@ngl/contracts';
import { OrderContents } from '../src/OrderContents';

afterEach(cleanup);

const EVENT = '3f8a1c2d-0000-4000-8000-000000000000';

const booking: OrderBooking = {
  source: 'form',
  lines: [
    { sku: 'TEAPOT', name: 'Teapot', qty: 1, cents: 4900 },
    { sku: 'MUG-BLUE', name: 'Blue mug', qty: 2, cents: 2400 },
  ],
  totalCents: 7300,
};

describe('OrderContents', () => {
  it('names what was ordered rather than reciting article numbers', () => {
    render(<OrderContents eventId={EVENT} booking={booking} />);
    const basket = screen.getByTestId(`order-basket-${EVENT}`);
    expect(within(basket).getByText(/Blue mug/)).toBeInTheDocument();
    expect(within(basket).queryByText(/MUG-BLUE/)).not.toBeInTheDocument();
  });

  it('says how many of each and what the line came to', () => {
    render(<OrderContents eventId={EVENT} booking={booking} />);
    const basket = screen.getByTestId(`order-basket-${EVENT}`);
    expect(within(basket).getByText(/2 x Blue mug/)).toBeInTheDocument();
    expect(within(basket).getByText('24.00 EUR')).toBeInTheDocument();
  });

  it('shows the total, because that is the number on the Stripe receipt', () => {
    render(<OrderContents eventId={EVENT} booking={booking} />);
    expect(screen.getByTestId(`order-total-${EVENT}`)).toHaveTextContent('73.00 EUR');
  });

  it('prints the total that was charged rather than adding the lines up on screen', () => {
    // If the two ever part company the receipt is the one that is right, and a card
    // that quietly re-adds the basket would hide the disagreement instead of showing
    // it. The stored figure is what Stripe was given.
    render(
      <OrderContents eventId={EVENT} booking={{ ...booking, totalCents: 9900 }} />,
    );
    expect(screen.getByTestId(`order-total-${EVENT}`)).toHaveTextContent('99.00 EUR');
  });

  it('says the order came in from the shop page', () => {
    render(<OrderContents eventId={EVENT} booking={booking} />);
    expect(screen.getByTestId(`order-origin-${EVENT}`)).toHaveTextContent(/shop/i);
  });

  it('says the order was read out of a mail when it was', () => {
    render(<OrderContents eventId={EVENT} booking={{ ...booking, source: 'email' }} />);
    expect(screen.getByTestId(`order-origin-${EVENT}`)).toHaveTextContent(/mail/i);
  });

  it('admits it has no basket rather than drawing an empty one', () => {
    // A Stripe payment webhook makes an event with deliveries and no orders row.
    render(<OrderContents eventId={EVENT} booking={null} />);
    expect(screen.queryByTestId(`order-basket-${EVENT}`)).not.toBeInTheDocument();
    expect(screen.queryByTestId(`order-total-${EVENT}`)).not.toBeInTheDocument();
    expect(screen.getByTestId(`order-origin-${EVENT}`)).toHaveTextContent(/no basket/i);
  });

  it('draws nothing at all for a basket that came back empty', () => {
    render(<OrderContents eventId={EVENT} booking={{ ...booking, lines: [] }} />);
    expect(screen.queryByTestId(`order-basket-${EVENT}`)).not.toBeInTheDocument();
    expect(screen.getByTestId(`order-total-${EVENT}`)).toBeInTheDocument();
  });
});
