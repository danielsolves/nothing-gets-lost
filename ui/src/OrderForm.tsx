// ui/src/OrderForm.tsx
// The one thing to press, and everything a visitor might want to change about it.
//
// This was two things in two places. A loud button at the top sent a fixed order,
// and a section at the very bottom of the page called "Place your own order" asked
// for a basket and a mandatory email address. A visitor who wanted their own order
// in the picture had to scroll past the entire demo to find the form, and then hand
// over an address before anything happened at all.
//
// The builder unfolds rather than appearing, which is why it is in the markup whether
// it is open or not: a block added to the page on the click has no height to grow
// from. It uses the queue card's fold, class and all, so the page has one way of
// opening something rather than two that drift apart.
//
// Both are optional now. Specification section 9.7 makes the address mandatory and
// calls it the strongest proof, which it still is: the arrival timestamp on the
// confirmation mail is stamped by the visitor's own provider and is the second
// witness of the proof chain. It is simply no longer the toll gate. Leave it out and
// there is no mail step, rather than a mail addressed to nobody.
import { useEffect, useState } from 'react';
import { type CatalogItem, type PlaceOrderResponse } from '@ngl/contracts';

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

/** The ceiling the number field used to carry as max, kept now that it is buttons. */
const MOST = 20;

export function OrderForm({
  onPlaced,
}: {
  /** The second argument says whether a confirmation mail is on its way. */
  onPlaced: (eventId: string, expectMail: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Most visitors press the button and never open this. Fetching eight products
  // for all of them buys nothing.
  useEffect(() => {
    if (!open || catalog.length > 0) return;
    void fetch('/api/catalog')
      .then((response) => response.json() as Promise<CatalogItem[]>)
      .then((items) => {
        setCatalog(items);
        setQuantities(randomBasket(items));
      })
      .catch(() => setError('The catalogue could not be loaded'));
  }, [open, catalog.length]);

  // A fresh basket every time the builder is opened, not only the first time. The
  // catalogue is kept, because it does not change and refetching it would be eight
  // products the visitor has already been shown.
  useEffect(() => {
    if (open && catalog.length > 0) setQuantities(randomBasket(catalog));
  }, [open]);

  const step = (sku: string, by: number) => {
    setQuantities((was) => {
      const next = Math.min(MOST, Math.max(0, (was[sku] ?? 0) + by));
      return { ...was, [sku]: next };
    });
  };

  const items = Object.entries(quantities)
    .filter(([, qty]) => qty > 0)
    .map(([sku, qty]) => ({ sku, qty }));

  const emptyBasket = open && items.length === 0;

  async function send(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      // Untouched, the order goes through the endpoint built for exactly that: no
      // basket to send, no address, nothing for a stranger to fill in first.
      const response = open
        ? await fetch('/api/orders', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              customerName: name, customerEmail: email, items,
            }),
          })
        : await fetch('/api/demo-order', { method: 'POST' });

      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { message?: string };
        throw new Error(body.message ?? `That did not work (${response.status}).`);
      }

      const placed = (await response.json()) as PlaceOrderResponse;
      onPlaced(placed.eventId, open && email.trim() !== '');
    } catch (problem) {
      setError((problem as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="order-form">
      {/* Closed, this is the way in and carries the wire. Open, the wire moves to
          the send button inside, because that is then the thing that puts an order
          into the machine. Whichever of the two is live wears the anchor.

          Folded away rather than taken off the page, for the same reason the panel
          is: closing has to run opening backwards, and a button that is put back the
          instant the click lands is on screen while the panel is still collapsing
          under it. Its row shuts at once when the panel opens and reopens only once
          the panel has finished shutting, on the panel's own timing. */}
      <div className="order-way" data-testid="order-way" data-open={open ? 'true' : 'false'}>
        <button
          type="button"
          className="stage-cta"
          data-wire-anchor={open ? undefined : ''}
          data-testid="create-order"
          aria-expanded={open}
          aria-controls="order-panel"
          onClick={() => setOpen(true)}
        >
          Create order
        </button>
      </div>

      {/* Always rendered, folded shut by a grid row of 0fr, which is the same trick
          and the same class as the queue cards: a block that is added to the page
          when it opens has no height to grow from, so it can only appear. Shut, the
          sheet also hides it, which is what keeps its buttons and fields out of the
          tab order; a control clipped to no height is still tabbable. */}
      <div
        className="order-fold"
        data-testid="order-fold"
        data-open={open ? 'true' : 'false'}
        aria-hidden={open ? undefined : 'true'}
      >
        <div className="order-builder" id="order-panel" data-testid="order-panel">
          {/* Closing is not a decision about the order, so it does not stand next to
              the button that sends one. It sits in the corner, where leaving a panel
              lives everywhere else. */}
          <button
            type="button"
            className="order-close"
            data-testid="close-order"
            aria-label="Close the order detail"
            onClick={() => setOpen(false)}
          >
            &times;
          </button>

          {/* The basket on the left, who it is for on the right. Two columns rather
              than one long form: what is being sent is the interesting half, and
              stacked under a paragraph it was the half a visitor scrolled past. */}
          <div className="order-basket">
            <p className="order-ph">What is in it</p>
            <ul className="catalog">
              {catalog.map((item) => {
                const qty = quantities[item.sku] ?? 0;
                return (
                  <li key={item.sku}>
                    {/* The price under the name rather than beside it. Side by side,
                        the two competed for a column that also had to hold the
                        stepper, and the longer product names broke over two lines
                        while the prices sat in a ragged middle column. */}
                    <span className="item">
                      <span className="item-name">{item.name}</span>
                      <span className="price">{(item.cents / 100).toFixed(2)} EUR</span>
                    </span>
                    {/* Two buttons and a number, not a number field. The native
                        spinner puts two three-pixel arrows in the corner of the box,
                        which is a target nobody hits on the first go and nothing at
                        all on a phone. Changing a basket by one is the whole
                        interaction here, so it gets a control the size of a thumb. */}
                    <span className="qty" role="group" aria-label={`Quantity of ${item.name}`}>
                      <button
                        type="button"
                        data-testid={`less-${item.sku}`}
                        aria-label={`One fewer ${item.name}`}
                        disabled={qty === 0}
                        onClick={() => step(item.sku, -1)}
                      >
                        &minus;
                      </button>
                      <span className="qty-count" data-testid={`qty-${item.sku}`}>{qty}</span>
                      <button
                        type="button"
                        data-testid={`more-${item.sku}`}
                        aria-label={`One more ${item.name}`}
                        disabled={qty === MOST}
                        onClick={() => step(item.sku, 1)}
                      >
                        +
                      </button>
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>

          <div className="order-who">
            <p className="order-ph">Who it is for</p>
            <p className="order-why">
              You can enter your email to receive a real confirmation and verify the
              email integration.
            </p>

            <input placeholder="Your name (optional)" value={name} data-testid="order-name"
                   aria-label="Your name" autoComplete="name"
                   onChange={(event) => setName(event.target.value)} />
            <input placeholder="Your email address (optional)" value={email}
                   data-testid="order-email" aria-label="Your email address"
                   type="email" autoComplete="email"
                   onChange={(event) => setEmail(event.target.value)} />

            {/* Under the fields rather than at the foot of the panel. It is about
                what happens to what you just typed, so it belongs where you typed
                it, and it reads in the same voice as the line above them. */}
            <p className="order-why">
              Info: Your address is used for this one order and deleted after 24 hours.
            </p>

          </div>

          {/* The send button ends the panel, bottom left. It is what the wire into
              the integration hub hangs on, and the hub is on the left, so the order
              leaves the drawing on the side it is going to. */}
          <div className="order-foot">
            {/* The anchor only while the panel is open. The button is in the markup
                the whole time so the panel has something to unfold, and a wire
                running to a control folded out of sight would point at nothing. */}
            <button
              type="button"
              className="stage-cta"
              data-wire-anchor={open ? '' : undefined}
              data-testid="send-order"
              disabled={busy || emptyBasket}
              onClick={() => void send()}
            >
              {busy ? 'Sending' : 'Send order'}
            </button>

            <div className="order-foot-said">
              {emptyBasket && (
                <p className="order-hint">Put something in the basket to send an order.</p>
              )}
            </div>
          </div>
        </div>
      </div>

      {error && <p className="error" data-testid="order-error">{error}</p>}
    </div>
  );
}
