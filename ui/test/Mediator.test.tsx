// @vitest-environment jsdom
// ui/test/Mediator.test.tsx
// The hub is a panel, not a caption. It carries its own live state, the queue it
// holds, and the log of what it just did.
//
// The specification calls the mediator the heart of the repo and defends building
// the queue by hand with "take a ready-made one and the most interesting part
// becomes invisible". A box saying "queue · retry · exactly once" made it invisible
// anyway. Everything a visitor would otherwise have to take on faith lives here.
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, fireEvent, within } from '@testing-library/react';
import type { Counters, DeliveryView, OrderView, TimelineEntry } from '@ngl/contracts';
import { Mediator } from '../src/Mediator';

afterEach(cleanup);

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })));
  // jsdom implements no layout, so it ships no ResizeObserver either. The hub uses
  // one to keep the tab underline the width of the tab it is under. Nothing here
  // measures pixels, so a stub that never fires is the honest stand-in: it lets the
  // component mount and leaves the underline where its first measurement put it.
  vi.stubGlobal('ResizeObserver', class {
    observe() { /* no layout to observe */ }
    unobserve() { /* no layout to observe */ }
    disconnect() { /* nothing was observed */ }
  });
});
afterEach(() => { vi.unstubAllGlobals(); });

const EVENT = '3f8a1c2d-0000-4000-8000-000000000000';

const counters: Counters = {
  received: 3, delivered: 9, waiting: 2, duplicatesDropped: 1, needsHuman: 1, lost: 0,
};

const deliveries: DeliveryView[] = [
  {
    id: 1, eventId: EVENT, target: 'stripe', state: 'done', attempts: 1,
    nextAt: null, lastError: null, remoteRef: 'pi_1', remoteAt: null, sentAt: null, answeredAt: null,
  },
  {
    id: 2, eventId: EVENT, target: 'hubspot', state: 'pending', attempts: 3,
    nextAt: null, lastError: 'ECONNRESET', remoteRef: null, remoteAt: null, sentAt: null, answeredAt: null,
  },
];

const timeline: TimelineEntry[] = [
  { at: '2026-07-31T12:00:00.000Z', eventId: EVENT, text: 'Stripe: confirmed', level: 'success' },
];

/** One entry per order, which is what the queue heads its cards from. */
const orders: OrderView[] = [
  {
    eventId: EVENT, number: 1042, receivedAt: '2026-07-31T12:00:00.000Z',
    booking: {
      source: 'form',
      lines: [{ sku: 'TEAPOT', name: 'Teapot', qty: 1, cents: 4900 }],
      totalCents: 4900,
    },
  },
];

const props = {
  counters, deliveries, orders, timeline,
  openOrder: null,
  onToggleOrder: () => {},
  // The everyday case: the stream is up and nobody else is here. The cases where
  // either is not true have their own tests at the bottom of this file.
  connected: true,
  viewers: 1,
};

describe('Mediator', () => {
  it('names itself and says what it is', () => {
    render(<Mediator {...props} />);
    expect(screen.getByText('The mediator')).toBeInTheDocument();
  });

  it('shows the counts that carry the claim', () => {
    render(<Mediator {...props} />);
    expect(screen.getByTestId('hub-waiting')).toHaveTextContent('2');
    expect(screen.getByTestId('hub-lost')).toHaveTextContent('0');
  });

  it('counts the duplicates it threw away, because that is the proof of exactly once', () => {
    // "Deliver the payment twice" is a switch on the Stripe tile, and this number is
    // the only place on the page that answers it. It used to sit in the header bar
    // above the diagram, which said the same four numbers as this row and has gone.
    render(<Mediator {...props} />);
    expect(screen.getByTestId('hub-duplicates')).toHaveTextContent('1');
  });

  it('says nothing about duplicates until one has been dropped', () => {
    render(<Mediator {...props} counters={{ ...counters, duplicatesDropped: 0 }} />);
    expect(screen.queryByTestId('hub-duplicates')).not.toBeInTheDocument();
  });

  it('keeps its explanation out of the way until asked', () => {
    render(<Mediator {...props} />);
    expect(screen.queryByTestId('hub-help')).not.toBeInTheDocument();
  });

  it('explains what it does when the question mark is used', () => {
    render(<Mediator {...props} />);
    fireEvent.click(screen.getByTestId('hub-help-toggle'));
    const help = screen.getByTestId('hub-help');
    expect(within(help).getByText(/exactly once/i)).toBeInTheDocument();
  });

  it('explains on hover too, since a question mark invites a pointer', () => {
    render(<Mediator {...props} />);
    fireEvent.mouseEnter(screen.getByTestId('hub-help-toggle'));
    expect(screen.getByTestId('hub-help')).toBeInTheDocument();
  });

  it('opens on the queue, because that is what the hub is', () => {
    render(<Mediator {...props} />);
    expect(screen.getByTestId('hub-tab-queue')).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('hub-panel-queue')).toBeInTheDocument();
  });

  it('carries one underline that moves, rather than one per tab that lights up', () => {
    // A border on the selected tab can only switch on and off. A single bar that
    // is told where to go can travel, and travelling is what says the two tabs are
    // two views of one panel rather than two separate things.
    render(<Mediator {...props} />);
    expect(screen.getAllByTestId('hub-tab-underline')).toHaveLength(1);
  });

  it('points the underline at whichever tab is selected', () => {
    render(<Mediator {...props} />);
    const underline = screen.getByTestId('hub-tab-underline');
    expect(underline).toHaveAttribute('data-for', 'queue');
    fireEvent.click(screen.getByTestId('hub-tab-log'));
    expect(underline).toHaveAttribute('data-for', 'log');
  });

  it('switches to the log and back', () => {
    render(<Mediator {...props} />);
    fireEvent.click(screen.getByTestId('hub-tab-log'));
    expect(screen.getByTestId('hub-panel-log')).toHaveAttribute('data-current', 'true');
    expect(screen.getByTestId('hub-panel-queue')).toHaveAttribute('data-current', 'false');

    fireEvent.click(screen.getByTestId('hub-tab-queue'));
    expect(screen.getByTestId('hub-panel-queue')).toHaveAttribute('data-current', 'true');
  });

  it('keeps both panels mounted, so one can slide out as the other slides in', () => {
    // A panel that is unmounted when its tab loses focus has nowhere to travel from.
    // Both are laid over each other and moved sideways instead.
    render(<Mediator {...props} />);
    expect(screen.getByTestId('hub-panel-queue')).toBeInTheDocument();
    expect(screen.getByTestId('hub-panel-log')).toBeInTheDocument();
  });

  it('takes the panel that is off to one side out of reach', () => {
    // The queue is a list of buttons. Parked off-screen and still focusable, it would
    // swallow a dozen tab stops into content nobody can see. CSS visibility does the
    // same job for the pointer and the keyboard once the slide has finished; this is
    // the half of it a screen reader listens to.
    render(<Mediator {...props} />);
    expect(screen.getByTestId('hub-panel-log')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByTestId('hub-panel-queue')).not.toHaveAttribute('aria-hidden');
  });

  it('shows the orders it is holding, not a promise of them', () => {
    render(<Mediator {...props} />);
    const panel = screen.getByTestId('hub-panel-queue');
    expect(within(panel).getByTestId(`order-card-${EVENT}`)).toBeInTheDocument();
  });

  it('shows what just happened under the log tab', () => {
    render(<Mediator {...props} />);
    fireEvent.click(screen.getByTestId('hub-tab-log'));
    expect(within(screen.getByTestId('hub-panel-log')).getByText(/Stripe: confirmed/))
      .toBeInTheDocument();
  });

  it('says what it is doing without being asked to open a tab', () => {
    // The log tab has always held this, and a visitor who never clicks it reads a
    // panel of numbers with no verb in it. The one thing the mediator is doing right
    // now belongs on the outside of the panel.
    render(<Mediator {...props} />);
    expect(screen.getByTestId('hub-doing')).toHaveTextContent(/hubspot/i);
  });

  it('says so plainly when there is nothing to do, rather than going blank', () => {
    render(<Mediator {...props} deliveries={[]} counters={{ ...counters, waiting: 0 }} />);
    expect(screen.getByTestId('hub-doing')).toHaveTextContent(/nothing has come in/i);
  });

  it('wipes the board on request', () => {
    // The reset used to live at the bottom of the page in the control panel drawer,
    // which has gone. It belongs next to the counters it zeroes.
    render(<Mediator {...props} />);
    fireEvent.click(screen.getByTestId('reset-all'));
    expect(fetch).toHaveBeenCalledWith('/api/reset', expect.objectContaining({
      method: 'POST',
    }));
  });

  // The badge and the visitor count came out of the page header when it was cut
  // back to a name and a claim. Both were doing a job, so they moved rather than
  // going: this panel is where the numbers they qualify are.
  it('says the stream is live', () => {
    render(<Mediator {...props} />);
    const live = screen.getByTestId('hub-live');
    expect(live).toHaveTextContent(/live/i);
    expect(live).toHaveAttribute('data-tone', 'live');
  });

  it('says so when the stream has dropped, rather than looking calm', () => {
    render(<Mediator {...props} connected={false} />);
    const live = screen.getByTestId('hub-live');
    expect(live).toHaveTextContent(/connection lost/i);
    expect(live).toHaveAttribute('data-tone', 'lost');
  });

  it('explains why the numbers move when somebody else is here', () => {
    render(<Mediator {...props} viewers={3} />);
    expect(screen.getByTestId('hub-viewers')).toHaveTextContent('2 others here right now');
  });

  it('says nothing about other visitors when there are none', () => {
    render(<Mediator {...props} viewers={1} />);
    expect(screen.queryByTestId('hub-viewers')).not.toBeInTheDocument();
  });
});
