// packages/contracts/src/targets.ts
// The vocabulary every service shares. Adding a value here is a breaking change:
// the database has matching CHECK constraints (see migration 001).

export const TARGETS = [
  'hubspot', 'stripe', 'slack', 'ledger', 'mailer', 'custom_webhook',
] as const;
export type Target = (typeof TARGETS)[number];

/** Targets that can be switched on the control panel. custom_webhook cannot. */
export const SWITCHABLE_TARGETS = [
  'hubspot', 'stripe', 'slack', 'ledger', 'mailer',
] as const;
export type SwitchableTarget = (typeof SWITCHABLE_TARGETS)[number];

export const DELIVERY_STATES = ['pending', 'inflight', 'done', 'dead'] as const;
export type DeliveryState = (typeof DELIVERY_STATES)[number];

export const SWITCH_STATES = ['up', 'slow', 'error', 'cut'] as const;
export type SwitchState = (typeof SWITCH_STATES)[number];

export const EVENT_KINDS = ['order.placed', 'payment.succeeded'] as const;
export type EventKind = (typeof EVENT_KINDS)[number];

export const CHAOS_KINDS = [
  'duplicate_webhook', 'garbage_payload', 'hallucinate',
] as const;
export type ChaosKind = (typeof CHAOS_KINDS)[number];

export function isTarget(value: string): value is Target {
  return (TARGETS as readonly string[]).includes(value);
}

export function isSwitchableTarget(value: string): value is SwitchableTarget {
  return (SWITCHABLE_TARGETS as readonly string[]).includes(value);
}
