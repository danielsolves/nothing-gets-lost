// ui/src/OrderCheck.tsx
// One checkpoint, drawn as the system it is about. The card head carries five of
// them and the opened card puts the same one in front of each system, so the summary
// and the detail are the same fact at two sizes rather than two notations a visitor
// has to reconcile.
//
// It was a coloured dot, then a small checkbox. Both were anonymous: five identical
// boxes in a row, and the only way to learn which one was HubSpot was to open the
// card. The tiles already wear the Stripe S, the HubSpot sprocket and the Slack
// hash, so the card wears the same marks and the queue and the drawing read as one
// thing seen twice.
//
// Not an <input type="checkbox">. Nothing here is settable by a visitor, so a real
// checkbox would promise an interaction that does not exist and would drop a tab stop
// into every row of a scrolling list of forty. A state indicator is an image with a
// name, and that is what this is.
//
// A tick cannot carry six states, and a tick on its own would leave the card saying
// delivered and not-delivered where it used to say five things. So the mark carries
// the system and a small overlay at its corner carries the state:
//
//   waiting   grey, no overlay, a dashed edge: the queue has not made the row yet
//   queued    grey, no overlay, a solid edge: the row exists and has not been tried
//   sending   grey, a turning ring: it is on the wire now
//   retrying  its own colour, held back, an hourglass: it failed and will try again
//   delivered its own colour, a tick
//   parked    red, a person: it is in the backlog and somebody has to look at it
//
// A cross would have been the obvious overlay for the last one, and it is the wrong
// one: a cross says failed, and failed is the state before this one, which the
// hourglass already holds. What is different about a parked row is that it has been
// handed to a person. The colour carries the alarm, the person carries the meaning.
//
// Every one of those reads without colour, which is the whole point of the overlays:
// a screenshot in black and white and a reader who cannot separate red from green
// both lose the tint and neither loses the state.
import {
  Check, CircleNotch, HourglassMedium, User, type Icon,
} from '@phosphor-icons/react';
import type { Target } from '@ngl/contracts';
import { checkLook, type CheckLook, type StepState } from './order-cards';
import { SystemMark } from './SystemMark';

const WORDS: Record<CheckLook, string> = {
  waiting: 'not queued yet',
  queued: 'queued, not tried yet',
  sending: 'going out now',
  retrying: 'an attempt failed, waiting to try again',
  delivered: 'delivered',
  parked: 'in the backlog, needs a person',
};

/** The two quiet looks have none, because there is nothing yet to say about them. */
const OVERLAYS: Partial<Record<CheckLook, Icon>> = {
  sending: CircleNotch,
  retrying: HourglassMedium,
  delivered: Check,
  parked: User,
};

export function OrderCheck(props: {
  target: Target;
  label: string;
  state: StepState;
  attempts: number;
  testId?: string;
}) {
  const look = checkLook(props.state, props.attempts);
  const said = `${props.label}: ${WORDS[look]}`;
  const Overlay = OVERLAYS[look];

  return (
    // The name lives here and the mark inside is hidden, so the whole thing is read
    // out once, as one image, rather than as a logo followed by a state.
    <span
      className="order-check"
      data-look={look}
      data-testid={props.testId}
      role="img"
      aria-label={said}
      title={said}
    >
      <SystemMark target={props.target} />
      {Overlay && (
        <span className="order-check-badge" data-badge={look} aria-hidden="true">
          <Overlay size={9} weight="bold" />
        </span>
      )}
    </span>
  );
}
