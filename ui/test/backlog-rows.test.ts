// ui/test/backlog-rows.test.ts
// What the backlog panel is allowed to say, checked without a browser.
//
// Two shapes are checked here. The rows are one per parked delivery, which is what
// v_backlog holds and what the tab counts. The cards are one per order, because the
// panel draws the order card now and two cards for one order would be the same
// basket, the same arrival and the same five marks printed twice.
import { describe, it, expect } from 'vitest';
import type { DeliveryView, OrderView } from '@ngl/contracts';
import { backlogCards, backlogOf } from '../src/backlog-rows';

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

describe('backlogCards', () => {
  it('has nothing to draw while nothing has been given up on', () => {
    expect(backlogCards([delivery({ id: 1, state: 'done' })], [order('evt-1', 1001)]))
      .toEqual([]);
  });

  // The point of taking the queue's card: an entry is an order, not a row. What was
  // in it and how the other four checkpoints got on are the first things a person
  // triaging it asks, and the old row could answer neither.
  it('carries the whole order behind the entry, not only the step that stopped', () => {
    const cards = backlogCards(
      [
        delivery({ id: 1, target: 'stripe', state: 'done', remoteRef: 'pi_1' }),
        delivery({ id: 2, target: 'ledger', state: 'done', remoteRef: 'INV-1010' }),
        delivery({ id: 7, target: 'slack', lastError: 'channel_not_found' }),
      ],
      [order('evt-1', 1001)],
    );

    expect(cards).toHaveLength(1);
    expect(cards[0]?.number).toBe(1001);
    expect(cards[0]?.receivedAt).toBe('2026-08-01T10:00:00.000Z');
    expect(cards[0]?.steps.map((step) => step.target))
      .toEqual(['stripe', 'hubspot', 'ledger', 'slack', 'mailer']);
  });

  // Whole, and first. It used to be the tail of a grey sentence, in brackets, behind
  // the word "attempts", which is the last place a reader looks.
  it('states what came back as the fault, in the words the driver used', () => {
    const cards = backlogCards(
      [delivery({ id: 7, target: 'slack', lastError: 'Slack error: channel_not_found' })],
      [order('evt-1', 1001)],
    );
    expect(cards[0]?.faults[0]?.why).toBe('Slack error: channel_not_found');
  });

  it('says the driver said nothing rather than leaving the fault blank', () => {
    const cards = backlogCards([delivery({ id: 7 })], [order('evt-1', 1001)]);
    expect(cards[0]?.faults[0]?.why).toMatch(/nothing came back/i);
  });

  it('names the system, the attempts and who has it now under the fault', () => {
    const cards = backlogCards(
      [delivery({ id: 7, target: 'slack' })], [order('evt-1', 1001)],
    );
    expect(cards[0]?.faults[0]?.how)
      .toBe('Slack, written to the backlog after 6 attempts, a person has to review it');
  });

  it('counts one attempt in the singular', () => {
    const cards = backlogCards(
      [delivery({ id: 7, attempts: 1 })], [order('evt-1', 1001)],
    );
    expect(cards[0]?.faults[0]?.how).toMatch(/after 1 attempt,/);
  });

  // Two stopped checkpoints are two faults on one card, not two cards. A second card
  // would repeat the same basket, the same arrival and the same five marks.
  it('gathers every stopped checkpoint of one order onto one card', () => {
    const cards = backlogCards(
      [
        delivery({ id: 4, target: 'slack', lastError: 'Slack responded 500' }),
        delivery({ id: 5, target: 'mailer', lastError: 'Mailer responded 502' }),
      ],
      [order('evt-1', 1001)],
    );
    expect(cards).toHaveLength(1);
    expect(cards[0]?.faults.map((fault) => fault.label))
      .toEqual(['Slack', 'Confirmation mail']);
  });

  // Same rule as the rows, and for the same reason: a card is ranked by the lowest
  // parked delivery on it, so the panel, the view and the MCP tool cannot disagree
  // about which entry has been waiting longest.
  it('puts the order that has waited longest first', () => {
    const cards = backlogCards(
      [
        delivery({ id: 9, eventId: 'evt-b' }),
        delivery({ id: 3, eventId: 'evt-a' }),
      ],
      [order('evt-a', 1001), order('evt-b', 1002)],
    );
    expect(cards.map((card) => card.id)).toEqual([3, 9]);
    expect(cards.map((card) => card.number)).toEqual([1001, 1002]);
  });

  // The queue drops a delivery whose order is not in the same snapshot. The backlog
  // draws it with what it does have: no number, no arrival, no basket, and the rows
  // that exist. An entry that waits until it can be labelled nicely is the
  // disappearance this panel exists to prevent.
  it('draws a parked delivery whose order has not arrived yet', () => {
    const cards = backlogCards(
      [delivery({ id: 4, eventId: 'evt-unknown', target: 'slack' })], [],
    );
    expect(cards).toHaveLength(1);
    expect(cards[0]?.number).toBeNull();
    expect(cards[0]?.receivedAt).toBeNull();
    expect(cards[0]?.booking).toBeNull();
    expect(cards[0]?.steps.map((step) => step.target)).toEqual(['slack']);
  });
});
