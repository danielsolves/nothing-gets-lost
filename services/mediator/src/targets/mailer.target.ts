// services/mediator/src/targets/mailer.target.ts
// Sends the confirmation mail. Idempotent through a UNIQUE (event_id) on the
// mailer's sent_mail table, so a retry returns the original send instead of
// posting a second mail (spec 6.5).
//
// This delivery is created last, only once every other target is done (rule 6.7),
// because its arrival timestamp — stamped by the visitor's own mail provider — is
// the second witness of the proof chain (spec 9.1).
import { CALLER_TIMEOUT_MS } from '@ngl/contracts';
import type { DeliveryContext, DeliveryOutcome, DeliveryTarget } from '../target.interface';

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

interface MailPayload {
  customerEmail: string;
  customerName: string;
  totalCents: number;
}

interface SendResult { messageId: string; sentAt: string; alreadySent: boolean }

export class MailerClient {
  constructor(
    private readonly baseUrl: string,
    private readonly doFetch: Fetch = fetch,
  ) {}

  async send(eventId: string, input: MailPayload): Promise<SendResult> {
    const amount = (input.totalCents / 100).toFixed(2);
    const response = await this.doFetch(`${this.baseUrl}/send`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        eventId,
        recipient: input.customerEmail,
        subject: 'Your order is confirmed',
        body: `Thank you, ${input.customerName}. Your order over EUR ${amount} `
          + 'is booked in every connected system.',
      }),
      signal: AbortSignal.timeout(CALLER_TIMEOUT_MS),
    });

    if (!response.ok) throw new Error(`Mailer responded ${response.status}`);
    return (await response.json()) as SendResult;
  }
}

export class MailerTarget implements DeliveryTarget {
  readonly target = 'mailer' as const;

  constructor(private readonly client: MailerClient) {}

  async deliver(ctx: DeliveryContext): Promise<DeliveryOutcome> {
    const sent = await this.client.send(ctx.eventId, ctx.payload as MailPayload);
    return { remoteRef: sent.messageId, remoteAt: new Date(sent.sentAt) };
  }
}
