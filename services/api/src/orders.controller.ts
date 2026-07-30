// services/api/src/orders.controller.ts
// POST /api/orders — the visitor's own basket. A refused order answers with the
// reason in plain words, because the form is the one place where a stranger can
// make a mistake and must be told what it was.
import { BadRequestException, Body, Controller, Inject, Post } from '@nestjs/common';
import type { PlaceOrderRequest, PlaceOrderResponse } from '@ngl/contracts';
import { OrdersService } from './orders.service';

@Controller('api')
export class OrdersController {
  // Token spelled out: esbuild emits no decorator metadata to infer it from.
  constructor(@Inject(OrdersService) private readonly orders: OrdersService) {}

  @Post('orders')
  async place(@Body() body: PlaceOrderRequest): Promise<PlaceOrderResponse> {
    try {
      return await this.orders.place(body);
    } catch (error) {
      throw new BadRequestException((error as Error).message);
    }
  }
}
