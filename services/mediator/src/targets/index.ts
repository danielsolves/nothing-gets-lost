// services/mediator/src/targets/index.ts
// Builds the five delivery targets from the environment.
//
// Every one of them is pointed at the egress gate, never at the real endpoint.
// That is what makes the control panel switches real: the mediator makes an
// ordinary HTTP call and experiences an ordinary failure, and it never learns
// that somebody flipped a switch (spec 7).
import { HubSpotClient, HubSpotTarget } from './hubspot.target';
import { StripeClient, StripeTarget } from './stripe.target';
import { SlackClient, SlackTarget } from './slack.target';
import { LedgerClient, LedgerTarget } from './ledger.target';
import { MailerClient, MailerTarget } from './mailer.target';
import type { DeliveryTarget } from '../target.interface';

const EGRESS_URL = process.env.EGRESS_URL ?? 'http://egress-gate:3003';

function via(target: string): string {
  return `${EGRESS_URL}/proxy/${target}`;
}

export function buildTargets(env: NodeJS.ProcessEnv = process.env): DeliveryTarget[] {
  return [
    new HubSpotTarget(new HubSpotClient(via('hubspot'), env.HUBSPOT_TOKEN ?? '')),
    new StripeTarget(new StripeClient(via('stripe'), env.STRIPE_SECRET_KEY ?? '')),
    new SlackTarget(new SlackClient(
      via('slack'), env.SLACK_BOT_TOKEN ?? '', env.SLACK_CHANNEL_ID ?? '',
    )),
    new LedgerTarget(new LedgerClient(via('ledger'))),
    new MailerTarget(new MailerClient(via('mailer'))),
  ];
}
