// @vitest-environment jsdom
// ui/test/Built.test.tsx
// The closing section, which says what the page is built with.
//
// This started as prose about architecture and had to be pulled back to a stack. The
// tests are written to hold it there. The first one names the five technologies a
// reader scans for, so they can never sink back into a paragraph. The second caps
// every line at one sentence's worth of characters, which is the assertion the
// version before this one failed and which would fail again the moment an argument
// starts growing inside a tile.
//
// The rest are what the earlier version got right and is worth keeping: the numbers
// are the repository's own, the admission about the queue survives, and the section
// links nowhere, because the repository is not published and a dead link is a claim
// a reader cannot check.
import { describe, it, expect, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { Built } from '../src/Built';

afterEach(cleanup);

const MAX_ROLE_CHARS = 80;

describe('Built', () => {
  it('says what it is under one heading', () => {
    render(<Built />);
    expect(screen.getByRole('heading', { name: 'Built with' })).toBeInTheDocument();
  });

  it('names the technologies a five second reader is looking for', () => {
    render(<Built />);
    for (const name of ['TypeScript', 'React', 'NestJS', 'Postgres', 'Docker Compose']) {
      expect(screen.getByText(name)).toBeInTheDocument();
    }
  });

  it('is a stack and not an essay: one short line per entry', () => {
    render(<Built />);
    const items = screen.getAllByRole('listitem');
    expect(items.length).toBeGreaterThanOrEqual(10);
    for (const item of items) {
      const text = item.querySelector('.built-role')?.textContent ?? '';
      expect(text.length).toBeGreaterThan(0);
      expect(text.length).toBeLessThanOrEqual(MAX_ROLE_CHARS);
    }
  });

  it('gives every entry a name and a figure beside it', () => {
    render(<Built />);
    for (const item of screen.getAllByRole('listitem')) {
      expect(item.querySelector('.built-name')?.textContent).toBeTruthy();
      expect(item.querySelector('.built-figure')?.textContent).toBeTruthy();
    }
  });

  it('carries the repository numbers as figures rather than sentences', () => {
    render(<Built />);
    const figures = [...screen.getByTestId('built-stack').querySelectorAll('.built-figure')]
      .map((node) => node.textContent);
    // The soak result, the integration scenarios, the migration count, and what
    // docker compose brings up. All four are counted in the repository.
    expect(figures).toContain('10,000 events');
    expect(figures).toContain('9 scenarios');
    expect(figures).toContain('16 migrations');
    expect(figures).toContain('10 services');
  });

  it('keeps the admission about the hand-written queue, in one line', () => {
    render(<Built />);
    const note = screen.getByTestId('built-note').textContent ?? '';
    expect(note).toMatch(/wrong call in most projects/i);
    expect(note.length).toBeLessThanOrEqual(220);
  });

  it('links nowhere, because there is nothing published to link to', () => {
    render(<Built />);
    expect(screen.queryAllByRole('link')).toHaveLength(0);
  });

  it('does not open a second introduction at the foot', () => {
    render(<Built />);
    expect(screen.queryAllByRole('heading', { level: 1 })).toHaveLength(0);
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });
});
