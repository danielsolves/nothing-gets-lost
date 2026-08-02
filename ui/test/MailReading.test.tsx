// @vitest-environment jsdom
// ui/test/MailReading.test.tsx
// One reading of one mail, drawn.
//
// Three of these tests are the feature rather than the component. A refusal must
// carry no way to place anything, so the confirmation step cannot be walked past by
// a visitor who did not read the verdict. A recorded answer must say it is recorded,
// on the answer itself, because that is the fact that is true of it. And what the
// model said has to be on screen next to what was done about it, in both directions:
// a page that shows the raw answer only when it was refused would be showing its
// evidence exactly when it is least needed.
import { describe, it, expect, afterEach, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import type { ExtractOrderResponse } from '@ngl/contracts';
import { MailReading } from '../src/MailReading';

afterEach(cleanup);

const PROPOSED: ExtractOrderResponse = {
  ok: true,
  mode: 'recorded',
  raw: {
    customer: { name: 'M. Berger', email: 'm@example.com' },
    items: [{ sku: 'MUG-BLUE', qty: 3 }],
    notes: 'invoice to head office as usual',
  },
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

const INVENTED: ExtractOrderResponse = {
  ok: false,
  mode: 'recorded',
  raw: { items: [{ sku: 'MUG-AZURE', qty: 4 }] },
  stoppedBy: 'catalog',
  detail: 'unknown sku: MUG-AZURE',
};

const MALFORMED: ExtractOrderResponse = {
  ok: false,
  mode: 'recorded',
  raw: { customer: { name: 'M. Berger', email: 'm@example.com' }, items: [], notes: null },
  stoppedBy: 'schema',
  detail: 'items: Array must contain at least 1 element(s)',
};

function draw(result: ExtractOrderResponse, over: {
  placing?: boolean; placed?: boolean; anchored?: boolean;
  onConfirm?: () => void; onDiscard?: () => void;
} = {}) {
  render(
    <MailReading
      result={result}
      placing={over.placing ?? false}
      placed={over.placed ?? false}
      anchored={over.anchored ?? false}
      onConfirm={over.onConfirm ?? (() => {})}
      onDiscard={over.onDiscard ?? (() => {})}
    />,
  );
}

describe('MailReading', () => {
  it('shows what the model answered, whether it was accepted or refused', () => {
    for (const result of [PROPOSED, INVENTED]) {
      cleanup();
      draw(result);
      expect(screen.getByTestId('mail-raw')).toBeInTheDocument();
    }
  });

  it('prints the answer as it came, rather than a sentence about it', () => {
    draw(INVENTED);
    expect(screen.getByTestId('mail-raw')).toHaveTextContent('MUG-AZURE');
  });

  it('says a recorded answer is a recording, and says no model was called', () => {
    draw(PROPOSED);
    const mode = screen.getByTestId('mail-mode');
    expect(mode).toHaveAttribute('data-mode', 'recorded');
    expect(mode).toHaveTextContent(/recorded/i);
    expect(mode).toHaveTextContent(/no model/i);
  });

  it('says a live answer is a live one, in different words', () => {
    draw({ ...PROPOSED, mode: 'live' });
    const mode = screen.getByTestId('mail-mode');
    expect(mode).toHaveAttribute('data-mode', 'live');
    expect(mode).not.toHaveTextContent(/recorded/i);
  });

  it('names the catalogue check when an article does not exist, and what it found', () => {
    draw(INVENTED);
    expect(screen.getByTestId('mail-stopped')).toHaveAttribute('data-check', 'catalog');
    expect(screen.getByTestId('mail-stopped')).toHaveTextContent(/catalogue/i);
    expect(screen.getByTestId('mail-detail')).toHaveTextContent('unknown sku: MUG-AZURE');
  });

  it('names the schema check when the answer is not shaped like an order', () => {
    draw(MALFORMED);
    expect(screen.getByTestId('mail-stopped')).toHaveAttribute('data-check', 'schema');
    expect(screen.getByTestId('mail-stopped')).toHaveTextContent(/schema/i);
  });

  it('says plainly that a refused reading placed nothing', () => {
    draw(INVENTED);
    expect(screen.getByTestId('mail-stopped')).toHaveTextContent(/nothing was placed/i);
  });

  it('offers nothing to press on a refusal, so there is nothing to press past', () => {
    for (const result of [INVENTED, MALFORMED]) {
      cleanup();
      draw(result);
      expect(screen.queryByTestId('confirm-order')).not.toBeInTheDocument();
      expect(screen.queryByTestId('mail-proposal')).not.toBeInTheDocument();
    }
  });

  it('lists the basket it would place, priced by the line', () => {
    draw(PROPOSED);
    const proposal = screen.getByTestId('mail-proposal');
    expect(proposal).toHaveTextContent('Blue mug');
    expect(proposal).toHaveTextContent('36.00');
    expect(proposal).toHaveTextContent('Oak coaster');
    expect(screen.getByTestId('mail-total')).toHaveTextContent('45.00');
  });

  it('says the money is the catalogue and not the model', () => {
    draw(PROPOSED);
    expect(screen.getByTestId('mail-proposal')).toHaveTextContent(/catalogue/i);
  });

  it('shows the address it read and says it is not written to', () => {
    // It is part of what was read, so hiding it would be hiding the answer. It is
    // not used, because a text box that mails whoever it names mails anyone.
    draw(PROPOSED);
    const proposal = screen.getByTestId('mail-proposal');
    expect(proposal).toHaveTextContent('m@example.com');
    expect(proposal).toHaveTextContent(/not written to/i);
  });

  it('says why a person presses the button and a check cannot', () => {
    // The argument the whole feature makes. A quantity read wrong is well formed and
    // in the catalogue, so both checks pass and only a reader notices.
    draw(PROPOSED);
    expect(screen.getByTestId('mail-why')).toHaveTextContent(/dozen/i);
  });

  it('places nothing by itself: the button calls back and does no more', () => {
    const confirm = vi.fn();
    draw(PROPOSED, { onConfirm: confirm });
    fireEvent.click(screen.getByTestId('confirm-order'));
    expect(confirm).toHaveBeenCalledTimes(1);
  });

  it('can be thrown away without placing anything', () => {
    const discard = vi.fn();
    draw(PROPOSED, { onDiscard: discard });
    fireEvent.click(screen.getByTestId('discard-order'));
    expect(discard).toHaveBeenCalledTimes(1);
  });

  it('will not take a second press while the first one is going out', () => {
    draw(PROPOSED, { placing: true });
    expect(screen.getByTestId('confirm-order')).toBeDisabled();
  });

  it('takes the button away once the order is placed, so it cannot be placed twice', () => {
    draw(PROPOSED, { placed: true });
    expect(screen.queryByTestId('confirm-order')).not.toBeInTheDocument();
    expect(screen.getByTestId('mail-placed')).toHaveTextContent(/queue/i);
  });

  it('hangs the wire on the confirm button, but only when it is asked to', () => {
    // The wire into the integration hub hangs on whichever control puts an order
    // into it. On this path that is this button, and the panel around it decides
    // whether this path is the one on screen.
    draw(PROPOSED);
    expect(screen.getByTestId('confirm-order')).not.toHaveAttribute('data-wire-anchor');
    cleanup();
    draw(PROPOSED, { anchored: true });
    expect(screen.getByTestId('confirm-order')).toHaveAttribute('data-wire-anchor');
  });

  it('hangs it on nothing at all when there is nothing to place', () => {
    // A refusal carries no button, so there is nothing here for a wire to point at
    // and it must not land on the panel instead.
    draw(INVENTED, { anchored: true });
    expect(document.querySelectorAll('[data-wire-anchor]')).toHaveLength(0);
  });

  it('hangs it on nothing once the order has gone', () => {
    draw(PROPOSED, { anchored: true, placed: true });
    expect(document.querySelectorAll('[data-wire-anchor]')).toHaveLength(0);
  });
});
