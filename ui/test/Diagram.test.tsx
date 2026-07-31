// @vitest-environment jsdom
// ui/test/Diagram.test.tsx
// The diagram is now the interface, not a picture of one. Breaking something was a
// scroll past the whole page and a click into a drawer called "Control panel"; the
// success criterion in specification section 1 is that a stranger breaks something on
// purpose within sixty seconds, and that distance was the thing in the way.
//
// So the box you want to break is the button that breaks it, and the state lands back
// on the same box. The four-state panel stays in the drawer for anyone who wants the
// range: the diagram offers the one dramatic action.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import type { DeliveryView, SwitchState, SwitchableTarget } from '@ngl/contracts';
import { Diagram } from '../src/Diagram';

afterEach(cleanup);

const ALL_UP: Record<SwitchableTarget, SwitchState> = {
  hubspot: 'up', stripe: 'up', slack: 'up', ledger: 'up', mailer: 'up',
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
    return new Response('{}', { status: 200 });
  });
});

afterEach(() => { vi.unstubAllGlobals(); });

describe('Diagram', () => {
  it('draws the mediator and every system it delivers to', () => {
    render(<Diagram switches={ALL_UP} deliveries={[]} />);
    expect(screen.getByTestId('mediator')).toBeInTheDocument();
    for (const target of ['stripe', 'hubspot', 'ledger', 'slack', 'mailer']) {
      expect(screen.getByTestId(`box-${target}`)).toBeInTheDocument();
    }
  });

  it('cuts the line when a reachable system is clicked', () => {
    render(<Diagram switches={ALL_UP} deliveries={[]} />);
    fireEvent.click(screen.getByTestId('box-hubspot'));
    expect(sent).toEqual([{ url: '/api/switches/hubspot', body: { state: 'cut' } }]);
  });

  it('puts the line back when a cut system is clicked again', () => {
    render(<Diagram switches={{ ...ALL_UP, hubspot: 'cut' }} deliveries={[]} />);
    fireEvent.click(screen.getByTestId('box-hubspot'));
    expect(sent).toEqual([{ url: '/api/switches/hubspot', body: { state: 'up' } }]);
  });

  it('restores a system that is failing or slow rather than cutting it further', () => {
    render(<Diagram switches={{ ...ALL_UP, slack: 'error' }} deliveries={[]} />);
    fireEvent.click(screen.getByTestId('box-slack'));
    expect(sent).toEqual([{ url: '/api/switches/slack', body: { state: 'up' } }]);
  });

  it('is reachable from a keyboard, because clicking is not the only way', () => {
    render(<Diagram switches={ALL_UP} deliveries={[]} />);
    expect(screen.getByTestId('box-hubspot').tagName).toBe('BUTTON');
  });

  it('says what the click will do, not just the name of the system', () => {
    render(<Diagram switches={ALL_UP} deliveries={[]} />);
    expect(screen.getByTestId('box-hubspot')).toHaveAccessibleName(/cut the line to HubSpot/i);
  });

  it('says the click will reconnect once the line is cut', () => {
    render(<Diagram switches={{ ...ALL_UP, hubspot: 'cut' }} deliveries={[]} />);
    expect(screen.getByTestId('box-hubspot')).toHaveAccessibleName(/reconnect HubSpot/i);
  });

  it('carries the state on the box, so the click shows its own consequence', () => {
    render(<Diagram switches={{ ...ALL_UP, hubspot: 'cut' }} deliveries={[]} />);
    expect(screen.getByTestId('box-hubspot')).toHaveAttribute('data-state', 'cut');
  });

  it('carries the state on the line as well as the box', () => {
    render(<Diagram switches={{ ...ALL_UP, hubspot: 'cut' }} deliveries={[]} />);
    expect(screen.getByTestId('line-hubspot')).toHaveAttribute('data-state', 'cut');
  });

  it('counts what is held up at a system', () => {
    render(<Diagram switches={{ ...ALL_UP, hubspot: 'cut' }} deliveries={waiting} />);
    expect(screen.getByTestId('box-hubspot')).toHaveTextContent('1 waiting');
  });

  it('says nothing about waiting when nothing is', () => {
    render(<Diagram switches={ALL_UP} deliveries={[]} />);
    expect(screen.getByTestId('box-hubspot')).not.toHaveTextContent('waiting');
  });

  it('marks nothing while no order is open in the queue', () => {
    render(<Diagram switches={ALL_UP} deliveries={waiting} />);
    expect(screen.getByTestId('box-hubspot')).not.toHaveAttribute('data-tracked');
  });

  it('marks the systems the open order is still waiting on', () => {
    // The card and the wires are the same thing seen twice, so opening a card has
    // to be visible over here or the two panels are just neighbours.
    render(<Diagram switches={ALL_UP} deliveries={waiting} openOrder="evt-1" />);
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
    render(<Diagram switches={ALL_UP} deliveries={mixed} openOrder="evt-1" />);
    expect(screen.getByTestId('box-stripe')).toHaveAttribute('data-tracked', 'done');
  });

  it('leaves the systems of another order unmarked', () => {
    render(<Diagram switches={ALL_UP} deliveries={waiting} openOrder="evt-other" />);
    expect(screen.getByTestId('box-hubspot')).not.toHaveAttribute('data-tracked');
  });
});
