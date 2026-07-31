// ui/src/Stage.tsx
// The first twenty-five seconds (specification section 1): what this is, that it is
// running right now, and where to start.
//
// It replaced a five-step walkthrough. The walkthrough worked, but once the diagram
// itself became usable there were two things on screen telling a visitor what to do,
// and that is worse than one thing that is obvious. What survives from it is the one
// line that points at the machine.
//
// The button that sends an order used to be here, and before that the form behind it
// sat at the very foot of the page. Both are now on the shop tile in the drawing,
// which is the place an order is actually sent from. Sending it from up here made it
// appear in the middle of the picture, skipping the one hop the picture exists to
// show. The cost is that the first thing to press is no longer the first thing on the
// screen, so this line has to carry the visitor down to it.
export function Stage(props: { connected: boolean; viewers: number }) {
  return (
    <header className="stage">
      <h1>Nothing gets lost. Not even when you break it.</h1>

      <p className="sub">
        One order, four real systems: a payment, a CRM entry, an invoice and a
        notification. Below is the machine that carries it between them, running right
        now. Send an order from the shop, then break one of the systems and watch what
        happens to the orders already on their way.
      </p>

      <p className="status">
        <span className={props.connected ? 'live' : 'offline'} data-testid="connection">
          {props.connected ? 'live' : 'reconnecting'}
        </span>
        <span className="status-note">
          Everything on this page is happening as you watch. Nothing is a recording.
        </span>
        {props.viewers > 1 && (
          <span data-testid="presence">
            Somebody else is experimenting right now. You are watching their events too.
          </span>
        )}
      </p>

      <p className="stage-hint" data-testid="stage-hint">
        Start at the shop on the left of the machine below. Then open the menu on any
        system and break it. Nothing will be lost.
      </p>
    </header>
  );
}
