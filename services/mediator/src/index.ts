// services/mediator/src/index.ts
// The mediator's public surface. Other services talk to it over HTTP for
// anything stateful; only pure helpers are shared as code, so the queue rules
// stay in exactly one process.
export * from './target.interface';
export * from './stripe.webhook';
// The api reads back from HubSpot and Slack for the verify button (spec 9.2) and
// reuses these clients rather than writing a second copy of the same calls.
export { HubSpotClient } from './targets/hubspot.target';
export { SlackClient } from './targets/slack.target';
// Whose account an entry lands in has to be decided the same way on both sides, or
// the verify button would read back from an account the delivery never touched.
export {
  CredentialResolver,
  type HouseCredentials,
  type HubSpotCredentials,
  type SlackCredentials,
} from './credentials';
// The api validates a visitor-supplied url on the way in; the delivery target
// re-checks it before every call. Same guard, so the two cannot drift apart.
export { assertSafeUrl, isBlockedAddress } from './ssrf.guard';
