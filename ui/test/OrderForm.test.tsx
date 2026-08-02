// @vitest-environment jsdom
// ui/test/OrderForm.test.tsx
// Making an order, then sending it.
//
// It used to be a section at the very bottom of the page called "Place your own
// order" with a mandatory email field, so a visitor who wanted their own order in
// the picture scrolled past the whole demo to find it and then handed over an
// address before anything would happen. Spec 9.7 makes the address mandatory and
// calls it the strongest proof. It still is, and the panel says so; it is no longer
// the toll gate.
//
// Then the button sent a fixed basket on one press, with a quiet link beside it that
// opened the detail, and the quiet one was the interesting one: a visitor pressed the
// loud button and never saw what went out. It is two steps now, send button last.
//
// The builder holds two ways of composing the same order since, on two tabs: pick the
// articles, or write the mail a customer would send and let a model read it. What is
// asserted about that here is the seam, not the mail path itself, which has its own
// file: one fold and not two, and which control the wire hangs on in each of the three
// states the box can be in.
//
// Two assertions about the product list left this file when the list became a
// component of its own. They are in OrderBasket.test.tsx, unchanged.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { ExtractOrderResponse } from '@ngl/contracts';
import { OrderForm } from '../src/OrderForm';

afterEach(cleanup);

const CATALOG = [
  { sku: 'TEAPOT', name: 'Cast iron teapot', cents: 4900 },
  { sku: 'MUG-BLUE', name: 'Blue mug', cents: 1200 },
];

const READING: ExtractOrderResponse = {
  ok: true,
  mode: 'recorded',
  raw: { items: [{ sku: 'MUG-BLUE', qty: 3 }] },
  proposal: {
    customerName: 'M. Berger',
    customerEmail: 'm@example.com',
    notes: null,
    lines: [{ sku: 'MUG-BLUE', name: 'Blue mug', qty: 3, cents: 3600 }],
    totalCents: 3600,
  },
};

interface Sent { url: string; body: unknown }
let sent: Sent[];

beforeEach(() => {
  sent = [];
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    if (url === '/api/catalog') return json(CATALOG);
    sent.push({ url, body: JSON.parse(String(init?.body ?? 'null')) });
    if (url === '/api/extract-order') return json(READING);
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

  it('unfolds and folds back, which is why both halves are always there', () => {
    // Neither half is added on the click: a block added to the page then has no
    // height to grow from and can only appear. Both stay in the markup and each has
    // a row that folds, which is also what lets closing run opening backwards, the
    // button's row waiting out the fold rather than coming back under a live panel.
    render(<OrderForm onPlaced={() => {}} />);
    const fold = screen.getByTestId('order-fold');
    const way = screen.getByTestId('order-way');
    expect(screen.getByTestId('order-panel')).toBeInTheDocument();
    expect(fold).toHaveAttribute('data-open', 'false');
    expect(fold).toHaveAttribute('aria-hidden', 'true');
    expect(way).toHaveAttribute('data-open', 'false');
    expect(screen.getByTestId('create-order')).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(screen.getByTestId('create-order'));
    expect(fold).toHaveAttribute('data-open', 'true');
    expect(fold).not.toHaveAttribute('aria-hidden');
    expect(way).toHaveAttribute('data-open', 'true');
    expect(screen.getByTestId('create-order')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('close-order'));
    expect(fold).toHaveAttribute('data-open', 'false');
    expect(way).toHaveAttribute('data-open', 'false');
  });

  it('puts the send button where the order is, not where the page begins', async () => {
    // It is the control that puts something into the machine, so it lives with the
    // thing it is about to send and it is what the wire into the hub hangs on.
    render(<OrderForm onPlaced={() => {}} />);
    await openPanel();
    expect(screen.getByTestId('order-panel'))
      .toContainElement(screen.getByTestId('send-order'));
  });

  it('marks whichever control is live as the one the wire hangs on', async () => {
    // Closed, that is the create button. Open, it is the send button. Both stay in
    // the markup so each can fold rather than appear, so whichever is folded away
    // gives the anchor up: a wire to a control nobody can see points at nothing.
    render(<OrderForm onPlaced={() => {}} />);
    expect(screen.getByTestId('create-order')).toHaveAttribute('data-wire-anchor');
    expect(screen.getByTestId('send-order')).not.toHaveAttribute('data-wire-anchor');
    await openPanel();
    expect(screen.getByTestId('send-order')).toHaveAttribute('data-wire-anchor');
    expect(screen.getByTestId('create-order')).not.toHaveAttribute('data-wire-anchor');
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

  it('fetches the catalogue only when somebody asks to see it', () => {
    // The folded panel stays empty until then: a visitor who never presses Create
    // order never needs eight products.
    render(<OrderForm onPlaced={() => {}} />);
    expect(screen.queryByTestId('qty-TEAPOT')).not.toBeInTheDocument();
  });

  it('offers both ways of composing the same order, in the one box', async () => {
    // The mail path used to be a section of its own below the machine, so the two
    // ways of making an order were a scroll apart and the choice between them was
    // not on screen anywhere.
    render(<OrderForm onPlaced={() => {}} />);
    await openPanel();
    const panel = screen.getByTestId('order-panel');
    expect(panel).toContainElement(screen.getByTestId('order-tab-articles'));
    expect(panel).toContainElement(screen.getByTestId('order-tab-mail'));
    expect(panel).toContainElement(screen.getByTestId('mail-text'));
  });

  it('opens on the articles, and keeps the other pane out of the way', async () => {
    render(<OrderForm onPlaced={() => {}} />);
    await openPanel();
    expect(screen.getByTestId('order-tab-articles')).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('order-pane-mail')).toHaveAttribute('hidden');

    fireEvent.click(screen.getByTestId('order-tab-mail'));
    expect(screen.getByTestId('order-pane-articles')).toHaveAttribute('hidden');
    expect(screen.getByTestId('order-pane-mail')).not.toHaveAttribute('hidden');
  });

  it('unfolds once for both paths, rather than folding a fold', async () => {
    // The builder borrows the queue card's fold so the page has one way of opening
    // something. A pane inside it that opened again would be two.
    render(<OrderForm onPlaced={() => {}} />);
    await openPanel();
    fireEvent.click(screen.getByTestId('order-tab-mail'));
    expect(screen.getAllByTestId('order-fold')).toHaveLength(1);
    expect(screen.getByTestId('mail-text')).toBeInTheDocument();
  });

  it('holds a reading while the visitor looks at the articles and comes back', async () => {
    // Both panes stay mounted. A pane thrown away when its tab loses focus throws a
    // reading away with it, and the visitor pressed Read for that reading.
    render(<OrderForm onPlaced={() => {}} />);
    await openPanel();
    fireEvent.click(screen.getByTestId('order-tab-mail'));
    fireEvent.click(screen.getByTestId('read-mail'));
    await screen.findByTestId('mail-reading');

    fireEvent.click(screen.getByTestId('order-tab-articles'));
    fireEvent.click(screen.getByTestId('order-tab-mail'));
    expect(screen.getByTestId('mail-reading')).toBeInTheDocument();
  });

  it('gives the wire to the mail path only once there is something to confirm', async () => {
    // The wire hangs on whichever control actually puts an order into the machine.
    // On this path that is the confirm button, and until a mail has been read there
    // is no such control: a wire to one that does not exist points at nothing.
    render(<OrderForm onPlaced={() => {}} />);
    await openPanel();
    fireEvent.click(screen.getByTestId('order-tab-mail'));
    expect(document.querySelectorAll('[data-wire-anchor]')).toHaveLength(0);

    fireEvent.click(screen.getByTestId('read-mail'));
    const confirm = await screen.findByTestId('confirm-order');
    expect(confirm).toHaveAttribute('data-wire-anchor');
    expect(document.querySelectorAll('[data-wire-anchor]')).toHaveLength(1);
  });

  it('gives it back to the send button when the visitor goes back to the articles', async () => {
    render(<OrderForm onPlaced={() => {}} />);
    await openPanel();
    fireEvent.click(screen.getByTestId('order-tab-mail'));
    fireEvent.click(screen.getByTestId('read-mail'));
    await screen.findByTestId('confirm-order');

    fireEvent.click(screen.getByTestId('order-tab-articles'));
    expect(screen.getByTestId('send-order')).toHaveAttribute('data-wire-anchor');
    expect(screen.getByTestId('confirm-order')).not.toHaveAttribute('data-wire-anchor');
    expect(document.querySelectorAll('[data-wire-anchor]')).toHaveLength(1);
  });

  it('takes the wire off both paths once the box is shut', async () => {
    render(<OrderForm onPlaced={() => {}} />);
    await openPanel();
    fireEvent.click(screen.getByTestId('order-tab-mail'));
    fireEvent.click(screen.getByTestId('read-mail'));
    await screen.findByTestId('confirm-order');

    fireEvent.click(screen.getByTestId('close-order'));
    expect(screen.getByTestId('create-order')).toHaveAttribute('data-wire-anchor');
    expect(document.querySelectorAll('[data-wire-anchor]')).toHaveLength(1);
  });

  it('tells the page about an order the mail path placed, and expects no mail', async () => {
    // Nothing is posted to the address the model read, so there is no confirmation
    // mail on this path and a page waiting for one would wait forever.
    const placed = vi.fn();
    render(<OrderForm onPlaced={placed} />);
    await openPanel();
    fireEvent.click(screen.getByTestId('order-tab-mail'));
    fireEvent.click(screen.getByTestId('read-mail'));
    fireEvent.click(await screen.findByTestId('confirm-order'));
    await waitFor(() => expect(placed).toHaveBeenCalledWith('evt-1', false));
  });
});
