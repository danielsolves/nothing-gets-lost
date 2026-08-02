// @vitest-environment jsdom
// ui/test/Backlog.test.tsx
// The hub's third panel. Three things are load-bearing: that a parked entry is drawn
// as the order card the queue tab draws, that what went wrong is said whole and at
// the top of it, and that the panel hands over the way to check all of it without
// believing the panel.
//
// It was a box of its own under the systems for a while, with its own heading and
// its own count. Both belong to the tab now, so the tests for them live in
// Mediator.test.tsx and this file is about what the panel says.
//
// It also had a shape of its own: a row of order number, system and one grey
// sentence that ended in the driver's words inside brackets. Those tests have gone
// with the row. What replaced them is checked against the queue card's own classes,
// because being the same card is the claim.
import { describe, it, expect, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { DeliveryView, OrderView } from '@ngl/contracts';
import { Backlog } from '../src/Backlog';

afterEach(cleanup);

function delivery(over: Partial<DeliveryView> & { id: number }): DeliveryView {
  return {
    eventId: 'evt-1',
    target: 'hubspot',
    state: 'dead',
    attempts: 6,
    nextAt: null,
    lastError: null,
    remoteRef: null,
    remoteAt: null,
    sentAt: null,
    answeredAt: null,
    ...over,
  };
}

const ARRIVED = '2026-08-01T10:00:00.000Z';

const ORDERS: OrderView[] = [
  {
    eventId: 'evt-1',
    number: 1042,
    receivedAt: ARRIVED,
    booking: {
      source: 'form',
      lines: [{ sku: 'TEAPOT', name: 'Teapot', qty: 1, cents: 4900 }],
      totalCents: 4900,
    },
  },
];

describe('Backlog', () => {
  it('says what would land here, so an empty panel still says something', () => {
    render(<Backlog deliveries={[]} orders={ORDERS} />);
    const empty = screen.getByTestId('backlog-empty');
    expect(empty).toHaveTextContent(/nothing is waiting/i);
    expect(empty).toHaveTextContent(/until a person deals with it/i);
  });

  it('leaves out deliveries that are still moving', () => {
    render(
      <Backlog
        deliveries={[delivery({ id: 7, state: 'pending' }), delivery({ id: 8, state: 'done' })]}
        orders={ORDERS}
      />,
    );
    expect(screen.queryByTestId('backlog-list')).not.toBeInTheDocument();
    expect(screen.getByTestId('backlog-empty')).toBeInTheDocument();
  });

  // The whole point of the rework. A visitor who has just learned to read a card in
  // the tab next door should not have to learn a second notation here.
  it('draws the parked order as the card the queue draws', () => {
    render(
      <Backlog deliveries={[delivery({ id: 7, target: 'slack' })]} orders={ORDERS} />,
    );
    const card = screen.getByTestId('backlog-card-7');
    expect(card).toHaveClass('order-card');
    expect(card).toHaveTextContent('Order #1042');
    expect(within(card).getByTestId('backlog-summary-7')).toHaveClass('order-summary');
    expect(within(card).getByTestId('backlog-fold-7')).toHaveClass('order-fold');
  });

  it('keeps the exact instant the order arrived in the markup', () => {
    render(<Backlog deliveries={[delivery({ id: 7 })]} orders={ORDERS} />);
    expect(screen.getByTestId('backlog-at-7')).toHaveAttribute('datetime', ARRIVED);
  });

  // The same marks the queue card and the diagram wear, so a reader can see at a
  // glance that the invoice went out even though Slack did not.
  it('wears one mark per checkpoint, the one its tile in the drawing wears', () => {
    render(
      <Backlog
        deliveries={[
          delivery({ id: 1, target: 'stripe', state: 'done', remoteRef: 'pi_1' }),
          delivery({ id: 7, target: 'slack', lastError: 'channel_not_found' }),
        ]}
        orders={ORDERS}
      />,
    );
    expect(screen.getAllByTestId(/^backlog-mark-7-/)).toHaveLength(5);
    expect(screen.getByTestId('backlog-mark-7-stripe'))
      .toHaveAttribute('data-look', 'delivered');
    expect(screen.getByTestId('backlog-mark-7-slack'))
      .toHaveAttribute('data-look', 'parked');
  });

  // What came back, on a line of its own and whole. It used to be the tail of a grey
  // note, in brackets, behind the word "attempts": last on the quietest line.
  it('states what went wrong on a line of its own, not in brackets', () => {
    render(
      <Backlog
        deliveries={[delivery({ id: 7, target: 'slack', lastError: 'Slack error: channel_not_found' })]}
        orders={ORDERS}
      />,
    );
    const why = screen.getByTestId('backlog-why-7');
    expect(why.textContent).toBe('Slack error: channel_not_found');
  });

  it('says the driver said nothing rather than showing an empty fault', () => {
    render(<Backlog deliveries={[delivery({ id: 7 })]} orders={ORDERS} />);
    expect(screen.getByTestId('backlog-why-7')).toHaveTextContent(/nothing came back/i);
  });

  it('says under the fault where it went and who has to review it', () => {
    render(<Backlog deliveries={[delivery({ id: 7, target: 'slack' })]} orders={ORDERS} />);
    expect(screen.getByTestId('backlog-fault-7'))
      .toHaveTextContent(/written to the backlog after 6 attempts, a person has to review it/i);
  });

  it('counts one attempt in the singular', () => {
    render(<Backlog deliveries={[delivery({ id: 7, attempts: 1 })]} orders={ORDERS} />);
    expect(screen.getByTestId('backlog-fault-7')).toHaveTextContent(/after 1 attempt,/);
  });

  it('gives every stopped checkpoint of one order its own fault on one card', () => {
    render(
      <Backlog
        deliveries={[
          delivery({ id: 4, target: 'slack', lastError: 'Slack responded 500' }),
          delivery({ id: 5, target: 'mailer', lastError: 'Mailer responded 502' }),
        ]}
        orders={ORDERS}
      />,
    );
    expect(screen.getAllByTestId(/^backlog-card-/)).toHaveLength(1);
    expect(screen.getByTestId('backlog-why-4')).toHaveTextContent('Slack responded 500');
    expect(screen.getByTestId('backlog-why-5')).toHaveTextContent('Mailer responded 502');
  });

  // Folded the way a queue card folds: in the markup either way, clipped to no
  // height and out of a reader's ear until it is asked for.
  it('stays folded until it is opened', () => {
    render(<Backlog deliveries={[delivery({ id: 7 })]} orders={ORDERS} />);
    const fold = screen.getByTestId('backlog-fold-7');
    expect(fold).toHaveAttribute('data-open', 'false');
    expect(fold).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByTestId('backlog-summary-7')).toHaveAttribute('aria-expanded', 'false');
  });

  it('unfolds on a click and shows what was in the order', () => {
    render(<Backlog deliveries={[delivery({ id: 7 })]} orders={ORDERS} />);
    fireEvent.click(screen.getByTestId('backlog-summary-7'));

    const fold = screen.getByTestId('backlog-fold-7');
    expect(fold).toHaveAttribute('data-open', 'true');
    expect(fold).not.toHaveAttribute('aria-hidden');
    expect(screen.getByTestId('backlog-summary-7')).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByTestId('order-basket-evt-1')).toHaveTextContent('1 x Teapot');
  });

  it('folds the card shut again on a second click', () => {
    render(<Backlog deliveries={[delivery({ id: 7 })]} orders={ORDERS} />);
    fireEvent.click(screen.getByTestId('backlog-summary-7'));
    fireEvent.click(screen.getByTestId('backlog-summary-7'));
    expect(screen.getByTestId('backlog-fold-7')).toHaveAttribute('data-open', 'false');
  });

  it('can be reached and opened from the keyboard', () => {
    render(<Backlog deliveries={[delivery({ id: 7 })]} orders={ORDERS} />);
    expect(screen.getByTestId('backlog-summary-7').tagName).toBe('BUTTON');
  });

  it('names the delivery when its order is not on the board yet', () => {
    render(<Backlog deliveries={[delivery({ id: 7, eventId: 'evt-x' })]} orders={[]} />);
    expect(screen.getByTestId('backlog-card-7')).toHaveTextContent('id 7');
    expect(screen.queryByTestId('backlog-at-7')).not.toBeInTheDocument();
  });

  // The id is the handle the MCP server answers to, so the card hands over its own
  // rather than leaving a reader to work out which of the entries it just listed is
  // the one they are looking at.
  it('hands over the id one entry can be asked for by', () => {
    render(<Backlog deliveries={[delivery({ id: 7 })]} orders={ORDERS} />);
    const ids = screen.getByTestId('backlog-ids-7');
    expect(ids).toHaveTextContent('id 7');
    expect(ids).toHaveTextContent('backlog_entry');
  });

  // The point of the whole panel: it does not ask to be believed. There was a second
  // way, a SELECT against v_backlog in a console on this page, and that console has
  // gone: it was our screen offering to check our own database.
  it('hands over the way to check it, full or empty', () => {
    render(<Backlog deliveries={[delivery({ id: 7 })]} orders={ORDERS} />);
    expect(screen.getByTestId('backlog-check')).toHaveTextContent('backlog_list');

    cleanup();
    render(<Backlog deliveries={[]} orders={ORDERS} />);
    expect(screen.getByTestId('backlog-empty')).toHaveTextContent('backlog_list');
  });
});
