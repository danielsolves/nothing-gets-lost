// services/api/src/orders.service.ts
// Turns a visitor's basket into an event with its deliveries.
//
// Prices come from the products table, never from the request — otherwise anyone
// could post a zero-cent order and the Stripe receipt, our strongest payment proof,
// would show a number nobody believes.
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import type { PlaceOrderRequest, PlaceOrderResponse } from '@ngl/contracts';
import type { EventIntake } from './intake.port';

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** The confirmation mail is missing on purpose: rule 6.7 queues it at the end. */
const TARGETS = ['stripe', 'hubspot', 'ledger', 'slack'] as const;

/** Reads the visitor's own endpoint, if they registered one (spec 10.2). */
export interface WebhookUrlSource { get(): Promise<string | null> }

export class OrdersService {
  constructor(
    private readonly pool: Pool,
    private readonly intake: EventIntake,
    private readonly webhook?: WebhookUrlSource,
  ) {}

  async place(request: PlaceOrderRequest): Promise<PlaceOrderResponse> {
    if (request.items.length === 0) throw new Error('no items in the order');
    if (!EMAIL.test(request.customerEmail)) throw new Error('invalid email address');

    const totalCents = await this.priceFromCatalogue(request);

    const intake = await this.intake.accept({
      externalId: `order_${randomUUID()}`,
      kind: 'order.placed',
      payload: {
        customerName: request.customerName,
        customerEmail: request.customerEmail,
        items: request.items,
        totalCents,
      },
      // custom_webhook joins only when a url is configured. Queueing it
      // unconditionally would hand every visitor a dead letter for a target
      // they never asked for.
      targets: (await this.webhook?.get()) ? [...TARGETS, 'custom_webhook'] : TARGETS,
    });

    const { rows } = await this.pool.query<{ id: string }>(
      `INSERT INTO orders (event_id, customer_name, customer_email, items, total_cents, source)
       VALUES ($1, $2, $3, $4::jsonb, $5, 'form') RETURNING id`,
      [
        intake.eventId, request.customerName, request.customerEmail,
        JSON.stringify(request.items), totalCents,
      ],
    );
    const order = rows[0];
    if (!order) throw new Error('the order could not be stored');

    return { eventId: intake.eventId, orderId: order.id };
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
