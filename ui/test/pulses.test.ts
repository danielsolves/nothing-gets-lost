// ui/test/pulses.test.ts
// A dot on the diagram must mean something happened. Specification section 7 forbids
// stage props at the point of proof, and an animation that runs on a timer whether or
// not anything moved would be the worst possible place to put one: right where the
// visitor is deciding whether to believe the page.
//
// So every dot comes from a delivery changing state, and this is the rule that decides
// it. Pure function over two snapshots, no clock, no stream, no browser.
import { describe, it, expect } from 'vitest';
import type { DeliveryView } from '@ngl/contracts';
import { pulsesFrom } from '../src/pulses';

const delivery = (
  id: number, target: DeliveryView['target'], state: DeliveryView['state'], attempts = 1,
): DeliveryView => ({
  id, target, state, attempts,
  eventId: `evt-${id}`, nextAt: null, lastError: null, remoteRef: null, remoteAt: null,
});

describe('pulsesFrom', () => {
  it('sends a dot when a delivery is confirmed', () => {
    const pulses = pulsesFrom(
      [delivery(1, 'hubspot', 'inflight')],
      [delivery(1, 'hubspot', 'done')],
    );
    expect(pulses).toEqual([{ id: 1, target: 'hubspot', kind: 'delivered' }]);
  });

  it('sends the dot back when an attempt failed and will be retried', () => {
    const pulses = pulsesFrom(
      [delivery(1, 'hubspot', 'inflight', 1)],
      [delivery(1, 'hubspot', 'pending', 1)],
    );
    expect(pulses).toEqual([{ id: 1, target: 'hubspot', kind: 'held' }]);
  });

  it('stops the dot short when a delivery is parked for a human', () => {
    const pulses = pulsesFrom(
      [delivery(1, 'slack', 'inflight')],
      [delivery(1, 'slack', 'dead')],
    );
    expect(pulses).toEqual([{ id: 1, target: 'slack', kind: 'parked' }]);
  });

  it('says nothing about a delivery that did not move', () => {
    const same = [delivery(1, 'hubspot', 'done')];
    expect(pulsesFrom(same, same)).toEqual([]);
  });

  it('does not fire on the first render, when everything looks new', () => {
    // Arriving mid-experiment must not spray a dot for every delivery on the board.
    const pulses = pulsesFrom(undefined, [
      delivery(1, 'hubspot', 'done'), delivery(2, 'stripe', 'done'),
    ]);
    expect(pulses).toEqual([]);
  });

  it('ignores a queued delivery that has not been tried yet', () => {
    const pulses = pulsesFrom([], [delivery(1, 'hubspot', 'pending', 0)]);
    expect(pulses).toEqual([]);
  });

  it('fires once per delivery when several move at the same time', () => {
    const pulses = pulsesFrom(
      [delivery(1, 'hubspot', 'inflight'), delivery(2, 'stripe', 'inflight')],
      [delivery(1, 'hubspot', 'done'), delivery(2, 'stripe', 'done')],
    );
    expect(pulses).toHaveLength(2);
    expect(pulses.map((p) => p.target).sort()).toEqual(['hubspot', 'stripe']);
  });

  it('fires again when the same delivery fails a second time', () => {
    // Same row, same state name, one more attempt. The visitor watching a cut line
    // needs to see each retry, not one dot for the whole outage.
    const pulses = pulsesFrom(
      [delivery(1, 'hubspot', 'pending', 1)],
      [delivery(1, 'hubspot', 'pending', 2)],
    );
    expect(pulses).toEqual([{ id: 1, target: 'hubspot', kind: 'held' }]);
  });

  it('says nothing about a delivery that vanished', () => {
    // Reset empties the board. That is not five deliveries succeeding at once.
    expect(pulsesFrom([delivery(1, 'hubspot', 'inflight')], [])).toEqual([]);
  });

  it('ignores a target the diagram does not draw', () => {
    // custom_webhook is the visitor's own endpoint and has no box to travel to.
    const pulses = pulsesFrom(
      [delivery(1, 'custom_webhook', 'inflight')],
      [delivery(1, 'custom_webhook', 'done')],
    );
    expect(pulses).toEqual([]);
  });
});
