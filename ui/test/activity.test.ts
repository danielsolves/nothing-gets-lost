// ui/test/activity.test.ts
// The two lines that say out loud what is happening: one per system tile, one for
// the mediator as a whole.
//
// The assertions here are about copy, which is deliberate. A tile used to say
// nothing about itself unless something was queued at it, and the mediator only
// admitted what it was doing to a visitor who clicked into the Log tab. Wording is
// the whole deliverable, so it is the thing under test: what is said, in which
// order of urgency, and what is never said at all. The raw error string is the
// last of those. It belongs in the backlog entry, not on a tile.
//
// Two of these tests are about length rather than meaning. A tile is a 150 pixel
// square whose first two rows are already the system name and a one word note, so
// a tile line that names the system again says nothing and costs several wrapped
// rows in a space that has none. The mediator line is the opposite case: it speaks
// for the whole machine, where the name is the point. That is why the same fact is
// worded twice in this file, and why the tile assertions are the short ones.
//
// Every timing case pins `now`, because a countdown that reads differently on the
// second run is not a test.
import { describe, it, expect } from 'vitest';
import type { DeliveryView, SwitchableTarget, Target } from '@ngl/contracts';
import { activityFor, currentWork } from '../src/activity';
import { SYSTEMS } from '../src/machine';

const NOW = new Date('2026-07-30T22:29:37.000Z');
const IN_4_SECONDS = '2026-07-30T22:29:41.000Z';
const IN_10_MINUTES = '2026-07-30T22:39:37.000Z';
const OVERDUE = '2026-07-30T22:29:31.000Z';

let nextId = 1;

function d(
  target: Target, state: DeliveryView['state'], extra: Partial<DeliveryView> = {},
): DeliveryView {
  const id = nextId++;
  return {
    id, eventId: `evt-${id}`, target, state, attempts: 1,
    nextAt: null, lastError: null, remoteRef: null, remoteAt: null,
    sentAt: null, answeredAt: null, ...extra,
  };
}

/** Every line a tile can produce, so length and wording can be checked in one go. */
function everyLine(target: SwitchableTarget): string[] {
  const retry = { attempts: 4, nextAt: IN_10_MINUTES };
  const lines = [
    activityFor(target, [d(target, 'inflight')], NOW),
    activityFor(target, [d(target, 'inflight'), d(target, 'inflight')], NOW),
    activityFor(target, [d(target, 'dead', { attempts: 6 })], NOW),
    activityFor(target, [d(target, 'dead', { attempts: 6 }), d(target, 'dead', { attempts: 6 })], NOW),
    activityFor(target, [d(target, 'pending', retry)], NOW),
    activityFor(target, [d(target, 'pending', { attempts: 4, nextAt: OVERDUE })], NOW),
    activityFor(target, [d(target, 'pending', retry), d(target, 'pending', retry)], NOW),
    activityFor(target, [d(target, 'pending', { attempts: 0 })], NOW),
    activityFor(target, [d(target, 'pending', { attempts: 0 }), d(target, 'pending', { attempts: 0 })], NOW),
  ];
  return lines.map((line) => line?.text ?? '');
}

describe('activityFor', () => {
  it('stays quiet when the system has nothing outstanding', () => {
    expect(activityFor('stripe', [], NOW)).toBeNull();
    expect(activityFor('stripe', [d('stripe', 'done')], NOW)).toBeNull();
  });

  it('says what is going out right now', () => {
    const activity = activityFor('stripe', [d('stripe', 'inflight')], NOW);
    expect(activity).toEqual({ text: 'Delivering', tone: 'work' });
  });

  it('says a delivery is being retried, without the attempt or the countdown', () => {
    // Both used to be here and both belong to one order, which is where they are
    // printed. A tile is a system, and an attempt number floating over a system is a
    // number with nothing to be about: the reader cannot tell which of the orders
    // stacked at that system it counts.
    const activity = activityFor('hubspot', [
      d('hubspot', 'pending', { attempts: 3, nextAt: IN_4_SECONDS, lastError: 'ECONNRESET' }),
    ], NOW);
    expect(activity).toEqual({ text: 'Retrying', tone: 'wait' });
  });

  it('says the same thing however far off the next try is', () => {
    // The countdown was also the one line on a tile that could be wrong without
    // anything being broken: it is arithmetic against the reader's own clock.
    const soon = activityFor('slack', [
      d('slack', 'pending', { attempts: 5, nextAt: IN_4_SECONDS }),
    ], NOW);
    const later = activityFor('slack', [
      d('slack', 'pending', { attempts: 5, nextAt: IN_10_MINUTES }),
    ], NOW);
    const due = activityFor('slack', [
      d('slack', 'pending', { attempts: 2, nextAt: OVERDUE }),
    ], NOW);
    expect(soon?.text).toBe('Retrying');
    expect(later?.text).toBe('Retrying');
    expect(due?.text).toBe('Retrying');
  });

  it('never prints an attempt number on a tile', () => {
    for (const text of everyLine('hubspot')) {
      expect(text).not.toMatch(/attempt \d/i);
    }
  });

  it('leads with what needs a human over what is only waiting to retry', () => {
    const activity = activityFor('slack', [
      d('slack', 'pending', { attempts: 2, nextAt: IN_4_SECONDS }),
      d('slack', 'dead', { attempts: 6, lastError: 'gave up' }),
    ], NOW);
    expect(activity).toEqual({
      text: 'Needs a human after 6 attempts',
      tone: 'bad',
    });
  });

  it('leads with the delivery going out over the one already parked', () => {
    // A parked row never clears itself. Rank it above live work and the tile
    // says "needs a human" for the rest of the session and never shows another
    // delivery leaving, which is the opposite of saying what is happening now.
    const activity = activityFor('ledger', [
      d('ledger', 'dead', { attempts: 6 }),
      d('ledger', 'inflight', { attempts: 1 }),
    ], NOW);
    expect(activity?.text).toBe('Delivering');
  });

  it('says an order is queued when nothing has been tried yet', () => {
    const activity = activityFor('mailer', [
      d('mailer', 'pending', { attempts: 0 }),
    ], NOW);
    expect(activity).toEqual({ text: 'Queued', tone: 'wait' });
  });

  it('counts several at once instead of naming them one by one', () => {
    const inflight = activityFor('stripe', [
      d('stripe', 'inflight'), d('stripe', 'inflight'), d('stripe', 'inflight'),
    ], NOW);
    expect(inflight?.text).toBe('Delivering 3 orders');

    const parked = activityFor('stripe', [
      d('stripe', 'dead', { attempts: 6 }), d('stripe', 'dead', { attempts: 6 }),
    ], NOW);
    expect(parked?.text).toBe('2 orders need a human');

    const retrying = activityFor('stripe', [
      d('stripe', 'pending', { attempts: 2, nextAt: IN_10_MINUTES }),
      d('stripe', 'pending', { attempts: 1, nextAt: IN_4_SECONDS }),
    ], NOW);
    expect(retrying?.text).toBe('2 orders retrying');

    const queued = activityFor('stripe', [
      d('stripe', 'pending', { attempts: 0 }), d('stripe', 'pending', { attempts: 0 }),
    ], NOW);
    expect(queued?.text).toBe('2 orders queued');
  });

  it('reports only its own system', () => {
    const activity = activityFor('stripe', [
      d('hubspot', 'inflight'),
      d('slack', 'dead', { attempts: 6 }),
    ], NOW);
    expect(activity).toBeNull();
  });

  it('never repeats the name of the tile it sits on', () => {
    // The tile prints the name and a one word note above this line. Repeating it
    // spends a third of a 150 pixel square on a word the reader is looking at.
    for (const node of SYSTEMS) {
      for (const text of everyLine(node.id)) {
        expect(text.toLowerCase()).not.toContain(node.label.toLowerCase());
      }
    }
  });

  it('stays short enough to read on a tile', () => {
    for (const text of everyLine('hubspot')) {
      expect(text.length).toBeLessThanOrEqual(60);
    }

    // The four everyday lines, the ones a visitor sees most of the time, hold to
    // half of that and fit on one row.
    const short = [
      activityFor('hubspot', [d('hubspot', 'inflight')], NOW),
      activityFor('hubspot', [d('hubspot', 'dead', { attempts: 6 })], NOW),
      activityFor('hubspot', [d('hubspot', 'pending', { attempts: 4, nextAt: OVERDUE })], NOW),
      activityFor('hubspot', [d('hubspot', 'pending', { attempts: 0 })], NOW),
    ];
    for (const line of short) {
      expect(line?.text.length).toBeLessThanOrEqual(30);
    }
  });

  it('never puts the raw error in front of a visitor', () => {
    const lastError = 'AggregateError: connect ECONNREFUSED 127.0.0.1:4003';
    const lines = [
      activityFor('hubspot', [d('hubspot', 'pending', { attempts: 3, lastError })], NOW),
      activityFor('hubspot', [d('hubspot', 'dead', { attempts: 6, lastError })], NOW),
      currentWork([d('hubspot', 'dead', { attempts: 6, lastError })]),
    ];
    for (const line of lines) {
      expect(line?.text).not.toContain('ECONNREFUSED');
      expect(line?.text).not.toContain('127.0.0.1');
    }
  });
});

describe('currentWork', () => {
  it('says nothing has come in rather than inventing work', () => {
    expect(currentWork([])).toEqual({ text: 'Nothing has come in yet', tone: 'wait' });
  });

  it('says the work is finished rather than claiming to be busy', () => {
    const work = currentWork([d('stripe', 'done'), d('slack', 'done')]);
    expect(work).toEqual({ text: 'Everything delivered, nothing waiting', tone: 'wait' });
  });

  it('names what is going out and counts what is left behind it', () => {
    const work = currentWork([
      d('stripe', 'inflight'),
      d('hubspot', 'pending', { attempts: 0 }),
      d('slack', 'pending', { attempts: 2, nextAt: IN_4_SECONDS }),
      d('ledger', 'done'),
    ]);
    expect(work).toEqual({ text: 'Delivering to Stripe, 2 more waiting', tone: 'work' });
  });

  it('leaves the count off when there is nothing else to count', () => {
    const work = currentWork([d('stripe', 'inflight'), d('slack', 'done')]);
    expect(work.text).toBe('Delivering to Stripe');
  });

  it('names the parked delivery once nothing is in flight', () => {
    const work = currentWork([
      d('slack', 'dead', { attempts: 6 }),
      d('stripe', 'done'),
    ]);
    expect(work).toEqual({ text: 'Slack needs a human after 6 attempts', tone: 'bad' });
  });

  it('counts the parked deliveries rather than listing them', () => {
    const work = currentWork([
      d('slack', 'dead', { attempts: 6 }),
      d('hubspot', 'dead', { attempts: 6 }),
      d('stripe', 'pending', { attempts: 0 }),
    ]);
    expect(work).toEqual({ text: '2 orders need a human, 1 more waiting', tone: 'bad' });
  });

  it('names what it is waiting to retry, without counting down to it', () => {
    // The countdown moved onto the card of the order it belongs to. Up here it was
    // a number about one delivery printed over the whole queue: a visitor read
    // "4 seconds" above twelve orders and had no way to tell which one it meant.
    const work = currentWork([
      d('hubspot', 'pending', { attempts: 4, nextAt: IN_10_MINUTES }),
      d('slack', 'pending', { attempts: 1, nextAt: IN_4_SECONDS }),
    ]);
    expect(work).toEqual({ text: 'Waiting to retry Slack, 1 more waiting', tone: 'wait' });
  });

  it('says the same thing whether or not the next try is overdue', () => {
    const work = currentWork([
      d('hubspot', 'pending', { attempts: 4, nextAt: OVERDUE }),
    ]);
    expect(work.text).toBe('Waiting to retry HubSpot');
  });

  it('falls back to the queue when nothing has been tried yet', () => {
    const work = currentWork([
      d('stripe', 'pending', { attempts: 0 }),
      d('hubspot', 'pending', { attempts: 0 }),
    ]);
    expect(work).toEqual({ text: 'Queued for Stripe, 1 more waiting', tone: 'wait' });
  });

  it('speaks of the visitor endpoint in their own words', () => {
    const work = currentWork([d('custom_webhook', 'inflight')]);
    expect(work.text).toBe('Delivering to your endpoint');
  });

  it('starts the line with a capital letter whichever system it names', () => {
    const work = currentWork([d('custom_webhook', 'pending', { attempts: 0 })]);
    expect(work.text).toBe('Queued for your endpoint');
    expect(currentWork([d('custom_webhook', 'dead', { attempts: 6 })]).text)
      .toBe('Your endpoint needs a human after 6 attempts');
  });
});

describe('the answer coming back', () => {
  // Every case here pins `now` against the answer, because the line is not only
  // computed from the two stamps but is also only shown for a moment after them.
  const ANSWERED = '2026-08-01T10:00:00.312Z';
  const JUST_AFTER = new Date('2026-08-01T10:00:01.000Z');

  it('says how long the system took, because the number is the evidence', () => {
    // "Delivered" is one more thing to read for no news. A duration only exists
    // because something at the other end really answered.
    const done = d('hubspot', 'done', {
      sentAt: '2026-08-01T10:00:00.000Z', answeredAt: ANSWERED,
    });
    expect(activityFor('hubspot', [done], JUST_AFTER)?.text).toBe('Answered in 312 ms');
  });

  it('reads a slow hop in seconds rather than four digits of milliseconds', () => {
    const done = d('slack', 'done', {
      sentAt: '2026-08-01T10:00:00.000Z', answeredAt: '2026-08-01T10:00:08.400Z',
    });
    const now = new Date('2026-08-01T10:00:09.000Z');
    expect(activityFor('slack', [done], now)?.text).toBe('Answered in 8.4 s');
  });

  it('takes the most recent answer when several have settled', () => {
    const older = d('hubspot', 'done', {
      sentAt: '2026-08-01T10:00:00.000Z', answeredAt: '2026-08-01T10:00:00.900Z',
    });
    const newer = d('hubspot', 'done', {
      sentAt: '2026-08-01T10:00:05.000Z', answeredAt: '2026-08-01T10:00:05.100Z',
    });
    const now = new Date('2026-08-01T10:00:06.000Z');
    expect(activityFor('hubspot', [older, newer], now)?.text).toBe('Answered in 100 ms');
  });

  it('lets the answer go once it is no longer news', () => {
    // Left up, the duration became the tile's resting state: five systems each
    // holding a number from whenever they last did something, which reads as a
    // machine still working while nothing at all is happening.
    const done = d('hubspot', 'done', {
      sentAt: '2026-08-01T10:00:00.000Z', answeredAt: ANSWERED,
    });
    const later = new Date('2026-08-01T10:00:30.000Z');
    expect(activityFor('hubspot', [done], later)).toBeNull();
  });

  it('stays quiet about a delivery that was never timed', () => {
    // A made-up duration on this page costs more than a blank tile.
    expect(activityFor('hubspot', [d('hubspot', 'done')], JUST_AFTER)).toBeNull();
  });

  it('ignores a pair of timestamps that runs backwards', () => {
    const broken = d('hubspot', 'done', {
      sentAt: '2026-08-01T10:00:05.000Z', answeredAt: '2026-08-01T10:00:00.000Z',
    });
    expect(activityFor('hubspot', [broken], JUST_AFTER)).toBeNull();
  });

  it('says nothing about timing while something is still moving', () => {
    const done = d('hubspot', 'done', {
      sentAt: '2026-08-01T10:00:00.000Z', answeredAt: ANSWERED,
    });
    const going = d('hubspot', 'inflight');
    expect(activityFor('hubspot', [done, going], JUST_AFTER)?.text).toBe('Delivering');
  });
});
