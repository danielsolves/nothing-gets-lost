// services/api/src/stripe-webhook.controller.ts
// POST /webhooks/stripe — the real payment events arrive here. The raw body is
// verified before anything else happens: the "deliver the payment twice" button may
// only claim to dedupe genuine traffic if forged traffic is refused (spec 6.2).
import {
  Controller, Headers, Post, Req, UnauthorizedException,
  type RawBodyRequest, Inject,
} from '@nestjs/common';
import type { Request } from 'express';
import type { Target } from '@ngl/contracts';
import type { EventIntake } from './intake.port';
import { EVENT_INTAKE, STRIPE_VERIFIER } from './tokens';
import type { StripeSignatureVerifier } from './stripe-verifier';

/** The payment is already made — the mail is added by rule 6.7 at the end. */
const TARGETS: readonly Target[] = ['hubspot', 'ledger', 'slack'];

@Controller('webhooks')
export class StripeWebhookController {
  constructor(
    @Inject(STRIPE_VERIFIER) private readonly verifier: StripeSignatureVerifier,
    @Inject(EVENT_INTAKE) private readonly intake: EventIntake,
  ) {}

  @Post('stripe')
  async receive(
    @Req() request: RawBodyRequest<Request>,
    @Headers('stripe-signature') signature: string | undefined,
  ): Promise<{ received: boolean; duplicate: boolean }> {
    const raw = request.rawBody?.toString('utf8') ?? '';
    if (!signature || !this.verifier.verify(raw, signature, Math.floor(Date.now() / 1000))) {
      throw new UnauthorizedException('the webhook signature could not be verified');
    }

    const event = JSON.parse(raw) as { id: string };
    const result = await this.intake.accept({
      externalId: event.id,
      kind: 'payment.succeeded',
      payload: event,
      targets: TARGETS,
    });
    return { received: true, duplicate: !result.accepted };
  }
}
