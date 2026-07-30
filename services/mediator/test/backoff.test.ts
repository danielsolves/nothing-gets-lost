// services/mediator/test/backoff.test.ts
// Pins the retry schedule and its jitter. The first two delays have to stay
// short enough for a visitor to watch a recovery happen inside one page view.
import { describe, it, expect } from 'vitest';
import { nextDelaySeconds, MAX_ATTEMPTS, BACKOFF_SECONDS } from '../src/backoff';

/** Deterministic stand-in for Math.random so the schedule is testable. */
const noJitter = () => 1;
const fullJitter = () => 0;

describe('retry schedule', () => {
  it('follows the schedule from the spec', () => {
    expect(BACKOFF_SECONDS).toEqual([2, 8, 30, 120, 600]);
  });

  it('gives up after six attempts', () => {
    expect(MAX_ATTEMPTS).toBe(6);
  });

  it('returns the full delay when jitter is at its maximum', () => {
    expect(nextDelaySeconds(1, noJitter)).toBe(2);
    expect(nextDelaySeconds(2, noJitter)).toBe(8);
    expect(nextDelaySeconds(3, noJitter)).toBe(30);
    expect(nextDelaySeconds(4, noJitter)).toBe(120);
    expect(nextDelaySeconds(5, noJitter)).toBe(600);
  });

  it('can shorten any delay down to zero — full jitter, not equal jitter', () => {
    expect(nextDelaySeconds(1, fullJitter)).toBe(0);
    expect(nextDelaySeconds(5, fullJitter)).toBe(0);
  });

  it('sends the sixth failed attempt to the dead letter box', () => {
    expect(nextDelaySeconds(6, noJitter)).toBeNull();
    expect(nextDelaySeconds(7, noJitter)).toBeNull();
  });

  it('never returns a negative delay', () => {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      for (let i = 0; i < 200; i++) {
        const delay = nextDelaySeconds(attempt);
        if (delay !== null) expect(delay).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('stays inside the scheduled bound', () => {
    for (let i = 0; i < 200; i++) {
      expect(nextDelaySeconds(3)!).toBeLessThanOrEqual(30);
    }
  });
});
