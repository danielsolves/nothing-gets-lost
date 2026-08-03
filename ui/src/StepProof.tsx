// ui/src/StepProof.tsx
// The check-it-yourself button, on the step it is about (spec 9.2).
//
// The opened card used to end a delivered step with "delivered, their id pi_3S9...".
// That is the hardest kind of claim to believe and the least actionable: a foreign
// looking identifier, on our page, in our words. A visitor who does not already trust
// the demo has no way from there to anything better.
//
// So the step asks the system again, now, and shows what came back. Two things make
// that worth doing rather than decorative. The read-back goes out to the real system
// rather than to a copy we kept, so a record deleted at the far end comes back 404
// and the page says so. And where the answer is a page the third party serves on its
// own domain, it is offered as a link, with the domain in the label: the point is not
// that something opens, it is that what opens is not us.
//
// The caveat is the other half of that and is not an apology. We render the HubSpot
// answer, so a sceptic is right that we could render anything. Saying it costs
// nothing here and is exactly what keeps the Stripe receipt worth something.
//
// The one button goes both ways. Opened, the answer had no way back and the button
// went on offering a check that had already been made, so a tile grown to three
// times its height stayed that way and pushed its row down the page for the rest of
// the visit. A second control next to it was the alternative and was rejected: a
// 198px tile has room for one thing to press, and the thing already there was the
// one saying the wrong words. Closing forgets the answer rather than keeping it to
// put back, so reopening asks again and nothing stale is ever shown.
import { useState } from 'react';
import type { Target, VerifyResponse } from '@ngl/contracts';

type Answer =
  | { kind: 'idle' }
  | { kind: 'asking' }
  | { kind: 'answered'; verified: VerifyResponse }
  | { kind: 'failed' };

/**
 * What the button says, which is whatever the surface around it has not said already.
 *
 * On a tile the system is printed two rows above, so naming it again is the exact
 * repetition every other line on a tile avoids, and on a 198px box it costs a second
 * wrapped row. What the tile has not said is which order, so that is what it says.
 *
 * In a queue card it is the other way round: the card is one order and lists every
 * system it went to, so the system is the point and the order number would be the
 * repetition.
 */
function askLabel(label: string, orderNumber: number | null | undefined, tile: boolean): string {
  if (tile && orderNumber !== null && orderNumber !== undefined) {
    return `Check order ${orderNumber}`;
  }
  return `Check it at ${label}`;
}

/**
 * The way out, in the same words on both surfaces.
 *
 * The offer has to differ by surface, because each one has already said a different
 * half of it. Putting the answer away has no such half: what folds is the answer, on
 * a tile and in a card alike, so a second wording would be two ways of saying one
 * thing. It is also shorter than either offer, which is what keeps the button on one
 * line in a 198px box.
 *
 * "Hide" and not "Close": nothing was opened over anything. The answer is part of the
 * step and goes back into it.
 */
const HIDE_LABEL = 'Hide the answer';

/** The domain, for the link label. A url we cannot parse is not offered as a link. */
function hostOf(url: string): string | null {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

export function StepProof(props: {
  eventId: string;
  target: Target;
  label: string;
  /**
   * Which order this is about, when the surface around the button does not already
   * say. A queue card is the order, so it passes nothing; a system tile is not, and
   * a bare "Check it at Stripe" there left the reader to assume it meant the one
   * they had just sent. It does mean that, and the button has to say so rather than
   * be trusted about it.
   */
  orderNumber?: number | null;
  /**
   * How much room there is to answer in.
   *
   * `card` is the queue, where a step has the width of the panel and the full url
   * is worth printing: seeing exactly which endpoint answered is the evidence.
   * `tile` is a 198px box in the drawing, where the same url would be six wrapped
   * lines and would push the systems around it down the page. There it prints the
   * host, which is the part of the url that carries the claim: the record is not
   * on this domain.
   */
  layout?: 'card' | 'tile';
}) {
  const [answer, setAnswer] = useState<Answer>({ kind: 'idle' });
  const id = `${props.eventId}-${props.target}`;

  const ask = () => {
    setAnswer({ kind: 'asking' });
    void fetch(`/api/verify/${props.target}/${props.eventId}`)
      .then((response) => response.json() as Promise<VerifyResponse>)
      .then((verified) => setAnswer({ kind: 'answered', verified }))
      .catch(() => setAnswer({ kind: 'failed' }));
  };

  const verified = answer.kind === 'answered' ? answer.verified : null;

  /**
   * One button, both directions. A separate close control would be a second thing to
   * find on a tile that has room for one, and the button was already sitting there
   * offering a check that had just been made.
   *
   * Going back to idle rather than keeping the answer to put back later. The whole
   * claim of this panel is that it read the far system just now: a record deleted
   * between the two presses has to come back 404, and an answer redisplayed from
   * memory would go on saying 200 about something that is gone. Reopening therefore
   * costs a round trip, which is the honest price of the claim.
   *
   * A failure is not a disclosure and does not toggle. It is a report about the
   * press, and the next thing anybody wants after reading it is another attempt.
   */
  const showing = verified !== null;
  const press = () => {
    if (showing) setAnswer({ kind: 'idle' });
    else ask();
  };
  // Only a page somebody else serves is worth sending a visitor to, which is the
  // same set the service already calls indisputable. The others answer on a url too,
  // but it is an API endpoint behind a bearer token: followed by a visitor it is a
  // 401, and a link that lands on a 401 is worse evidence than no link at all. A 404
  // is excluded for the same reason from the other end: the url is real and the
  // record behind it is not.
  const openable = verified !== null && verified.indisputable && verified.httpStatus === 200;
  const host = openable ? hostOf(verified.requestUrl) : null;
  const tile = props.layout === 'tile';

  let says = askLabel(props.label, props.orderNumber, tile);
  if (showing) says = HIDE_LABEL;
  if (answer.kind === 'asking') says = 'Asking…';

  return (
    <div className="step-proof" data-layout={props.layout ?? 'card'}>
      <button
        type="button"
        className="step-proof-ask"
        data-testid={`check-${id}`}
        onClick={press}
        disabled={answer.kind === 'asking'}
        aria-expanded={showing}
      >
        {says}
      </button>

      {answer.kind === 'failed' && (
        <p className="step-proof-error" data-testid={`proof-error-${id}`}>
          The check could not be made. That is this page failing to ask, not an answer
          about the record.
        </p>
      )}

      {verified && (
        <div className="step-proof-answer" data-testid={`proof-${id}`}>
          <dl>
            <div>
              <dt>asked</dt>
              <dd>
                {tile
                  ? hostOf(verified.requestUrl) ?? 'nothing to ask for'
                  : verified.requestUrl || 'nothing to ask for'}
              </dd>
            </div>
            <div>
              <dt>answered</dt>
              <dd>{verified.httpStatus}</dd>
            </div>
            {verified.remoteRef && (
              <div>
                <dt>their id</dt>
                <dd>{verified.remoteRef}</dd>
              </div>
            )}
            {verified.remoteAt && (
              <div>
                <dt>their timestamp</dt>
                <dd>{verified.remoteAt}</dd>
              </div>
            )}
          </dl>

          {host && (
            <a
              className="step-proof-link"
              data-testid={`proof-link-${id}`}
              href={verified.requestUrl}
              target="_blank"
              rel="noreferrer noopener"
            >
              Open the record on {host}
            </a>
          )}

          {/* Kept although the button is now only offered where the answer does not
              rest on our word, because "only offered where" is a decision made by
              the caller and this component cannot see it. If a check ever turns up
              somewhere it should not, the page says so rather than quietly passing
              our own reading off as a third party's. */}
          {!verified.indisputable && (
            <p className="step-proof-caveat" data-testid={`proof-caveat-${id}`}>
              Read back through us, so it is worth our word.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
