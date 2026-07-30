// services/mediator/src/targets/slack.target.ts
// Posts the notification.
//
// Slack has neither idempotency keys nor a natural key, so the delivery embeds its
// own marker in the message text and checks the channel history before posting.
// That is a weaker guarantee than Stripe's and it is documented as such — a narrow
// window between the check and the post remains. For a notification that is the
// right trade; for the invoice it would not be, which is why the ledger uses a
// database constraint instead (spec 6.5).
import { CALLER_TIMEOUT_MS } from '@ngl/contracts';
import type { DeliveryContext, DeliveryOutcome, DeliveryTarget } from '../target.interface';

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

interface NotifyPayload { customerName: string; totalCents: number }

export class SlackClient {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
    private readonly channel: string,
    private readonly doFetch: Fetch = fetch,
  ) {}

  private async call(method: string, body: unknown): Promise<Record<string, unknown>> {
    const response = await this.doFetch(`${this.baseUrl}/api/${method}`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(CALLER_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`Slack responded ${response.status}`);
    const parsed = (await response.json()) as Record<string, unknown>;
    if (parsed.ok !== true) throw new Error(`Slack error: ${String(parsed.error)}`);
    return parsed;
  }

  async history(marker: string): Promise<{ ts: string | null; raw: unknown }> {
    const result = await this.call('conversations.history', {
      channel: this.channel, limit: 50,
    });
    const messages = (result.messages ?? []) as Array<{ text: string; ts: string }>;
    const found = messages.find((m) => m.text?.includes(marker));
    return { ts: found?.ts ?? null, raw: result };
  }

  async post(text: string): Promise<{ ts: string }> {
    const result = await this.call('chat.postMessage', { channel: this.channel, text });
    return { ts: String(result.ts) };
  }
}

export class SlackTarget implements DeliveryTarget {
  readonly target = 'slack' as const;

  constructor(private readonly client: SlackClient) {}

  async deliver(ctx: DeliveryContext): Promise<DeliveryOutcome> {
    const payload = ctx.payload as NotifyPayload;
    const marker = ctx.idempotencyKey;

    const existing = await this.client.history(marker);
    if (existing.ts) return this.outcome(existing.ts);

    const amount = (payload.totalCents / 100).toFixed(2);
    const posted = await this.client.post(
      `New order from ${payload.customerName} — EUR ${amount}  \`${marker}\``,
    );
    return this.outcome(posted.ts);
  }

  private outcome(ts: string): DeliveryOutcome {
    return { remoteRef: ts, remoteAt: new Date(Number(ts.split('.')[0]) * 1000) };
  }
}
