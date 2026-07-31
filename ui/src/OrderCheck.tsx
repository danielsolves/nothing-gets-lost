// ui/src/OrderCheck.tsx
// One checkpoint, drawn as a small box that can be ticked. The card head carries five
// of them and the opened card puts the same one in front of each system, so the
// summary and the detail are the same fact at two sizes rather than two notations a
// visitor has to reconcile.
//
// Not an <input type="checkbox">. Nothing here is settable by a visitor, so a real
// checkbox would promise an interaction that does not exist and would drop a tab stop
// into every row of a scrolling list of forty. A state indicator is an image with a
// name, and that is what this is.
//
// A tick cannot carry five states. Two of them get a glyph, because a glyph is the
// part that survives being printed, being read by somebody who cannot separate red
// from green, and being looked at out of the corner of an eye:
//
//   done      a tick, the box is filled
//   dead      a cross, tried and stopped trying
//   inflight  a dot, something is happening in there now
//   pending   an empty box with a solid edge, queued and nothing has happened
//   waiting   an empty box with a dashed edge, the queue has not made the row yet
//
// The difference between the last two is the edge, which is the sheet's job: there is
// no honest glyph for "not yet" that an empty box does not already say better.
import type { StepState } from './order-cards';

const WORDS: Record<StepState, string> = {
  done: 'delivered',
  inflight: 'going out now',
  pending: 'queued, waiting',
  dead: 'gave up, needs a human',
  waiting: 'not queued yet',
};

const MARKS: Record<StepState, string> = {
  done: '✓', inflight: '•', pending: '', dead: '✕', waiting: '',
};

export function OrderCheck(props: {
  label: string;
  state: StepState;
  testId?: string;
}) {
  const said = `${props.label}: ${WORDS[props.state]}`;
  return (
    <span
      className="order-check"
      data-state={props.state}
      data-testid={props.testId}
      role="img"
      aria-label={said}
      title={said}
    >
      {MARKS[props.state]}
    </span>
  );
}
