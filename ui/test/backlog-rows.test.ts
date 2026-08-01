// ui/test/backlog-rows.test.ts
// What the backlog panel is allowed to say, checked without a browser.
import { describe, it, expect } from 'vitest';
import type { DeliveryView, OrderView, Target } from '@ngl/contracts';
import { backlogOf } from '../src/backlog-rows';

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

function order(eventId: string, number: number): OrderView {
  return { eventId, number, receivedAt: '2026-08-01T10:00:00.000Z', booking: null };
}

describe('backlogOf', () => {
  it('is empty while nothing has been given up on', () => {
    const rows = backlogOf(
      [delivery({ id: 1, state: 'pending' }), delivery({ id: 2, state: 'done' })],
      [order('evt-1', 1001)],
    );
    expect(rows).toEqual([]);
  });

  it('takes the parked delivery and leaves the rest', () => {
    const rows = backlogOf(
      [
        delivery({ id: 1, state: 'inflight' }),
        delivery({ id: 2, state: 'dead', target: 'slack', lastError: 'channel_not_found' }),
      ],
      [order('evt-1', 1001)],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: 2, number: 1001, target: 'slack', label: 'Slack',
      attempts: 6, lastError: 'channel_not_found',
    });
  });

  // Ids come from a sequence, so the lowest has been waiting longest. The view and
  // the MCP tool order the same way, and three answers that disagreed about which
  // entry is next would be worse than any one of them.
  it('puts what has waited longest first', () => {
    const rows = backlogOf(
      [delivery({ id: 9 }), delivery({ id: 3 }), delivery({ id: 6 })],
      [order('evt-1', 1001)],
    );
    expect(rows.map((row) => row.id)).toEqual([3, 6, 9]);
  });

  it('names each system the way the rest of the page does', () => {
    const rows = backlogOf(
      [
        delivery({ id: 1, target: 'mailer' }),
        delivery({ id: 2, target: 'ledger' }),
        delivery({ id: 3, target: 'custom_webhook' }),
      ],
      [order('evt-1', 1001)],
    );
    expect(rows.map((row) => row.label))
      .toEqual(['Confirmation mail', 'Invoice', 'Your endpoint']);
  });

  // The queue drops a delivery whose order is not in the same snapshot, because a
  // card that cannot say which order it is has nothing to offer. The backlog must
  // not: an entry that hides until it can be labelled nicely is the disappearance
  // this panel exists to prevent.
  it('keeps a parked delivery whose order has not arrived yet', () => {
    const rows = backlogOf([delivery({ id: 4, eventId: 'evt-unknown' })], []);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.number).toBeNull();
  });

  it('matches each delivery to its own order', () => {
    const rows = backlogOf(
      [
        delivery({ id: 1, eventId: 'evt-a' }),
        delivery({ id: 2, eventId: 'evt-b' }),
      ],
      [order('evt-a', 1001), order('evt-b', 1002)],
    );
    expect(rows.map((row) => row.number)).toEqual([1001, 1002]);
  });
});
