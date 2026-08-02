// services/api/src/trusted-proxy.ts
// How many proxies in front of this service are allowed to say who the caller is.
//
// Its own file so it can be tested. main.ts starts the server when it is imported,
// which makes the one line this holds untestable in place, and it is a line worth
// pinning: everything the page says about its own limits depends on it.
//
// Every request reaches this service through nginx. Without the setting below the
// address Express reports is the proxy's, which is the same address for everybody,
// and both caps in rate-limit.guard.ts are keyed on it. What the page documented as
// thirty orders per visitor was thirty orders for the whole internet, and the first
// reader to spend them shut every other reader out until the hour turned. On a page
// whose entire invitation is that a stranger can come and press the button, that is
// the worst thing a limit can do, because it does it silently.
//
// One hop, never `true`. `true` trusts the whole X-Forwarded-For chain, and that
// chain is written by whoever is calling: a caller could name any address it liked
// and hold a fresh allowance for each. One hop reads the entry nginx appended
// itself, which is the only one whose origin we know.
//
// The honest limit of that: the audit of this host found the api port reachable from
// other containers on the same machine, so a neighbour can reach this service
// without passing nginx and claim whatever address it wants. That is a hole in the
// deployment rather than in this decision, and it is written down where the
// deployment is. Against the public internet, which is what the caps are for, this
// is right.
export const TRUSTED_PROXY_HOPS = 1;

/** The part of an Express app this needs, so a test does not have to build one. */
export interface Configurable {
  set(setting: string, value: unknown): void;
}

export function trustTheProxy(app: Configurable): void {
  app.set('trust proxy', TRUSTED_PROXY_HOPS);
}
