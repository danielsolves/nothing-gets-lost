// ui/src/Stage.tsx
// The first twenty-five seconds (specification section 1): whose work this is, what
// it is, that it is running right now, and that none of it has to be taken on trust.
//
// It replaced a five-step walkthrough. The walkthrough worked, but once the diagram
// itself became usable there were two things on screen telling a visitor what to do,
// and that is worse than one thing that is obvious.
//
// What went with the walkthrough, later, was a line pointing down at the machine.
// While the button that sends an order sat on a tile in the middle of the drawing,
// something had to carry the visitor to it. The button is now at the top of the
// machine, directly under this header, so the line was pointing at something already
// in view and saying "the first tile" about a tile that no longer exists.
//
// What is left is one claim, one paragraph and one badge. That is also the answer to
// there having been four different voices here: a claim in the display face, a lede,
// a monospaced line beside the live dot, a hint, and a note about test mode further
// down. Monospace on this page means the machine said it. Prose about the machine is
// prose, and reads in the same face as everything else.
export function Stage(props: { connected: boolean; viewers: number }) {
  return (
    <header className="stage">
      <p className="stage-who">Daniel Froemmig, integration engineer</p>

      <h1>Nothing gets lost. Not even when you break it.</h1>

      <p className="sub" data-testid="stage-intro">
        One order, five real systems that know nothing about each other: a Stripe
        payment, a HubSpot deal, an invoice, a Slack message and a confirmation mail.
        Below is the machine that carries the order between them, running right now.
        Take any system away and the order waits, retries, and is either delivered or
        handed to a person. It is never quietly dropped. Nothing here is staged:
        every record was written while you watched, and each one links back to the
        system that holds it, so you can go and look.
      </p>

      <p className="status">
        <span className={props.connected ? 'live' : 'offline'} data-testid="connection">
          {props.connected ? 'live' : 'reconnecting'}
        </span>
        <span className="status-note">
          Stripe runs in test mode with real webhooks. The HubSpot portal is a real
          one. Breaking a system here stops us reaching it. It does not stop it.
        </span>
        {props.viewers > 1 && (
          <span data-testid="presence">
            Somebody else is experimenting right now. You are watching their events too.
          </span>
        )}
      </p>
    </header>
  );
}
