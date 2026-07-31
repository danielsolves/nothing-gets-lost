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

/**
 * How an order was paid for. One provider, so this is a list of one.
 *
 * PayPal was the second, and it went: PayPal will not capture a server-made order
 * until a payer has approved it in a browser, and there is no shared test payer the
 * way Stripe has pm_card_visa. On a public page that meant every visitor who chose
 * PayPal watched a payment hang for a reason that was neither a fault nor a thing
 * they could fix. A demo whose capital is that everything on it is true cannot ship
 * a route that is only true for the person holding the sandbox account.
 *
 * The list survives the removal rather than collapsing into a bare string, because
 * the route is written on the order and read back rather than assumed, and the day
 * a second provider arrives it should arrive here.
 */
export const PAYMENT_ROUTES = ['stripe'] as const;
export type PaymentRoute = (typeof PAYMENT_ROUTES)[number];

/**
 * What an order takes when nobody said. POST /api/demo-order carries no body at all
 * and has to keep working untouched, so there has to be one, and it is Stripe: the
 * route that ends in a receipt page stripe.com serves itself, which is the strongest
 * payment proof the demo owns (spec 9.2).
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
