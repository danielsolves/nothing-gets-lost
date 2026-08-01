// services/mcp/src/rate-limit.ts
// A per-caller window, held in memory.
//
// The api service rate limits into the rate_limits table so that several replicas
// share one count. This service cannot: it connects as ngl_ro, which cannot write
// anything, and widening that role to keep a counter would trade the guarantee this
// server rests on for a nicety. There is one instance of it, so an in-memory window
// is the same count anyway, and it is lost on restart, which costs a restarting
// server one window of forgiveness.
export interface RateLimitOptions {
  max: number;
  windowMs: number;
}

export class RateLimiter {
  private readonly seen = new Map<string, { count: number; startedAt: number }>();

  constructor(private readonly options: RateLimitOptions) {}

  /** Counts the call and says whether it is allowed. `now` is injected for tests. */
  allow(caller: string, now: number = Date.now()): boolean {
    const window = this.seen.get(caller);

    if (window === undefined || now - window.startedAt >= this.options.windowMs) {
      this.seen.set(caller, { count: 1, startedAt: now });
      // Sweeping here rather than on a timer: a map that is only ever added to is a
      // slow leak, and a timer would keep the process alive with nothing to do.
      this.forget(now);
      return true;
    }

    window.count += 1;
    return window.count <= this.options.max;
  }

  private forget(now: number): void {
    for (const [caller, window] of this.seen) {
      if (now - window.startedAt >= this.options.windowMs) this.seen.delete(caller);
    }
  }
}

/**
 * Who is calling. Behind the reverse proxy every request arrives from the proxy, so
 * the forwarded address is the only thing that tells two callers apart; the socket
 * address is what is left when nobody set one.
 *
 * The first entry of the list, because a proxy appends and the client can only forge
 * what comes before the hop it cannot control.
 */
export function callerOf(
  headers: Record<string, string | string[] | undefined>, socketAddress?: string,
): string {
  const forwarded = headers['x-forwarded-for'];
  const first = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  return first?.split(',')[0]?.trim() || socketAddress || 'unknown';
}
