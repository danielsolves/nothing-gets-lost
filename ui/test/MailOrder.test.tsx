// @vitest-environment jsdom
// ui/test/MailOrder.test.tsx
// The panel where an order arrives as prose.
//
// Most of what is asserted here is about which request is sent when, because that is
// where this feature can go wrong in a way nobody would notice by looking. Reading a
// mail must place nothing. Placing must go to /api/orders, the endpoint every other
// order on this page goes through, and not to some second door with its own idea
// about prices and caps. And what is placed must be what was on screen when the
// visitor pressed, or the confirmation step is theatre.
//
// The address is the one field deliberately left behind. The model read it out of a
// text box a stranger typed into, and posting it as the confirmation address would
// turn this panel into a way to send mail from our domain to any inbox named in it.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MAX_ORDER_TEXT, type ExtractOrderResponse } from '@ngl/contracts';
import { MailOrder } from '../src/MailOrder';
import { sampleMail } from '../src/mail-order-samples';

afterEach(cleanup);
afterEach(() => { vi.unstubAllGlobals(); });

interface Sent { url: string; body: unknown }
let sent: Sent[];
let reading: ExtractOrderResponse;
let readingStatus: number;
let readingMessage: string;

const PROPOSED: ExtractOrderResponse = {
  ok: true,
  mode: 'recorded',
  raw: { items: [{ sku: 'MUG-BLUE', qty: 3 }] },
  proposal: {
    customerName: 'M. Berger',
    customerEmail: 'm@example.com',
    notes: 'invoice to head office as usual',
    lines: [
      { sku: 'MUG-BLUE', name: 'Blue mug', qty: 3, cents: 3600 },
      { sku: 'COASTER-OAK', name: 'Oak coaster', qty: 2, cents: 900 },
    ],
    totalCents: 4500,
  },
};

const REFUSED: ExtractOrderResponse = {
  ok: false,
  mode: 'recorded',
  raw: { items: [{ sku: 'MUG-AZURE', qty: 4 }] },
  stoppedBy: 'catalog',
  detail: 'unknown sku: MUG-AZURE',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status, headers: { 'content-type': 'application/json' },
  });
}

beforeEach(() => {
  sent = [];
  reading = PROPOSED;
  readingStatus = 200;
  readingMessage = '';
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    sent.push({ url, body: JSON.parse(String(init?.body ?? 'null')) });
    if (url === '/api/extract-order') {
      return readingStatus === 200
        ? json(reading)
        : json({ message: readingMessage }, readingStatus);
    }
    return json({ eventId: 'evt-1', orderId: 'ord-1' });
  });
});

/** Presses read and waits for the answer to be drawn. */
async function read(): Promise<void> {
  fireEvent.click(screen.getByTestId('read-mail'));
  await screen.findByTestId('mail-reading');
}

describe('MailOrder', () => {
  it('opens with a mail already in the field, so there is something to press', () => {
    render(<MailOrder />);
    expect(screen.getByTestId('mail-text'))
      .toHaveValue(sampleMail('ordinary').text);
  });

  it('offers the three examples, including the two that get refused', () => {
    render(<MailOrder />);
    for (const id of ['ordinary', 'invented', 'nothing']) {
      expect(screen.getByTestId(`sample-${id}`)).toBeInTheDocument();
    }
  });

  it('puts a chosen example in the field without sending anything', () => {
    render(<MailOrder />);
    fireEvent.click(screen.getByTestId('sample-invented'));
    expect(screen.getByTestId('mail-text')).toHaveValue(sampleMail('invented').text);
    expect(sent).toEqual([]);
  });

  it('takes a mail of the visitor own, and will not take a book', () => {
    render(<MailOrder />);
    const field = screen.getByTestId('mail-text');
    fireEvent.change(field, { target: { value: 'two teapots please' } });
    expect(field).toHaveValue('two teapots please');
    expect(field).toHaveAttribute('maxLength', String(MAX_ORDER_TEXT));
  });

  it('reads nothing until the button is pressed', () => {
    render(<MailOrder />);
    expect(sent).toEqual([]);
  });

  it('sends the text to be read, and nothing else with it', async () => {
    render(<MailOrder />);
    await read();
    expect(sent).toHaveLength(1);
    expect(sent[0].url).toBe('/api/extract-order');
    expect(sent[0].body).toEqual({ text: sampleMail('ordinary').text });
  });

  it('places nothing by reading, which is the whole reason for the second step', async () => {
    render(<MailOrder />);
    await read();
    expect(sent.map((call) => call.url)).toEqual(['/api/extract-order']);
    expect(screen.getByTestId('mail-proposal')).toBeInTheDocument();
  });

  it('will not read an empty field', () => {
    render(<MailOrder />);
    fireEvent.change(screen.getByTestId('mail-text'), { target: { value: '  ' } });
    expect(screen.getByTestId('read-mail')).toBeDisabled();
  });

  it('places the confirmed order through the endpoint every order goes through', async () => {
    render(<MailOrder />);
    await read();
    fireEvent.click(screen.getByTestId('confirm-order'));

    await waitFor(() => expect(sent).toHaveLength(2));
    expect(sent[1].url).toBe('/api/orders');
    expect(sent[1].body).toEqual({
      customerName: 'M. Berger',
      items: [{ sku: 'MUG-BLUE', qty: 3 }, { sku: 'COASTER-OAK', qty: 2 }],
    });
  });

  it('places exactly the basket that was on screen', async () => {
    render(<MailOrder />);
    await read();
    const shown = screen.getByTestId('mail-proposal').textContent ?? '';
    fireEvent.click(screen.getByTestId('confirm-order'));
    await waitFor(() => expect(sent).toHaveLength(2));

    const body = sent[1].body;
    if (typeof body !== 'object' || body === null || !('items' in body)) {
      throw new Error('the order carried no items');
    }
    const items = body.items;
    if (!Array.isArray(items)) throw new Error('items is not a list');
    expect(items).toHaveLength(2);
    expect(shown).toContain('Blue mug');
    expect(shown).toContain('Oak coaster');
  });

  it('never posts the address the model read', async () => {
    // Sending it would make a public text box a way to mail any inbox a stranger
    // writes into it, with a model choosing the recipient.
    render(<MailOrder />);
    await read();
    fireEvent.click(screen.getByTestId('confirm-order'));
    await waitFor(() => expect(sent).toHaveLength(2));
    expect(JSON.stringify(sent[1].body)).not.toContain('m@example.com');
  });

  it('tells the page which event it made, so the queue can be pointed at it', async () => {
    const placed = vi.fn();
    render(<MailOrder onPlaced={placed} />);
    await read();
    fireEvent.click(screen.getByTestId('confirm-order'));
    await waitFor(() => expect(placed).toHaveBeenCalledWith('evt-1'));
  });

  it('works without anybody listening, since the page may not want to be told', () => {
    render(<MailOrder />);
    expect(screen.getByTestId('read-mail')).toBeEnabled();
  });

  it('draws a refusal and offers nothing to place', async () => {
    reading = REFUSED;
    render(<MailOrder />);
    fireEvent.click(screen.getByTestId('sample-invented'));
    await read();

    expect(screen.getByTestId('mail-stopped')).toHaveTextContent('MUG-AZURE');
    expect(screen.queryByTestId('confirm-order')).not.toBeInTheDocument();
    expect(sent.map((call) => call.url)).toEqual(['/api/extract-order']);
  });

  it('throws a proposal away on discard, and places nothing', async () => {
    render(<MailOrder />);
    await read();
    fireEvent.click(screen.getByTestId('discard-order'));
    expect(screen.queryByTestId('mail-reading')).not.toBeInTheDocument();
    expect(sent.map((call) => call.url)).toEqual(['/api/extract-order']);
  });

  it('repeats the reason a reading was refused, rather than failing quietly', async () => {
    // The cap on this endpoint is tighter than the one on orders, so this message
    // is one a curious visitor will actually meet.
    readingStatus = 429;
    readingMessage = 'That is 10 mails read this hour from your address.';
    render(<MailOrder />);
    fireEvent.click(screen.getByTestId('read-mail'));
    expect(await screen.findByTestId('mail-problem'))
      .toHaveTextContent(/10 mails read this hour/);
    expect(screen.queryByTestId('mail-reading')).not.toBeInTheDocument();
  });

  it('repeats the reason a confirmed order was refused', async () => {
    render(<MailOrder />);
    await read();
    vi.stubGlobal('fetch', async () => json({ message: 'unknown sku: MUG-AZURE' }, 400));
    fireEvent.click(screen.getByTestId('confirm-order'));
    expect(await screen.findByTestId('mail-problem')).toHaveTextContent(/unknown sku/);
  });

  it('drops a reading when the mail under it is edited', async () => {
    // The answer on screen belongs to the text that was read. Leaving it above a
    // field somebody has since rewritten invites a visitor to confirm a proposal
    // for a mail that no longer exists.
    render(<MailOrder />);
    await read();
    fireEvent.change(screen.getByTestId('mail-text'), { target: { value: 'two teapots' } });
    expect(screen.queryByTestId('mail-reading')).not.toBeInTheDocument();
  });

  it('cannot place the same proposal twice', async () => {
    render(<MailOrder />);
    await read();
    fireEvent.click(screen.getByTestId('confirm-order'));
    await screen.findByTestId('mail-placed');
    expect(screen.queryByTestId('confirm-order')).not.toBeInTheDocument();
    expect(sent.filter((call) => call.url === '/api/orders')).toHaveLength(1);
  });
});
