// @vitest-environment jsdom
// ui/test/TileMenu.test.tsx
// The control that replaced the drawer at the bottom of the page.
//
// The one rule it must not break: it is not hover-only. A menu that appears when a
// pointer arrives is unreachable on a phone and unreachable from a keyboard, and the
// specification says the typical visitor may well be on a phone. So the button is
// always in the DOM and only quiet, and the rest is ordinary menu behaviour.
import { describe, it, expect, vi, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import { TileMenu } from '../src/TileMenu';

afterEach(cleanup);

function renderMenu(overrides: Partial<Parameters<typeof TileMenu>[0]> = {}) {
  const chose = vi.fn();
  render(
    <TileMenu
      testId="stripe"
      menuLabel="Break Stripe on purpose"
      sections={[
        {
          heading: 'How it behaves',
          items: [
            { id: 'up', label: 'Reachable', means: 'Calls go through', chosen: true, run: chose },
            { id: 'cut', label: 'Unreachable', means: 'The line is dead', chosen: false, run: chose },
          ],
        },
        { items: [{ id: 'duplicate_webhook', label: 'Deliver the payment twice', run: chose }] },
      ]}
      {...overrides}
    />,
  );
  return chose;
}

describe('TileMenu', () => {
  it('is there before anything is hovered, because touch has no hover', () => {
    renderMenu();
    expect(screen.getByTestId('menu-stripe')).toBeInTheDocument();
  });

  it('says what it opens rather than being three unlabelled dots', () => {
    renderMenu();
    expect(screen.getByTestId('menu-stripe'))
      .toHaveAccessibleName(/break stripe on purpose/i);
  });

  it('starts closed, so five tiles do not shout at once', () => {
    renderMenu();
    expect(screen.getByTestId('menu-stripe')).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('opens on a click and shows what each choice does', () => {
    renderMenu();
    fireEvent.click(screen.getByTestId('menu-stripe'));
    expect(screen.getByRole('menu')).toBeInTheDocument();
    expect(screen.getByTestId('menu-stripe-cut')).toHaveTextContent('The line is dead');
  });

  it('marks the state that is in force, so the menu doubles as the readout', () => {
    renderMenu();
    fireEvent.click(screen.getByTestId('menu-stripe'));
    expect(screen.getByTestId('menu-stripe-up')).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByTestId('menu-stripe-cut')).toHaveAttribute('aria-checked', 'false');
  });

  it('leaves a one-off action unchecked, because it is not a state to be in', () => {
    renderMenu();
    fireEvent.click(screen.getByTestId('menu-stripe'));
    expect(screen.getByTestId('menu-stripe-duplicate_webhook'))
      .not.toHaveAttribute('aria-checked');
  });

  it('runs the choice and closes', () => {
    const chose = renderMenu();
    fireEvent.click(screen.getByTestId('menu-stripe'));
    fireEvent.click(screen.getByTestId('menu-stripe-cut'));
    expect(chose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('closes on escape and hands the focus back', () => {
    renderMenu();
    const button = screen.getByTestId('menu-stripe');
    fireEvent.click(button);
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(button).toHaveFocus();
  });

  it('closes when the visitor goes somewhere else on the page', () => {
    renderMenu();
    fireEvent.click(screen.getByTestId('menu-stripe'));
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('puts the keyboard on the first choice as soon as it opens', () => {
    renderMenu();
    fireEvent.click(screen.getByTestId('menu-stripe'));
    expect(screen.getByTestId('menu-stripe-up')).toHaveFocus();
  });
});
