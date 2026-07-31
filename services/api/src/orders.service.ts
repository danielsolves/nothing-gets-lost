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
// nothing about it: this is where the target list is built, so exactly one payment
// target is ever queued, and a mediator that restarts reads the delivery rows back
// rather than choosing again.
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import {
  DEFAULT_PAYMENT_ROUTE, isPaymentRoute,
  type OrderLine, type PaymentRoute, type PlaceOrderRequest, type PlaceOrderResponse,
  type Target,
} from '@ngl/contracts';
import type { EventIntake } from './intake.port';
import { demoBasket, demoBuyer, DEMO_DOMAIN, type Chance } from './demo-order';

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
 *
 * On the demo's own domain, and not on a .example one. That is the reserved TLD for
 * exactly this purpose and it is the obvious choice right up to the point where the
 * address is handed to a real CRM: HubSpot rejects it as INVALID_EMAIL, so every
 * demo order placed without an address failed at HubSpot six times and parked a dead
 * letter, and the demo's own "needs a human" counter climbed for a reason that was
 * nothing to do with the outage it was meant to be showing.
 *
 * Exported because three test files used to spell it out again, and a house address
 * that drifted apart from the one the cleanup rule protects would quietly start
 * erasing it as though it were a real person's.
 */
export const HOUSE_IDENTITY = `orders@${DEMO_DOMAIN}`;
const HOUSE_NAME = 'Demo order';

/** Reads the visitor's own endpoint, if they registered one (spec 10.2). */
export interface WebhookUrlSource { get(): Promise<string | null> }

export class OrdersService {
  constructor(
    private readonly pool: Pool,
    private readonly intake: EventIntake,
    private readonly webhook?: WebhookUrlSource,
    private readonly chance: Chance = (upTo) => Math.floor(Math.random() * upTo),
  ) {}

  /**
   * The order the page's own button sends: an invented buyer and an invented basket,
   * and still nobody's address.
   *
   * The buyer's address goes in as the identity rather than as `customerEmail`,
   * which is the field that promises a confirmation mail. Passing it there would
   * queue a mail to somebody who does not exist, and rule 6.7 would hold the whole
   * chain open waiting for it to arrive.
   */
  async placeDemo(): Promise<PlaceOrderResponse> {
    const buyer = demoBuyer(this.chance);
    const items = demoBasket(await this.catalogueSkus(), this.chance);
    return this.book({ items, customerName: buyer.name }, buyer.email);
  }

  async place(request: PlaceOrderRequest): Promise<PlaceOrderResponse> {
    return this.book(request, HOUSE_IDENTITY);
  }

  /**
   * @param identity what the order is booked under when nobody gave an address. It
   *   is the natural key HubSpot upserts on, and it is never written to.
   */
  private async book(
    request: PlaceOrderRequest, identity: string,
  ): Promise<PlaceOrderResponse> {
    if (request.items.length === 0) throw new Error('no items in the order');

    // Blank is not the same as wrong. Somebody who tabbed through the field has
    // not made a mistake to be told about; somebody who typed half an address has.
    const confirmTo = request.customerEmail?.trim() ?? '';
    if (confirmTo !== '' && !EMAIL.test(confirmTo)) {
      throw new Error('invalid email address');
    }

    const customerName = request.customerName?.trim() || HOUSE_NAME;
    const customerEmail = confirmTo || identity;
    const paymentRoute = this.routeFor(request);
    const lines = await this.priceFromCatalogue(request);
    const totalCents = lines.reduce((sum, line) => sum + line.cents, 0);

    const intake = await this.intake.accept({
      externalId: `order_${randomUUID()}`,
      kind: 'order.placed',
      payload: {
        customerName,
        customerEmail,
        ...(confirmTo === '' ? {} : { confirmTo }),
        paymentRoute,
        items: request.items,
        // The basket as it was priced, not as it was asked for. A target that has to
        // write the order down somewhere needs a name and a figure per line, and the
        // mediator holds no catalogue to look either up in. Joining it back later
        // would read tomorrow's prices onto yesterday's order.
        lines,
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
   * default. Somebody who names a provider and is billed by another was not served,
   * they were overruled. There is one route today, so the only thing this can refuse
   * is a name that was never real, and it still has to refuse it.
   */
  private routeFor(request: PlaceOrderRequest): PaymentRoute {
    const asked = request.paymentRoute;
    if (asked === undefined) return DEFAULT_PAYMENT_ROUTE;
    if (!isPaymentRoute(asked)) {
      throw new Error(`unknown payment route: ${String(asked)}`);
    }
    return asked;
  }

  /** Exactly one payment target, never two and never none. */
  private async targetsFor(paymentRoute: PaymentRoute): Promise<readonly Target[]> {
    const targets: Target[] = [paymentRoute, ...TARGETS];
    return (await this.webhook?.get()) ? [...targets, 'custom_webhook'] : targets;
  }

  /**
   * The basket, priced. `cents` is the whole line rather than the unit price, so a
   * reader holding the card against the receipt never has to multiply to check it,
   * and the total is these lines added up rather than a second sum arrived at
   * separately.
   */
  /** Every sku on the shelf, so an invented basket only asks for things that exist. */
  private async catalogueSkus(): Promise<string[]> {
    const { rows } = await this.pool.query<{ sku: string }>(
      'SELECT sku FROM products ORDER BY sku',
    );
    return rows.map((row) => row.sku);
  }

  private async priceFromCatalogue(request: PlaceOrderRequest): Promise<OrderLine[]> {
    const { rows: catalog } = await this.pool.query<{
      sku: string; name: string; cents: number;
    }>(
      'SELECT sku, name, cents FROM products WHERE sku = ANY($1)',
      [request.items.map((item) => item.sku)],
    );
    const known = new Map(catalog.map((entry) => [entry.sku, entry]));
    const unknown = request.items.filter((item) => !known.has(item.sku));
    if (unknown.length > 0) {
      throw new Error(`unknown sku: ${unknown.map((item) => item.sku).join(', ')}`);
    }
    return request.items.map((item) => {
      const product = known.get(item.sku);
      if (!product) throw new Error(`unknown sku: ${item.sku}`);
      return {
        sku: item.sku, name: product.name, qty: item.qty,
        cents: product.cents * item.qty,
      };
    });
  }
}
