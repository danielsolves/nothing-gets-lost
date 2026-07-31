// @vitest-environment jsdom
// ui/test/OrderForm.test.tsx
// The one thing to press, and everything a visitor might want to change about it.
//
// It used to be two things in two places: a loud button at the top that sent a
// fixed order, and a section at the very bottom of the page called "Place your own
// order" with a mandatory email field. A visitor who wanted their own order in the
// picture had to scroll past the whole demo to find the form, and then hand over an
// address before anything would happen at all.
//
// So the form came up to the button, and both the basket and the address became
// optional. Spec 9.7 makes the address mandatory and calls it the strongest proof.
// It still is, and the panel says so; it is simply no longer the toll gate.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { OrderForm } from '../src/OrderForm';

afterEach(cleanup);

const CATALOG = [
  { sku: 'TEAPOT', name: 'Cast iron teapot', cents: 4900 },
  { sku: 'MUG-BLUE', name: 'Blue mug', cents: 1200 },
];

interface Sent { url: string; body: unknown }
let sent: Sent[];

beforeEach(() => {
  sent = [];
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    if (url === '/api/catalog') return json(CATALOG);
    sent.push({ url, body: JSON.parse(String(init?.body ?? 'null')) });
    return json({ eventId: 'evt-1', orderId: 'ord-1' });
  });
});

afterEach(() => { vi.unstubAllGlobals(); });

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200, headers: { 'content-type': 'application/json' },
  });
}

/** Opens the panel and waits for the catalogue it fetches on the way. */
async function openPanel(): Promise<void> {
  fireEvent.click(screen.getByTestId('customise-order'));
  await screen.findByTestId('qty-TEAPOT');
}

describe('OrderForm', () => {
  it('offers one obvious thing to press', () => {
    render(<OrderForm onPlaced={() => {}} />);
    expect(screen.getByTestId('send-order')).toBeInTheDocument();
  });

  it('sends the plain order when nothing has been changed', () => {
    render(<OrderForm onPlaced={() => {}} />);
    fireEvent.click(screen.getByTestId('send-order'));
    expect(sent).toEqual([{ url: '/api/demo-order', body: null }]);
  });

  it('keeps the detail out of the way until it is wanted', () => {
    render(<OrderForm onPlaced={() => {}} />);
    expect(screen.queryByTestId('order-email')).not.toBeInTheDocument();
    expect(screen.getByTestId('customise-order')).toHaveAttribute('aria-expanded', 'false');
  });

  it('says both fields are optional, since nothing else on the page says so', () => {
    // Spec 9.7 makes the address mandatory. It is optional here on the owner's
    // instruction, and a visitor cannot know that unless it is written down.
    render(<OrderForm onPlaced={() => {}} />);
    fireEvent.click(screen.getByTestId('customise-order'));
    expect(screen.getByTestId('order-panel')).toHaveTextContent(/optional/i);
  });

  it('starts from a basket that already has something in it', async () => {
    // An empty basket would mean the button is dead the moment the panel opens,
    // which reads as the demo being broken rather than as a form to fill in.
    render(<OrderForm onPlaced={() => {}} />);
    await openPanel();
    expect(screen.getByTestId('qty-TEAPOT')).toHaveValue(1);
    expect(screen.getByTestId('qty-MUG-BLUE')).toHaveValue(2);
  });

  it('sends the visitor own basket and address once the panel is open', async () => {
    render(<OrderForm onPlaced={() => {}} />);
    await openPanel();
    fireEvent.change(screen.getByTestId('qty-TEAPOT'), { target: { value: '3' } });
    fireEvent.change(screen.getByTestId('order-name'), { target: { value: 'M. Berger' } });
    fireEvent.change(screen.getByTestId('order-email'), { target: { value: 'm@example.com' } });
    fireEvent.click(screen.getByTestId('send-order'));

    expect(sent).toEqual([{
      url: '/api/orders',
      body: {
        customerName: 'M. Berger',
        customerEmail: 'm@example.com',
        items: [{ sku: 'TEAPOT', qty: 3 }, { sku: 'MUG-BLUE', qty: 2 }],
        paymentRoute: 'stripe',
      },
    }]);
  });

  it('sends a chosen basket with no address at all', async () => {
    render(<OrderForm onPlaced={() => {}} />);
    await openPanel();
    fireEvent.change(screen.getByTestId('qty-MUG-BLUE'), { target: { value: '0' } });
    fireEvent.click(screen.getByTestId('send-order'));

    expect(sent).toEqual([{
      url: '/api/orders',
      body: {
        customerName: '', customerEmail: '',
        items: [{ sku: 'TEAPOT', qty: 1 }], paymentRoute: 'stripe',
      },
    }]);
  });

  it('takes the usual route when nobody chose one', async () => {
    render(<OrderForm onPlaced={() => {}} />);
    await openPanel();
    fireEvent.click(screen.getByTestId('send-order'));
    expect((sent[0].body as { paymentRoute: string }).paymentRoute).toBe('stripe');
  });

  it('sends the other route when it is picked', async () => {
    render(<OrderForm onPlaced={() => {}} />);
    await openPanel();
    fireEvent.click(screen.getByTestId('route-paypal'));
    fireEvent.click(screen.getByTestId('send-order'));
    expect((sent[0].body as { paymentRoute: string }).paymentRoute).toBe('paypal');
  });

  it('offers exactly one route at a time, because an order is paid once', async () => {
    // Two payment providers charged for one basket is not a thing that happens in a
    // shop, and this page has nothing to sell but its own truthfulness.
    render(<OrderForm onPlaced={() => {}} />);
    await openPanel();
    expect(screen.getByTestId('route-stripe')).toBeChecked();
    expect(screen.getByTestId('route-paypal')).not.toBeChecked();
    fireEvent.click(screen.getByTestId('route-paypal'));
    expect(screen.getByTestId('route-stripe')).not.toBeChecked();
  });

  it('says what the visitor gives up by leaving the usual route', async () => {
    // Only one of the two ends in a page a stranger can open, and the proof chain is
    // the whole product.
    render(<OrderForm onPlaced={() => {}} />);
    await openPanel();
    expect(screen.getByTestId('route-note')).toHaveTextContent(/receipt/i);
  });

  it('will not send an empty basket, and says what is missing', async () => {
    render(<OrderForm onPlaced={() => {}} />);
    await openPanel();
    fireEvent.change(screen.getByTestId('qty-TEAPOT'), { target: { value: '0' } });
    fireEvent.change(screen.getByTestId('qty-MUG-BLUE'), { target: { value: '0' } });
    expect(screen.getByTestId('send-order')).toBeDisabled();
    expect(screen.getByTestId('order-panel')).toHaveTextContent(/put something in/i);
  });

  it('tells the caller a confirmation mail is coming when an address was given', async () => {
    const placed = vi.fn();
    render(<OrderForm onPlaced={placed} />);
    await openPanel();
    fireEvent.change(screen.getByTestId('order-email'), { target: { value: 'm@example.com' } });
    fireEvent.click(screen.getByTestId('send-order'));
    await waitFor(() => expect(placed).toHaveBeenCalledWith('evt-1', true));
  });

  it('tells the caller there will be no mail when no address was given', async () => {
    // The proof panel shows two foreign timestamps side by side. Without an
    // address the second one is never coming, and a panel waiting forever for it
    // would read as the machine being stuck.
    const placed = vi.fn();
    render(<OrderForm onPlaced={placed} />);
    fireEvent.click(screen.getByTestId('send-order'));
    await waitFor(() => expect(placed).toHaveBeenCalledWith('evt-1', false));
  });

  it('repeats the reason an order was refused, rather than failing quietly', async () => {
    vi.stubGlobal('fetch', async () => new Response(
      JSON.stringify({ message: 'invalid email address' }),
      { status: 400, headers: { 'content-type': 'application/json' } },
    ));
    render(<OrderForm onPlaced={() => {}} />);
    fireEvent.click(screen.getByTestId('send-order'));
    expect(await screen.findByTestId('order-error'))
      .toHaveTextContent(/invalid email address/i);
  });

  it('fetches the catalogue only when somebody asks to see it', () => {
    // Most visitors press the button and never open the panel. Loading eight
    // products for all of them buys nothing.
    render(<OrderForm onPlaced={() => {}} />);
    expect(screen.queryByTestId('qty-TEAPOT')).not.toBeInTheDocument();
  });
});
