// services/mediator/src/targets/slack.target.ts
// Posts the notification, into our workspace or into the visitor's own (spec 10.1).
//
// Slack has neither idempotency keys nor a natural key, so the delivery embeds its
// own marker in the message text. How that marker is checked depends on whose
// workspace it is, because the two hold different scopes:
//
//   house    our app, channels:history granted, so read the channel back before
//            posting. That is the technique spec 6.5 assigns to Slack.
//   visitor  chat:write and incoming-webhook only. Asking a stranger for read
//            access to their channel so that we can save ourselves a database row
//            is the wrong trade, so the send log remembers instead.
//
// Both are weaker than Stripe's guarantee and both are documented as such. For a
// notification that is the right trade; for the invoice it would not be, which is
// why the ledger uses a database constraint instead.
import { CALLER_TIMEOUT_MS } from '@ngl/contracts';
import type { DeliveryContext, DeliveryOutcome, DeliveryTarget } from '../target.interface';
import { UnresolvableDelivery } from '../target.interface';
import type { SlackCredentials } from '../credentials';
import type { SlackSendLog } from '../slack-send.log';

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
    private readonly sendLog: SlackSendLog,
  ) {}

  async deliver(ctx: DeliveryContext): Promise<DeliveryOutcome> {
    const creds = await this.credentials();
    return creds.visitor
      ? this.deliverToVisitor(creds, ctx)
      : this.deliverToHouse(creds, ctx);
  }

  private async deliverToHouse(
    creds: SlackCredentials, ctx: DeliveryContext,
  ): Promise<DeliveryOutcome> {
    const existing = await this.client.history(creds, ctx.idempotencyKey);
    if (existing.ts) return outcome(existing.ts);

    const posted = await this.client.post(creds, this.text(ctx, false));
    return outcome(posted.ts);
  }

  private async deliverToVisitor(
    creds: SlackCredentials, ctx: DeliveryContext,
  ): Promise<DeliveryOutcome> {
    const claim = await this.sendLog.begin(ctx.eventId, ctx.idempotencyKey);
    if (claim.status === 'sent') return outcome(claim.messageTs);
    if (claim.status === 'unknown') {
      throw new UnresolvableDelivery(
        'A message was sent to your Slack workspace but the outcome could not be ' +
        'confirmed, because this worker stopped mid-call and the demo holds no ' +
        'permission to read your channel. Parked rather than posted twice.',
      );
    }

    let posted: { ts: string };
    try {
      posted = await this.client.post(creds, this.text(ctx, true));
    } catch (error) {
      // We are alive to handle this, so the post did not happen. Clearing the claim
      // is what lets the cut connection heal on the next attempt like every other
      // target does. Only a worker that dies before reaching here leaves it standing.
      await this.sendLog.abandon(ctx.eventId);
      throw error;
    }

    await this.sendLog.complete(ctx.eventId, posted.ts);
    return outcome(posted.ts);
  }

  private text(ctx: DeliveryContext, visitor: boolean): string {
    const payload = ctx.payload as NotifyPayload;
    const amount = (payload.totalCents / 100).toFixed(2);
    const line = `New order from ${payload.customerName} — EUR ${amount}  \`${ctx.idempotencyKey}\``;
    if (!visitor) return line;
    // Spec 10.1: their first message has to say what just happened and that the
    // connection ends on its own. Said on every message rather than only the first,
    // because remembering which one was first is state we do not need.
    return `${line}\nSent by the Nothing Gets Lost demo, which you connected to this ` +
      'workspace. The connection removes itself within 24 hours, or right away with ' +
      'the Disconnect button on the page.';
  }
}

function outcome(ts: string): DeliveryOutcome {
  return { remoteRef: ts, remoteAt: new Date(Number(ts.split('.')[0]) * 1000) };
}
