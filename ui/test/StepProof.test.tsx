// @vitest-environment jsdom
// ui/test/StepProof.test.tsx
// Going and looking, from the card rather than from a panel further down the page.
//
// The opened card said "delivered, their id pi_3S..." and stopped there. That is the
// hardest kind of claim to believe: a foreign-looking identifier that the page could
// equally well have invented, with nothing to do about it. The check is the answer,
// and the interesting assertions here are the honest ones. Stripe serves its receipt
// itself, so that is a proof. Our own portals are read back through us, and saying so
// costs nothing and is what keeps the Stripe claim worth anything.
//
// The rest is about the way back out. The answer had none: it opened, the button went
// on offering a check that had been made, and a tile stayed at three times its height
// for the rest of the visit. The button carries both directions now, so what is
// asserted here is that the label follows the state on either surface and that
// closing forgets the answer rather than filing it away for later.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import type { VerifyResponse } from '@ngl/contracts';
import { StepProof } from '../src/StepProof';

afterEach(cleanup);
afterEach(() => { vi.unstubAllGlobals(); });

const stripe: VerifyResponse = {
  target: 'stripe',
  requestUrl: 'https://pay.stripe.com/receipts/xyz',
  httpStatus: 200,
  remoteRef: 'pi_3S9',
  remoteAt: '2026-08-01T10:00:00.000Z',
  rawBody: { receipt_url: 'https://pay.stripe.com/receipts/xyz' },
  indisputable: true,
};

const hubspot: VerifyResponse = {
  target: 'hubspot',
  requestUrl: 'https://api.hubapi.com/crm/v3/objects/contacts/42',
  httpStatus: 200,
  remoteRef: '42',
  remoteAt: '2026-08-01T10:00:00.000Z',
  rawBody: { id: '42' },
  indisputable: false,
};

let asked: string[];

function answering(answer: VerifyResponse, status = 200): void {
  asked = [];
  vi.stubGlobal('fetch', async (url: string) => {
    asked.push(url);
    return new Response(JSON.stringify(answer), {
      status, headers: { 'content-type': 'application/json' },
    });
  });
}

beforeEach(() => { answering(stripe); });

const base = { eventId: 'evt-1', target: 'stripe' as const, label: 'Stripe' };

describe('StepProof', () => {
  it('says nothing until it is asked', () => {
    render(<StepProof {...base} />);
    expect(screen.queryByTestId('proof-evt-1-stripe')).not.toBeInTheDocument();
    expect(asked).toEqual([]);
  });

  it('reads back from the system itself, not from anything we stored', () => {
    render(<StepProof {...base} />);
    fireEvent.click(screen.getByTestId('check-evt-1-stripe'));
    expect(asked).toEqual(['/api/verify/stripe/evt-1']);
  });

  it('opens the page Stripe serves, because anybody can open it', async () => {
    render(<StepProof {...base} />);
    fireEvent.click(screen.getByTestId('check-evt-1-stripe'));
    const link = await screen.findByTestId('proof-link-evt-1-stripe');
    expect(link).toHaveAttribute('href', 'https://pay.stripe.com/receipts/xyz');
    expect(link).toHaveAttribute('rel', expect.stringContaining('noreferrer'));
  });

  it('names the host it is sending the visitor to', async () => {
    // "Open it" says nothing. Which domain answers is the whole point: the visitor
    // is being shown that the record lives somewhere that is not this page.
    render(<StepProof {...base} />);
    fireEvent.click(screen.getByTestId('check-evt-1-stripe'));
    expect(await screen.findByTestId('proof-link-evt-1-stripe'))
      .toHaveTextContent(/pay\.stripe\.com/);
  });

  it('shows what came back, so the answer is the evidence and not our word', async () => {
    render(<StepProof {...base} />);
    fireEvent.click(screen.getByTestId('check-evt-1-stripe'));
    const proof = await screen.findByTestId('proof-evt-1-stripe');
    expect(proof).toHaveTextContent('200');
    expect(proof).toHaveTextContent('pi_3S9');
  });

  it('says plainly when a read-back is only as good as our word', async () => {
    // Spec 9.0. We render the answer, so a sceptic is right that we could render
    // anything. Admitting it is what makes the Stripe receipt worth something.
    answering(hubspot);
    render(<StepProof eventId="evt-1" target="hubspot" label="HubSpot" />);
    fireEvent.click(screen.getByTestId('check-evt-1-hubspot'));
    expect(await screen.findByTestId('proof-caveat-evt-1-hubspot'))
      .toHaveTextContent(/we (are the ones who )?read|through us|our own/i);
  });

  it('claims nothing of the sort about a proof served by somebody else', async () => {
    render(<StepProof {...base} />);
    fireEvent.click(screen.getByTestId('check-evt-1-stripe'));
    await screen.findByTestId('proof-evt-1-stripe');
    expect(screen.queryByTestId('proof-caveat-evt-1-stripe')).not.toBeInTheDocument();
  });

  it('sends nobody to an API endpoint they have no token for', async () => {
    // The HubSpot read-back answers on api.hubapi.com, behind a bearer token.
    // Offered as a link it is a 401 for the visitor, and a link that lands on a 401
    // is worse evidence than no link at all.
    answering(hubspot);
    render(<StepProof eventId="evt-1" target="hubspot" label="HubSpot" />);
    fireEvent.click(screen.getByTestId('check-evt-1-hubspot'));
    await screen.findByTestId('proof-evt-1-hubspot');
    expect(screen.queryByTestId('proof-link-evt-1-hubspot')).not.toBeInTheDocument();
    // The url is still shown. Seeing which endpoint answered is the evidence; being
    // sent there is not.
    expect(screen.getByTestId('proof-evt-1-hubspot')).toHaveTextContent('api.hubapi.com');
  });

  it('offers no link to a record that is not there', async () => {
    answering({ ...stripe, httpStatus: 404 });
    render(<StepProof {...base} />);
    fireEvent.click(screen.getByTestId('check-evt-1-stripe'));
    await screen.findByTestId('proof-evt-1-stripe');
    expect(screen.queryByTestId('proof-link-evt-1-stripe')).not.toBeInTheDocument();
  });

  it('says so when the record cannot be found rather than going quiet', async () => {
    answering({ ...stripe, requestUrl: '', httpStatus: 404, rawBody: { receipt_url: null } });
    render(<StepProof {...base} />);
    fireEvent.click(screen.getByTestId('check-evt-1-stripe'));
    expect(await screen.findByTestId('proof-evt-1-stripe')).toHaveTextContent('404');
  });

  it('says so when the check itself could not be made', async () => {
    vi.stubGlobal('fetch', async () => { throw new Error('offline'); });
    render(<StepProof {...base} />);
    fireEvent.click(screen.getByTestId('check-evt-1-stripe'));
    expect(await screen.findByTestId('proof-error-evt-1-stripe')).toBeInTheDocument();
  });

  it('offers to put the answer away once there is one to put away', async () => {
    // The answer opened and stayed open, and the button went on offering a check
    // that had already been made. On a tile that is a box grown to three times its
    // height with no way back, pushing the row it stands in down the page for the
    // rest of the visit.
    render(<StepProof {...base} />);
    const button = screen.getByTestId('check-evt-1-stripe');
    expect(button).toHaveTextContent('Check it at Stripe');
    fireEvent.click(button);
    await screen.findByTestId('proof-evt-1-stripe');
    expect(button).toHaveTextContent('Hide the answer');
  });

  it('folds the answer away on the next press, and offers the check again', async () => {
    render(<StepProof {...base} />);
    const button = screen.getByTestId('check-evt-1-stripe');
    fireEvent.click(button);
    await screen.findByTestId('proof-evt-1-stripe');

    fireEvent.click(button);
    expect(screen.queryByTestId('proof-evt-1-stripe')).not.toBeInTheDocument();
    expect(button).toHaveTextContent('Check it at Stripe');
  });

  it('asks nothing on the way out, because closing is not a question', async () => {
    render(<StepProof {...base} />);
    fireEvent.click(screen.getByTestId('check-evt-1-stripe'));
    await screen.findByTestId('proof-evt-1-stripe');
    fireEvent.click(screen.getByTestId('check-evt-1-stripe'));
    expect(asked).toHaveLength(1);
  });

  it('says the same thing on a tile, where the offer is about the order', async () => {
    // The offer differs by surface: a tile has printed the system two rows above, a
    // card is one order and lists every system. What is being put away is the answer
    // either way, so the way out says one thing, and it is short enough to stay on
    // one line in a 198px box.
    render(<StepProof {...base} orderNumber={1016} layout="tile" />);
    const button = screen.getByTestId('check-evt-1-stripe');
    expect(button).toHaveTextContent('Check order 1016');
    fireEvent.click(button);
    await screen.findByTestId('proof-evt-1-stripe');
    expect(button).toHaveTextContent('Hide the answer');
    fireEvent.click(button);
    expect(button).toHaveTextContent('Check order 1016');
  });

  it('tells a screen reader whether the answer is open, which the label only implies', async () => {
    render(<StepProof {...base} />);
    const button = screen.getByTestId('check-evt-1-stripe');
    expect(button).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(button);
    await screen.findByTestId('proof-evt-1-stripe');
    expect(button).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'false');
  });

  it('can be asked again, because the answer is about now and not about then', async () => {
    // Reopening asks the system again rather than putting the kept answer back on
    // screen. A record deleted at the far end between the two presses has to come
    // back 404, and a panel that redisplayed what it was told earlier would go on
    // saying 200 about a record that is gone.
    render(<StepProof {...base} />);
    fireEvent.click(screen.getByTestId('check-evt-1-stripe'));
    await screen.findByTestId('proof-evt-1-stripe');
    fireEvent.click(screen.getByTestId('check-evt-1-stripe'));
    fireEvent.click(screen.getByTestId('check-evt-1-stripe'));
    await screen.findByTestId('proof-evt-1-stripe');
    expect(asked).toEqual(['/api/verify/stripe/evt-1', '/api/verify/stripe/evt-1']);
  });

  it('offers another go after a failure, not the hiding of an answer it has not got', async () => {
    // A failure is a report about the press, not something disclosed. The next thing
    // anybody wants after reading it is another attempt, so the button stays the offer.
    vi.stubGlobal('fetch', async () => { throw new Error('offline'); });
    render(<StepProof {...base} />);
    const button = screen.getByTestId('check-evt-1-stripe');
    fireEvent.click(button);
    await screen.findByTestId('proof-error-evt-1-stripe');
    expect(button).toHaveTextContent('Check it at Stripe');
    expect(button).toHaveAttribute('aria-expanded', 'false');
  });
});
