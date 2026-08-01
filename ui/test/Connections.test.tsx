// @vitest-environment jsdom
// ui/test/Connections.test.tsx
// The one thing left in this panel, and the reason it is the one thing left.
//
// It held three rows: connect your Slack, connect your HubSpot, and a url of your
// own. The two OAuth rows are gone, so the tests that matter here are the negative
// ones: nothing on this panel may ask a visitor to log in to anything, and nothing
// may promise them a token store that no longer exists.
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Connections } from '../src/Connections';

afterEach(cleanup);

let sent: Array<{ url: string; body: unknown }>;
let reply: { ok: boolean; body: unknown };

beforeEach(() => {
  sent = [];
  reply = { ok: true, body: { ok: true } };
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    sent.push({ url, body: JSON.parse(String(init?.body ?? 'null')) });
    return new Response(JSON.stringify(reply.body), {
      status: reply.ok ? 200 : 400,
      headers: { 'content-type': 'application/json' },
    });
  });
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('Connections', () => {
  it('offers no way to connect an account of the visitor', () => {
    render(<Connections />);
    expect(screen.queryByText(/add to slack/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/connect hubspot/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/disconnect/i)).not.toBeInTheDocument();
  });

  // The scopes line and the promise that a token is deleted after 24 hours described
  // a store that no longer exists. A page whose subject is being worth trusting
  // cannot carry a data-protection promise about nothing.
  it('promises nothing about tokens or scopes', () => {
    const { container } = render(<Connections />);
    expect(container).not.toHaveTextContent(/scope/i);
    expect(container).not.toHaveTextContent(/24 hours/i);
  });

  // The tab that opens this panel is already called "Your own endpoint". A heading
  // repeating it back is a line that says nothing.
  it('does not repeat the name of the tab that opened it', () => {
    render(<Connections />);
    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
  });

  it('asks for nothing but a url', () => {
    render(<Connections />);
    expect(screen.getByTestId('webhook-url')).toBeInTheDocument();
    expect(screen.getAllByRole('button')).toHaveLength(1);
  });

  // Somebody who has never set a webhook target up cannot tell whether this is for
  // them. Naming a throwaway service is what turns the field from a thing for
  // developers into thirty seconds of work for anyone.
  it('says how to get a url without installing anything', () => {
    render(<Connections />);
    expect(screen.getByText(/webhook\.site/i)).toBeInTheDocument();
  });

  it('saves the url the visitor typed', async () => {
    render(<Connections />);
    fireEvent.change(screen.getByTestId('webhook-url'), {
      target: { value: 'https://mine.example/hook' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(sent).toEqual([
      { url: '/api/webhook-target', body: { url: 'https://mine.example/hook' } },
    ]));
  });

  // Nothing else on the page moves when this works: the deliveries go to a url only
  // the visitor can watch. Without a word here, a saved endpoint and a rejected one
  // look the same.
  it('says so once it is saved', async () => {
    render(<Connections />);
    fireEvent.change(screen.getByTestId('webhook-url'), {
      target: { value: 'https://mine.example/hook' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByTestId('webhook-saved')).toHaveTextContent(/saved/i);
  });

  it('says why a url was refused, rather than going quiet', async () => {
    reply = { ok: false, body: { message: 'that address is not reachable from here' } };
    render(<Connections />);
    fireEvent.change(screen.getByTestId('webhook-url'), {
      target: { value: 'http://127.0.0.1/hook' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByTestId('webhook-error'))
      .toHaveTextContent(/not reachable from here/i);
    expect(screen.queryByTestId('webhook-saved')).not.toBeInTheDocument();
  });
});
