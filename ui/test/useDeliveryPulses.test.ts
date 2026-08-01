// @vitest-environment jsdom
// ui/test/useDeliveryPulses.test.ts
// pulses.ts decides what a dot means; this hook decides what the page knows. The one
// thing it knows that the pure function cannot is which kind of empty list it is
// holding: the placeholder it starts with, or a board it watched empty.
//
// It matters because reset now really does empty the page. Without this the first
// order after every reset arrived with nothing on the wire, which is the one moment
// the visitor is watching hardest.
import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { DeliveryView } from '@ngl/contracts';
import { useDeliveryPulses } from '../src/useDeliveryPulses';

const TARGETS: DeliveryView['target'][] = ['hubspot', 'stripe'];

/** One order, fanned out to two systems, the way the mediator queues it. */
const order = (eventId: string, firstId: number): DeliveryView[] =>
  TARGETS.map((target, index): DeliveryView => ({
    id: firstId + index, eventId, target, state: 'pending', attempts: 0,
    nextAt: null, lastError: null, remoteRef: null, remoteAt: null, sentAt: null, answeredAt: null,
  }));

/** The hook, fed one board after another the way the stream feeds it. */
function watch(first: DeliveryView[]) {
  const rendered = renderHook(
    ({ deliveries }) => useDeliveryPulses(deliveries),
    { initialProps: { deliveries: first } },
  );
  return {
    show: (deliveries: DeliveryView[]) => rendered.rerender({ deliveries }),
    pulses: () => rendered.result.current,
  };
}

describe('useDeliveryPulses', () => {
  it('says nothing about the board the page arrived on', () => {
    // The list is empty until the first board lands, and that first board is the
    // world as it already was, not a burst of things happening.
    const page = watch([]);
    page.show(order('evt-1', 1));
    expect(page.pulses()).toEqual([]);
  });

  it('announces the first order after a reset emptied the board', () => {
    const page = watch([]);
    page.show(order('evt-1', 1));
    page.show([]);
    page.show(order('evt-2', 10));

    expect(page.pulses().map((pulse) => ({ target: pulse.target, kind: pulse.kind })))
      .toEqual([{ target: 'shop', kind: 'arrival' }]);
  });

  it('announces an order that arrives in the same board the reset emptied', () => {
    // A visitor quick enough to send within the second sees no empty board at all,
    // and the order is new against the rows the reset removed.
    const page = watch([]);
    page.show(order('evt-1', 1));
    page.show(order('evt-2', 10));

    expect(page.pulses()).toHaveLength(1);
  });

  it('stays quiet while the same board is repeated', () => {
    const page = watch([]);
    const board = order('evt-1', 1);
    page.show(board);
    page.show([...board]);
    expect(page.pulses()).toEqual([]);
  });
});
