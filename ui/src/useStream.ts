// ui/src/useStream.ts
// One subscription for the whole page. Falls back to the state endpoint on
// connect so a visitor who arrives mid-experiment sees the current world rather
// than an empty one.
import { useEffect, useRef, useState } from 'react';
import type {
  Counters, DeliveryView, StateResponse, StreamEvent, SwitchState,
  SwitchableTarget, TimelineEntry,
} from '@ngl/contracts';
import { mergeTimeline, TIMELINE_KEPT } from './timeline-merge';

const EMPTY_COUNTERS: Counters = {
  received: 0, delivered: 0, waiting: 0,
  duplicatesDropped: 0, needsHuman: 0, lost: 0,
};

const ALL_UP: Record<SwitchableTarget, SwitchState> = {
  hubspot: 'up', stripe: 'up', slack: 'up', ledger: 'up', mailer: 'up',
};

export interface Stream {
  counters: Counters;
  switches: Record<SwitchableTarget, SwitchState>;
  deliveries: DeliveryView[];
  timeline: TimelineEntry[];
  viewers: number;
  connected: boolean;
  extractorMode: StateResponse['extractorMode'];
}

export function useStream(): Stream {
  const [counters, setCounters] = useState<Counters>(EMPTY_COUNTERS);
  const [switches, setSwitches] = useState<Record<SwitchableTarget, SwitchState>>(ALL_UP);
  const [deliveries, setDeliveries] = useState<DeliveryView[]>([]);
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
        setTimeline(state.timeline.slice(0, TIMELINE_KEPT));
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
        case 'counters': setCounters(event.payload); break;
        case 'switches': setSwitches(event.payload); break;
        case 'presence': setViewers(event.payload.viewers); break;
        case 'delivery':
          setDeliveries((current) => {
            const rest = current.filter((delivery) => delivery.id !== event.payload.id);
            return [event.payload, ...rest].slice(0, 60);
          });
          break;
        case 'timeline':
          // The board arrives whole every second, so the same line keeps coming
          // back. mergeTimeline is what recognises it (see timeline-merge.ts).
          setTimeline((current) => mergeTimeline(current, event.payload));
          break;
        case 'reset':
          setDeliveries([]); setTimeline([]); setCounters(EMPTY_COUNTERS);
          break;
      }
    };
    return () => events.close();
  }, []);

  return { counters, switches, deliveries, timeline, viewers, connected, extractorMode };
}
