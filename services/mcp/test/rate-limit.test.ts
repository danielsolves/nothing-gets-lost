// services/mcp/test/rate-limit.test.ts
// The window, with the clock handed in. Nothing here sleeps.
import { describe, it, expect } from 'vitest';
import { callerOf, RateLimiter } from '../src/rate-limit';

describe('RateLimiter', () => {
  it('allows up to the limit and refuses the one after', () => {
    const limiter = new RateLimiter({ max: 3, windowMs: 1000 });
    expect([1, 2, 3].map(() => limiter.allow('a', 0))).toEqual([true, true, true]);
    expect(limiter.allow('a', 0)).toBe(false);
  });

  it('starts again once the window has passed', () => {
    const limiter = new RateLimiter({ max: 1, windowMs: 1000 });
    expect(limiter.allow('a', 0)).toBe(true);
    expect(limiter.allow('a', 500)).toBe(false);
    expect(limiter.allow('a', 1000)).toBe(true);
  });

  it('counts each caller on its own', () => {
    const limiter = new RateLimiter({ max: 1, windowMs: 1000 });
    expect(limiter.allow('a', 0)).toBe(true);
    expect(limiter.allow('b', 0)).toBe(true);
    expect(limiter.allow('a', 0)).toBe(false);
  });
});

describe('callerOf', () => {
  it('takes the socket address when nothing was forwarded', () => {
    expect(callerOf({}, '10.0.0.4')).toBe('10.0.0.4');
  });

  it('takes the first forwarded address, which is the one behind the proxy', () => {
    expect(callerOf({ 'x-forwarded-for': '1.2.3.4, 10.0.0.1' }, '10.0.0.1')).toBe('1.2.3.4');
  });

  it('reads a header the server split into a list', () => {
    expect(callerOf({ 'x-forwarded-for': ['1.2.3.4', '5.6.7.8'] }, '10.0.0.1')).toBe('1.2.3.4');
  });

  // Everyone unidentifiable shares one bucket rather than each getting a fresh
  // allowance, which is the safer way round for a public port.
  it('names an unidentifiable caller rather than inventing one', () => {
    expect(callerOf({})).toBe('unknown');
  });
});
