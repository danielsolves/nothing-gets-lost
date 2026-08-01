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
import { useState } from 'react';
import type { Target, VerifyResponse } from '@ngl/contracts';

type Answer =
  | { kind: 'idle' }
  | { kind: 'asking' }
  | { kind: 'answered'; verified: VerifyResponse }
  | { kind: 'failed' };

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
  // Only a page somebody else serves is worth sending a visitor to, which is the
  // same set the service already calls indisputable. The others answer on a url too,
  // but it is an API endpoint behind a bearer token: followed by a visitor it is a
  // 401, and a link that lands on a 401 is worse evidence than no link at all. A 404
  // is excluded for the same reason from the other end: the url is real and the
  // record behind it is not.
  const openable = verified !== null && verified.indisputable && verified.httpStatus === 200;
  const host = openable ? hostOf(verified.requestUrl) : null;
  const tile = props.layout === 'tile';

  return (
    <div className="step-proof" data-layout={props.layout ?? 'card'}>
      <button
        type="button"
        className="step-proof-ask"
        data-testid={`check-${id}`}
        onClick={ask}
        disabled={answer.kind === 'asking'}
      >
        {answer.kind === 'asking' ? 'Asking…' : `Check it at ${props.label}`}
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

          {!verified.indisputable && (
            <p className="step-proof-caveat" data-testid={`proof-caveat-${id}`}>
              {tile
                ? 'Read back through us. We render this answer, so it is worth our word.'
                : 'Read back through us, from our own portal. We render this answer, so it '
                  + 'is worth exactly as much as our word. The Stripe receipt is not: that '
                  + 'page is served by stripe.com.'}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
