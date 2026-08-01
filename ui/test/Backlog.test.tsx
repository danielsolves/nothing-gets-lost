// @vitest-environment jsdom
// ui/test/Backlog.test.tsx
// The panel under the systems. Two things are load-bearing here: that a parked
// delivery says where it went and who has to deal with it, and that the panel hands
// over the two ways to check that without believing the panel.
import { describe, it, expect, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { DeliveryView, OrderView, Target } from '@ngl/contracts';
import { Backlog } from '../src/Backlog';

afterEach(cleanup);

function delivery(over: Partial<DeliveryView> & { id: number }): DeliveryView {
  return {
    eventId: 'evt-1',
    target: 'hubspot' as Target,
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

const ORDERS: OrderView[] = [
  { eventId: 'evt-1', number: 1042, receivedAt: '2026-08-01T10:00:00.000Z', booking: null },
];

describe('Backlog', () => {
  it('is drawn even with nothing in it, because the empty case is the claim', () => {
    render(<Backlog deliveries={[]} orders={ORDERS} />);
    expect(screen.getByTestId('backlog')).toBeInTheDocument();
    expect(screen.getByTestId('backlog-empty')).toHaveTextContent(/nothing is waiting/i);
  });

  it('says what would land here, so an empty panel still says something', () => {
    render(<Backlog deliveries={[]} orders={ORDERS} />);
    expect(screen.getByTestId('backlog-empty')).toHaveTextContent(/until a person deals with it/i);
  });

  it('carries no count while it is empty', () => {
    render(<Backlog deliveries={[]} orders={ORDERS} />);
    expect(screen.queryByTestId('backlog-count')).not.toBeInTheDocument();
  });

  it('lists a parked delivery under the order it belongs to', () => {
    render(
      <Backlog
        deliveries={[delivery({ id: 7, target: 'slack', lastError: 'channel_not_found' })]}
        orders={ORDERS}
      />,
    );
    const row = screen.getByTestId('backlog-row-7');
    expect(row).toHaveTextContent('#1042');
    expect(row).toHaveTextContent('Slack');
    expect(row).toHaveTextContent('channel_not_found');
  });

  // The sentence Daniel asked for, in the words he asked for: it went to the
  // backlog, and a person has to look at it.
  it('says the delivery was written to the backlog for a person to review', () => {
    render(<Backlog deliveries={[delivery({ id: 7 })]} orders={ORDERS} />);
    expect(screen.getByTestId('backlog-row-7'))
      .toHaveTextContent(/written to the backlog after 6 attempts, a person has to review it/i);
  });

  it('counts one attempt in the singular', () => {
    render(<Backlog deliveries={[delivery({ id: 7, attempts: 1 })]} orders={ORDERS} />);
    expect(screen.getByTestId('backlog-row-7')).toHaveTextContent(/after 1 attempt,/);
  });

  it('shows how many are waiting', () => {
    render(
      <Backlog
        deliveries={[delivery({ id: 7 }), delivery({ id: 8, target: 'ledger' })]}
        orders={ORDERS}
      />,
    );
    expect(screen.getByTestId('backlog-count')).toHaveTextContent('2');
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

  it('names the delivery when its order is not on the board yet', () => {
    render(<Backlog deliveries={[delivery({ id: 7, eventId: 'evt-x' })]} orders={[]} />);
    expect(screen.getByTestId('backlog-row-7')).toHaveTextContent('id 7');
  });

  // The point of the whole panel: it does not ask to be believed.
  it('hands over both ways of checking it, full or empty', () => {
    for (const deliveries of [[], [delivery({ id: 7 })]]) {
      cleanup();
      render(<Backlog deliveries={deliveries} orders={ORDERS} />);
      const check = screen.getByTestId('backlog-check');
      expect(check).toHaveTextContent('SELECT * FROM v_backlog');
      expect(check).toHaveTextContent('backlog_list');
    }
  });
});
