// ui/src/Outside.tsx
// The two ways to check this page from somewhere that is not this page.
//
// It replaces a strip called "Go further", which held its panels behind tabs and
// opened none of them by default. That was right while it held five things and a
// visitor could not be asked to choose between them on arrival. It held one, and a
// closed tab in front of a single panel is a click charged for nothing.
//
// It matters more than that now. Three surfaces that argued the page was checkable
// have been removed: the visitor OAuth, the SQL console and the proof block. What is
// left that a stranger can verify without us is the Stripe receipt, the confirmation
// mail, and these two. Keeping them folded away put the whole remaining argument
// behind a click most readers never make.
//
// Side by side and open, under a heading that says what they are for. They are the
// same argument from opposite ends: one sends our deliveries to a server the reader
// runs, the other serves our records to a client the reader runs. Neither asks the
// reader to believe anything we drew.
import type { ReactNode } from 'react';

export function Outside(props: { endpoint: ReactNode; mcp: ReactNode }) {
  return (
    <section className="outside" data-testid="outside">
      <div className="outside-head">
        <h2>Check it without us</h2>
        <p>
          Everything above is drawn by this page. These two are not: they put the same
          records somewhere we do not run, where you can read them yourself.
        </p>
      </div>

      <div className="outside-panels">
        {props.endpoint}
        {props.mcp}
      </div>
    </section>
  );
}
