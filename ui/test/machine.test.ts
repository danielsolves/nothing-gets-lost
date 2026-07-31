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
import { SWITCH_STATES, SWITCHABLE_TARGETS } from '@ngl/contracts';
import { LEFT, NODES, RIGHT, SOURCES, SYSTEMS, faultsFor } from '../src/machine';

describe('faults', () => {
  it('offers every state the gate can actually be put into', () => {
    const offered = faultsFor('stripe').map((fault) => fault.state);
    expect(offered).toEqual([...SWITCH_STATES]);
  });

  it('says of each fault what it does, not just what it is called', () => {
    for (const fault of faultsFor('stripe')) {
      expect(fault.means.length).toBeGreaterThan(10);
    }
  });

  it('keeps the difference between a dead system and a dead line', () => {
    const failing = faultsFor('stripe').find((f) => f.state === 'error');
    const unreachable = faultsFor('stripe').find((f) => f.state === 'cut');
    expect(failing?.means).toMatch(/down/i);
    expect(unreachable?.means).toMatch(/still (running|up)|is fine/i);
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

  it('gives every switchable target the full set', () => {
    for (const target of SWITCHABLE_TARGETS) {
      expect(faultsFor(target)).toHaveLength(SWITCH_STATES.length);
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

  it('puts both malformed orders on the mail, which is what the extractor reads', () => {
    const mail = SOURCES.find((node) => node.id === 'mail');
    expect(mail?.mischief.map((m) => m.kind).sort())
      .toEqual(['garbage_payload', 'hallucinate']);
  });
});

describe('sources', () => {
  it('draws both places an order can come from', () => {
    // Specification section 4 has two: the shop page and a free-text order mail.
    // The diagram used to draw only the outgoing half, so orders appeared from
    // nowhere.
    expect(SOURCES.map((node) => node.id)).toEqual(['shop', 'mail']);
  });

  it('gives a source no state, because a source is not something we call', () => {
    for (const node of SOURCES) {
      expect(node.kind).toBe('source');
      expect((SWITCHABLE_TARGETS as readonly string[])).not.toContain(node.id);
    }
  });

  it('draws every system the mediator delivers to', () => {
    expect(SYSTEMS.map((node) => node.id).sort())
      .toEqual([...SWITCHABLE_TARGETS].sort());
  });
});

describe('the two columns', () => {
  it('balances four against three, so neither side towers over the hub', () => {
    // Five on one side and two on the other left the hub shorter than the column
    // beside it, and the outermost lines then began in mid-air next to the hub
    // rather than at it.
    expect(LEFT).toHaveLength(4);
    expect(RIGHT).toHaveLength(3);
  });

  it('draws every node exactly once', () => {
    expect([...LEFT, ...RIGHT]).toHaveLength(NODES.length);
    expect(new Set(NODES.map((node) => node.id)).size).toBe(NODES.length);
  });

  it('keeps the two ways in together at the top of the left column', () => {
    expect(LEFT.slice(0, 2).map((node) => node.id)).toEqual(['shop', 'mail']);
  });

  it('does not make the side a claim about what a node is', () => {
    // A system can stand on either side. What it is lives in kind, not in the
    // column it happens to be drawn in.
    expect(LEFT.some((node) => node.kind === 'system')).toBe(true);
    expect(RIGHT.every((node) => node.kind === 'system')).toBe(true);
  });
});
