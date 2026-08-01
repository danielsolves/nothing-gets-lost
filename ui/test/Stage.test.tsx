// @vitest-environment jsdom
// ui/test/Stage.test.tsx
// The first twenty-five seconds (specification section 1). What this is, that it is
// running right now, and one obvious thing to press.
//
// The header used to read "● LIVE" and then, as the very next thing on the page,
// "Recorded operation. No model key is configured." That sentence is true of the
// free-text reading step alone, but two of the first three things a visitor read
// contradicted each other. It belongs next to the step it describes.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { Stage } from '../src/Stage';

afterEach(cleanup);

let sent: string[];

beforeEach(() => {
  sent = [];
  vi.stubGlobal('fetch', async (url: string) => {
    sent.push(url);
    return new Response('{}', { status: 200 });
  });
});

afterEach(() => { vi.unstubAllGlobals(); });

const props = { connected: true, viewers: 1 };

describe('Stage', () => {
  it('says what the person behind the page does, before demonstrating it', () => {
    // It read "Nothing gets lost. Not even when you break it.", which is the claim
    // the machine below demonstrates rather than the thing on offer. A visitor
    // arriving from a case list is deciding whether to hire somebody.
    render(<Stage {...props} />);
    expect(screen.getByRole('heading', { level: 1 }))
      .toHaveTextContent(/a business workflow you can trust/i);
  });

  it('says the systems are real and running now', () => {
    render(<Stage {...props} />);
    expect(screen.getByTestId('connection')).toHaveTextContent(/live/i);
  });

  it('says it is reconnecting when the stream drops', () => {
    render(<Stage {...props} connected={false} />);
    expect(screen.getByTestId('connection')).toHaveTextContent(/reconnecting/i);
  });

  it('sends nothing itself, because an order starts at the shop in the drawing', () => {
    // Sent from up here it appeared in the middle of the picture, skipping the one
    // hop the picture exists to show.
    render(<Stage {...props} />);
    expect(screen.queryByTestId('send-order')).not.toBeInTheDocument();
    expect(sent).toEqual([]);
  });

  it('names the problem before naming what was built for it', () => {
    // It opened on five systems and a queue, which answers a question a visitor
    // arriving from a case list has not been asked yet. The gap between systems
    // comes first now, and the machine second.
    render(<Stage {...props} />);
    const intro = screen.getByTestId('stage-intro');
    expect(intro).toHaveTextContent(/work perfectly well on its own/i);
    expect(intro).toHaveTextContent(/move between them/i);
  });

  it('says the systems are real and running, not illustrated', () => {
    render(<Stage {...props} />);
    expect(screen.getByText(/five real systems/i)).toBeInTheDocument();
    expect(screen.getByTestId('connection')).toHaveTextContent(/live/i);
  });

  it('says which way the demo can be broken without pointing at a tile', () => {
    // It used to read "Start at the shop, the first tile in the machine below".
    // The shop is a button at the top of the machine now, so that line pointed at
    // something already in view and named a tile that does not exist.
    render(<Stage {...props} />);
    expect(screen.queryByTestId('stage-hint')).not.toBeInTheDocument();
  });

  it('names whose work this is, before saying what it is', () => {
    // The page is a piece in a portfolio and said so nowhere. A visitor arriving
    // from the case list met a claim about orders with no idea whose claim it was.
    render(<Stage {...props} />);
    expect(screen.getByText(/integration engineer/i)).toBeInTheDocument();
  });

  it('leaves the pressing to the machine, so the phone reaches the button sooner', () => {
    // Every instruction the header used to carry is now in the machine's own head,
    // beside the button it is about. On a 375px screen the header alone was 413px
    // and the first button sat at 766px.
    render(<Stage {...props} />);
    const intro = screen.getByTestId('stage-intro');
    expect(intro).not.toHaveTextContent(/press|click/i);
  });

  it('never puts the recorded-operation note beside the live badge', () => {
    render(<Stage {...props} />);
    expect(screen.queryByTestId('extractor-mode')).not.toBeInTheDocument();
  });

  it('mentions the other visitor when there is one', () => {
    render(<Stage {...props} viewers={2} />);
    expect(screen.getByTestId('presence')).toBeInTheDocument();
  });

  it('stays quiet about presence when nobody else is here', () => {
    render(<Stage {...props} />);
    expect(screen.queryByTestId('presence')).not.toBeInTheDocument();
  });
});
