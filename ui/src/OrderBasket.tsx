// ui/src/OrderBasket.tsx
// The catalogue with a stepper on every row, and the basket the builder opens with.
//
// It came out of OrderForm when the builder gained a second way of composing an
// order. That file owns the panel, the two panes and the request that sends an order,
// and it was at its line ceiling before any of the second way was written. Nothing
// about the list changed in the move.
//
// It draws and it asks. The quantities live in OrderForm because that is where the
// order that goes out is assembled, and the rejected alternative was to keep a copy
// of them here: the basket would then be in one file and the button that sends it in
// another, with nobody owning the thing the two of them could disagree about.
import { type CatalogItem } from '@ngl/contracts';

/** The ceiling the number field used to carry as max, kept now that it is buttons. */
export const MOST = 20;

/**
 * A different basket every time the builder is opened.
 *
 * It used to be the fixed DEFAULT_BASKET, which made every order on the board the
 * same order: the queue filled with rows that were identical apart from their
 * number, and a visitor comparing two of them learned nothing from the comparison.
 * Random baskets also exercise the catalogue mirror against more than two SKUs.
 *
 * Two to four products, one to three of each, never empty. Pure and given its
 * randomness, so the shape can be checked without rolling dice in a test.
 */
export function randomBasket(
  items: readonly CatalogItem[], random: () => number = Math.random,
): Record<string, number> {
  if (items.length === 0) return {};

  const pick = (upto: number) => Math.floor(random() * upto);
  const pool = [...items];
  // Fisher-Yates, so every product has the same chance of being in the basket. A
  // filter on random() < 0.4 would have favoured nothing in particular but could
  // also return an empty basket, and an empty basket disables the send button the
  // moment the panel opens.
  for (let i = pool.length - 1; i > 0; i -= 1) {
    const j = pick(i + 1);
    const here = pool[i];
    const there = pool[j];
    // Both are in range by construction. Narrowed rather than asserted, because an
    // index that came back undefined would mean the arithmetic above is wrong and
    // silently swapping in a hole is the worst way to find that out.
    if (here === undefined || there === undefined) continue;
    pool[i] = there;
    pool[j] = here;
  }

  const howMany = Math.min(pool.length, 2 + pick(3));
  const basket: Record<string, number> = {};
  for (const item of pool.slice(0, howMany)) basket[item.sku] = 1 + pick(3);
  return basket;
}

export function OrderBasket({
  catalog, quantities, onStep,
}: {
  catalog: readonly CatalogItem[];
  quantities: Record<string, number>;
  /** One more or one fewer of this product. The panel decides what that means. */
  onStep: (sku: string, by: number) => void;
}) {
  return (
    <ul className="catalog">
      {catalog.map((item) => {
        const qty = quantities[item.sku] ?? 0;
        return (
          <li key={item.sku}>
            {/* The price under the name rather than beside it. Side by side, the two
                competed for a column that also had to hold the stepper, and the
                longer product names broke over two lines while the prices sat in a
                ragged middle column. */}
            <span className="item">
              <span className="item-name">{item.name}</span>
              <span className="price">{(item.cents / 100).toFixed(2)} EUR</span>
            </span>
            {/* Two buttons and a number, not a number field. The native spinner puts
                two three-pixel arrows in the corner of the box, which is a target
                nobody hits on the first go and nothing at all on a phone. Changing a
                basket by one is the whole interaction here, so it gets a control the
                size of a thumb. */}
            <span className="qty" role="group" aria-label={`Quantity of ${item.name}`}>
              <button
                type="button"
                data-testid={`less-${item.sku}`}
                aria-label={`One fewer ${item.name}`}
                disabled={qty === 0}
                onClick={() => onStep(item.sku, -1)}
              >
                &minus;
              </button>
              <span className="qty-count" data-testid={`qty-${item.sku}`}>{qty}</span>
              <button
                type="button"
                data-testid={`more-${item.sku}`}
                aria-label={`One more ${item.name}`}
                disabled={qty === MOST}
                onClick={() => onStep(item.sku, 1)}
              >
                +
              </button>
            </span>
          </li>
        );
      })}
    </ul>
  );
}
