// services/mediator/src/targets/index.ts
// Builds the six delivery targets from the environment.
//
// Every one of them is pointed at the egress gate, never at the real endpoint.
// That is what makes the control panel switches real: the mediator makes an
// ordinary HTTP call and experiences an ordinary failure, and it never learns
// that somebody flipped a switch (spec 7).
//
// Slack and HubSpot take a resolver rather than a token, because whose account an
// entry lands in is decided per delivery and can change while items are queued
// (spec 9.4, 10.1).
import { HubSpotClient, HubSpotTarget } from './hubspot.target';
import { HubSpotOrders } from './hubspot.order';
import { StripeClient, StripeTarget } from './stripe.target';
import { SlackClient, SlackTarget } from './slack.target';
import { LedgerClient, LedgerTarget } from './ledger.target';
import { MailerClient, MailerTarget } from './mailer.target';
import { WebhookTarget } from './webhook.target';
import type { CredentialResolver } from '../credentials';
import type { SlackSendLog } from '../slack-send.log';
import type { DeliveryTarget } from '../target.interface';

const EGRESS_URL = process.env.EGRESS_URL ?? 'http://egress-gate:3003';

function via(target: string): string {
  return `${EGRESS_URL}/proxy/${target}`;
}

export function buildTargets(
  credentials: CredentialResolver,
  slackSendLog: SlackSendLog,
  env: NodeJS.ProcessEnv = process.env,
  webhookUrl: () => Promise<string | null> = () => Promise.resolve(null),
): DeliveryTarget[] {
  return [
    new HubSpotTarget(
      new HubSpotClient(via('hubspot')), () => credentials.hubspot(),
      new HubSpotOrders(via('hubspot')),
    ),
    new StripeTarget(new StripeClient(via('stripe'), env.STRIPE_SECRET_KEY ?? '')),
    new SlackTarget(
      new SlackClient(via('slack')), () => credentials.slack(), slackSendLog,
    ),
    new LedgerTarget(new LedgerClient(via('ledger'))),
    new MailerTarget(new MailerClient(via('mailer'))),
    // The visitor's own endpoint is reached directly, not through the gate: the
    // switches are ours to flip, and theirs is not one of them.
    new WebhookTarget(webhookUrl, env.WEBHOOK_SIGNING_SECRET ?? 'demo-signing-secret'),
  ];
}
