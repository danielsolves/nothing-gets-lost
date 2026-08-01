// @vitest-environment jsdom
// ui/test/OrderCheck.test.tsx
// One checkpoint on a card, drawn as the system's own mark.
//
// It was a coloured dot, then a small checkbox. Both were anonymous: five identical
// boxes in a row, and the only way to learn which one was HubSpot was to open the
// card. The tiles in the diagram already carry the Stripe S, the HubSpot sprocket
// and the Slack hash, so the card wears the same marks and the two drawings read as
// one thing seen twice.
//
// Not an input. Nothing here is settable by a visitor, so a real checkbox would
// promise something it cannot do and would put forty tab stops in a scrolling list.
// It is an image with a name, which is what a state indicator actually is.
//
// The tick is deliberately not the only state. A mark that is either plain or ticked
// says delivered and not-delivered, and the card used to say five things. So the
// overlay in the corner carries the rest: a spinner while it is going out, an
// hourglass while it waits to retry, a person once it is in the backlog. Colour
// agrees with all of it and carries none of it on its own, because a screenshot and
// a colour-blind reader both lose colour.
import { describe, it, expect, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { OrderCheck } from '../src/OrderCheck';

afterEach(cleanup);

/**
 * The overlay in the corner, or null when the state does not have one. Found by the
 * attribute rather than by a test id: a card head holds five of these, so an id
 * would have to be unique per checkpoint to be worth anything.
 */
function badge(): Element | null {
  return screen.getByRole('img').querySelector('[data-badge]');
}

describe('OrderCheck', () => {
  it('is not something a visitor can tick', () => {
    render(<OrderCheck target="stripe" label="Stripe" state="done" attempts={1} />);
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(document.querySelector('input')).toBeNull();
  });

  it('draws the system its own mark rather than an anonymous box', () => {
    render(<OrderCheck target="hubspot" label="HubSpot" state="done" attempts={1} />);
    expect(screen.getByTestId('mark-hubspot')).toBeInTheDocument();
  });

  it('gives our own services a mark too, the same one the tile wears', () => {
    // The invoice service and the confirmation mail have no brand to be faithful to
    // and take a function glyph on the tiles. The card asks the same table.
    for (const target of ['ledger', 'mailer'] as const) {
      cleanup();
      render(<OrderCheck target={target} label="x" state="done" attempts={1} />);
      expect(screen.getByTestId(`mark-${target}`)).toBeInTheDocument();
    }
  });

  it('has a mark for the visitor own endpoint, which is a sixth checkpoint', () => {
    render(<OrderCheck target="custom_webhook" label="Your endpoint" state="pending" attempts={0} />);
    expect(screen.getByTestId('mark-custom_webhook')).toBeInTheDocument();
  });

  it('says the checkpoint and its state in words, not in colour', () => {
    render(<OrderCheck target="stripe" label="Stripe" state="done" attempts={1} />);
    expect(screen.getByRole('img', { name: /^Stripe: / })).toBeInTheDocument();
  });

  it('gives each state its own name, and retrying a name of its own', () => {
    const cases = [
      ['done', 1], ['inflight', 1], ['pending', 0], ['pending', 4],
      ['dead', 6], ['waiting', 0],
    ] as const;
    const names = cases.map(([state, attempts]) => {
      cleanup();
      render(<OrderCheck target="slack" label="Slack" state={state} attempts={attempts} />);
      return screen.getByRole('img').getAttribute('aria-label');
    });
    expect(new Set(names).size).toBe(6);
  });

  it('names one thing only, so the mark inside does not get read out twice', () => {
    render(<OrderCheck target="slack" label="Slack" state="inflight" attempts={1} />);
    expect(screen.getAllByRole('img')).toHaveLength(1);
  });

  it('carries the look for the sheet to draw, since a mark cannot hold six', () => {
    render(<OrderCheck target="slack" label="Slack" state="inflight" attempts={1} />);
    expect(screen.getByRole('img')).toHaveAttribute('data-look', 'sending');
  });

  it('overlays a tick on a checkpoint that is through', () => {
    render(<OrderCheck target="ledger" label="Invoice" state="done" attempts={1} />);
    expect(badge()).toHaveAttribute('data-badge', 'delivered');
  });

  it('overlays a person on one in the backlog, because that is what changed', () => {
    // A cross would say "failed", and failed is the state before this one. What is
    // different about this one is that it has been handed to somebody.
    render(<OrderCheck target="hubspot" label="HubSpot" state="dead" attempts={6} />);
    expect(badge()).toHaveAttribute('data-badge', 'parked');
  });

  it('overlays an hourglass while it is waiting to try again', () => {
    render(<OrderCheck target="slack" label="Slack" state="pending" attempts={2} />);
    expect(badge()).toHaveAttribute('data-badge', 'retrying');
  });

  it('overlays a loading indicator while it is on the wire', () => {
    render(<OrderCheck target="stripe" label="Stripe" state="inflight" attempts={1} />);
    expect(badge()).toHaveAttribute('data-badge', 'sending');
  });

  it('overlays nothing at all on a checkpoint nothing has happened to', () => {
    for (const [state, attempts] of [['waiting', 0], ['pending', 0]] as const) {
      cleanup();
      render(<OrderCheck target="mailer" label="Confirmation mail"
                         state={state} attempts={attempts} />);
      expect(badge()).toBeNull();
    }
  });

  it('keeps the overlay out of a reader ear, since the name already said it', () => {
    render(<OrderCheck target="stripe" label="Stripe" state="done" attempts={1} />);
    expect(badge()).toHaveAttribute('aria-hidden', 'true');
  });

  it('can be found by test id when a card needs to point at one', () => {
    render(<OrderCheck target="slack" label="Slack" state="pending" attempts={0}
                       testId="order-check-evt-slack" />);
    expect(screen.getByTestId('order-check-evt-slack')).toBeInTheDocument();
  });
});
