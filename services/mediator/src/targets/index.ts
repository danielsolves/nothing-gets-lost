// services/mediator/src/targets/index.ts
// Builds the six delivery targets from the environment.
//
// Every one of them is pointed at the egress gate, never at the real endpoint.
// That is what makes the control panel switches real: the mediator makes an
// ordinary HTTP call and experiences an ordinary failure, and it never learns
// that somebody flipped a switch (spec 7).
//
// Slack and HubSpot take a resolver rather than a token. It has one source now that
// the visitor OAuth is gone, but it stays the one place the house configuration is
// read, so the mediator and the check button on the api cannot disagree about which
// account an entry went to.
import { randomBytes } from 'node:crypto';
import { HubSpotClient, HubSpotTarget } from './hubspot.target';
import { HubSpotOrders } from './hubspot.order';
import { HubSpotCatalogue } from './hubspot.catalogue';
import { StripeClient, StripeTarget } from './stripe.target';
import { SlackClient, SlackTarget } from './slack.target';
import { LedgerClient, LedgerTarget } from './ledger.target';
import { MailerClient, MailerTarget } from './mailer.target';
import { WebhookTarget } from './webhook.target';
import type { CredentialResolver } from '../credentials';
import type { CatalogueLog } from '../hubspot-catalogue.log';
import type { DeliveryTarget } from '../target.interface';

const EGRESS_URL = process.env.EGRESS_URL ?? 'http://egress-gate:3003';

function via(target: string): string {
  return `${EGRESS_URL}/proxy/${target}`;
}

/**
 * The key behind `x-demo-signature` when nobody set one.
 *
 * It used to be the literal 'demo-signing-secret'. That header exists so a visitor can
 * tell our deliveries from anybody else's calls to the same url, and a key printed in a
 * public repository does not sign anything: forging a delivery that looks like ours
 * becomes copy and paste, and the only thing the signature still proves is that the
 * sender can read GitHub.
 *
 * Refusing to build the target without WEBHOOK_SIGNING_SECRET is the other obvious
 * answer and it is wrong twice over. Spec 8.5 asks that a stranger who cloned this and
 * set no environment at all still gets a running demo, and this file exists precisely
 * to build targets whose credentials are missing rather than to take the process down
 * over one of them. Random, once per process, keeps both. The price is that a receiver
 * cannot compare a signature from before a restart with one from after, which nothing
 * here asks them to do: they check the delivery in front of them. Inside one process
 * every attempt and every retry of a delivery signs alike, which is the part that
 * matters, and on the live host the variable is set, so this value never runs there.
 */
const PROCESS_SIGNING_SECRET = randomBytes(32).toString('hex');

/**
 * Empty counts as unset. `env_file` turns an empty line in .env into an empty string
 * rather than into nothing at all, and .env.example ships this line empty, so `??`
 * would hand HMAC the empty key in exactly the case the fallback exists for, and an
 * empty key is as public as a published one.
 */
export function webhookSigningSecret(env: NodeJS.ProcessEnv): string {
  return env.WEBHOOK_SIGNING_SECRET || PROCESS_SIGNING_SECRET;
}

export function buildTargets(
  credentials: CredentialResolver,
  catalogueLog: CatalogueLog,
  env: NodeJS.ProcessEnv = process.env,
  webhookUrl: () => Promise<string | null> = () => Promise.resolve(null),
): DeliveryTarget[] {
  return [
    new HubSpotTarget(
      new HubSpotClient(via('hubspot')), () => credentials.hubspot(),
      new HubSpotOrders(via('hubspot'), new HubSpotCatalogue(via('hubspot'), catalogueLog)),
    ),
    new StripeTarget(new StripeClient(via('stripe'), env.STRIPE_SECRET_KEY ?? '')),
    new SlackTarget(new SlackClient(via('slack')), () => credentials.slack()),
    new LedgerTarget(new LedgerClient(via('ledger'))),
    new MailerTarget(new MailerClient(via('mailer'))),
    // The visitor's own endpoint is reached directly, not through the gate: the
    // switches are ours to flip, and theirs is not one of them.
    new WebhookTarget(webhookUrl, webhookSigningSecret(env)),
  ];
}
