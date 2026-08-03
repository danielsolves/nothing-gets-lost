// @vitest-environment jsdom
// ui/test/useSpokenActivity.test.tsx
// A tile may not report an outcome the drawing has not delivered to it yet.
//
// The fault this covers was visible on the live page: a dot set off from the hub
// towards Stripe and the Stripe tile printed "Answered in 984 ms" while the dot was
// still crossing the gap. The result arrived before the thing carrying it, which on a
// page whose whole claim is that the drawing shows what happened is the drawing
// telling the story out of order.
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { act, cleanup, render } from '@testing-library/react';
import { useState } from 'react';
import type { DeliveryView } from '@ngl/contracts';
import { PULSE_MS, type LivePulse } from '../src/useDeliveryPulses';
import { useSpokenActivity } from '../src/useSpokenActivity';

afterEach(cleanup);
beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

const SENT = '2026-08-02T10:00:00.000Z';

function delivery(
  id: number, target: DeliveryView['target'], state: DeliveryView['state'],
  extra: Partial<DeliveryView> = {},
): DeliveryView {
  return {
    id, eventId: `evt-${id}`, target, state, attempts: 1,
    nextAt: null, lastError: null, remoteRef: null, remoteAt: null,
    sentAt: SENT, answeredAt: null, ...extra,
  };
}

function pulse(target: LivePulse['target'], key: string): LivePulse {
  return { id: 1, target, kind: 'delivered', key };
}

function harness() {
  let set: (next: { rows: DeliveryView[]; pulses: LivePulse[] }) => void = () => {};
  let latest = '';

  function Probe(props: { rows: DeliveryView[]; pulses: LivePulse[] }) {
    const spoken = useSpokenActivity(props.rows, props.pulses);
    latest = spoken.stripe?.text ?? '';
    return null;
  }

  function Host() {
    const [board, setBoard] = useState<{ rows: DeliveryView[]; pulses: LivePulse[] }>({
      rows: [], pulses: [],
    });
    set = setBoard;
    return <Probe rows={board.rows} pulses={board.pulses} />;
  }

  render(<Host />);
  return {
    push(rows: DeliveryView[], pulses: LivePulse[]) {
      act(() => { set({ rows, pulses }); });
    },
    tick(ms: number) {
      act(() => { vi.advanceTimersByTime(ms); });
    },
    said: () => latest,
  };
}

describe('useSpokenActivity', () => {
  it('says nothing about a system while its dot is still on the way', () => {
    const h = harness();
    h.push([delivery(1, 'stripe', 'inflight')], []);
    expect(h.said()).toBe('Delivering');

    // The delivery settles and a dot sets off carrying that news. Until it lands,
    // the tile is still saying what it said before.
    const done = [delivery(1, 'stripe', 'done', { answeredAt: SENT })];
    h.push(done, [pulse('stripe', 'p1')]);
    expect(h.said()).toBe('Delivering');
  });

  it('says it the moment the dot lands', () => {
    const h = harness();
    h.push([delivery(1, 'stripe', 'inflight')], []);
    const done = [delivery(1, 'stripe', 'done', { answeredAt: SENT })];
    h.push(done, [pulse('stripe', 'p1')]);

    h.tick(PULSE_MS);
    expect(h.said()).not.toBe('Delivering');
  });

  it('holds one system without silencing the others', () => {
    // A dot travelling to Stripe says nothing about what HubSpot is doing, and a
    // hold that stopped the whole drawing would trade one wrong tile for four.
    const h = harness();
    h.push([delivery(1, 'stripe', 'inflight'), delivery(2, 'hubspot', 'inflight')], []);
    h.push(
      [delivery(1, 'stripe', 'done', { answeredAt: SENT }), delivery(2, 'hubspot', 'inflight')],
      [pulse('stripe', 'p1')],
    );
    // Stripe is held, HubSpot is not and keeps reporting for itself.
    expect(h.said()).toBe('Delivering');
  });

  it('speaks at once for a system with nothing in the air', () => {
    // Which is every tile most of the time. A hold that had to expire before a tile
    // could ever speak would leave the drawing blank on arrival.
    const h = harness();
    h.push([delivery(1, 'stripe', 'inflight')], []);
    expect(h.said()).toBe('Delivering');
  });
});
