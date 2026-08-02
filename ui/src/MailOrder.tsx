// ui/src/MailOrder.tsx
// An order that arrives the way orders actually arrive: as somebody's mail.
//
// Everywhere else on this page an order is assembled by pressing things that can only
// produce a valid order. Here a stranger writes prose, a model turns it into a typed
// record, and the two checks that already existed decide whether that record is
// allowed to become anything. The interesting half is the refusals, so two of the
// three example mails are refused on purpose.
//
// Two requests, never one. Reading calls /api/extract-order, which cannot place
// anything; placing calls /api/orders, which is where every order on this page is
// priced, capped and queued. Nothing was gained by an endpoint that did both, and
// what would have been lost is the only step in this feature that a check cannot
// stand in for: a model that reads "a dozen" as 2 produces a record that is well
// formed, in the catalogue, and wrong, and no amount of validation will ever say so.
//
// The address is left behind on purpose. It is read, it is shown, and it is not
// posted: a public text box that mails whoever is named in it is a way to send mail
// from this domain to anybody, with a model picking the recipient. The name and the
// basket are what an order needs, and the order is booked under the house address the
// same way the loud button's is.
//
// It holds no wire anchor and takes nothing from the board, so it can be mounted
// anywhere on the page without the diagram having to know about it.
import { useState } from 'react';
import { MAX_ORDER_TEXT, type ExtractOrderResponse, type ProposedOrder } from '@ngl/contracts';
import { MailReading } from './MailReading';
import { isExtractOrderResponse, isPlaceOrderResponse } from './mail-order-answer';
import { SAMPLE_MAILS, sampleMail } from './mail-order-samples';

/** The server's own words for why it refused, which are written to be read. */
async function refusalFrom(response: Response): Promise<string> {
  const body: unknown = await response.json().catch(() => null);
  if (typeof body === 'object' && body !== null && 'message' in body
    && typeof body.message === 'string') {
    return body.message;
  }
  return `That did not work (${response.status}).`;
}

function saying(trouble: unknown): string {
  return trouble instanceof Error ? trouble.message : 'That did not work.';
}

export function MailOrder({
  onPlaced,
}: {
  /** Told the event id of a confirmed order, for a page that wants to point at it. */
  onPlaced?: (eventId: string) => void;
}) {
  const [text, setText] = useState(sampleMail('ordinary').text);
  const [reading, setReading] = useState(false);
  const [result, setResult] = useState<ExtractOrderResponse | null>(null);
  const [placing, setPlacing] = useState(false);
  const [placed, setPlaced] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  /** A reading belongs to the text it was made from, so both go together. */
  function put(mail: string): void {
    setText(mail);
    setResult(null);
    setPlaced(false);
    setProblem(null);
  }

  async function read(): Promise<void> {
    setReading(true);
    setProblem(null);
    setResult(null);
    setPlaced(false);
    try {
      const response = await fetch('/api/extract-order', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      // A refused reading is a 200 and is the interesting case, so only the
      // endpoint's own refusals land here: a full hour, a field left blank, a book.
      if (!response.ok) throw new Error(await refusalFrom(response));
      const answer: unknown = await response.json();
      if (!isExtractOrderResponse(answer)) {
        throw new Error('The reading came back in a shape this page cannot draw.');
      }
      setResult(answer);
    } catch (trouble) {
      setProblem(saying(trouble));
    } finally {
      setReading(false);
    }
  }

  async function place(proposal: ProposedOrder): Promise<void> {
    setPlacing(true);
    setProblem(null);
    try {
      const response = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          customerName: proposal.customerName,
          items: proposal.lines.map((line) => ({ sku: line.sku, qty: line.qty })),
        }),
      });
      if (!response.ok) throw new Error(await refusalFrom(response));
      const order: unknown = await response.json();
      if (!isPlaceOrderResponse(order)) {
        throw new Error('The order went out and came back unrecognisable.');
      }
      setPlaced(true);
      onPlaced?.(order.eventId);
    } catch (trouble) {
      setProblem(saying(trouble));
    } finally {
      setPlacing(false);
    }
  }

  return (
    <section className="mail-order" data-testid="mail-order">
      <h3>An order that arrives as a mail</h3>
      <p className="mail-lede">
        Write what a customer would write. A model turns it into a typed order, and
        two checks decide whether that order may exist: one that it has the shape of
        an order, one that every article is really in the catalogue. Then you confirm
        it, because a check cannot.
      </p>

      <div className="mail-samples" role="group" aria-label="Example mails">
        {SAMPLE_MAILS.map((mail) => (
          <button
            key={mail.id}
            type="button"
            data-testid={`sample-${mail.id}`}
            onClick={() => put(mail.text)}
          >
            {mail.label}
          </button>
        ))}
      </div>

      <textarea
        className="mail-text"
        data-testid="mail-text"
        aria-label="The order mail"
        rows={7}
        maxLength={MAX_ORDER_TEXT}
        value={text}
        onChange={(event) => put(event.target.value)}
      />

      <div className="mail-actions">
        <button
          type="button"
          className="stage-cta"
          data-testid="read-mail"
          disabled={reading || text.trim() === ''}
          onClick={() => void read()}
        >
          {reading ? 'Reading' : 'Read this mail'}
        </button>
      </div>

      {problem && <p className="error" data-testid="mail-problem">{problem}</p>}

      {result && (
        <MailReading
          result={result}
          placing={placing}
          placed={placed}
          onConfirm={() => { if (result.ok) void place(result.proposal); }}
          onDiscard={() => { setResult(null); setPlaced(false); setProblem(null); }}
        />
      )}
    </section>
  );
}
