// services/api/src/demo-order.ts
// The buyer and the basket the page's own button invents.
//
// It sent one fixed name and one fixed basket, which is a true record of what
// happened and a poor picture of what the demo is about. A CRM holding one contact
// patched a hundred times shows the upsert working and shows nothing else; a CRM
// holding a dozen buyers with different baskets looks like the thing being
// demonstrated, and the upsert still shows itself every time a name comes round
// again.
//
// Randomness is passed in rather than reached for, the way `now` is passed to
// activity.ts. It keeps these two functions checkable and it keeps the decision
// about where randomness comes from in one place.
export type Chance = (upTo: number) => number;

/**
 * The demo's own domain. Every invented buyer is booked here, and nowhere else: an
 * address on a domain we do not hold could belong to a real person, and this one is
 * only ever an identity. Nobody asked for a mail, so rule 6.7 queues none, and the
 * address is never written to.
 */
export const DEMO_DOMAIN = 'ngl.danielsolves.ai';

const FIRST_NAMES = [
  'Mira', 'Jonas', 'Elif', 'Tomas', 'Anke', 'Rafael',
  'Nadia', 'Lukas', 'Sofia', 'Henrik', 'Yara', 'Milan',
];

const LAST_NAMES = [
  'Hoffmann', 'Vermeer', 'Kowalski', 'Bergstrom', 'Okafor', 'Lindqvist',
  'Moreau', 'Novak', 'Ferrara', 'Haugen',
];

export interface DemoBuyer {
  name: string;
  /** An identity, not a recipient. See DEMO_DOMAIN. */
  email: string;
}

export function demoBuyer(chance: Chance): DemoBuyer {
  const first = FIRST_NAMES[chance(FIRST_NAMES.length)] ?? FIRST_NAMES[0];
  const last = LAST_NAMES[chance(LAST_NAMES.length)] ?? LAST_NAMES[0];
  const name = `${first} ${last}`;
  // Derived, never rolled separately. The email is the natural key HubSpot upserts
  // on, so the same person coming round again has to arrive at the same address or
  // every order would make a new contact and the retry story would never be shown.
  return { name, email: `${name.toLowerCase().replace(' ', '.')}@${DEMO_DOMAIN}` };
}

/** How many different articles a made-up order holds. */
const BASKET_SIZES = [2, 3];
const MOST_OF_ONE_ARTICLE = 3;

export function demoBasket(
  skus: readonly string[], chance: Chance,
): Array<{ sku: string; qty: number }> {
  const wanted = Math.min(
    BASKET_SIZES[chance(BASKET_SIZES.length)] ?? 2,
    skus.length,
  );
  // Drawn without replacement. Two lines of the same article would be one basket
  // saying two different things about how many of it were bought.
  const left = [...skus];
  const basket: Array<{ sku: string; qty: number }> = [];
  while (basket.length < wanted && left.length > 0) {
    const [sku] = left.splice(chance(left.length), 1);
    if (sku === undefined) break;
    basket.push({ sku, qty: chance(MOST_OF_ONE_ARTICLE) + 1 });
  }
  return basket;
}
