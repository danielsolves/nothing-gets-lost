// services/api/src/orders.service.ts
// Turns a visitor's basket into an event with its deliveries.
//
// Prices come from the products table, never from the request — otherwise anyone
// could post a zero-cent order and the Stripe receipt, our strongest payment proof,
// would show a number nobody believes.
//
// The address is optional, against spec 9.7 and on the owner's instruction. Two
// fields come out of one: `customerEmail` is the identity the order is booked
// under, always present, house address if nobody gave one; `confirmTo` is the
// promise of a mail and exists only when a real person asked for it.
//
// The payment route is settled here too, and only here. The mediator decides
// nothing about it: this is where the target list is built, so exactly one of the
// two payment targets is ever queued, and a mediator that restarts reads the
// delivery rows back rather than choosing again.
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import {
  DEFAULT_PAYMENT_ROUTE, isPaymentRoute,
  type PaymentRoute, type PlaceOrderRequest, type PlaceOrderResponse, type Target,
} from '@ngl/contracts';
import type { EventIntake } from './intake.port';

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/**
 * Everywhere an order goes apart from the payment, which is one target chosen per
 * order. The confirmation mail is missing on purpose: rule 6.7 queues it at the end.
 */
const TARGETS = ['hubspot', 'ledger', 'slack'] as const;

/**
 * Every order has to be booked under some address, because Stripe wants one for
 * the receipt and HubSpot uses it as the natural key that makes a retry find the
 * existing contact instead of creating a second one. An order placed without one
 * is booked under the house, and the payload says so by carrying no `confirmTo`:
 * nobody was promised a mail, so no mail is ever queued (rule 6.7).
 */
const HOUSE_IDENTITY = 'demo@nothing-gets-lost.example';
const HOUSE_NAME = 'Demo order';

/** Reads the visitor's own endpoint, if they registered one (spec 10.2). */
export interface WebhookUrlSource { get(): Promise<string | null> }

export class OrdersService {
  constructor(
    private readonly pool: Pool,
    private readonly intake: EventIntake,
    private readonly webhook?: WebhookUrlSource,
  ) {}

  /** The order the page's own button sends: a plausible basket and nobody's address. */
  async placeDemo(items: PlaceOrderRequest['items']): Promise<PlaceOrderResponse> {
    return this.place({ items });
  }

  async place(request: PlaceOrderRequest): Promise<PlaceOrderResponse> {
    if (request.items.length === 0) throw new Error('no items in the order');

    // Blank is not the same as wrong. Somebody who tabbed through the field has
    // not made a mistake to be told about; somebody who typed half an address has.
    const confirmTo = request.customerEmail?.trim() ?? '';
    if (confirmTo !== '' && !EMAIL.test(confirmTo)) {
      throw new Error('invalid email address');
    }

    const customerName = request.customerName?.trim() || HOUSE_NAME;
    const customerEmail = confirmTo || HOUSE_IDENTITY;
    const paymentRoute = this.routeFor(request);
    const totalCents = await this.priceFromCatalogue(request);

    const intake = await this.intake.accept({
      externalId: `order_${randomUUID()}`,
      kind: 'order.placed',
      payload: {
        customerName,
        customerEmail,
        ...(confirmTo === '' ? {} : { confirmTo }),
        paymentRoute,
        items: request.items,
        totalCents,
      },
      // custom_webhook joins only when a url is configured. Queueing it
      // unconditionally would hand every visitor a dead letter for a target
      // they never asked for.
      targets: await this.targetsFor(paymentRoute),
    });

    const { rows } = await this.pool.query<{ id: string }>(
      `INSERT INTO orders (event_id, customer_name, customer_email, items, total_cents,
                           source, payment_route)
       VALUES ($1, $2, $3, $4::jsonb, $5, 'form', $6) RETURNING id`,
      [
        intake.eventId, customerName, customerEmail,
        JSON.stringify(request.items), totalCents, paymentRoute,
      ],
    );
    const order = rows[0];
    if (!order) throw new Error('the order could not be stored');

    return { eventId: intake.eventId, orderId: order.id };
  }

  /**
   * The body is whatever the network sent, whatever the type says about it, and a
   * route we cannot charge has to be refused rather than quietly turned into the
   * default. Somebody who asked for PayPal and was billed by Stripe was not served,
   * they were overruled.
   */
  private routeFor(request: PlaceOrderRequest): PaymentRoute {
    const asked = request.paymentRoute;
    if (asked === undefined) return DEFAULT_PAYMENT_ROUTE;
    if (!isPaymentRoute(asked)) {
      throw new Error(`unknown payment route: ${String(asked)}`);
    }
    return asked;
  }

  /** Exactly one payment target, never both and never neither. */
  private async targetsFor(paymentRoute: PaymentRoute): Promise<readonly Target[]> {
    const targets: Target[] = [paymentRoute, ...TARGETS];
    return (await this.webhook?.get()) ? [...targets, 'custom_webhook'] : targets;
  }

  private async priceFromCatalogue(request: PlaceOrderRequest): Promise<number> {
    const { rows: catalog } = await this.pool.query<{ sku: string; cents: number }>(
      'SELECT sku, cents FROM products WHERE sku = ANY($1)',
      [request.items.map((item) => item.sku)],
    );
    const prices = new Map(catalog.map((entry) => [entry.sku, entry.cents]));
    const unknown = request.items.filter((item) => !prices.has(item.sku));
    if (unknown.length > 0) {
      throw new Error(`unknown sku: ${unknown.map((item) => item.sku).join(', ')}`);
    }
    return request.items.reduce(
      (sum, item) => sum + (prices.get(item.sku) ?? 0) * item.qty, 0,
    );
  }
}
