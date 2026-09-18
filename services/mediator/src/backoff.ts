// services/mediator/src/backoff.ts
// Retry schedule for failed deliveries (spec 6.4).
//
// Every pause stays below five seconds so visitors can watch the whole recovery.
// In production this would start at 30s and stretch over hours —
// the README says so instead of hiding it.
//
// Full jitter (random between 0 and the scheduled delay), not equal jitter, so a
// burst of failures does not come back in lockstep.

export const BACKOFF_SECONDS = [1, 2, 3, 4, 5] as const;
export const MAX_RETRY_DELAY_SECONDS = Math.max(...BACKOFF_SECONDS);
export const MAX_ATTEMPTS = BACKOFF_SECONDS.length + 1;

export function nextDelaySeconds(
  attempts: number,
  rand: () => number = Math.random,
): number | null {
  if (attempts >= MAX_ATTEMPTS) return null;
  const scheduled = BACKOFF_SECONDS[attempts - 1];
  if (scheduled === undefined) return null;
  return rand() * scheduled;
}
