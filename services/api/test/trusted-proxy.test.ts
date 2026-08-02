// services/api/test/trusted-proxy.test.ts
// One setting, and every claim the page makes about its own limits rests on it.
//
// Without it the address Express reports is nginx's, the same for every caller, so
// the caps in rate-limit.guard.ts counted the whole internet as one visitor. The page
// said thirty orders per visitor and enforced thirty orders in total, and the first
// reader to spend them shut the rest out until the hour turned.
//
// The value is as load-bearing as the setting. `true` would trust the entire
// X-Forwarded-For chain, and a caller writes that chain, so anyone could name a fresh
// address and hold a fresh allowance for each. That is not a weaker limit, it is no
// limit at all while looking exactly like one.
import { describe, it, expect } from 'vitest';
import { trustTheProxy, TRUSTED_PROXY_HOPS, type Configurable } from '../src/trusted-proxy';

function spy(): Configurable & { calls: Array<[string, unknown]> } {
  const calls: Array<[string, unknown]> = [];
  return { calls, set(setting, value) { calls.push([setting, value]); } };
}

describe('trustTheProxy', () => {
  it('tells Express to read the caller from the proxy', () => {
    const app = spy();
    trustTheProxy(app);
    expect(app.calls).toEqual([['trust proxy', TRUSTED_PROXY_HOPS]]);
  });

  it('trusts exactly one hop, never the whole chain', () => {
    expect(TRUSTED_PROXY_HOPS).toBe(1);
    const app = spy();
    trustTheProxy(app);
    expect(app.calls[0]?.[1]).not.toBe(true);
  });
});
