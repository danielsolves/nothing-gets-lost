// services/api/src/webhook-target.controller.ts
// POST /api/webhook-target: the visitor registers a url of their own to receive
// every delivery, with the full retry behaviour visible on their side (spec 10.2).
//
// The url is checked here as well as immediately before each call. Checking twice
// is the point: DNS can change between the two, and only the second check is the
// one that actually protects the network.
import { BadRequestException, Body, Controller, Inject, Post } from '@nestjs/common';
import type { WebhookTargetRequest } from '@ngl/contracts';
import { assertSafeUrl } from '@ngl/mediator';
import type { WebhookTargetStore } from './webhook-target.store';

export const WEBHOOK_TARGET_STORE = Symbol('WEBHOOK_TARGET_STORE');

@Controller('api')
export class WebhookTargetController {
  constructor(
    @Inject(WEBHOOK_TARGET_STORE) private readonly store: WebhookTargetStore,
  ) {}

  @Post('webhook-target')
  async set(@Body() body: WebhookTargetRequest): Promise<{ url: string | null }> {
    if (typeof body?.url !== 'string') {
      throw new BadRequestException('expected { url: string }');
    }

    // An empty field means "stop sending", not "send to nowhere".
    if (body.url.trim() === '') {
      await this.store.clear();
      return { url: null };
    }

    try {
      await assertSafeUrl(body.url);
    } catch (error) {
      throw new BadRequestException((error as Error).message);
    }

    await this.store.set(body.url);
    return { url: body.url };
  }
}
