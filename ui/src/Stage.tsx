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

      {/* Two beats: what the visitor already has, and what they get instead. It read
          "Nothing gets lost. Not even when you break it." for a long time, which put
          a challenge to the reader in the second half, and then a full sentence in
          the first person, which described the work rather than the outcome. */}
      {/* The result, not the work. It read "Nothing gets lost. Not even when you
          break it.", which put a challenge to the reader in its second half, and
          then a sentence in the first person about what gets built. What a customer
          buys is the state afterwards. */}
      <h1>A business workflow you can trust.</h1>

      {/* The problem first, then what was built for it. It read the other way round
          for a long time, opening on five systems and a queue, which is an answer to
          a question a visitor arriving from a case list has not been asked yet. */}
      <p className="sub" data-testid="stage-intro">
        Today, many businesses rely on different systems to handle payments, customer
        relationships, invoicing, and communication. Each system can work perfectly
        well on its own. Problems begin when information needs to move between them.
      </p>

      <p className="sub">
        In this live demonstration, I connect five real systems: Stripe, HubSpot, an
        invoicing service, Slack, and email through one reliable workflow. Every
        handoff is tracked, failed steps retry automatically, and anything unresolved
        is sent to a person.
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
