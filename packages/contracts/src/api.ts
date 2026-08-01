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

/**
 * Three things used to live here and all three are gone, which is worth writing
 * down because each was a whole surface rather than a field.
 *
 * `ProofResponse` fed the proof chain panel, the two foreign timestamps of spec 9.1
 * with the measured gap between them. `SqlRequest` and `SqlResponse` fed the public
 * SQL console. `ConnectionsResponse` said whether a visitor had connected their own
 * Slack or HubSpot. The OAuth went first, and the console and the panel followed for
 * the same reason: what a stranger can actually check is the Stripe receipt on
 * stripe.com, the confirmation mail in their own inbox, the deliveries arriving at
 * their own endpoint, and the backlog through the MCP server. Everything else was a
 * screen of ours asking to be believed.
 */
export interface WebhookTargetRequest { url: string }
