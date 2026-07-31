// services/api/src/demo-order.controller.ts
// POST /api/demo-order: the loud button at the top of the page.
//
// Separate from POST /api/orders on purpose, and not because of the address: it
// carries no basket either, so it works before a visitor has touched anything.
// The order it places is real in every other respect and is booked under the house
// identity, which means no confirmation mail is ever promised or queued for it.
import { Controller, HttpException, HttpStatus, Inject, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { DEFAULT_BASKET, type PlaceOrderResponse } from '@ngl/contracts';
import { OrdersService } from './orders.service';
import { LIMITS, RateLimiter, hashIp } from './rate-limit.guard';
import { RATE_LIMITER } from './orders.controller';

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
    return this.orders.placeDemo([...DEFAULT_BASKET]);
  }
}
