// services/api/src/orders.controller.ts
// POST /api/orders — the visitor's own basket. A refused order answers with the
// reason in plain words, because the form is the one place where a stranger can
// make a mistake and must be told what it was.
import {
  BadRequestException, Body, Controller, Inject, Post, Req,
  HttpException, HttpStatus,
} from '@nestjs/common';
import type { Request } from 'express';
import type { PlaceOrderRequest, PlaceOrderResponse } from '@ngl/contracts';
import { OrdersService } from './orders.service';
import { LIMITS, RateLimiter, hashIp, hashRecipient } from './rate-limit.guard';

export const RATE_LIMITER = Symbol('RATE_LIMITER');

@Controller('api')
export class OrdersController {
  // Token spelled out: esbuild emits no decorator metadata to infer it from.
  constructor(
    @Inject(OrdersService) private readonly orders: OrdersService,
    @Inject(RATE_LIMITER) private readonly limiter: RateLimiter,
  ) {}

  @Post('orders')
  async place(
    @Body() body: PlaceOrderRequest,
    @Req() request: Request,
  ): Promise<PlaceOrderResponse> {
    // The link is public. A refused order says so plainly and says when to retry,
    // rather than failing silently (spec 11).
    const within = await this.limiter.check(
      'orders', hashIp(request.ip ?? 'unknown'), LIMITS.orders,
    );
    if (!within) {
      throw new HttpException(
        `That is ${LIMITS.orders} orders this hour from your address. Try again next hour.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    await this.checkMail(body.customerEmail, request.ip ?? 'unknown');

    try {
      return await this.orders.place(body);
    } catch (error) {
      throw new BadRequestException((error as Error).message);
    }
  }

  /**
   * The two caps that only apply once an order would send mail to somebody.
   *
   * Checked here rather than in the service, beside the cap it belongs with, and
   * before anything is booked: a refused order must not leave a contact in the CRM
   * and a charge at Stripe behind it.
   *
   * An order with no address can send to nobody and is not counted against either.
   * The service treats a blank address as "book it under the house", and rule 6.7
   * then queues no mail at all, so counting it would be metering a thing that cannot
   * happen and would spend the visitor's allowance on the loud button.
   */
  private async checkMail(address: string | undefined, ip: string): Promise<void> {
    const to = address?.trim() ?? '';
    if (to === '') return;

    const fromVisitor = await this.limiter.check('mail', hashIp(ip), LIMITS.mail);
    if (!fromVisitor) {
      throw new HttpException(
        `That is ${LIMITS.mail} confirmation mails this hour from your address. `
        + 'Order without an address to carry on, or try again next hour.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const toAddress = await this.limiter.check('mail_to', hashRecipient(to), LIMITS.mailTo);
    if (!toAddress) {
      throw new HttpException(
        `That address has had ${LIMITS.mailTo} confirmation mails this hour. `
        + 'Try again next hour.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }
}
