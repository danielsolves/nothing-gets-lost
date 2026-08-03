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

/**
 * The gate url turned back into the url of the system that actually answered.
 *
 * The verify endpoint reports which url it asked, and that report is the evidence:
 * the visitor is being shown that the record lives on somebody else's domain. Left
 * as the gate saw it, that field read `http://egress-gate:3003/proxy/hubspot/...`,
 * which names a container on our own network and proves the opposite of the point.
 *
 * The gate is how we cut the line, not where the record is. Returns null for a url
 * that did not come from the gate, so a caller cannot silently rewrite an address it
 * did not recognise.
 */
export function upstreamUrl(gateUrl: string): string | null {
  const marker = '/proxy/';
  const at = gateUrl.indexOf(marker);
  if (at === -1) return null;

  const rest = gateUrl.slice(at + marker.length);
  const slash = rest.indexOf('/');
  const target = slash === -1 ? rest : rest.slice(0, slash);
  const path = slash === -1 ? '' : rest.slice(slash);

  const base = EGRESS_BASE_URLS[target as SwitchableTarget];
  if (base === undefined) return null;
  return `${base}${path}`;
}
