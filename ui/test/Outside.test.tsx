// @vitest-environment jsdom
// ui/test/Outside.test.tsx
// The section that holds the two checks a stranger can make without us.
//
// The assertion that matters is the one about tabs. This strip used to hold its
// panels behind a tab bar with none of them open, and three surfaces that argued the
// page was checkable have since been removed. Folding away what is left would put the
// whole remaining argument behind a click most readers never make.
import { describe, it, expect, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { Outside } from '../src/Outside';

afterEach(cleanup);

const panels = {
  endpoint: <p>the endpoint panel</p>,
  mcp: <p>the mcp panel</p>,
};

describe('Outside', () => {
  it('shows both panels without anything being pressed first', () => {
    render(<Outside {...panels} />);
    expect(screen.getByText('the endpoint panel')).toBeInTheDocument();
    expect(screen.getByText('the mcp panel')).toBeInTheDocument();
  });

  it('has no tabs left to open', () => {
    render(<Outside {...panels} />);
    expect(screen.queryAllByRole('tab')).toHaveLength(0);
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
  });

  it('says what the two are for, under one heading', () => {
    render(<Outside {...panels} />);
    expect(screen.getByRole('heading', { name: 'Check it without us' })).toBeInTheDocument();
  });

  it('keeps the two in one row, so neither reads as an afterthought', () => {
    const { container } = render(<Outside {...panels} />);
    const row = container.querySelector('.outside-panels');
    expect(row?.children).toHaveLength(2);
  });
});
