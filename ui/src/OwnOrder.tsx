// ui/src/OwnOrder.tsx
// The visitor composes their own order. The email field is mandatory on purpose:
// the confirmation mail landing in their own inbox is the one proof we cannot
// fake, and its Received header is the second witness of the proof chain.
import { useEffect, useState } from 'react';
import type { CatalogItem, PlaceOrderResponse } from '@ngl/contracts';

export function OwnOrder({ onPlaced }: { onPlaced: (eventId: string) => void }) {
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void fetch('/api/catalog')
      .then((response) => response.json() as Promise<CatalogItem[]>)
      .then(setCatalog)
      .catch(() => setError('The catalogue could not be loaded'));
  }, []);

  const items = Object.entries(quantities)
    .filter(([, qty]) => qty > 0)
    .map(([sku, qty]) => ({ sku, qty }));

  async function submit(): Promise<void> {
    setBusy(true);
    setError(null);
    const response = await fetch('/api/orders', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ customerName: name, customerEmail: email, items }),
    });
    setBusy(false);
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as { message?: string };
      setError(body.message ?? 'Order rejected');
      return;
    }
    const placed = (await response.json()) as PlaceOrderResponse;
    onPlaced(placed.eventId);
  }

  return (
    <section className="own-order">
      <h2>Place your own order</h2>
      <p>Then check every claim on this page yourself.</p>

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

      <input placeholder="Your name" value={name} data-testid="order-name"
             aria-label="Your name"
             onChange={(event) => setName(event.target.value)} />
      <input placeholder="Your email address" value={email} data-testid="order-email"
             aria-label="Your email address" type="email"
             onChange={(event) => setEmail(event.target.value)} />

      <button type="button" data-testid="place-order"
              disabled={busy || items.length === 0 || !email}
              onClick={() => void submit()}>
        Place order
      </button>

      {error && <p className="error" data-testid="order-error">{error}</p>}
      <p className="fine-print">
        Your address is used for this one order and deleted after 24 hours.
      </p>
    </section>
  );
}
