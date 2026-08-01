// @vitest-environment jsdom
// ui/test/OrderForm.test.tsx
// Making an order, then sending it.
//
// It used to be a section at the very bottom of the page called "Place your own
// order" with a mandatory email field, so a visitor who wanted their own order in
// the picture scrolled past the whole demo to find it and then handed over an
// address before anything would happen at all. The form came up to the button and
// both fields became optional. Spec 9.7 makes the address mandatory and calls it
// the strongest proof. It still is, and the panel says so; it is no longer the
// toll gate.
//
// Then the button sent a fixed basket on one press, with a quiet link beside it
// that opened the detail. Two controls, and the quiet one was the interesting one:
// a visitor pressed the loud button and never saw what they had just sent. So it is
// two steps now. "Create order" opens the builder, the basket is on the left, who
// it is for on the right, and the send button is inside it. Nothing leaves without
// having been on screen first.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { OrderForm, randomBasket } from '../src/OrderForm';

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

/** Opens the builder and waits for the catalogue it fetches on the way. */
async function openPanel(): Promise<void> {
  fireEvent.click(screen.getByTestId('create-order'));
  await screen.findByTestId('qty-TEAPOT');
}

describe('OrderForm', () => {
  it('offers one obvious thing to press', () => {
    render(<OrderForm onPlaced={() => {}} />);
    expect(screen.getByTestId('create-order')).toBeInTheDocument();
  });

  it('sends nothing on the first press, because nothing has been shown yet', () => {
    // The whole reason for the second step: an order that goes out before the
    // visitor has seen it teaches them nothing about what went out.
    render(<OrderForm onPlaced={() => {}} />);
    fireEvent.click(screen.getByTestId('create-order'));
    expect(sent).toEqual([]);
  });

  it('keeps the detail out of the way until it is wanted', () => {
    render(<OrderForm onPlaced={() => {}} />);
    expect(screen.queryByTestId('order-email')).not.toBeInTheDocument();
    expect(screen.getByTestId('create-order')).toHaveAttribute('aria-expanded', 'false');
  });

  it('puts the send button where the order is, not where the page begins', async () => {
    // It is the control that puts something into the machine, so it lives with the
    // thing it is about to send and it is what the wire into the mediator hangs on.
    render(<OrderForm onPlaced={() => {}} />);
    await openPanel();
    expect(screen.getByTestId('order-panel'))
      .toContainElement(screen.getByTestId('send-order'));
  });

  it('marks whichever control is live as the one the wire hangs on', async () => {
    // Closed, that is the create button. Open, it is the send button. Exactly one
    // of the two is on screen, so the drawing always has something to point at.
    render(<OrderForm onPlaced={() => {}} />);
    expect(screen.getByTestId('create-order')).toHaveAttribute('data-wire-anchor');
    await openPanel();
    expect(screen.getByTestId('send-order')).toHaveAttribute('data-wire-anchor');
    expect(screen.queryByTestId('create-order')).not.toBeInTheDocument();
  });

  it('can be closed again without sending anything', async () => {
    render(<OrderForm onPlaced={() => {}} />);
    await openPanel();
    fireEvent.click(screen.getByTestId('close-order'));
    expect(screen.getByTestId('create-order')).toBeInTheDocument();
    expect(sent).toEqual([]);
  });

  it('says both fields are optional, since nothing else on the page says so', async () => {
    // Spec 9.7 makes the address mandatory. It is optional here on the owner's
    // instruction, and a visitor cannot know that unless it is written down. It is
    // written on the fields themselves rather than in a sentence above them, so it
    // is read by somebody about to type rather than by somebody reading prose.
    render(<OrderForm onPlaced={() => {}} />);
    await openPanel();
    for (const field of ['order-name', 'order-email']) {
      expect(screen.getByTestId(field))
        .toHaveAttribute('placeholder', expect.stringContaining('(optional)'));
    }
  });

  it('starts from a basket that already has something in it', async () => {
    // An empty basket would mean the button is dead the moment the panel opens,
    // which reads as the demo being broken rather than as a form to fill in.
    render(<OrderForm onPlaced={() => {}} />);
    await openPanel();
    const chosen = CATALOG
      .map((item) => Number(screen.getByTestId(`qty-${item.sku}`).textContent))
      .filter((qty) => qty > 0);
    expect(chosen.length).toBeGreaterThan(0);
  });

  it('sends the visitor own basket and address', async () => {
    render(<OrderForm onPlaced={() => {}} />);
    await openPanel();
    // Whatever the basket started as, plus one teapot: the assertion is about what
    // is sent matching what is on screen, not about a fixed basket.
    fireEvent.click(screen.getByTestId('more-TEAPOT'));
    fireEvent.change(screen.getByTestId('order-name'), { target: { value: 'M. Berger' } });
    fireEvent.change(screen.getByTestId('order-email'), { target: { value: 'm@example.com' } });
    fireEvent.click(screen.getByTestId('send-order'));

    const onScreen = CATALOG
      .map((item) => ({ sku: item.sku, qty: Number(screen.getByTestId(`qty-${item.sku}`).textContent) }))
      .filter((line) => line.qty > 0);
    // Compared by sku rather than in order: the basket is built in a random order,
    // and which line comes first is not something the server or anybody else cares
    // about.
    const bySku = (lines: Array<{ sku: string }>) =>
      [...lines].sort((a, b) => a.sku.localeCompare(b.sku));
    expect(sent).toHaveLength(1);
    expect(sent[0].url).toBe('/api/orders');
    const body = sent[0].body as {
      customerName: string; customerEmail: string; items: Array<{ sku: string; qty: number }>;
    };
    expect(body.customerName).toBe('M. Berger');
    expect(body.customerEmail).toBe('m@example.com');
    expect(bySku(body.items)).toEqual(bySku(onScreen));
  });

  it('sends no address at all when none was given', async () => {
    render(<OrderForm onPlaced={() => {}} />);
    await openPanel();
    fireEvent.click(screen.getByTestId('send-order'));
    expect(sent[0].body).toMatchObject({ customerName: '', customerEmail: '' });
  });

  it('names no route, and lets the server settle it', async () => {
    // There is one provider, so a field naming it would be the browser asserting
    // something the server already knows. The route is decided in one place.
    render(<OrderForm onPlaced={() => {}} />);
    await openPanel();
    fireEvent.click(screen.getByTestId('send-order'));
    expect(sent[0].body).not.toHaveProperty('paymentRoute');
  });

  it('asks nothing about how to pay, because there is nothing to ask', async () => {
    // A radio group with one option is a control that puts a question to the
    // visitor and accepts one answer. It went with the second provider.
    render(<OrderForm onPlaced={() => {}} />);
    await openPanel();
    expect(screen.queryByTestId('route-stripe')).not.toBeInTheDocument();
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
  });

  it('explains nothing about the payment here, and lets the receipt do it', async () => {
    // A paragraph about the Stripe receipt sat under the address fields, ahead of a
    // payment that had not happened yet. The receipt turns up on the delivered step
    // afterwards as a link to stripe.com, which makes the point without being told.
    render(<OrderForm onPlaced={() => {}} />);
    await openPanel();
    expect(screen.queryByTestId('route-note')).not.toBeInTheDocument();
  });

  it('will not send an empty basket, and says what is missing', async () => {
    render(<OrderForm onPlaced={() => {}} />);
    await openPanel();
    for (const item of CATALOG) {
      for (let i = 0; i < 3; i += 1) fireEvent.click(screen.getByTestId(`less-${item.sku}`));
    }
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
    await openPanel();
    fireEvent.click(screen.getByTestId('send-order'));
    await waitFor(() => expect(placed).toHaveBeenCalledWith('evt-1', false));
  });

  it('repeats the reason an order was refused, rather than failing quietly', async () => {
    render(<OrderForm onPlaced={() => {}} />);
    await openPanel();
    vi.stubGlobal('fetch', async () => new Response(
      JSON.stringify({ message: 'invalid email address' }),
      { status: 400, headers: { 'content-type': 'application/json' } },
    ));
    fireEvent.click(screen.getByTestId('send-order'));
    expect(await screen.findByTestId('order-error'))
      .toHaveTextContent(/invalid email address/i);
  });

  it('changes a quantity by one on each press, in both directions', async () => {
    render(<OrderForm onPlaced={() => {}} />);
    await openPanel();
    const was = Number(screen.getByTestId('qty-TEAPOT').textContent);
    fireEvent.click(screen.getByTestId('more-TEAPOT'));
    expect(screen.getByTestId('qty-TEAPOT')).toHaveTextContent(String(was + 1));
    fireEvent.click(screen.getByTestId('less-TEAPOT'));
    expect(screen.getByTestId('qty-TEAPOT')).toHaveTextContent(String(was));
  });

  it('will not go below nothing', async () => {
    // The old number field accepted a typed -3 and sent it. Buttons that stop at
    // the floor cannot.
    render(<OrderForm onPlaced={() => {}} />);
    await openPanel();
    for (let i = 0; i < 4; i += 1) fireEvent.click(screen.getByTestId('less-TEAPOT'));
    expect(screen.getByTestId('qty-TEAPOT')).toHaveTextContent('0');
    expect(screen.getByTestId('less-TEAPOT')).toBeDisabled();
  });

  it('never opens on an empty basket, whatever the dice say', () => {
    // An empty basket disables the send button the moment the panel opens, which
    // reads as the demo being broken rather than as a form to fill in.
    for (const roll of [0, 0.999, 0.5, 0.25]) {
      const basket = randomBasket(CATALOG, () => roll);
      expect(Object.values(basket).filter((qty) => qty > 0).length).toBeGreaterThan(0);
    }
  });

  it('never puts more in the basket than the catalogue holds', () => {
    expect(Object.keys(randomBasket(CATALOG, () => 0.999)).length)
      .toBeLessThanOrEqual(CATALOG.length);
    expect(randomBasket([], () => 0.5)).toEqual({});
  });

  it('names each button after the thing it changes', async () => {
    // Two dozen buttons all called "+" is a screen reader reading out a row of
    // plus signs. The label carries the product.
    render(<OrderForm onPlaced={() => {}} />);
    await openPanel();
    expect(screen.getByLabelText('One more Cast iron teapot')).toBeInTheDocument();
    expect(screen.getByLabelText('One fewer Blue mug')).toBeInTheDocument();
  });

  it('fetches the catalogue only when somebody asks to see it', () => {
    // A visitor who never presses Create order never needs eight products.
    render(<OrderForm onPlaced={() => {}} />);
    expect(screen.queryByTestId('qty-TEAPOT')).not.toBeInTheDocument();
  });
});
