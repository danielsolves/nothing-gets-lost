// services/mediator/src/targets/webhook.target.ts
// Delivers to a url the visitor supplied, with the full retry behaviour visible on
// their own side. Idempotency is delegated to them and documented in the README —
// we send the key, honouring it is their business.
import { createHmac } from 'node:crypto';
import { CALLER_TIMEOUT_MS } from '@ngl/contracts';
import type { DeliveryContext, DeliveryOutcome, DeliveryTarget } from '../target.interface';
import { assertSafeUrl } from '../ssrf.guard';

export class WebhookTarget implements DeliveryTarget {
  readonly target = 'custom_webhook' as const;

  constructor(
    private readonly getUrl: () => Promise<string | null>,
    private readonly signingSecret: string,
  ) {}

  async deliver(ctx: DeliveryContext): Promise<DeliveryOutcome> {
    const configured = await this.getUrl();
    if (!configured) throw new Error('no custom webhook url configured');

    // Checked again here, not only when it was entered — DNS can change in between.
    const url = await assertSafeUrl(configured);
    const body = JSON.stringify({ eventId: ctx.eventId, payload: ctx.payload });
    const signature = createHmac('sha256', this.signingSecret).update(body).digest('hex');

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': ctx.idempotencyKey,
        'x-demo-signature': signature,
      },
      body,
      redirect: 'manual',            // a redirect could point back inside
      signal: AbortSignal.timeout(CALLER_TIMEOUT_MS),
    });

    if (!response.ok) throw new Error(`Your endpoint responded ${response.status}`);
    return { remoteRef: String(response.status), remoteAt: new Date() };
  }
}
