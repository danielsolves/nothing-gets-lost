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
import { LIMITS, RateLimiter, hashIp } from './rate-limit.guard';

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

    try {
      return await this.orders.place(body);
    } catch (error) {
      throw new BadRequestException((error as Error).message);
    }
  }
}
