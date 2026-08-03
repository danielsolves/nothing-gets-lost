// ui/test/mail-order-answer.test.ts
// What the panel will and will not draw.
//
// The cases worth having are the near misses rather than the nonsense: a refusal
// naming a check that does not exist, a proposal whose lines carry no price. Those
// are what a drifting server actually sends, and both would otherwise be drawn as a
// confident empty panel on a page whose entire argument is that it can be checked.
import { describe, it, expect } from 'vitest';
import { isExtractOrderResponse, isPlaceOrderResponse } from '../src/mail-order-answer';

const PROPOSAL = {
  customerName: 'M. Berger',
  customerEmail: 'm@example.com',
  notes: null,
  lines: [{ sku: 'MUG-BLUE', name: 'Blue mug', qty: 3, cents: 3600 }],
  totalCents: 3600,
};

describe('isExtractOrderResponse', () => {
  it('accepts a proposal', () => {
    expect(isExtractOrderResponse({
      ok: true, mode: 'recorded', raw: { anything: true }, proposal: PROPOSAL,
    })).toBe(true);
  });

  it('accepts a refusal from either check', () => {
    for (const stoppedBy of ['schema', 'catalog']) {
      expect(isExtractOrderResponse({
        ok: false, mode: 'live', raw: {}, stoppedBy, detail: 'unknown sku: MUG-AZURE',
      })).toBe(true);
    }
  });

  it('takes any raw answer at all, since that is the field allowed to be anything', () => {
    expect(isExtractOrderResponse({
      ok: false, mode: 'recorded', raw: 'Sure! Here is your order:',
      stoppedBy: 'schema', detail: 'model did not return json',
    })).toBe(true);
  });

  it('refuses a mode that is neither live nor recorded', () => {
    // The one field that must never be wrong: it is what tells a reader whether a
    // model was called at all.
    expect(isExtractOrderResponse({
      ok: true, mode: 'probably', raw: {}, proposal: PROPOSAL,
    })).toBe(false);
    expect(isExtractOrderResponse({ ok: true, raw: {}, proposal: PROPOSAL })).toBe(false);
  });

  it('refuses a refusal that names a check nobody ran', () => {
    expect(isExtractOrderResponse({
      ok: false, mode: 'live', raw: {}, stoppedBy: 'vibes', detail: 'no',
    })).toBe(false);
  });

  it('refuses a proposal with a line that has no price on it', () => {
    expect(isExtractOrderResponse({
      ok: true, mode: 'live', raw: {},
      proposal: { ...PROPOSAL, lines: [{ sku: 'MUG-BLUE', name: 'Blue mug', qty: 3 }] },
    })).toBe(false);
  });

  it('refuses a proposal with no basket key at all, and a bare success', () => {
    expect(isExtractOrderResponse({ ok: true, mode: 'live', raw: {} })).toBe(false);
    expect(isExtractOrderResponse({ ok: 'yes', mode: 'live', raw: {} })).toBe(false);
  });

  it('refuses what is not an object', () => {
    for (const value of [null, undefined, 'ok', 42, []]) {
      expect(isExtractOrderResponse(value)).toBe(false);
    }
  });
});

describe('isPlaceOrderResponse', () => {
  it('accepts the two ids an order comes back with', () => {
    expect(isPlaceOrderResponse({ eventId: 'evt-1', orderId: 'ord-1' })).toBe(true);
  });

  it('refuses an answer missing either of them', () => {
    // The event id is what the page points the queue at. Half an answer would leave
    // the panel saying an order was placed and nothing to show for it.
    expect(isPlaceOrderResponse({ eventId: 'evt-1' })).toBe(false);
    expect(isPlaceOrderResponse({ orderId: 'ord-1' })).toBe(false);
    expect(isPlaceOrderResponse(null)).toBe(false);
  });
});
