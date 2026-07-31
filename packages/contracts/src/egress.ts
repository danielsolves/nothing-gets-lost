// packages/contracts/src/egress.ts
// The egress-gate contract. Every outbound call goes through
// POST|GET|... {EGRESS_URL}/proxy/:target/{rest of path}
// The gate applies the switch state and forwards to the real base url below.
//
// The mediator must NOT know about switches. It sees a real failed HTTP call and
// behaves exactly as it would in production — that is the whole point (spec 7).
import type { SwitchableTarget } from './targets';

export const EGRESS_BASE_URLS: Record<SwitchableTarget, string> = {
  hubspot: 'https://api.hubapi.com',
  stripe: 'https://api.stripe.com',
  slack: 'https://slack.com',
  ledger: 'http://ledger:3004',
  mailer: 'http://mailer:3005',
};

/** How each switch state is realised on the wire (spec 7). */
export const SWITCH_BEHAVIOUR = {
  up: 'forward',
  slow: 'delay 8s, then forward',
  error: 'respond 503 without forwarding',
  cut: 'destroy the socket immediately (ECONNRESET)',
} as const satisfies Record<string, string>;

export const SLOW_DELAY_MS = 8_000;
/** Callers time out below the slow delay, so "slow" produces a real timeout. */
export const CALLER_TIMEOUT_MS = 5_000;
