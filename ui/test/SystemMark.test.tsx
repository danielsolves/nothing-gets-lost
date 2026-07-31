// @vitest-environment jsdom
// ui/test/SystemMark.test.tsx
// Each system gets a mark you recognise before you have read the label.
//
// The published outline of the real mark, in that brand's colour. Not the
// full-colour logo: Slack's alone is four colours, and three foreign palettes would
// fight the single accent the rest of the page is built on. The shape carries the
// recognition, the colour stays consistent.
//
// Our own invoice service and mailer have no mark to be faithful to, so they take a
// function glyph instead. Both routes have to work or the row breaks.
import { describe, it, expect, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { SystemMark, SYSTEM_LOOK } from '../src/SystemMark';

afterEach(cleanup);

describe('SystemMark', () => {
  it('has a look for every system the diagram draws', () => {
    for (const target of ['stripe', 'hubspot', 'ledger', 'slack', 'mailer'] as const) {
      expect(SYSTEM_LOOK[target]).toBeDefined();
    }
  });

  it('carries each brand its own colour', () => {
    expect(SYSTEM_LOOK.stripe.tint).not.toBe(SYSTEM_LOOK.hubspot.tint);
    expect(SYSTEM_LOOK.slack.tint).not.toBe(SYSTEM_LOOK.stripe.tint);
  });

  it('renders a mark for a system', () => {
    render(<SystemMark target="stripe" />);
    expect(screen.getByTestId('mark-stripe')).toBeInTheDocument();
  });

  it('draws the real outline for a system that has one', () => {
    const { container } = render(<SystemMark target="stripe" />);
    const svg = container.querySelector('svg');
    expect(svg).toHaveAttribute('viewBox', '0 0 24 24');
    expect(svg?.querySelectorAll('path')).toHaveLength(1);
  });

  it('draws every piece of a mark built from several paths', () => {
    // Slack's hash is four shapes. Dropping three of them would leave a mark that
    // is recognisably wrong, which is worse than a neutral glyph.
    const { container } = render(<SystemMark target="slack" />);
    expect(container.querySelectorAll('svg path')).toHaveLength(4);
  });

  it('fills the outline with one colour rather than the brand palette', () => {
    const { container } = render(<SystemMark target="slack" />);
    expect(container.querySelector('svg')).toHaveAttribute('fill', 'currentColor');
    for (const path of container.querySelectorAll('svg path')) {
      expect(path).not.toHaveAttribute('fill');
    }
  });

  it('tints the mark with the brand colour', () => {
    render(<SystemMark target="hubspot" />);
    expect(screen.getByTestId('mark-hubspot'))
      .toHaveStyle({ '--mark-tint': SYSTEM_LOOK.hubspot.tint });
  });

  it('hides the glyph from screen readers, since the name is right beside it', () => {
    render(<SystemMark target="slack" />);
    expect(screen.getByTestId('mark-slack')).toHaveAttribute('aria-hidden', 'true');
  });

  it('gives our own services a mark too, so the row does not break', () => {
    render(<SystemMark target="ledger" />);
    expect(screen.getByTestId('mark-ledger')).toBeInTheDocument();
  });
});
