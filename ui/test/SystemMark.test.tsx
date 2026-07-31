// @vitest-environment jsdom
// ui/test/SystemMark.test.tsx
// Each system gets a mark you recognise before you have read the label.
//
// One treatment for all five rather than real brand logos for some and stand-ins
// for the rest. Two reasons, and the second is the stronger one:
//
//   1. simple-icons carries Stripe and HubSpot but not Slack, which had its mark
//      removed at the trademark holder's request. Two real logos plus one drawn
//      approximation is exactly the mismatched look this redesign exists to fix.
//   2. Our own invoice service and mailer have no logo at all and never will, so
//      any logo-led system would break on two of the five anyway.
//
// Brand colour plus a glyph that says what the system does carries the
// recognition without copying anyone's mark or hand-drawing a bad one.
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
