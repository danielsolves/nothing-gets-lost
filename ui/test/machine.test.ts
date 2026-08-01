// ui/test/machine.test.ts
// What the diagram is allowed to say about each system, kept as data so the words
// can be checked without a browser.
//
// The interesting assertions here are about copy, which is unusual and deliberate.
// The page used to flatten four distinct faults into one on/off switch, and the
// two that look alike are the two worth teaching: "Failing" means the system is
// down, "Unreachable" means the system is fine and the line to it is not. If those
// two ever read the same way again, the demo has lost its point.
import { describe, it, expect } from 'vitest';
import { SWITCHABLE_TARGETS } from '@ngl/contracts';
import { CHAOS_KINDS } from '@ngl/contracts';
import { NODES, ORDER_WAYS, SYSTEMS, faultsFor } from '../src/machine';

describe('faults', () => {
  it('offers only the states this page can honestly produce', () => {
    // The gate also has 'error', where it answers 503 in the system's place. Nothing
    // here can make Slack fail, so a tile saying "the system is down" stated as fact
    // something true of our container and false of the system it named.
    expect(faultsFor('stripe').map((fault) => fault.state)).toEqual(['up', 'slow', 'cut']);
  });

  it('never offers to make a third party fail', () => {
    for (const target of SWITCHABLE_TARGETS) {
      expect(faultsFor(target).map((fault) => fault.state)).not.toContain('error');
    }
  });

  it('says of each fault what it does, not just what it is called', () => {
    for (const fault of faultsFor('stripe')) {
      expect(fault.means.length).toBeGreaterThan(10);
    }
  });

  it('keeps the difference between a slow line and a dead one', () => {
    // Two failures that look alike from a tile and recover completely differently:
    // one times out and retries into a system that is answering, the other retries
    // into nothing until the line comes back.
    const slow = faultsFor('stripe').find((f) => f.state === 'slow');
    const unreachable = faultsFor('stripe').find((f) => f.state === 'cut');
    expect(slow?.means).toMatch(/times out/i);
    expect(unreachable?.means).toMatch(/still (running|up)|is fine/i);
    expect(slow?.means).not.toBe(unreachable?.means);
  });

  it('lets Invoices say that off means off, because it alone really stops', () => {
    // Spec 7: the ledger closes its listening socket. Every other system is only
    // cut at the gate, and saying the same words about both would be a lie about
    // one of them.
    const ledger = faultsFor('ledger').find((f) => f.state === 'cut');
    const slack = faultsFor('slack').find((f) => f.state === 'cut');
    expect(ledger?.means).toMatch(/really|actually/i);
    expect(ledger?.means).not.toBe(slack?.means);
  });

  it('gives every switchable target the same set', () => {
    // A system offering fewer ways to break it than its neighbour reads as one that
    // is somehow less real.
    for (const target of SWITCHABLE_TARGETS) {
      expect(faultsFor(target).map((f) => f.state)).toEqual(['up', 'slow', 'cut']);
    }
  });
});

describe('mischief', () => {
  it('puts the repeated payment on Stripe, where the webhook comes from', () => {
    const stripe = SYSTEMS.find((node) => node.id === 'stripe');
    expect(stripe?.mischief.map((m) => m.kind)).toEqual(['duplicate_webhook']);
  });

  it('puts nothing one-off on a system that has no one-off to give', () => {
    for (const node of SYSTEMS) {
      if (node.id !== 'stripe') expect(node.mischief).toEqual([]);
    }
  });

  it('leaves the malformed orders to the way in, not to a system', () => {
    // They used to hang off an order-mail tile. Neither is a fault of a system we
    // call: both are things a visitor sends, so they belong to the one entrance.
    for (const node of SYSTEMS) {
      expect(node.mischief.map((m) => m.kind)).not.toContain('garbage_payload');
      expect(node.mischief.map((m) => m.kind)).not.toContain('hallucinate');
    }
  });
});

describe('the way in', () => {
  it('offers the clean order alongside the two odd ones', () => {
    // Naming the plain press in the same list is what tells a visitor these are
    // three variants of one action. A list holding only the odd two would read as
    // if the normal case lived somewhere else.
    expect(ORDER_WAYS.map((way) => way.id))
      .toEqual(['clean', 'garbage_payload', 'hallucinate']);
  });

  it('marks the ordinary order as the one that breaks nothing', () => {
    const clean = ORDER_WAYS.find((way) => way.id === 'clean');
    expect(clean?.kind).toBeNull();
  });

  it('sends every odd order through a chaos kind the server knows', () => {
    for (const way of ORDER_WAYS) {
      if (way.kind === null) continue;
      expect(CHAOS_KINDS as readonly string[]).toContain(way.kind);
    }
  });

  it('says of each way what it does, not just what it is called', () => {
    for (const way of ORDER_WAYS) expect(way.means.length).toBeGreaterThan(10);
  });
});

describe('the systems', () => {
  it('draws every system the mediator delivers to, and nothing else', () => {
    // There are no source tiles left. The shop and the order mail were drawn beside
    // the systems, which made two places an order comes from look like two more
    // places it goes to.
    expect(SYSTEMS.map((node) => node.id).sort())
      .toEqual([...SWITCHABLE_TARGETS].sort());
    expect(NODES.every((node) => node.kind === 'system')).toBe(true);
  });

  it('draws every system exactly once', () => {
    expect(new Set(NODES.map((node) => node.id)).size).toBe(NODES.length);
  });

  it('leads with the payment, because every order makes that hop first', () => {
    expect(NODES[0]?.id).toBe('stripe');
  });

  it('ends with the confirmation mail, which is last in the chain', () => {
    expect(NODES[NODES.length - 1]?.id).toBe('mailer');
  });
});
