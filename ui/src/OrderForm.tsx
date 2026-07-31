// ui/src/OrderForm.tsx
// The one thing to press, and everything a visitor might want to change about it.
//
// This was two things in two places. A loud button at the top sent a fixed order,
// and a section at the very bottom of the page called "Place your own order" asked
// for a basket and a mandatory email address. A visitor who wanted their own order
// in the picture had to scroll past the entire demo to find the form, and then hand
// over an address before anything happened at all.
//
// Both are optional now. Specification section 9.7 makes the address mandatory and
// calls it the strongest proof, which it still is: the arrival timestamp on the
// confirmation mail is stamped by the visitor's own provider and is the second
// witness of the proof chain. It is simply no longer the toll gate. Leave it out and
// there is no mail step, rather than a mail addressed to nobody.
import { useEffect, useState } from 'react';
import {
  DEFAULT_BASKET, DEFAULT_PAYMENT_ROUTE, PAYMENT_ROUTES,
  type CatalogItem, type PaymentRoute, type PlaceOrderResponse,
} from '@ngl/contracts';

/**
 * One order is paid once. Two providers charged for one basket is not a thing that
 * happens in a shop, and this page has nothing to sell but its own truthfulness, so
 * these are a radio group and never a pair of checkboxes.
 */
const ROUTE_LABELS: Record<PaymentRoute, string> = { stripe: 'Stripe', paypal: 'PayPal' };

const STARTING_BASKET: Record<string, number> = Object.fromEntries(
  DEFAULT_BASKET.map((line) => [line.sku, line.qty]),
);

export function OrderForm({
  onPlaced,
}: {
  /** The second argument says whether a confirmation mail is on its way. */
  onPlaced: (eventId: string, expectMail: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [quantities, setQuantities] = useState<Record<string, number>>(STARTING_BASKET);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [route, setRoute] = useState<PaymentRoute>(DEFAULT_PAYMENT_ROUTE);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Most visitors press the button and never open this. Fetching eight products
  // for all of them buys nothing.
  useEffect(() => {
    if (!open || catalog.length > 0) return;
    void fetch('/api/catalog')
      .then((response) => response.json() as Promise<CatalogItem[]>)
      .then(setCatalog)
      .catch(() => setError('The catalogue could not be loaded'));
  }, [open, catalog.length]);

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
              customerName: name, customerEmail: email, items, paymentRoute: route,
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
      <div className="stage-actions">
        <button
          type="button"
          className="stage-cta"
          data-testid="send-order"
          disabled={busy || emptyBasket}
          onClick={() => void send()}
        >
          {busy ? 'Sending' : 'Send an order'}
        </button>

        <button
          type="button"
          className="order-disclosure"
          data-testid="customise-order"
          aria-expanded={open}
          aria-controls="order-panel"
          onClick={() => setOpen((was) => !was)}
        >
          {open ? 'Never mind the detail' : 'Make it your own order'}
        </button>
      </div>

      {open && (
        <div className="order-panel" id="order-panel" data-testid="order-panel">
          <p className="order-why">
            Both are optional. An address is worth giving: the confirmation mail
            lands in your inbox with a timestamp written by your own provider, and
            that is the one thing on this page nobody here can fake.
          </p>

          <ul className="catalog">
            {catalog.map((item) => (
              <li key={item.sku}>
                <span>{item.name}</span>
                <span className="price">{(item.cents / 100).toFixed(2)} EUR</span>
                <input
                  type="number" min={0} max={20}
                  aria-label={`Quantity of ${item.name}`}
                  data-testid={`qty-${item.sku}`}
                  value={quantities[item.sku] ?? 0}
                  onChange={(event) =>
                    setQuantities({ ...quantities, [item.sku]: Number(event.target.value) })}
                />
              </li>
            ))}
          </ul>

          <fieldset className="order-routes">
            <legend>How to pay</legend>
            {PAYMENT_ROUTES.map((option) => (
              <label key={option}>
                <input
                  type="radio"
                  name="payment-route"
                  data-testid={`route-${option}`}
                  checked={route === option}
                  onChange={() => setRoute(option)}
                />
                {ROUTE_LABELS[option]}
              </label>
            ))}
            <p className="order-hint" data-testid="route-note">
              Only Stripe ends in a receipt page stripe.com serves itself, which is
              the one payment proof nobody here can fake. PayPal is just as real and
              leaves no such page.
            </p>
          </fieldset>

          <input placeholder="Your name, if you like" value={name} data-testid="order-name"
                 aria-label="Your name" autoComplete="name"
                 onChange={(event) => setName(event.target.value)} />
          <input placeholder="Your email address, if you like" value={email}
                 data-testid="order-email" aria-label="Your email address"
                 type="email" autoComplete="email"
                 onChange={(event) => setEmail(event.target.value)} />

          {emptyBasket && (
            <p className="order-hint">Put something in the basket to send an order.</p>
          )}

          <p className="fine-print">
            Your address is used for this one order and deleted after 24 hours.
          </p>
        </div>
      )}

      {error && <p className="error" data-testid="order-error">{error}</p>}
    </div>
  );
}
