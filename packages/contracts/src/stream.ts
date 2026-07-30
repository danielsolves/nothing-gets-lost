// packages/contracts/src/stream.ts
// The SSE payload shape. Frozen: the UI and the api service are built by
// different strands and would otherwise drift apart.
import type { Target, DeliveryState, SwitchState, SwitchableTarget } from './targets';

export interface Counters {
  received: number;
  delivered: number;
  waiting: number;
  duplicatesDropped: number;
  needsHuman: number;
  /** Always 0. It is the product. */
  lost: number;
}

export interface DeliveryView {
  id: number;
  eventId: string;
  target: Target;
  state: DeliveryState;
  attempts: number;
  nextAt: string | null;
  lastError: string | null;
  remoteRef: string | null;
  remoteAt: string | null;
}

export interface TimelineEntry {
  at: string;
  eventId: string;
  text: string;
  level: 'info' | 'warn' | 'error' | 'success';
}

export type StreamEvent =
  | { type: 'counters'; payload: Counters }
  | { type: 'delivery'; payload: DeliveryView }
  | { type: 'timeline'; payload: TimelineEntry }
  | { type: 'switches'; payload: Record<SwitchableTarget, SwitchState> }
  | { type: 'presence'; payload: { viewers: number } }
  | { type: 'reset'; payload: Record<string, never> };
