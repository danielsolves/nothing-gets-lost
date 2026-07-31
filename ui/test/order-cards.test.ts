// ui/test/order-cards.test.ts
// The queue is the thing the whole project exists to show. The specification calls
// the mediator the heart of the repo and defends building the queue by hand with:
// "take a ready-made one and the most interesting part becomes invisible."
//
// It was invisible anyway. The page drew a box labelled "queue · retry · exactly
// once" and asked the visitor to take it on faith. This is the rule that turns the
// flat delivery list back into what it really is: one order, five checkpoints, and
// a plain sentence about where it is stuck.
//
// A card is built from two lists now. The deliveries say how the order is getting on;
// the order entry says which order it is, when it came in and what was in it, none of
// which a delivery row knows.
import { describe, it, expect } from 'vitest';
import type { DeliveryView, OrderView, Target } from '@ngl/contracts';
import { groupIntoOrders, CHECKPOINTS, type OrderCard } from '../src/order-cards';

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

function order(eventId: string, number: number, over: Partial<OrderView> = {}): OrderView {
  return {
    eventId, number, receivedAt: '2026-07-31T12:00:00.000Z', booking: null, ...over,
  };
}

/**
 * The deliveries plus the order entry the board sends alongside each of them,
 * numbered in the order they first appear. Most tests here are about the chain
 * rather than about the head, and spelling both lists out every time would bury it.
 */
function group(
  deliveries: DeliveryView[], orders?: OrderView[], now: Date = NOW,
): OrderCard[] {
  const seen = [...new Set(deliveries.map((row) => row.eventId))];
  return groupIntoOrders(
    deliveries,
    orders ?? seen.map((eventId, index) => order(eventId, 1000 + index)),
    now,
  );
}

/** Fixed, so the countdown on a card is a value and not whatever the clock said. */
const NOW = new Date('2026-07-31T12:00:00.000Z');
const IN_20_SECONDS = '2026-07-31T12:00:20.000Z';
const OVERDUE = '2026-07-31T11:59:50.000Z';

describe('the payment checkpoint', () => {
  // Exactly one payment is ever charged per order, so a card that drew a box for a
  // provider the order never used would show a checkpoint that can never be reached
  // and would say "4 of 6" about an order that is finished.

  it('draws the route the order actually took, in front of the rest', () => {
    const [card] = group([d('evt-1', 'stripe', 'done'), d('evt-1', 'slack', 'done')]);
    expect(card.steps.map((step) => step.target)).toEqual(
      ['stripe', 'hubspot', 'ledger', 'slack', 'mailer'],
    );
  });

  it('draws five checkpoints and not one more', () => {
    const [card] = group([d('evt-1', 'stripe', 'done')]);
    expect(card.total).toBe(5);
  });

  it('names it, so the card and the tile under the hub agree', () => {
    const [card] = group([d('evt-1', 'stripe', 'done')]);
    expect(card.steps[0].label).toBe('Stripe');
  });

  it('falls back to the usual route before any payment row exists', () => {
    // The card has to draw five boxes from the first frame rather than four and
    // then grow one.
    const [card] = group([d('evt-1', 'slack', 'pending')]);
    expect(card.steps.map((step) => step.target)).toEqual(CHECKPOINTS);
  });
});

describe('groupIntoOrders', () => {
  it('makes one card per order, not one per delivery', () => {
    const orders = group([
      d('evt-1', 'stripe', 'done'),
      d('evt-1', 'hubspot', 'pending'),
      d('evt-2', 'stripe', 'done'),
    ]);
    expect(orders.map((o) => o.eventId)).toEqual(['evt-2', 'evt-1']);
  });

  it('shows the newest order first', () => {
    const orders = group([
      d('evt-old', 'stripe', 'done'),
      d('evt-new', 'stripe', 'done'),
    ]);
    expect(orders[0].eventId).toBe('evt-new');
  });

  it('always lays out the same five checkpoints in the same order', () => {
    const [card] = group([d('evt-1', 'hubspot', 'done')]);
    expect(card.steps.map((s) => s.target)).toEqual([...CHECKPOINTS]);
  });

  it('counts a checkpoint the queue has not created yet as waiting', () => {
    // The confirmation mail is only enqueued once everything else is done
    // (spec 6.7), so for most of an order's life it has no row at all. A missing
    // row is not a missing step, and the card must not pretend the chain is
    // shorter than it is.
    const [card] = group([d('evt-1', 'stripe', 'done')]);
    const mailer = card.steps.find((s) => s.target === 'mailer');
    expect(mailer?.state).toBe('waiting');
    expect(card.total).toBe(5);
  });

  it('counts how many checkpoints are through', () => {
    const [card] = group([
      d('evt-1', 'stripe', 'done'),
      d('evt-1', 'hubspot', 'done'),
      d('evt-1', 'slack', 'pending'),
    ]);
    expect(card.doneCount).toBe(2);
    expect(card.total).toBe(5);
  });

  it('says which system is holding things up and when it tries again', () => {
    const [card] = group([
      d('evt-1', 'stripe', 'done'),
      d('evt-1', 'hubspot', 'pending', {
        attempts: 3, nextAt: '2026-07-30T22:29:37.000Z', lastError: 'ECONNRESET',
      }),
    ]);
    expect(card.headline).toContain('HubSpot');
    expect(card.headline).toContain('attempt 3');
  });

  it('counts down to the next try on the card, where the retry belongs', () => {
    // The hub used to print this over the whole queue, which made a number about
    // one delivery read as a fact about all of them. It is a promise about this
    // order, so it is made on this order.
    const [card] = group([
      d('evt-1', 'hubspot', 'pending', { attempts: 3, nextAt: IN_20_SECONDS }),
    ]);
    expect(card.headline).toBe('HubSpot: attempt 3 failed, next try in 20 seconds');
  });

  it('stops at the failure when the next try is already overdue', () => {
    // The worker has not picked it up yet. "in 0 seconds" would be a promise the
    // rows do not make, so the sentence ends before the when.
    const [card] = group([
      d('evt-1', 'hubspot', 'pending', { attempts: 3, nextAt: OVERDUE }),
    ]);
    expect(card.headline).toBe('HubSpot: attempt 3 failed, trying again');
  });

  it('leads with the one that needs a human over the one still retrying', () => {
    const [card] = group([
      d('evt-1', 'hubspot', 'pending', { attempts: 2 }),
      d('evt-1', 'slack', 'dead', { attempts: 6, lastError: 'gave up' }),
    ]);
    expect(card.headline).toMatch(/needs a human/i);
    expect(card.headline).toContain('Slack');
  });

  it('says so plainly when everything is through', () => {
    const orders = group(CHECKPOINTS.map((t) => d('evt-1', t, 'done')));
    expect(orders[0].doneCount).toBe(5);
    expect(orders[0].headline).toMatch(/all five/i);
  });

  it('reports an order that is mid-flight as on its way', () => {
    const [card] = group([d('evt-1', 'stripe', 'inflight', { attempts: 1 })]);
    expect(card.headline).toMatch(/on its way|going out/i);
  });

  it('carries the detail each checkpoint needs to be checked', () => {
    const [card] = group([
      d('evt-1', 'stripe', 'done', { remoteRef: 'pi_1', attempts: 1 }),
      d('evt-1', 'hubspot', 'pending', {
        attempts: 4, nextAt: '2026-07-30T22:29:37.000Z', lastError: 'ECONNRESET',
      }),
    ]);
    const stripe = card.steps.find((s) => s.target === 'stripe');
    const hubspot = card.steps.find((s) => s.target === 'hubspot');
    expect(stripe?.remoteRef).toBe('pi_1');
    expect(hubspot?.attempts).toBe(4);
    expect(hubspot?.lastError).toBe('ECONNRESET');
    expect(hubspot?.nextAt).toBe('2026-07-30T22:29:37.000Z');
  });

  it('shows the visitor endpoint as a sixth checkpoint only when it is in use', () => {
    const without = group([d('evt-1', 'stripe', 'done')]);
    expect(without[0].steps).toHaveLength(5);

    const with_ = group([
      d('evt-2', 'stripe', 'done'),
      d('evt-2', 'custom_webhook', 'pending'),
    ]);
    expect(with_[0].steps.map((s) => s.target)).toContain('custom_webhook');
    expect(with_[0].total).toBe(6);
  });

  it('heads every card with the order number, which the database can be asked for', () => {
    const [card] = groupIntoOrders(
      [d('3f8a1c2d-0000-4000-8000-000000000000', 'stripe', 'done')],
      [order('3f8a1c2d-0000-4000-8000-000000000000', 1042)],
    );
    expect(card.number).toBe(1042);
  });

  it('carries the moment the order arrived, not the moment a delivery moved', () => {
    const [card] = groupIntoOrders(
      [d('evt-1', 'stripe', 'done')],
      [order('evt-1', 1000, { receivedAt: '2026-07-31T09:14:02.000Z' })],
    );
    expect(card.receivedAt).toBe('2026-07-31T09:14:02.000Z');
  });

  it('carries what was ordered so the opened card can itemise it', () => {
    const [card] = groupIntoOrders(
      [d('evt-1', 'stripe', 'done')],
      [order('evt-1', 1000, {
        booking: {
          source: 'form',
          lines: [{ sku: 'TEAPOT', name: 'Teapot', qty: 1, cents: 4900 }],
          totalCents: 4900,
        },
      })],
    );
    expect(card.booking?.lines[0].name).toBe('Teapot');
    expect(card.booking?.totalCents).toBe(4900);
    expect(card.booking?.source).toBe('form');
  });

  it('admits an order that was never booked rather than drawing an empty basket', () => {
    // A Stripe payment webhook makes an event with deliveries and no orders row.
    const [card] = groupIntoOrders([d('evt-1', 'stripe', 'done')], [order('evt-1', 1000)]);
    expect(card.booking).toBeNull();
  });

  it('sorts by the order number rather than by whichever delivery moved first', () => {
    const orders = groupIntoOrders(
      [d('evt-a', 'stripe', 'done'), d('evt-b', 'stripe', 'done')],
      [order('evt-a', 1007), order('evt-b', 1003)],
    );
    expect(orders.map((o) => o.number)).toEqual([1007, 1003]);
  });

  it('draws no card for a delivery whose order the board did not describe', () => {
    // The two lists are read a moment apart, so a reset landing between them leaves
    // deliveries with no order. A card with no number cannot say which order it is.
    const orders = groupIntoOrders(
      [d('evt-1', 'stripe', 'done'), d('evt-2', 'stripe', 'done')],
      [order('evt-2', 1000)],
    );
    expect(orders.map((o) => o.eventId)).toEqual(['evt-2']);
  });

  it('says nothing at all when nothing has happened', () => {
    expect(groupIntoOrders([], [])).toEqual([]);
  });
});
