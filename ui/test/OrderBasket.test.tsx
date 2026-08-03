// @vitest-environment jsdom
// ui/test/OrderBasket.test.tsx
// The catalogue with a stepper on every row, and the basket a builder opens with.
//
// These assertions are not new. They were in OrderForm.test.tsx and moved here with
// the code they are about: the builder gained a second way of composing an order, the
// file it lived in reached its line ceiling, and the product list came out into a
// component of its own. Moving the test with the unit keeps the two together, which
// is the only reason this file exists.
//
// What is asserted is what the list must never do: open on an empty basket, which
// makes the send button dead the moment the panel unfolds, and name every stepper
// button after the product it changes rather than after the sign printed on it.
import { describe, it, expect, afterEach, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import { OrderBasket, randomBasket } from '../src/OrderBasket';

afterEach(cleanup);

const CATALOG = [
  { sku: 'TEAPOT', name: 'Cast iron teapot', cents: 4900 },
  { sku: 'MUG-BLUE', name: 'Blue mug', cents: 1200 },
];

describe('randomBasket', () => {
  it('never opens on an empty basket, whatever the dice say', () => {
    // An empty basket disables the send button the moment the panel opens, which
    // reads as the demo being broken rather than as a form to fill in.
    for (const roll of [0, 0.999, 0.5, 0.25]) {
      const basket = randomBasket(CATALOG, () => roll);
      expect(Object.values(basket).filter((qty) => qty > 0).length).toBeGreaterThan(0);
    }
  });

  it('never puts more in the basket than the catalogue holds', () => {
    expect(Object.keys(randomBasket(CATALOG, () => 0.999)).length)
      .toBeLessThanOrEqual(CATALOG.length);
    expect(randomBasket([], () => 0.5)).toEqual({});
  });
});

describe('OrderBasket', () => {
  it('names each button after the thing it changes', () => {
    // Two dozen buttons all called "+" is a screen reader reading out a row of
    // plus signs. The label carries the product.
    render(<OrderBasket catalog={CATALOG} quantities={{ TEAPOT: 1 }} onStep={() => {}} />);
    expect(screen.getByLabelText('One more Cast iron teapot')).toBeInTheDocument();
    expect(screen.getByLabelText('One fewer Blue mug')).toBeInTheDocument();
  });

  it('asks for one more or one fewer, and changes nothing itself', () => {
    // The quantities belong to the panel that sends the order. A list that kept its
    // own copy would be a basket in one file and a send button in another with
    // nobody owning the thing they disagree about.
    const step = vi.fn();
    render(<OrderBasket catalog={CATALOG} quantities={{ TEAPOT: 2 }} onStep={step} />);
    fireEvent.click(screen.getByTestId('more-TEAPOT'));
    expect(step).toHaveBeenCalledWith('TEAPOT', 1);
    fireEvent.click(screen.getByTestId('less-TEAPOT'));
    expect(step).toHaveBeenCalledWith('TEAPOT', -1);
    expect(screen.getByTestId('qty-TEAPOT')).toHaveTextContent('2');
  });

  it('will not go below nothing', () => {
    render(<OrderBasket catalog={CATALOG} quantities={{ TEAPOT: 0 }} onStep={() => {}} />);
    expect(screen.getByTestId('less-TEAPOT')).toBeDisabled();
  });
});
