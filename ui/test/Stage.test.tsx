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
  it('makes the claim before anything else', () => {
    render(<Stage {...props} />);
    expect(screen.getByRole('heading', { level: 1 }))
      .toHaveTextContent(/nothing gets lost/i);
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

  it('says where to start and that the systems are the controls', () => {
    // The first thing to press is no longer the first thing on the screen, so this
    // line carries the whole success criterion on its own. It is pinned.
    render(<Stage {...props} />);
    const hint = screen.getByTestId('stage-hint');
    expect(hint).toHaveTextContent(/shop/i);
    expect(hint).toHaveTextContent(/menu on any system/i);
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
