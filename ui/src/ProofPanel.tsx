// ui/src/ProofPanel.tsx
// Shows the two foreign timestamps side by side with the measured gap between them.
// The instruction on how to read the Received header matters: without it the second
// witness stays theoretical for most visitors.
import { useEffect, useState } from 'react';
import type { ProofResponse } from '@ngl/contracts';

export function ProofPanel({ eventId }: { eventId: string }) {
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
          <span className="who">Stripe stamped the payment</span>
          <time data-testid="proof-paid">{format(proof.paidAt)}</time>
          {proof.receiptUrl && (
            <a href={proof.receiptUrl} target="_blank" rel="noreferrer">
              Open the receipt on stripe.com
            </a>
          )}
        </div>

        <div className="gap" data-testid="proof-gap">
          {proof.gapSeconds === null
            ? 'waiting for the chain to complete'
            : `${formatGap(proof.gapSeconds)} apart`}
        </div>

        <div className="witness">
          <span className="who">Your mail provider stamped the arrival</span>
          <time data-testid="proof-mail">{format(proof.mailReceivedAt)}</time>
          <small>
            Open the confirmation in your inbox and choose “Show original” to read the
            Received header. That timestamp is written by your provider, not by us.
          </small>
        </div>
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
