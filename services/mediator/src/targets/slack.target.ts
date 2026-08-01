// services/mediator/src/targets/slack.target.ts
// Posts the notification into the workspace this demo owns (spec 10.1).
//
// Slack has neither idempotency keys nor a natural key, so the delivery embeds its
// own marker in the message text and the channel is read back before posting. That
// is the technique spec 6.5 assigns to Slack, and it leaves a narrow window between
// the read and the post.
//
// There was a second path, for a visitor who had connected their own workspace. It
// held chat:write and no read scope, so it remembered in a database row what it
// could not go and look up, and an interrupted send there could only be parked. The
// visitor OAuth is gone and so is that path, along with the send log it needed.
//
// This one is weaker than Stripe's guarantee and is documented as such. For a
// notification that is the right trade; for the invoice it would not be, which is
// why the ledger uses a database constraint instead.
import { CALLER_TIMEOUT_MS } from '@ngl/contracts';
import type { DeliveryContext, DeliveryOutcome, DeliveryTarget } from '../target.interface';
import type { SlackCredentials } from '../credentials';

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

interface NotifyPayload { customerName: string; totalCents: number }

export class SlackClient {
  constructor(
    private readonly baseUrl: string,
    private readonly doFetch: Fetch = fetch,
  ) {}

  private async call(
    creds: SlackCredentials, method: string, body: unknown,
  ): Promise<Record<string, unknown>> {
    const response = await this.doFetch(`${this.baseUrl}/api/${method}`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${creds.token}`,
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

  async history(
    creds: SlackCredentials, marker: string,
  ): Promise<{ ts: string | null; raw: unknown }> {
    const result = await this.call(creds, 'conversations.history', {
      channel: creds.channel, limit: 50,
    });
    const messages = (result.messages ?? []) as Array<{ text: string; ts: string }>;
    const found = messages.find((m) => m.text?.includes(marker));
    return { ts: found?.ts ?? null, raw: result };
  }

  async post(creds: SlackCredentials, text: string): Promise<{ ts: string }> {
    const result = await this.call(creds, 'chat.postMessage', {
      channel: creds.channel, text,
    });
    return { ts: String(result.ts) };
  }
}

export class SlackTarget implements DeliveryTarget {
  readonly target = 'slack' as const;

  constructor(
    private readonly client: SlackClient,
    private readonly credentials: () => Promise<SlackCredentials>,
  ) {}

  async deliver(ctx: DeliveryContext): Promise<DeliveryOutcome> {
    const creds = await this.credentials();
    const existing = await this.client.history(creds, ctx.idempotencyKey);
    if (existing.ts) return outcome(existing.ts);

    const posted = await this.client.post(creds, this.text(ctx));
    return outcome(posted.ts);
  }

  private text(ctx: DeliveryContext): string {
    const payload = ctx.payload as NotifyPayload;
    const amount = (payload.totalCents / 100).toFixed(2);
    return `New order from ${payload.customerName} — EUR ${amount}  \`${ctx.idempotencyKey}\``;
  }
}

function outcome(ts: string): DeliveryOutcome {
  return { remoteRef: ts, remoteAt: new Date(Number(ts.split('.')[0]) * 1000) };
}
