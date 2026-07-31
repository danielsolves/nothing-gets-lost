// @vitest-environment jsdom
// ui/test/useStream.test.ts
// The page may show nothing the server is not holding. That is the whole claim, and
// it was not true: the stream sent deliveries and log lines one row at a time, this
// hook merged each row into what it already had, and a merge can only ever add. Reset
// truncated the tables and the page went on drawing three orders that no longer
// existed, next to a counter that said one delivery was waiting.
//
// A tick is now one board, and this hook puts it in place of the one before it.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import type {
  BoardSnapshot, DeliveryView, OrderView, StateResponse, TimelineEntry,
} from '@ngl/contracts';
import { useStream } from '../src/useStream';

class FakeEventSource {
  static last: FakeEventSource | undefined;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((message: { data: string }) => void) | null = null;
  closed = false;

  constructor(readonly url: string) { FakeEventSource.last = this; }
  close(): void { this.closed = true; }

  /** What the browser does when a message lands, plus React's re-render. */
  send(payload: unknown): void {
    act(() => { this.onmessage?.({ data: JSON.stringify(payload) }); });
  }
}

const EMPTY_STATE: StateResponse = {
  counters: {
    received: 0, delivered: 0, waiting: 0, duplicatesDropped: 0, needsHuman: 0, lost: 0,
  },
  switches: {
    hubspot: 'up', stripe: 'up', paypal: 'up', slack: 'up', ledger: 'up', mailer: 'up',
  },
  deliveries: [], orders: [], timeline: [], viewers: 1, extractorMode: 'recorded',
};

let state: StateResponse;

beforeEach(() => {
  state = EMPTY_STATE;
  FakeEventSource.last = undefined;
  vi.stubGlobal('EventSource', FakeEventSource);
  vi.stubGlobal('fetch', async () => new Response(JSON.stringify(state), {
    status: 200, headers: { 'content-type': 'application/json' },
  }));
});

afterEach(() => { vi.unstubAllGlobals(); });

const delivery = (id: number, state: DeliveryView['state']): DeliveryView => ({
  id, eventId: `evt-${id}`, target: 'slack', state, attempts: 1,
  nextAt: null, lastError: null, remoteRef: null, remoteAt: null,
});

const line = (at: string, text: string): TimelineEntry => ({
  at, eventId: 'evt-1', text, level: 'info',
});

const placed = (id: number): OrderView => ({
  eventId: `evt-${id}`, number: 1000 + id,
  receivedAt: '2026-07-31T10:00:00.000Z', booking: null,
});

function board(over: Partial<BoardSnapshot>): { type: 'board'; payload: BoardSnapshot } {
  return {
    type: 'board',
    payload: {
      counters: EMPTY_STATE.counters,
      switches: EMPTY_STATE.switches,
      deliveries: [],
      orders: [],
      timeline: [],
      ...over,
    },
  };
}

/** The hook, mounted, with its stream open and its first fetch answered. */
async function open(): Promise<{
  stream: () => ReturnType<typeof useStream>; source: FakeEventSource;
}> {
  const rendered = renderHook(() => useStream());
  await waitFor(() => { expect(FakeEventSource.last).toBeDefined(); });
  const source = FakeEventSource.last;
  if (!source) throw new Error('the hook opened no stream');
  act(() => { source.onopen?.(); });
  return { stream: () => rendered.result.current, source };
}

describe('useStream', () => {
  it('shows the board the server last sent', async () => {
    const { stream, source } = await open();
    source.send(board({
      deliveries: [delivery(1, 'pending'), delivery(2, 'done')],
      orders: [placed(1), placed(2)],
      timeline: [line('2026-07-31T10:00:00.000Z', 'Slack: queued')],
      counters: { ...EMPTY_STATE.counters, received: 1, waiting: 1 },
    }));

    expect(stream().deliveries).toHaveLength(2);
    expect(stream().orders).toHaveLength(2);
    expect(stream().timeline).toHaveLength(1);
    expect(stream().counters.waiting).toBe(1);
    expect(stream().connected).toBe(true);
  });

  it('stops showing the orders a reset deleted', async () => {
    // The bug, exactly: reset empties the tables and tells nobody, so the only thing
    // that can tell the page is the next snapshot, and it can only tell it by being
    // believed whole.
    const { stream, source } = await open();
    source.send(board({
      deliveries: [delivery(1, 'pending'), delivery(2, 'pending'), delivery(3, 'pending')],
      orders: [placed(1), placed(2), placed(3)],
      timeline: [line('2026-07-31T10:00:00.000Z', 'Slack: queued')],
      counters: { ...EMPTY_STATE.counters, received: 3, waiting: 3 },
    }));

    source.send(board({}));

    expect(stream().deliveries).toEqual([]);
    expect(stream().orders).toEqual([]);
    expect(stream().timeline).toEqual([]);
    expect(stream().counters.received).toBe(0);
    expect(stream().counters.waiting).toBe(0);
  });

  it('draws one log line once however often the same board arrives', async () => {
    const { stream, source } = await open();
    const entries = [line('2026-07-31T10:00:00.000Z', 'Slack: queued')];
    for (let tick = 0; tick < 60; tick++) source.send(board({ timeline: entries }));

    expect(stream().timeline).toEqual(entries);
  });

  it('lets a log line be rewritten rather than keeping both versions', async () => {
    // A line is the current state of a delivery rather than an entry in a ledger, so
    // when the delivery moves the server sends a different sentence for the same row.
    // Keeping the old one alongside it invented a history the server does not have,
    // and a reload rubbed it out again anyway.
    const { stream, source } = await open();
    source.send(board({ timeline: [line('2026-07-31T10:00:00.000Z', 'Slack: attempt 1 failed')] }));
    source.send(board({ timeline: [line('2026-07-31T10:00:02.000Z', 'Slack: confirmed')] }));

    expect(stream().timeline.map((entry) => entry.text)).toEqual(['Slack: confirmed']);
  });

  it('keeps the switches the board reports', async () => {
    const { stream, source } = await open();
    source.send(board({
      switches: { ...EMPTY_STATE.switches, hubspot: 'cut' },
    }));

    expect(stream().switches.hubspot).toBe('cut');
  });

  it('counts viewers from its own event, which is not about the pipeline', async () => {
    const { stream, source } = await open();
    source.send({ type: 'presence', payload: { viewers: 4 } });

    expect(stream().viewers).toBe(4);
  });

  it('takes its first picture from the state endpoint', async () => {
    // A visitor arriving mid-experiment must see the world as it is, not an empty
    // page for the second before the first tick.
    state = {
      ...EMPTY_STATE,
      deliveries: [delivery(7, 'done')],
      orders: [placed(7)],
      counters: { ...EMPTY_STATE.counters, received: 1, delivered: 1 },
      extractorMode: 'live',
    };
    const { stream } = await open();

    await waitFor(() => { expect(stream().deliveries).toHaveLength(1); });
    expect(stream().orders).toHaveLength(1);
    expect(stream().counters.delivered).toBe(1);
    expect(stream().extractorMode).toBe('live');
  });

  it('says it is disconnected when the stream drops', async () => {
    const { stream, source } = await open();
    act(() => { source.onerror?.(); });

    expect(stream().connected).toBe(false);
  });
});
