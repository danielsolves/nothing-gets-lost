// ui/test/queue.test.ts
// The queue is the thing the whole project exists to show. The specification calls
// the mediator the heart of the repo and defends building the queue by hand with:
// "take a ready-made one and the most interesting part becomes invisible."
//
// It was invisible anyway. The page drew a box labelled "queue · retry · exactly
// once" and asked the visitor to take it on faith. This is the rule that turns the
// flat delivery list back into what it really is: one order, five checkpoints, and
// a plain sentence about where it is stuck.
import { describe, it, expect } from 'vitest';
import type { DeliveryView, Target } from '@ngl/contracts';
import { groupIntoOrders, CHECKPOINTS } from '../src/queue';

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

describe('groupIntoOrders', () => {
  it('makes one card per order, not one per delivery', () => {
    const orders = groupIntoOrders([
      d('evt-1', 'stripe', 'done'),
      d('evt-1', 'hubspot', 'pending'),
      d('evt-2', 'stripe', 'done'),
    ]);
    expect(orders.map((o) => o.eventId)).toEqual(['evt-2', 'evt-1']);
  });

  it('shows the newest order first', () => {
    const older = [d('evt-old', 'stripe', 'done')];
    const newer = [d('evt-new', 'stripe', 'done')];
    const orders = groupIntoOrders([...older, ...newer]);
    expect(orders[0].eventId).toBe('evt-new');
  });

  it('always lays out the same five checkpoints in the same order', () => {
    const [order] = groupIntoOrders([d('evt-1', 'hubspot', 'done')]);
    expect(order.steps.map((s) => s.target)).toEqual([...CHECKPOINTS]);
  });

  it('counts a checkpoint the queue has not created yet as waiting', () => {
    // The confirmation mail is only enqueued once everything else is done
    // (spec 6.7), so for most of an order's life it has no row at all. A missing
    // row is not a missing step, and the card must not pretend the chain is
    // shorter than it is.
    const [order] = groupIntoOrders([d('evt-1', 'stripe', 'done')]);
    const mailer = order.steps.find((s) => s.target === 'mailer');
    expect(mailer?.state).toBe('waiting');
    expect(order.total).toBe(5);
  });

  it('counts how many checkpoints are through', () => {
    const [order] = groupIntoOrders([
      d('evt-1', 'stripe', 'done'),
      d('evt-1', 'hubspot', 'done'),
      d('evt-1', 'slack', 'pending'),
    ]);
    expect(order.doneCount).toBe(2);
    expect(order.total).toBe(5);
  });

  it('says which system is holding things up and when it tries again', () => {
    const [order] = groupIntoOrders([
      d('evt-1', 'stripe', 'done'),
      d('evt-1', 'hubspot', 'pending', {
        attempts: 3, nextAt: '2026-07-30T22:29:37.000Z', lastError: 'ECONNRESET',
      }),
    ]);
    expect(order.headline).toContain('HubSpot');
    expect(order.headline).toContain('attempt 3');
  });

  it('leads with the one that needs a human over the one still retrying', () => {
    const [order] = groupIntoOrders([
      d('evt-1', 'hubspot', 'pending', { attempts: 2 }),
      d('evt-1', 'slack', 'dead', { attempts: 6, lastError: 'gave up' }),
    ]);
    expect(order.headline).toMatch(/needs a human/i);
    expect(order.headline).toContain('Slack');
  });

  it('says so plainly when everything is through', () => {
    const orders = groupIntoOrders(
      CHECKPOINTS.map((t) => d('evt-1', t, 'done')),
    );
    expect(orders[0].doneCount).toBe(5);
    expect(orders[0].headline).toMatch(/all five/i);
  });

  it('reports an order that is mid-flight as on its way', () => {
    const [order] = groupIntoOrders([
      d('evt-1', 'stripe', 'inflight', { attempts: 1 }),
    ]);
    expect(order.headline).toMatch(/on its way|going out/i);
  });

  it('carries the detail each checkpoint needs to be checked', () => {
    const [order] = groupIntoOrders([
      d('evt-1', 'stripe', 'done', { remoteRef: 'pi_1', attempts: 1 }),
      d('evt-1', 'hubspot', 'pending', {
        attempts: 4, nextAt: '2026-07-30T22:29:37.000Z', lastError: 'ECONNRESET',
      }),
    ]);
    const stripe = order.steps.find((s) => s.target === 'stripe');
    const hubspot = order.steps.find((s) => s.target === 'hubspot');
    expect(stripe?.remoteRef).toBe('pi_1');
    expect(hubspot?.attempts).toBe(4);
    expect(hubspot?.lastError).toBe('ECONNRESET');
    expect(hubspot?.nextAt).toBe('2026-07-30T22:29:37.000Z');
  });

  it('shows the visitor endpoint as a sixth checkpoint only when it is in use', () => {
    const without = groupIntoOrders([d('evt-1', 'stripe', 'done')]);
    expect(without[0].steps).toHaveLength(5);

    const with_ = groupIntoOrders([
      d('evt-2', 'stripe', 'done'),
      d('evt-2', 'custom_webhook', 'pending'),
    ]);
    expect(with_[0].steps.map((s) => s.target)).toContain('custom_webhook');
    expect(with_[0].total).toBe(6);
  });

  it('gives every card a short handle that can be pasted into the sql console', () => {
    const [order] = groupIntoOrders([
      d('3f8a1c2d-0000-4000-8000-000000000000', 'stripe', 'done'),
    ]);
    expect(order.shortId).toBe('3f8a1c2d');
  });

  it('says nothing at all when nothing has happened', () => {
    expect(groupIntoOrders([])).toEqual([]);
  });
});
