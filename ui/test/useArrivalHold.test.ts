// @vitest-environment jsdom
// ui/test/useArrivalHold.test.ts
// The hub is not allowed to know about an order before the dot carrying it has
// finished travelling. Sending one used to raise the waiting count the instant the
// board said so, which was roughly a second before the dot reached the hub, so the
// page answered a question the animation had not asked yet and the travel read as
// decoration rather than as the thing happening.
//
// The rule for what counts as an arrival is the same one pulses.ts uses: an event id
// in the list that was not in the list before. It is stated twice on purpose. The two
// could be wired together, and then the hub would hold its breath because a dot was
// on screen rather than because an order had arrived, which is the tail wagging the
// dog: turn the animation off and the numbers would stop being right.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { Counters, DeliveryView } from '@ngl/contracts';
import { useArrivalHold, type HubBoard } from '../src/useArrivalHold';

const COUNTERS: Counters = {
  received: 0, delivered: 0, waiting: 0, duplicatesDropped: 0, needsHuman: 0, lost: 0,
};

/**
 * A board is its rows plus the numbers about them, and they travel together. Built
 * once per list, because the hook is keyed to the value it is handed: a caller that
 * builds a fresh one every render is the mistake this shape exists to prevent, and a
 * test that made it would be testing something the page never does.
 */
const boards = new Map<DeliveryView[], HubBoard>();
const board = (deliveries: DeliveryView[]): HubBoard => {
  const built = boards.get(deliveries)
    ?? { counters: { ...COUNTERS, waiting: deliveries.length }, deliveries, orders: [] };
  boards.set(deliveries, built);
  return built;
};

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

const order = (eventId: string, firstId: number): DeliveryView[] =>
  (['hubspot', 'stripe'] as const).map((target, index): DeliveryView => ({
    id: firstId + index, eventId, target, state: 'pending', attempts: 0,
    nextAt: null, lastError: null, remoteRef: null, remoteAt: null,
  }));

/** Time passing, with React told about the state the timers set. */
function elapse(ms: number): void {
  act(() => { vi.advanceTimersByTime(ms); });
}

/** The hook fed one board after another, the way the stream feeds it. */
function watch(first: DeliveryView[]) {
  const rendered = renderHook(
    ({ live }) => useArrivalHold(live),
    { initialProps: { live: board(first) } },
  );
  return {
    show: (deliveries: DeliveryView[]) => rendered.rerender({ live: board(deliveries) }),
    held: () => rendered.result.current.deliveries,
    waiting: () => rendered.result.current.counters.waiting,
  };
}

describe('useArrivalHold', () => {
  it('shows the first board at once, since nothing travelled to bring it', () => {
    // A visitor arriving mid-experiment is looking at the world as it already is.
    // Holding that back would open the page on an empty hub for no reason.
    const first = order('evt-1', 1);
    const page = watch(first);
    expect(page.held()).toBe(first);
  });

  it('holds the counters with the rows, so the two never disagree', () => {
    // Numbers released a beat ahead of the queue they count would have the hub
    // arguing with itself for the length of the animation.
    const before = order('evt-1', 1);
    const page = watch(before);
    page.show([...before, ...order('evt-2', 10)]);
    expect(page.waiting()).toBe(2);
    elapse(900);
    expect(page.waiting()).toBe(4);
  });

  it('keeps showing the board it had while an order is still on its way', () => {
    const before = order('evt-1', 1);
    const page = watch(before);
    page.show([...before, ...order('evt-2', 10)]);
    expect(page.held()).toBe(before);
  });

  it('lets the new order through once the dot has finished travelling', () => {
    const before = order('evt-1', 1);
    const after = [...before, ...order('evt-2', 10)];
    const page = watch(before);
    page.show(after);
    elapse(900);
    expect(page.held()).toBe(after);
  });

  it('passes a board with no new order straight through', () => {
    // Deliveries succeeding and failing are not arrivals. Holding those back would
    // put the whole hub a second behind the diagram for the rest of the session.
    const before = order('evt-1', 1);
    const page = watch(before);
    const progressed = before.map((row) => ({ ...row, state: 'done' as const }));
    page.show(progressed);
    expect(page.held()).toBe(progressed);
  });

  it('does not let a tick landing mid-flight release the hold early', () => {
    // The board arrives every second and the dot travels for less than that, so a
    // tick carrying no new order lands inside the window. It must not be read as
    // permission to show what the previous one was holding back.
    const before = order('evt-1', 1);
    const after = [...before, ...order('evt-2', 10)];
    const page = watch(before);
    page.show(after);
    elapse(300);
    page.show([...after]);
    expect(page.held()).toBe(before);
  });

  it('holds an order that arrives while another is still travelling', () => {
    const first = order('evt-1', 1);
    const second = [...first, ...order('evt-2', 10)];
    const third = [...second, ...order('evt-3', 20)];
    const page = watch(first);
    page.show(second);
    elapse(400);
    page.show(third);
    elapse(600);
    expect(page.held()).toBe(first);
    elapse(400);
    expect(page.held()).toBe(third);
  });
});
