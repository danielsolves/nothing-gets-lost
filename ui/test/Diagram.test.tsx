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
// orders appeared out of the middle of the picture.
//
// The second fix has since been redone. The two ways in were drawn as tiles on the
// left, beside the systems, which made two places an order comes from look like two
// more places it goes to. There is one entrance now, it is a button at the top of
// the machine, and the odd orders that used to hang off the mail tile are what its
// menu offers.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, fireEvent, within } from '@testing-library/react';
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
  hubspot: 'up', stripe: 'up', slack: 'up', ledger: 'up', mailer: 'up',
};

const waiting: DeliveryView[] = [
  {
    id: 1, target: 'hubspot', state: 'pending', attempts: 2, eventId: 'evt-1',
    nextAt: null, lastError: 'ECONNRESET', remoteRef: null, remoteAt: null, sentAt: null, answeredAt: null,
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

  it('draws the way in, so no order appears from nowhere', () => {
    // The drawing had outgoing lines only for a while and every order arrived out
    // of the middle of it. The entrance is a button now rather than a tile, but the
    // line an arriving order travels down into the mediator is still drawn.
    render(<Diagram {...base} switches={ALL_UP} deliveries={[]} />);
    expect(screen.getByTestId('line-shop')).toBeInTheDocument();
  });

  it('draws no tile for a place an order merely comes from', () => {
    // Shaped like a system, the shop and the order mail read as two more places the
    // order goes to. Five tiles, five systems, and every one of them is something
    // the mediator calls.
    render(<Diagram {...base} switches={ALL_UP} deliveries={[]} />);
    expect(screen.queryByTestId('box-shop')).not.toBeInTheDocument();
    expect(screen.queryByTestId('box-mail')).not.toBeInTheDocument();
  });

  it('says the model step is replayed on the two orders the model reads', () => {
    // Spec 8.5 wants it said out loud. It was a banner under the whole machine,
    // then a note on a tile that no longer exists, then a line beside the send
    // button, where it sat next to the ordinary order and read as a caveat about
    // the whole machine. The ordinary order never touches the model.
    render(<Diagram {...base} switches={ALL_UP} deliveries={[]} extractorMode="recorded" />);
    fireEvent.click(screen.getByTestId('menu-entry'));
    expect(screen.getByTestId('menu-entry-garbage_payload'))
      .toHaveTextContent(/replayed here: no model key/i);
  });

  it('keeps that caveat off the ordinary order, which never reaches the model', () => {
    render(<Diagram {...base} switches={ALL_UP} deliveries={[]} extractorMode="recorded" />);
    expect(screen.getByTestId('machine-head')).not.toHaveTextContent(/model key/i);
  });

  it('says nothing about replaying when the model is really being called', () => {
    render(<Diagram {...base} switches={ALL_UP} deliveries={[]} extractorMode="live" />);
    fireEvent.click(screen.getByTestId('menu-entry'));
    expect(screen.getByTestId('menu-entry-garbage_payload'))
      .not.toHaveTextContent(/replayed/i);
  });

  it('puts the one way in at the top of the machine, before the systems it feeds', () => {
    // It was a button on a tile in the middle of the drawing, which meant the first
    // thing to press was not the first thing on the screen and a line above had to
    // carry the visitor down to it.
    render(<Diagram {...base} switches={ALL_UP} deliveries={[]} />);
    const head = screen.getByTestId('machine-head');
    expect(head).toContainElement(screen.getByTestId('order-form'));
    expect(head).toContainElement(screen.getByTestId('menu-entry'));
  });

  it('offers the three faults rather than one on and off', () => {
    render(<Diagram {...base} switches={ALL_UP} deliveries={[]} />);
    fireEvent.click(screen.getByTestId('menu-hubspot'));
    for (const state of ['up', 'slow', 'cut']) {
      expect(screen.getByTestId(`menu-hubspot-${state}`)).toBeInTheDocument();
    }
  });

  it('does not offer to make a third party fail', () => {
    render(<Diagram {...base} switches={ALL_UP} deliveries={[]} />);
    fireEvent.click(screen.getByTestId('menu-hubspot'));
    expect(screen.queryByTestId('menu-hubspot-error')).not.toBeInTheDocument();
  });

  it('slows a system down when the visitor asks for that', () => {
    render(<Diagram {...base} switches={ALL_UP} deliveries={[]} />);
    choose('hubspot', 'slow');
    expect(sent).toEqual([{ url: '/api/switches/hubspot', body: { state: 'slow' } }]);
  });

  it('cuts the line when the visitor says the line is dead', () => {
    render(<Diagram {...base} switches={ALL_UP} deliveries={[]} />);
    choose('hubspot', 'cut');
    expect(sent).toEqual([{ url: '/api/switches/hubspot', body: { state: 'cut' } }]);
  });

  it('puts a broken system back', () => {
    render(<Diagram {...base} switches={{ ...ALL_UP, slack: 'cut' }} deliveries={[]} />);
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

  it('hands the malformed orders to the entrance they are sent from', () => {
    render(<Diagram {...base} switches={ALL_UP} deliveries={[]} />);
    choose('entry', 'garbage_payload');
    expect(sent).toEqual([{ url: '/api/chaos/garbage_payload', body: null }]);
  });

  it('keeps the odd orders off the systems, which are not what sent them', () => {
    render(<Diagram {...base} switches={ALL_UP} deliveries={[]} />);
    fireEvent.click(screen.getByTestId('menu-hubspot'));
    expect(screen.queryByTestId('menu-hubspot-garbage_payload')).not.toBeInTheDocument();
  });

  it('repeats what came back, so pressing it is visibly not a no-op', async () => {
    // Neither malformed order creates an event, so nothing appears in the queue or
    // the log. Without this line the two loudest buttons on the page did nothing a
    // visitor could see.
    render(<Diagram {...base} switches={ALL_UP} deliveries={[]} />);
    choose('entry', 'hallucinate');
    expect(await screen.findByTestId('said-entry'))
      .toHaveTextContent(/handed to the extractor/i);
  });

  it('carries the state on the box, so the fault shows where it was caused', () => {
    render(<Diagram {...base} switches={{ ...ALL_UP, hubspot: 'cut' }} deliveries={[]} />);
    expect(screen.getByTestId('box-hubspot')).toHaveAttribute('data-state', 'cut');
  });

  it('says in words which fault a system is in', () => {
    render(<Diagram {...base} switches={{ ...ALL_UP, hubspot: 'cut' }} deliveries={[]} />);
    expect(screen.getByTestId('state-hubspot')).toHaveTextContent(/unreachable/i);
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

  it('keeps the mark, the name and the note in one head, in that order', () => {
    // The mark sits beside the name rather than above it, and the note reads as a
    // subtitle of the name rather than as the first of the tile's report lines.
    // Grouping them says which lines belong to the heading and which do not; laid
    // out as four loose children, the note drifted between the two readings.
    render(<Diagram {...base} switches={ALL_UP} deliveries={[]} />);
    const head = within(screen.getByTestId('box-hubspot')).getByTestId('head-hubspot');
    expect(within(head).getByTestId('mark-hubspot')).toBeInTheDocument();
    expect(within(head).getByText('HubSpot')).toBeInTheDocument();
    expect(within(head).getByText('CRM')).toBeInTheDocument();
  });

  it('leaves what a system is doing outside that head', () => {
    // The heading is what the tile is. The activity line is what it is doing, and
    // it comes and goes, so it must not be able to push the name around.
    render(<Diagram {...base} switches={{ ...ALL_UP, hubspot: 'cut' }} deliveries={waiting} />);
    const head = screen.getByTestId('head-hubspot');
    expect(head).not.toContainElement(screen.getByTestId('doing-hubspot'));
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
        nextAt: null, lastError: null, remoteRef: 'pi_1', remoteAt: null, sentAt: null, answeredAt: null,
      },
    ];
    render(<Diagram {...base} switches={ALL_UP} deliveries={mixed} openOrder="evt-1" />);
    expect(screen.getByTestId('box-stripe')).toHaveAttribute('data-tracked', 'done');
  });

  it('leaves the systems of another order unmarked', () => {
    render(<Diagram {...base} switches={ALL_UP} deliveries={waiting} openOrder="evt-other" />);
    expect(screen.getByTestId('box-hubspot')).not.toHaveAttribute('data-tracked');
  });

  // The backlog goes in the column with the tiles, not under the whole machine. The
  // hub is about twice their height, so that column ended halfway down with nothing
  // under it, and what belongs in that space is what the systems would not take.
  it('puts the backlog under the systems rather than beside the mediator', () => {
    render(
      <Diagram
        {...base}
        switches={ALL_UP}
        deliveries={waiting}
        backlog={<div data-testid="backlog">parked</div>}
      />,
    );
    const side = screen.getByTestId('backlog').parentElement;
    expect(side).toHaveClass('machine-side');
    expect(within(side ?? document.body).getByTestId('box-hubspot')).toBeInTheDocument();
  });

  it('draws the machine without a backlog at all', () => {
    render(<Diagram {...base} switches={ALL_UP} deliveries={waiting} />);
    expect(screen.queryByTestId('backlog')).not.toBeInTheDocument();
    expect(screen.getByTestId('box-hubspot')).toBeInTheDocument();
  });
});
