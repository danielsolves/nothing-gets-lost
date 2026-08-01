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
  sentAt: null, answeredAt: null,
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

  it('needs a previous state to compare against, or a reload looks like traffic', () => {
    // On mount the delivery list is empty, so the empty array became the baseline
    // and the first real snapshot arrived looking like forty simultaneous changes.
    // A row seen for the first time is not a change we witnessed.
    const pulses = pulsesFrom([], [
      delivery(1, 'hubspot', 'done'),
      delivery(2, 'stripe', 'done'),
      delivery(3, 'slack', 'pending', 3),
    ]);
    expect(pulses).toEqual([]);
  });

  it('fires once that same row is seen changing', () => {
    const first = [delivery(1, 'hubspot', 'pending', 0)];
    expect(pulsesFrom([], first)).toEqual([]);

    const moved = [{ ...first[0], state: 'done' as const, attempts: 1 }];
    expect(pulsesFrom(first, moved)).toEqual([
      { id: first[0].id, target: 'hubspot', kind: 'delivered' },
    ]);
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
    const a = delivery(1, 'hubspot', 'inflight');
    const b = delivery(2, 'stripe', 'inflight');
    const pulses = pulsesFrom(
      [a, b],
      [{ ...a, state: 'done' }, { ...b, state: 'done' }],
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

// The diagram now draws where an order comes from, and nothing travelled along the
// wire from the shop, so an order still appeared to begin inside the hub. An arrival
// is not a state change of any one delivery, it is a whole order turning up, and the
// only evidence of it in this data is an event id that was not there a moment ago.
describe('pulsesFrom, when an order arrives', () => {
  const order = (
    eventId: string, firstId: number, targets: DeliveryView['target'][],
  ): DeliveryView[] => targets.map((target, index) => ({
    ...delivery(firstId + index, target, 'pending', 0), eventId,
  }));

  const onBoard = order('evt-old', 1, ['hubspot']);

  it('sends a dot down the shop wire when a new order turns up', () => {
    const pulses = pulsesFrom(onBoard, [...onBoard, ...order('evt-new', 10, ['hubspot'])]);
    expect(pulses).toEqual([{ id: 10, target: 'shop', kind: 'arrival' }]);
  });

  it('sends one dot per order, not one per delivery the order queues', () => {
    // One order fans out to four systems at once. Four dots on the incoming wire
    // would say four orders arrived, which is a lie about the thing being measured.
    const arriving = order('evt-new', 10, ['hubspot', 'stripe', 'slack', 'mailer']);
    const pulses = pulsesFrom(onBoard, [...onBoard, ...arriving]);
    expect(pulses).toEqual([{ id: 10, target: 'shop', kind: 'arrival' }]);
  });

  it('sends a dot for each of two orders arriving together', () => {
    const pulses = pulsesFrom(onBoard, [
      ...onBoard,
      ...order('evt-a', 10, ['hubspot', 'stripe']),
      ...order('evt-b', 20, ['hubspot', 'stripe']),
    ]);
    expect(pulses).toEqual([
      { id: 10, target: 'shop', kind: 'arrival' },
      { id: 20, target: 'shop', kind: 'arrival' },
    ]);
  });

  it('picks the same delivery to stand for the order however the rows are ordered', () => {
    const arriving = order('evt-new', 10, ['hubspot', 'stripe']);
    const forwards = pulsesFrom(onBoard, [...onBoard, ...arriving]);
    const backwards = pulsesFrom(onBoard, [...onBoard, ...[...arriving].reverse()]);
    expect(backwards).toEqual(forwards);
  });

  it('counts an order in even when nothing it queued is drawn', () => {
    // The wire that matters here is the one into the hub. Which systems the order
    // then fans out to has no bearing on whether it arrived.
    const pulses = pulsesFrom(onBoard, [...onBoard, ...order('evt-new', 10, ['custom_webhook'])]);
    expect(pulses).toEqual([{ id: 10, target: 'shop', kind: 'arrival' }]);
  });

  it('says nothing about an order that was already on the board', () => {
    // Its deliveries moving is not the order arriving a second time.
    const before = order('evt-1', 1, ['hubspot']);
    const after = [{ ...before[0], state: 'done' as const, attempts: 1 }];
    expect(pulsesFrom(before, after)).toEqual([{ id: 1, target: 'hubspot', kind: 'delivered' }]);
  });

  it('reports the arrival alongside a delivery that moved in the same snapshot', () => {
    const inflight = delivery(1, 'hubspot', 'inflight');
    const pulses = pulsesFrom(
      [inflight],
      [{ ...inflight, state: 'done' as const }, ...order('evt-new', 10, ['stripe'])],
    );
    expect(pulses).toEqual([
      { id: 10, target: 'shop', kind: 'arrival' },
      { id: 1, target: 'hubspot', kind: 'delivered' },
    ]);
  });

  it('does not announce arrivals on the first render', () => {
    expect(pulsesFrom(undefined, order('evt-1', 1, ['hubspot', 'stripe']))).toEqual([]);
  });

  it('stays quiet after an empty snapshot, or a reload is a burst of arrivals', () => {
    // The list is empty on mount, so an empty previous snapshot is indistinguishable
    // from not having looked yet, and every order on the board would read as new.
    const pulses = pulsesFrom([], [
      ...order('evt-1', 1, ['hubspot']), ...order('evt-2', 2, ['stripe']),
    ]);
    expect(pulses).toEqual([]);
  });
});

// The board is now told to the page whole and put in place of what the page held, so
// reset genuinely empties the list. That turned the rule above into a hole at the
// worst moment: after a reset the visitor presses send and watches, and their order
// was compared against an empty list and travelled silently.
//
// An empty previous list is two different things. Before the first board arrives it
// means "we have not looked", and every order on the board would read as new. Once
// the page has watched the board go from full to empty it means the board is empty,
// which is a fact and not an absence of one. Only the caller can tell them apart, so
// the caller says which it is holding.
describe('pulsesFrom, on a board the page watched empty', () => {
  const order = (
    eventId: string, firstId: number, targets: DeliveryView['target'][],
  ): DeliveryView[] => targets.map((target, index) => ({
    ...delivery(firstId + index, target, 'pending', 0), eventId,
  }));

  it('announces the first order after the reset', () => {
    const pulses = pulsesFrom([], order('evt-new', 10, ['hubspot', 'stripe']), {
      boardWasEmptied: true,
    });
    expect(pulses).toEqual([{ id: 10, target: 'shop', kind: 'arrival' }]);
  });

  it('announces each of two orders, once each', () => {
    const pulses = pulsesFrom([], [
      ...order('evt-a', 10, ['hubspot', 'stripe']),
      ...order('evt-b', 20, ['slack']),
    ], { boardWasEmptied: true });
    expect(pulses).toEqual([
      { id: 10, target: 'shop', kind: 'arrival' },
      { id: 20, target: 'shop', kind: 'arrival' },
    ]);
  });

  it('still says nothing about a row it never watched move', () => {
    // A delivery that is already confirmed the first time it is seen was not watched
    // travelling. The order arriving is the thing that happened, and that is the dot.
    const pulses = pulsesFrom([], [delivery(1, 'hubspot', 'done')], {
      boardWasEmptied: true,
    });
    expect(pulses).toEqual([{ id: 1, target: 'shop', kind: 'arrival' }]);
  });

  it('has nothing to say about an empty board that stays empty', () => {
    expect(pulsesFrom([], [], { boardWasEmptied: true })).toEqual([]);
  });

  it('stays quiet when the caller does not claim to have watched it', () => {
    // The default is the careful one: a caller that says nothing is a caller that
    // cannot tell an empty board from a board it has not seen.
    expect(pulsesFrom([], order('evt-new', 10, ['hubspot']))).toEqual([]);
  });
});

describe('the answer coming back', () => {
  it('draws the return leg of a delivery that was timed on both sides', () => {
    // A settled delivery is two things that happened: a call went out and an answer
    // came back. One dot absorbed at the far end said the first half and left the
    // second to be taken on trust, which is the half that matters here.
    const before = [delivery(1, 'hubspot', 'inflight', 1)];
    const after = [{
      ...delivery(1, 'hubspot', 'done', 1),
      sentAt: '2026-08-01T10:00:00.000Z',
      answeredAt: '2026-08-01T10:00:00.312Z',
    }];
    expect(pulsesFrom(before, after).map((p) => p.kind))
      .toEqual(['delivered', 'answer']);
  });

  it('draws no return leg for a row that was never timed', () => {
    // Never an animation standing in for a measurement we do not have.
    const before = [delivery(1, 'hubspot', 'inflight', 1)];
    const after = [delivery(1, 'hubspot', 'done', 1)];
    expect(pulsesFrom(before, after).map((p) => p.kind)).toEqual(['delivered']);
  });

  it('sends the return leg back along the wire it went out on', () => {
    const before = [delivery(1, 'slack', 'inflight', 1)];
    const after = [{
      ...delivery(1, 'slack', 'done', 1),
      sentAt: '2026-08-01T10:00:00.000Z',
      answeredAt: '2026-08-01T10:00:00.100Z',
    }];
    for (const pulse of pulsesFrom(before, after)) expect(pulse.target).toBe('slack');
  });

  it('draws nothing back from an attempt that got no answer', () => {
    const before = [delivery(1, 'hubspot', 'inflight', 1)];
    const after = [{ ...delivery(1, 'hubspot', 'dead', 3), sentAt: '2026-08-01T10:00:00.000Z' }];
    expect(pulsesFrom(before, after).map((p) => p.kind)).toEqual(['parked']);
  });
});
