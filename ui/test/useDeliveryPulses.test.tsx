// @vitest-environment jsdom
// ui/test/useDeliveryPulses.test.tsx
// The hook, wired the way App wires it: a live board for the dot coming in and a
// held board for everything that follows from it.
//
// pulses.test.ts covers the rule. This covers the plumbing, which is where the dots
// went missing: the pure function returned them and nothing reached the screen. Two
// boards mean two memories, and a memory that is not advanced on the renders where
// the two lists happen to be one object is a memory that is wrong ever after.
import { describe, it, expect, afterEach } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { useState } from 'react';
import type { DeliveryView } from '@ngl/contracts';
import { useDeliveryPulses, type LivePulse } from '../src/useDeliveryPulses';

afterEach(cleanup);

const SENT = '2026-08-02T10:00:00.000Z';

function delivery(
  id: number, eventId: string, target: DeliveryView['target'],
  state: DeliveryView['state'], attempts = 1,
): DeliveryView {
  return {
    id, eventId, target, state, attempts,
    nextAt: null, lastError: null, remoteRef: null, remoteAt: null,
    sentAt: state === 'pending' && attempts === 0 ? null : SENT,
    answeredAt: null,
  };
}

/** Drives the hook by hand, the way App drives it: live in one hand, held in the other. */
function harness() {
  const runs: LivePulse[][] = [];
  let set: (next: { live: DeliveryView[]; held: DeliveryView[] }) => void = () => {};

  function Probe(props: { live: DeliveryView[]; held: DeliveryView[] }) {
    const pulses = useDeliveryPulses(props.live, props.held);
    runs.push(pulses);
    return null;
  }

  function Host() {
    const [board, setBoard] = useState<{ live: DeliveryView[]; held: DeliveryView[] }>({
      live: [], held: [],
    });
    set = setBoard;
    return <Probe live={board.live} held={board.held} />;
  }

  render(<Host />);
  // A dot stays on screen for the length of its animation, so the hook returns
  // everything still travelling. What each push is about is what it added, so the
  // keys already on screen are subtracted rather than asserted around.
  let known = new Set<string>();
  return {
    push(live: DeliveryView[], held: DeliveryView[]): string[] {
      act(() => { set({ live, held }); });
      const now = runs[runs.length - 1] ?? [];
      const added = now.filter((pulse) => !known.has(pulse.key));
      known = new Set(now.map((pulse) => pulse.key));
      return added.map((pulse) => pulse.target);
    },
  };
}

describe('useDeliveryPulses, wired as App wires it', () => {
  it('draws the arrival off the live board and the delivery off the held one', () => {
    const first = [delivery(1, 'evt-1', 'hubspot', 'done')];
    const h = harness();

    // A first board is the world as it already was: nothing moved.
    expect(h.push(first, first)).toEqual([]);

    // An order lands. The live board carries it; the held board is still a beat
    // behind, which is the whole point of the hold.
    const arrived = [...first, delivery(2, 'evt-2', 'stripe', 'done')];
    expect(h.push(arrived, first)).toEqual(['shop']);

    // The hold releases. Now the delivery goes out, and it must not be swallowed by
    // the memory the arrival board already advanced.
    expect(h.push(arrived, arrived)).toContain('stripe');
  });

  it('keeps drawing after a board where the two lists were the same object', () => {
    // The trap. When nothing is in flight the held board and the live board are one
    // array, and reading it through only one memory leaves the other stuck in the
    // past for good, so every later delivery is measured against a stale board.
    const board1 = [delivery(1, 'evt-1', 'hubspot', 'pending', 0)];
    const h = harness();
    h.push(board1, board1);

    const board2 = [delivery(1, 'evt-1', 'hubspot', 'done', 1)];
    expect(h.push(board2, board2)).toEqual(['hubspot']);

    const board3 = [delivery(1, 'evt-1', 'hubspot', 'pending', 2)];
    expect(h.push(board3, board3)).toEqual(['hubspot']);
  });
});
