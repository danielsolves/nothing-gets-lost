// services/api/src/demo-order.controller.ts
// POST /api/demo-order: the one button the guided walkthrough starts with.
//
// Separate from POST /api/orders on purpose. The visitor's own order needs their
// email, because that address is the strongest proof they have (spec 9.7). The
// walkthrough must work before anyone has typed anything, so it uses a house
// customer and skips the mail.
import { Controller, HttpException, HttpStatus, Inject, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import type { PlaceOrderResponse } from '@ngl/contracts';
import { OrdersService } from './orders.service';
import { LIMITS, RateLimiter, hashIp } from './rate-limit.guard';
import { RATE_LIMITER } from './orders.controller';

/** A basket that shows a realistic total without needing a choice from anyone. */
const DEMO_BASKET = [{ sku: 'TEAPOT', qty: 1 }, { sku: 'MUG-BLUE', qty: 2 }];

@Controller('api')
export class DemoOrderController {
  constructor(
    @Inject(OrdersService) private readonly orders: OrdersService,
    @Inject(RATE_LIMITER) private readonly limiter: RateLimiter,
  ) {}

  @Post('demo-order')
  async place(@Req() request: Request): Promise<PlaceOrderResponse> {
    const within = await this.limiter.check(
      'orders', hashIp(request.ip ?? 'unknown'), LIMITS.orders,
    );
    if (!within) {
      throw new HttpException(
        `That is ${LIMITS.orders} orders this hour from your address. Try again next hour.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return this.orders.placeDemo(DEMO_BASKET);
  }
}
