// services/api/test/demo-order.test.ts
// Who the demo button says bought something, and what they bought.
//
// It used to be one name and one basket, so a hundred presses left the CRM holding a
// single contact patched a hundred times and one order repeated. That is a true
// record of what happened and a poor picture of what the demo is for, which is a
// shop with customers in it.
//
// Every function here takes its randomness rather than reaching for it, so a test
// can say which name it wants and the file stays checkable without a browser.
import { describe, it, expect } from 'vitest';
import { demoBasket, demoBuyer, DEMO_DOMAIN } from '../src/demo-order';

/** Always the first of anything offered. */
const first = () => 0;

/** Walks the options in turn, so a picker asked twice gives two different answers. */
function counting(): (upTo: number) => number {
  let n = 0;
  return (upTo) => n++ % upTo;
}

const CATALOGUE = ['COASTER-OAK', 'MUG-BLUE', 'PLATE-LARGE', 'TEAPOT'];

describe('demoBuyer', () => {
  it('names a person rather than the demo', () => {
    const buyer = demoBuyer(first);
    expect(buyer.name).toMatch(/^\S+ \S+$/);
    expect(buyer.name).not.toMatch(/demo/i);
  });

  it('books them on our own domain, so no invented address can be reached', () => {
    // The address is an identity, never a recipient: nobody asked for a mail, so
    // rule 6.7 queues none. It still has to be an address HubSpot will accept, and
    // it must not be one that could belong to a real person.
    expect(demoBuyer(first).email).toMatch(new RegExp(`@${DEMO_DOMAIN}$`));
  });

  it('derives the address from the name, so the same buyer is the same contact', () => {
    // Two orders from one person are one contact and two deals. If the address were
    // random per order, every press would make a new contact and the upsert this
    // demo is built to show would never once be exercised.
    const buyer = demoBuyer(first);
    const again = demoBuyer(first);
    expect(again.email).toBe(buyer.email);
    expect(buyer.email).toBe(`${buyer.name.toLowerCase().replace(' ', '.')}@${DEMO_DOMAIN}`);
  });

  it('offers more than one buyer', () => {
    const pick = counting();
    const names = new Set([demoBuyer(pick).name, demoBuyer(pick).name, demoBuyer(pick).name]);
    expect(names.size).toBeGreaterThan(1);
  });
});

describe('demoBasket', () => {
  it('puts two or three different articles in the basket', () => {
    const basket = demoBasket(CATALOGUE, counting());
    expect(basket.length).toBeGreaterThanOrEqual(2);
    expect(basket.length).toBeLessThanOrEqual(3);
    expect(new Set(basket.map((line) => line.sku)).size).toBe(basket.length);
  });

  it('orders at least one of anything it puts in', () => {
    const basket = demoBasket(CATALOGUE, counting());
    for (const line of basket) expect(line.qty).toBeGreaterThanOrEqual(1);
  });

  it('takes only skus the catalogue actually has', () => {
    // Priced from the products table, so an invented sku is refused at intake and
    // the button would answer with an error rather than an order.
    const basket = demoBasket(CATALOGUE, counting());
    for (const line of basket) expect(CATALOGUE).toContain(line.sku);
  });

  it('copes with a catalogue smaller than the basket it wants', () => {
    const basket = demoBasket(['TEAPOT'], counting());
    expect(basket).toHaveLength(1);
    expect(basket[0].sku).toBe('TEAPOT');
  });
});
