// packages/contracts/src/targets.ts
// The vocabulary every service shares. Adding a value here is a breaking change:
// the database has matching CHECK constraints (see migration 001).

export const TARGETS = [
  'hubspot', 'stripe', 'paypal', 'slack', 'ledger', 'mailer', 'custom_webhook',
] as const;
export type Target = (typeof TARGETS)[number];

/** Targets that can be switched on the control panel. custom_webhook cannot. */
export const SWITCHABLE_TARGETS = [
  'hubspot', 'stripe', 'paypal', 'slack', 'ledger', 'mailer',
] as const;
export type SwitchableTarget = (typeof SWITCHABLE_TARGETS)[number];

/**
 * The two ways an order can be paid for. A visitor picks one when the order is
 * placed and exactly one of them is charged. An order billed through two providers
 * at once is not a thing that happens in a shop, and the demo's whole capital is
 * that everything on it is true.
 */
export const PAYMENT_ROUTES = ['stripe', 'paypal'] as const;
export type PaymentRoute = (typeof PAYMENT_ROUTES)[number];

/**
 * What an order takes when nobody said. POST /api/demo-order carries no body at all
 * and has to keep working untouched, so there has to be one, and it is Stripe: it is
 * the route that ends in a receipt page stripe.com serves itself, which is the
 * strongest payment proof the demo owns (spec 9.2). PayPal has no such page, so a
 * visitor who never chose would otherwise be handed the weaker half of the demo.
 */
export const DEFAULT_PAYMENT_ROUTE: PaymentRoute = 'stripe';

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

export function isPaymentRoute(value: string): value is PaymentRoute {
  return (PAYMENT_ROUTES as readonly string[]).includes(value);
}
