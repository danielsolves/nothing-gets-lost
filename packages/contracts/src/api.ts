// packages/contracts/src/api.ts
// Request and response types for the 24 endpoints listed in spec 16.2.
import type { BoardSnapshot } from './stream';
import type { Target, SwitchState, PaymentRoute } from './targets';

export interface CatalogItem { sku: string; name: string; cents: number }

/**
 * Name and address are both optional, which departs from spec 9.7 and does so on
 * purpose: a visitor should be able to watch a real order go through without
 * handing over anything first. Give an address and the confirmation mail becomes
 * the second witness of the proof chain; leave it out and there is no mail step at
 * all, rather than one addressed to nobody.
 */
export interface PlaceOrderRequest {
  customerName?: string;
  customerEmail?: string;
  /**
   * Which of the two providers takes the money. Optional, and absent means
   * DEFAULT_PAYMENT_ROUTE: POST /api/demo-order carries no body at all and has to
   * keep working untouched. Exactly one route is charged either way.
   */
  paymentRoute?: PaymentRoute;
  items: Array<{ sku: string; qty: number }>;
}
export interface PlaceOrderResponse { eventId: string; orderId: string }

/**
 * A basket that shows a realistic total without needing a choice from anyone.
 *
 * It lives here rather than in the api service because two places need the same
 * one: POST /api/demo-order sends it when a visitor has chosen nothing, and the
 * order form starts from it when a visitor opens the panel to change it. Two
 * copies would let the plain order and the customised order quietly diverge.
 */
export const DEFAULT_BASKET: ReadonlyArray<{ sku: string; qty: number }> = [
  { sku: 'TEAPOT', qty: 1 },
  { sku: 'MUG-BLUE', qty: 2 },
];

/**
 * The board plus the two things that are true of the visit rather than of the
 * pipeline. It extends the snapshot rather than restating its four fields, so the
 * picture the page is handed on arrival cannot drift from the ones the stream sends
 * afterwards.
 */
export interface StateResponse extends BoardSnapshot {
  viewers: number;
  extractorMode: 'live' | 'recorded';
}

export interface SetSwitchRequest { state: SwitchState }

/** One live read-back against the real third-party system (spec 9.2). */
export interface VerifyResponse {
  target: Target;
  requestUrl: string;
  httpStatus: number;
  remoteRef: string | null;
  /** Timestamp assigned by the remote system, never by us. */
  remoteAt: string | null;
  rawBody: unknown;
  /** False for our own portal read-backs — honest labelling (spec 9.0). */
  indisputable: boolean;
}

/** The two foreign timestamps that prove outage and recovery (spec 9.1). */
export interface ProofResponse {
  eventId: string;
  paidAt: string | null;
  /**
   * Which provider stamped `paidAt`, read off the delivery that took the money
   * rather than off what the order asked for. Null when the event has no payment
   * leg at all, which a Stripe webhook does not: it arrives already paid.
   */
  paidAtSource: PaymentRoute | null;
  /** Only Stripe serves one. PayPal has no page a visitor can open (spec 9.2). */
  receiptUrl: string | null;
  mailReceivedAt: string | null;
  mailReceivedAtSource: 'recipient mail server';
  hubspotCreatedAt: string | null;
  gapSeconds: number | null;
}

export interface SqlRequest { query: string }
export interface SqlResponse {
  columns: string[];
  rows: unknown[][];
  rowCount: number;
  truncated: boolean;
}

export interface WebhookTargetRequest { url: string }
export interface ConnectionsResponse {
  slack: { connected: boolean; expiresAt: string | null };
  hubspot: { connected: boolean; expiresAt: string | null };
  customWebhook: { url: string | null };
}
