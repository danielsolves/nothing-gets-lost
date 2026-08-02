// ui/src/MailReading.tsx
// What came back from reading one mail: what the model said, what was done about it,
// and the one button that turns it into an order.
//
// The raw answer is printed on a proposal as well as on a refusal. Showing the
// evidence only when something went wrong would make the good case the one the
// reader has to take on trust, and the good case is the one an order comes out of.
//
// A refusal carries no button. Not a disabled one and not a hidden one: there is
// nothing on a refusal that could be placed, so the markup has nothing to press. The
// confirmation step is meant to be a decision, and a decision a visitor can walk past
// by clicking through a red panel is not one.
//
// Drawing and doing are split. This component holds no state and sends nothing; the
// panel around it owns the two requests. That is what lets every case here, including
// the ones a visitor on the live site can only reach with a model key, be drawn in a
// test without a server.
import type { ExtractOrderResponse, ExtractionCheck, OrderLine } from '@ngl/contracts';

/** The two checks, in words a reader can hold against the answer above them. */
const CHECKS: Record<ExtractionCheck, { name: string; means: string }> = {
  schema: {
    name: 'the schema check',
    means: 'the answer is not shaped like an order',
  },
  catalog: {
    name: 'the catalogue check',
    means: 'the answer names an article that is not in the catalogue',
  },
};

function money(cents: number): string {
  return `${(cents / 100).toFixed(2)} EUR`;
}

function Lines({ lines }: { lines: OrderLine[] }) {
  return (
    <ul className="mail-lines">
      {lines.map((line) => (
        <li key={line.sku}>
          <span className="mail-qty">{line.qty}</span>
          <span className="mail-item">{line.name}</span>
          <span className="price">{money(line.cents)}</span>
        </li>
      ))}
    </ul>
  );
}

export function MailReading({
  result, placing, placed, onConfirm, onDiscard,
}: {
  result: ExtractOrderResponse;
  /** The confirmed order is on its way out. */
  placing: boolean;
  /** It has gone. The button leaves, because there is nothing left to press it for. */
  placed: boolean;
  onConfirm: () => void;
  onDiscard: () => void;
}) {
  return (
    <div className="mail-reading" data-testid="mail-reading">
      {/* First, before the answer it is about. A reader who takes in the JSON and
          then learns it was replayed has already believed something. */}
      <p className="mail-mode" data-testid="mail-mode" data-mode={result.mode}>
        {result.mode === 'recorded'
          ? 'Recorded answer. This deployment holds no model key, so the reply is '
            + 'replayed from a file and no model was called. Everything after it is '
            + 'real: the checks, the prices and the order.'
          : 'Live answer. This mail went to a model and came back.'}
      </p>

      <p className="mail-ph">What the model answered</p>
      <pre className="mail-raw" data-testid="mail-raw">
        {JSON.stringify(result.raw, null, 2)}
      </pre>

      {!result.ok ? (
        <div className="mail-stopped" data-testid="mail-stopped" data-check={result.stoppedBy}>
          <p className="mail-verdict">
            Stopped by {CHECKS[result.stoppedBy].name}: {CHECKS[result.stoppedBy].means}.
          </p>
          <p className="mail-detail" data-testid="mail-detail">{result.detail}</p>
          <p className="mail-nothing">
            Nothing was placed. No event, no order, and the queue is as it was.
          </p>
        </div>
      ) : (
        <div className="mail-proposal" data-testid="mail-proposal">
          <p className="mail-ph">Both checks passed. This is what would be placed</p>
          <p className="mail-buyer">{result.proposal.customerName}</p>
          <Lines lines={result.proposal.lines} />
          <p className="mail-total" data-testid="mail-total">
            Total {money(result.proposal.totalCents)}
          </p>

          <p className="fine-print">
            Priced from the catalogue, never by the model. The address it read,
            {' '}{result.proposal.customerEmail}, is shown and not written to: a text
            box that mails whoever it names is a text box that mails anyone.
          </p>

          {/* The argument the whole feature makes, next to the button it is about. */}
          <p className="mail-why" data-testid="mail-why">
            Both checks prove the answer is well formed and that every article exists.
            Neither can prove it was read correctly: a dozen read as 2 passes both.
            That is why a person presses this and not the machine.
          </p>

          {placed ? (
            <p className="mail-placed" data-testid="mail-placed" role="status">
              Placed. It is in the queue now, and from here it is an order like any
              other.
            </p>
          ) : (
            <div className="mail-decide">
              <button
                type="button"
                className="stage-cta"
                data-testid="confirm-order"
                disabled={placing}
                onClick={onConfirm}
              >
                {placing ? 'Placing' : 'Place this order'}
              </button>
              <button
                type="button"
                className="mail-quiet"
                data-testid="discard-order"
                onClick={onDiscard}
              >
                Discard
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
