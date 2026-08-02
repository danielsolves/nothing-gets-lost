// @vitest-environment jsdom
// ui/test/useImpacts.test.tsx
// When a tile is told a dot has reached it.
//
// The timing is the whole feature. A flash that fires as the dot sets off announces
// an arrival that has not happened, on a page whose argument is that the drawing
// shows what occurred, so it would be worse than no flash at all.
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { act, cleanup, render } from '@testing-library/react';
import { useState } from 'react';
import { PULSE_MS, type LivePulse } from '../src/useDeliveryPulses';
import { useImpacts, type Impacts } from '../src/useImpacts';

afterEach(cleanup);
beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

function pulse(target: LivePulse['target'], key: string, kind: LivePulse['kind']): LivePulse {
  return { id: 1, target, kind, key };
}

function harness() {
  let set: (pulses: LivePulse[]) => void = () => {};
  let latest: Impacts = {};

  function Probe(props: { pulses: LivePulse[] }) {
    latest = useImpacts(props.pulses);
    return null;
  }

  function Host() {
    const [pulses, setPulses] = useState<LivePulse[]>([]);
    set = setPulses;
    return <Probe pulses={pulses} />;
  }

  render(<Host />);
  return {
    send(pulses: LivePulse[]) { act(() => { set(pulses); }); },
    tick(ms: number) { act(() => { vi.advanceTimersByTime(ms); }); },
    struck: () => latest,
  };
}

describe('useImpacts', () => {
  it('says nothing while the dot is still crossing the gap', () => {
    const h = harness();
    h.send([pulse('stripe', 'p1', 'delivered')]);
    expect(h.struck().stripe).toBeUndefined();

    h.tick(PULSE_MS * 0.5);
    expect(h.struck().stripe).toBeUndefined();
  });

  it('marks the tile once the dot is at the far end', () => {
    const h = harness();
    h.send([pulse('stripe', 'p1', 'delivered')]);
    h.tick(PULSE_MS);
    expect(h.struck().stripe).toBe('delivered');
  });

  it('lets go again, because a hit is not a state', () => {
    const h = harness();
    h.send([pulse('stripe', 'p1', 'delivered')]);
    h.tick(PULSE_MS);
    h.tick(1000);
    expect(h.struck().stripe).toBeUndefined();
  });

  it('carries the kind, because the two arrivals are opposite news', () => {
    const h = harness();
    h.send([pulse('slack', 'p1', 'parked')]);
    h.tick(PULSE_MS);
    expect(h.struck().slack).toBe('parked');
  });

  it('marks only the tile the dot was going to', () => {
    const h = harness();
    h.send([pulse('stripe', 'p1', 'delivered')]);
    h.tick(PULSE_MS);
    expect(h.struck().hubspot).toBeUndefined();
  });

  it('ignores the dot travelling into the hub, which has no tile', () => {
    const h = harness();
    h.send([pulse('shop', 'p1', 'arrival')]);
    h.tick(PULSE_MS);
    expect(h.struck()).toEqual({});
  });

  it('does not strike twice for one dot when the page re-renders', () => {
    // The pulse list survives for the length of the animation, so it is handed back
    // on every board that arrives in the meantime. Counting those as new arrivals
    // would make one delivery flash again and again.
    const h = harness();
    const one = [pulse('stripe', 'p1', 'delivered')];
    h.send(one);
    h.tick(PULSE_MS);
    h.tick(1000);
    h.send([...one]);
    h.tick(PULSE_MS);
    expect(h.struck().stripe).toBeUndefined();
  });
});
