// ui/src/ProofPanel.tsx
// Shows the two foreign timestamps side by side with the measured gap between them.
// The instruction on how to read the Received header matters: without it the second
// witness stays theoretical for most visitors.
//
// The address is optional now, so the second witness is not always coming. A panel
// that sat there saying "not yet" forever would read as the machine being stuck,
// which is the exact opposite of the claim. It says plainly what is missing and how
// to get it instead.
//
// The same goes for the payment. Stripe serves a receipt page a stranger can open,
// but only once the charge has actually gone through, so the link is rendered off
// the url the payment came back with rather than assumed from the route.
import { useEffect, useState } from 'react';
import type { PaymentRoute, ProofResponse } from '@ngl/contracts';

/**
 * Named rather than printed raw, because the label is a claim about who stamped
 * the time and the wire carries an identifier, not a sentence.
 */
const PAYER: Record<PaymentRoute, string> = { stripe: 'Stripe' };

export function ProofPanel({
  eventId, expectMail,
}: { eventId: string; expectMail: boolean }) {
  const [proof, setProof] = useState<ProofResponse | null>(null);

  useEffect(() => {
    const load = () =>
      fetch(`/api/proof/${eventId}`)
        .then((response) => response.json() as Promise<ProofResponse>)
        .then(setProof);
    void load();
    const timer = setInterval(() => void load(), 3000);
    return () => clearInterval(timer);
  }, [eventId]);

  if (!proof) return null;

  return (
    <section className="proof" data-testid="proof-panel">
      <h2>Check it yourself</h2>

      <div className="witnesses">
        <div className="witness">
          <span className="who" data-testid="proof-paid-by">
            {proof.paidAtSource === null
              ? 'Nothing was paid for this one'
              : `${PAYER[proof.paidAtSource]} stamped the payment`}
          </span>
          <time data-testid="proof-paid">{format(proof.paidAt)}</time>
          {proof.receiptUrl ? (
            <a href={proof.receiptUrl} target="_blank" rel="noreferrer">
              Open the receipt on stripe.com
            </a>
          ) : proof.paidAtSource && (
            <small data-testid="proof-no-receipt">
              The receipt page appears once Stripe has taken the payment. Until then
              this half of the chain rests on the timestamp alone.
            </small>
          )}
        </div>

        <div className="gap" data-testid="proof-gap">
          {!expectMail
            ? 'one witness only'
            : proof.gapSeconds === null
              ? 'waiting for the chain to complete'
              : `${formatGap(proof.gapSeconds)} apart`}
        </div>

        {expectMail ? (
          <div className="witness">
            <span className="who">Your mail provider stamped the arrival</span>
            <time data-testid="proof-mail">{format(proof.mailReceivedAt)}</time>
            <small>
              Open the confirmation in your inbox and choose “Show original” to read the
              Received header. That timestamp is written by your provider, not by us.
            </small>
          </div>
        ) : (
          <div className="witness" data-testid="proof-no-mail">
            <span className="who">The second witness is missing</span>
            <small>
              You sent this order without an address, so there is no confirmation mail
              to carry a timestamp stamped by somebody other than us. Send another one
              with your address and this half fills in.
            </small>
          </div>
        )}
      </div>

      {proof.hubspotCreatedAt && (
        <p className="third-witness">
          Third witness: HubSpot stamped the contact at {format(proof.hubspotCreatedAt)},
          visible in your own portal.
        </p>
      )}

      <p className="fine-print">
        Neither timestamp is ours. We cannot set them, change them or fake them.
      </p>

      {/* Spec 9.5: for the reader who does not click through this themselves but
          hands the whole thing to a developer they trust. */}
      <p className="take-away">
        <a href={`/api/proof/${eventId}/download`} download data-testid="proof-download">
          Download the proof log
        </a>{' '}
        with every call, its remote reference, and a line on each entry saying
        whether it is indisputable or only our own claim.
      </p>
    </section>
  );
}

function format(value: string | null): string {
  return value ? new Date(value).toLocaleTimeString() : 'not yet';
}

function formatGap(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  return minutes > 0 ? `${minutes} min ${seconds % 60} s` : `${seconds} s`;
}
