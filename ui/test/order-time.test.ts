// ui/test/order-time.test.ts
// The card head carries the moment the order arrived. The wire sends the instant and
// says nothing about how it reads, which is right: how it reads is a decision about
// the visitor in front of it, and it is made here.
//
// Every case below is built from local date parts rather than a literal ISO string,
// so the test asserts what a visitor sees on their own clock wherever they run it.
import { describe, it, expect } from 'vitest';
import { formatArrival } from '../src/order-time';

const iso = (
  year: number, month: number, day: number, hour: number, minute: number, second = 0,
): string => new Date(year, month - 1, day, hour, minute, second).toISOString();

describe('formatArrival', () => {
  it('gives an order that arrived today a time down to the second', () => {
    // Four orders can land inside one minute during a demo, and four cards all
    // headed 14:32 say less than the uuid fragment they replaced.
    const now = new Date(2026, 6, 31, 14, 40, 0);
    expect(formatArrival(iso(2026, 7, 31, 14, 32, 7), now)).toBe('14:32:07');
  });

  it('pads the clock so a column of cards lines up', () => {
    const now = new Date(2026, 6, 31, 14, 40, 0);
    expect(formatArrival(iso(2026, 7, 31, 9, 5, 3), now)).toBe('09:05:03');
  });

  it('names the day once the order is no longer today', () => {
    // A second is noise on something a day old, and the date is not.
    const now = new Date(2026, 6, 31, 0, 30, 0);
    expect(formatArrival(iso(2026, 7, 30, 23, 58, 41), now)).toBe('30 Jul 23:58');
  });

  it('names the day for an order from another year, not just another day', () => {
    const now = new Date(2026, 6, 31, 14, 0, 0);
    expect(formatArrival(iso(2025, 7, 31, 14, 0, 0), now)).toBe('31 Jul 14:00');
  });

  it('never invents a time out of something that is not one', () => {
    expect(formatArrival('not a timestamp', new Date(2026, 6, 31))).toBe('not a timestamp');
  });
});
