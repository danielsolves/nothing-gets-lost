// services/api/test/mail-cap.test.ts
// The caps that only bite once an order would send mail to somebody.
//
// They are the reason the confirmation mail can be switched on at all. Every other
// thing this demo does lands in an account we own; a confirmation mail goes to an
// address a stranger typed, which turns the form into a way of sending mail from our
// domain to people who did not ask for it. What that costs is not money, it is
// whether mail from this domain is delivered anywhere, and that is lost slowly and
// recovered with difficulty.
//
// No database here. What is under test is which caps a request is charged against and
// in which order, and that is the controller's decision alone. The limiter is
// exercised against Postgres in rate-limit.guard.test.ts.
import { describe, it, expect, beforeEach } from 'vitest';
import type { PlaceOrderRequest, PlaceOrderResponse } from '@ngl/contracts';
import { OrdersController } from '../src/orders.controller';
import { LIMITS } from '../src/rate-limit.guard';
import type { OrdersService } from '../src/orders.service';
import type { RateLimiter } from '../src/rate-limit.guard';

/** Counts what it is asked, and refuses whatever bucket it has been told to refuse. */
class CountingLimiter {
  readonly asked: Array<{ bucket: string; subject: string; limit: number }> = [];
  refuse: string | null = null;

  async check(bucket: string, subject: string, limit: number): Promise<boolean> {
    this.asked.push({ bucket, subject, limit });
    return bucket !== this.refuse;
  }
}

let limiter: CountingLimiter;
let placed: PlaceOrderRequest[];
let controller: OrdersController;

const orders = {
  async place(body: PlaceOrderRequest): Promise<PlaceOrderResponse> {
    placed.push(body);
    return { eventId: 'evt-1', orderId: 'ord-1' };
  },
};

const request = { ip: '203.0.113.7' };
const basket = [{ sku: 'MUG-BLUE', qty: 1 }];

beforeEach(() => {
  limiter = new CountingLimiter();
  placed = [];
  controller = new OrdersController(
    orders as unknown as OrdersService,
    limiter as unknown as RateLimiter,
  );
});

function buckets(): string[] {
  return limiter.asked.map((call) => call.bucket);
}

describe('an order that carries no address', () => {
  it('is charged against the order cap only', async () => {
    // It can send to nobody: rule 6.7 queues no mail without a confirmTo. Charging
    // it would meter a thing that cannot happen, and it would spend a visitor's
    // small mail allowance on the loud button they are meant to press first.
    await controller.place({ items: basket }, request as never);
    expect(buckets()).toEqual(['orders']);
  });

  it('treats an address of nothing but spaces as no address', async () => {
    await controller.place({ items: basket, customerEmail: '   ' }, request as never);
    expect(buckets()).toEqual(['orders']);
  });
});

describe('an order that would send mail', () => {
  const withAddress = { items: basket, customerEmail: 'reader@example.com' };

  it('is charged against the visitor and against the recipient', async () => {
    await controller.place(withAddress, request as never);
    expect(buckets()).toEqual(['orders', 'mail', 'mail_to']);
  });

  it('charges each cap its own number', async () => {
    await controller.place(withAddress, request as never);
    const asked = new Map(limiter.asked.map((call) => [call.bucket, call.limit]));
    expect(asked.get('orders')).toBe(LIMITS.orders);
    expect(asked.get('mail')).toBe(LIMITS.mail);
    expect(asked.get('mail_to')).toBe(LIMITS.mailTo);
  });

  it('meters the recipient separately from the visitor', async () => {
    // Same request, two different subjects. Sharing one would let a visitor who
    // sends to their own address be charged twice for one mail, and would let two
    // visitors sending to one inbox look like two unrelated readers.
    await controller.place(withAddress, request as never);
    const byBucket = new Map(limiter.asked.map((call) => [call.bucket, call.subject]));
    expect(byBucket.get('mail')).not.toBe(byBucket.get('mail_to'));
  });

  it('books nothing when the visitor is over their mail cap', async () => {
    // Refused before the order is placed, not after. An order booked and then
    // refused leaves a contact in the CRM and a charge at Stripe behind it.
    limiter.refuse = 'mail';
    await expect(controller.place(withAddress, request as never)).rejects.toThrow(/hour/i);
    expect(placed).toEqual([]);
  });

  it('books nothing when the inbox is over its cap', async () => {
    limiter.refuse = 'mail_to';
    await expect(controller.place(withAddress, request as never)).rejects.toThrow(/hour/i);
    expect(placed).toEqual([]);
  });

  it('tells a capped visitor what they can still do', async () => {
    // The whole page is one interaction, and a dead end here reads as the demo
    // being broken. Ordering without an address still shows everything but the mail.
    limiter.refuse = 'mail';
    await expect(controller.place(withAddress, request as never))
      .rejects.toThrow(/without an address/i);
  });

  it('places the order when both caps allow it', async () => {
    await controller.place(withAddress, request as never);
    expect(placed).toEqual([withAddress]);
  });
});
