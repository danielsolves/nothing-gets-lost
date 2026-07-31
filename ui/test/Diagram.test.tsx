// @vitest-environment jsdom
// ui/test/Diagram.test.tsx
// The diagram is the interface, not a picture of one. Breaking something used to be
// a scroll past the whole page and a click into a drawer called "Control panel";
// the success criterion in specification section 1 is that a stranger breaks
// something on purpose within sixty seconds, and that distance was the thing in the
// way.
//
// Two things changed after the first attempt at that. The tile used to be a single
// toggle, which flattened four distinct faults into on and off and taught the wrong
// lesson: that an outage is one thing. And the drawing had outgoing lines only, so
// orders appeared out of the middle of the picture. Both are fixed here: the tile
// carries a menu of all four faults, and the two ways in are drawn on the left.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import type { DeliveryView, SwitchState, SwitchableTarget } from '@ngl/contracts';
import { Diagram } from '../src/Diagram';

/** The props every test shares. Individual tests override what they are about. */
const base = {
  // The hub and the order form are passed in rather than built here: this file is
  // about the layout and the wiring, and Mediator.test.tsx and OrderForm.test.tsx
  // are about the panels themselves.
  hub: <div data-testid="mediator">hub</div>,
  orderForm: <div data-testid="order-form">form</div>,
};

afterEach(cleanup);

const ALL_UP: Record<SwitchableTarget, SwitchState> = {
  hubspot: 'up', stripe: 'up', paypal: 'up', slack: 'up', ledger: 'up', mailer: 'up',
};

const waiting: DeliveryView[] = [
  {
    id: 1, target: 'hubspot', state: 'pending', attempts: 2, eventId: 'evt-1',
    nextAt: null, lastError: 'ECONNRESET', remoteRef: null, remoteAt: null,
  },
];

let sent: Array<{ url: string; body: unknown }>;

beforeEach(() => {
  sent = [];
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    sent.push({ url, body: JSON.parse(String(init?.body ?? 'null')) });
    return new Response(
      JSON.stringify({ ok: true, detail: 'a malformed order was handed to the extractor' }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  });
});

afterEach(() => { vi.unstubAllGlobals(); });

/** Opens a tile's menu and picks one entry, the way a visitor does. */
function choose(tile: string, item: string): void {
  fireEvent.click(screen.getByTestId(`menu-${tile}`));
  fireEvent.click(screen.getByTestId(`menu-${tile}-${item}`));
}

describe('Diagram', () => {
  it('draws the mediator and every system it delivers to', () => {
    render(<Diagram {...base} switches={ALL_UP} deliveries={[]} />);
    expect(screen.getByTestId('mediator')).toBeInTheDocument();
    for (const target of ['stripe', 'hubspot', 'ledger', 'slack', 'mailer']) {
      expect(screen.getByTestId(`box-${target}`)).toBeInTheDocument();
    }
  });

  it('draws where an order comes from, so none of them appear from nowhere', () => {
    render(<Diagram {...base} switches={ALL_UP} deliveries={[]} />);
    expect(screen.getByTestId('box-shop')).toBeInTheDocument();
    expect(screen.getByTestId('box-mail')).toBeInTheDocument();
    expect(screen.getByTestId('line-shop')).toBeInTheDocument();
  });

  it('gives a source no state, because a source is not something we call', () => {
    render(<Diagram {...base} switches={ALL_UP} deliveries={[]} />);
    expect(screen.getByTestId('box-shop')).not.toHaveAttribute('data-state');
  });

  it('leaves the shop page alone, having nothing to offer that the page does not', () => {
    render(<Diagram {...base} switches={ALL_UP} deliveries={[]} />);
    expect(screen.queryByTestId('menu-shop')).not.toBeInTheDocument();
  });

  it('puts the replayed-step note on the tile it is about', () => {
    // Spec 8.5 wants it said out loud. It was a banner under the whole machine,
    // which is the part of a page nobody reads.
    render(<Diagram {...base} switches={ALL_UP} deliveries={[]} extractorMode="recorded" />);
    expect(screen.getByTestId('box-mail'))
      .toContainElement(screen.getByTestId('extractor-mode'));
  });

  it('says nothing about replaying when the model is really being called', () => {
    render(<Diagram {...base} switches={ALL_UP} deliveries={[]} extractorMode="live" />);
    expect(screen.queryByTestId('extractor-mode')).not.toBeInTheDocument();
  });

  it('draws a source with the same tile as a system, so neither looks like a class of its own', () => {
    // Two code paths drifted once already: the order mail ended up wider than
    // Slack and read as a different kind of thing, which it is not.
    render(<Diagram {...base} switches={ALL_UP} deliveries={[]} />);
    const mail = screen.getByTestId('box-mail');
    const slack = screen.getByTestId('box-slack');
    expect(mail.className.split(' ')).toContain('target');
    expect(slack.className.split(' ')).toContain('target');
    expect(mail.className.split(' ')).toContain('source');
  });

  it('puts the order form on the shop, which is where an order comes from', () => {
    // Sent from the top of the page instead, an order appears in the middle of the
    // drawing, skipping the one hop the drawing exists to show.
    render(<Diagram {...base} switches={ALL_UP} deliveries={[]} />);
    const shop = screen.getByTestId('box-shop');
    expect(shop).toContainElement(screen.getByTestId('order-form'));
  });

  it('offers all four faults rather than one on and off', () => {
    render(<Diagram {...base} switches={ALL_UP} deliveries={[]} />);
    fireEvent.click(screen.getByTestId('menu-hubspot'));
    for (const state of ['up', 'slow', 'error', 'cut']) {
      expect(screen.getByTestId(`menu-hubspot-${state}`)).toBeInTheDocument();
    }
  });

  it('takes a system down when the visitor says the system is down', () => {
    render(<Diagram {...base} switches={ALL_UP} deliveries={[]} />);
    choose('hubspot', 'error');
    expect(sent).toEqual([{ url: '/api/switches/hubspot', body: { state: 'error' } }]);
  });

  it('cuts the line when the visitor says the line is dead', () => {
    render(<Diagram {...base} switches={ALL_UP} deliveries={[]} />);
    choose('hubspot', 'cut');
    expect(sent).toEqual([{ url: '/api/switches/hubspot', body: { state: 'cut' } }]);
  });

  it('puts a broken system back', () => {
    render(<Diagram {...base} switches={{ ...ALL_UP, slack: 'error' }} deliveries={[]} />);
    choose('slack', 'up');
    expect(sent).toEqual([{ url: '/api/switches/slack', body: { state: 'up' } }]);
  });

  it('marks the fault that is in force, so the menu is also the readout', () => {
    render(<Diagram {...base} switches={{ ...ALL_UP, slack: 'slow' }} deliveries={[]} />);
    fireEvent.click(screen.getByTestId('menu-slack'));
    expect(screen.getByTestId('menu-slack-slow')).toHaveAttribute('aria-checked', 'true');
  });

  it('lets Invoices say that off means off, because it alone really stops', () => {
    render(<Diagram {...base} switches={ALL_UP} deliveries={[]} />);
    fireEvent.click(screen.getByTestId('menu-ledger'));
    expect(screen.getByTestId('menu-ledger-cut')).toHaveTextContent(/really stops listening/i);
  });

  it('offers the repeated payment on Stripe and nowhere else', () => {
    render(<Diagram {...base} switches={ALL_UP} deliveries={[]} />);
    fireEvent.click(screen.getByTestId('menu-stripe'));
    expect(screen.getByTestId('menu-stripe-duplicate_webhook')).toBeInTheDocument();

    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    fireEvent.click(screen.getByTestId('menu-slack'));
    expect(screen.queryByTestId('menu-slack-duplicate_webhook')).not.toBeInTheDocument();
  });

  it('fires the repeated payment at the real endpoint', () => {
    render(<Diagram {...base} switches={ALL_UP} deliveries={[]} />);
    choose('stripe', 'duplicate_webhook');
    expect(sent).toEqual([{ url: '/api/chaos/duplicate_webhook', body: null }]);
  });

  it('hands the malformed orders to the mail they arrive as', () => {
    render(<Diagram {...base} switches={ALL_UP} deliveries={[]} />);
    choose('mail', 'garbage_payload');
    expect(sent).toEqual([{ url: '/api/chaos/garbage_payload', body: null }]);
  });

  it('repeats what came back, so pressing it is visibly not a no-op', async () => {
    // Neither malformed order creates an event, so nothing appears in the queue or
    // the log. Without this line the two loudest buttons on the page did nothing a
    // visitor could see.
    render(<Diagram {...base} switches={ALL_UP} deliveries={[]} />);
    choose('mail', 'hallucinate');
    expect(await screen.findByTestId('said-mail'))
      .toHaveTextContent(/handed to the extractor/i);
  });

  it('carries the state on the box, so the fault shows where it was caused', () => {
    render(<Diagram {...base} switches={{ ...ALL_UP, hubspot: 'cut' }} deliveries={[]} />);
    expect(screen.getByTestId('box-hubspot')).toHaveAttribute('data-state', 'cut');
  });

  it('says in words which fault a system is in', () => {
    render(<Diagram {...base} switches={{ ...ALL_UP, hubspot: 'error' }} deliveries={[]} />);
    expect(screen.getByTestId('state-hubspot')).toHaveTextContent(/failing/i);
  });

  it('stays quiet about a system that is simply working', () => {
    render(<Diagram {...base} switches={ALL_UP} deliveries={[]} />);
    expect(screen.queryByTestId('state-hubspot')).not.toBeInTheDocument();
  });

  it('carries the state on the line as well as the box', () => {
    render(<Diagram {...base} switches={{ ...ALL_UP, hubspot: 'cut' }} deliveries={[]} />);
    expect(screen.getByTestId('line-hubspot')).toHaveAttribute('data-state', 'cut');
  });

  it('says what a system is doing, not merely how many are stacked up at it', () => {
    // A count is a number to interpret. The visitor watching an outage wants the
    // verb: whether anything is moving, and when it will be tried again.
    render(<Diagram {...base} switches={{ ...ALL_UP, hubspot: 'cut' }} deliveries={waiting} />);
    expect(screen.getByTestId('doing-hubspot')).toHaveTextContent(/attempt 2 failed/i);
  });

  it('never makes a tile repeat its own name back at the reader', () => {
    render(<Diagram {...base} switches={{ ...ALL_UP, hubspot: 'cut' }} deliveries={waiting} />);
    expect(screen.getByTestId('doing-hubspot')).not.toHaveTextContent(/hubspot/i);
  });

  it('stays quiet about a system with nothing outstanding', () => {
    render(<Diagram {...base} switches={ALL_UP} deliveries={[]} />);
    expect(screen.queryByTestId('doing-hubspot')).not.toBeInTheDocument();
  });

  it('marks nothing while no order is open in the queue', () => {
    render(<Diagram {...base} switches={ALL_UP} deliveries={waiting} />);
    expect(screen.getByTestId('box-hubspot')).not.toHaveAttribute('data-tracked');
  });

  it('marks the systems the open order is still waiting on', () => {
    // The card and the wires are the same thing seen twice, so opening a card has
    // to be visible over here or the two panels are just neighbours.
    render(<Diagram {...base} switches={ALL_UP} deliveries={waiting} openOrder="evt-1" />);
    expect(screen.getByTestId('box-hubspot')).toHaveAttribute('data-tracked', 'open');
    expect(screen.getByTestId('line-hubspot')).toHaveAttribute('data-tracked', 'open');
  });

  it('marks a system the open order has already reached as settled', () => {
    const mixed: DeliveryView[] = [
      ...waiting,
      {
        id: 2, target: 'stripe', state: 'done', attempts: 1, eventId: 'evt-1',
        nextAt: null, lastError: null, remoteRef: 'pi_1', remoteAt: null,
      },
    ];
    render(<Diagram {...base} switches={ALL_UP} deliveries={mixed} openOrder="evt-1" />);
    expect(screen.getByTestId('box-stripe')).toHaveAttribute('data-tracked', 'done');
  });

  it('leaves the systems of another order unmarked', () => {
    render(<Diagram {...base} switches={ALL_UP} deliveries={waiting} openOrder="evt-other" />);
    expect(screen.getByTestId('box-hubspot')).not.toHaveAttribute('data-tracked');
  });
});
