// ui/src/useStream.ts
// One subscription for the whole page. Falls back to the state endpoint on
// connect so a visitor who arrives mid-experiment sees the current world rather
// than an empty one.
//
// Every board that arrives is put in place of the one before it, never merged into
// it. Merging could only ever add, so nothing the server had let go of could ever
// leave the page: reset emptied the tables and the page kept drawing orders that no
// longer existed. Believing the snapshot whole is also what repairs any other drift,
// a row swept by the nightly cleanup included, and it is why there is no reset event
// for the reset button to send.
import { useEffect, useRef, useState } from 'react';
import type {
  Counters, DeliveryView, OrderView, StateResponse, StreamEvent, SwitchState,
  SwitchableTarget, TimelineEntry,
} from '@ngl/contracts';

const EMPTY_COUNTERS: Counters = {
  received: 0, delivered: 0, waiting: 0,
  duplicatesDropped: 0, needsHuman: 0, lost: 0,
};

const ALL_UP: Record<SwitchableTarget, SwitchState> = {
  hubspot: 'up', stripe: 'up', paypal: 'up', slack: 'up', ledger: 'up', mailer: 'up',
};

export interface Stream {
  counters: Counters;
  switches: Record<SwitchableTarget, SwitchState>;
  deliveries: DeliveryView[];
  orders: OrderView[];
  timeline: TimelineEntry[];
  viewers: number;
  connected: boolean;
  extractorMode: StateResponse['extractorMode'];
}

export function useStream(): Stream {
  const [counters, setCounters] = useState<Counters>(EMPTY_COUNTERS);
  const [switches, setSwitches] = useState<Record<SwitchableTarget, SwitchState>>(ALL_UP);
  const [deliveries, setDeliveries] = useState<DeliveryView[]>([]);
  const [orders, setOrders] = useState<OrderView[]>([]);
  const [timeline, setTimeline] = useState<TimelineEntry[]>([]);
  const [viewers, setViewers] = useState(1);
  const [connected, setConnected] = useState(false);
  const [extractorMode, setExtractorMode] =
    useState<StateResponse['extractorMode']>('recorded');
  const source = useRef<EventSource>();

  useEffect(() => {
    void fetch('/api/state')
      .then((response) => response.json() as Promise<StateResponse>)
      .then((state) => {
        setCounters(state.counters);
        setSwitches(state.switches);
        setDeliveries(state.deliveries);
        setOrders(state.orders);
        setTimeline(state.timeline);
        setViewers(state.viewers);
        setExtractorMode(state.extractorMode);
      })
      .catch(() => setConnected(false));

    const events = new EventSource('/api/stream');
    source.current = events;
    events.onopen = () => setConnected(true);
    events.onerror = () => setConnected(false);
    events.onmessage = (message) => {
      const event = JSON.parse(message.data as string) as StreamEvent;
      switch (event.type) {
        case 'board':
          setCounters(event.payload.counters);
          setSwitches(event.payload.switches);
          setDeliveries(event.payload.deliveries);
          setOrders(event.payload.orders);
          setTimeline(event.payload.timeline);
          break;
        case 'presence': setViewers(event.payload.viewers); break;
      }
    };
    return () => events.close();
  }, []);

  return {
    counters, switches, deliveries, orders, timeline, viewers, connected, extractorMode,
  };
}
