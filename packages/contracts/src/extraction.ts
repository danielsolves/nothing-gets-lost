// packages/contracts/src/extraction.ts
// An order that arrives as free text, and what comes back when a model has read it.
//
// Three services share these names. The extractor answers with `ExtractResult`, the
// api turns that into `ExtractOrderResponse` by pricing what survived both checks,
// and the page draws it. The wire shape of the extractor's own door lives here too,
// rather than being mirrored in the api: the api cannot import from
// `services/extractor`, whose entry point starts a listening server the moment it is
// loaded, and a hand copy of a six field union in the caller is exactly the drift
// this package exists to prevent.
//
// What is deliberately not here is a request to place an extracted order. There is
// one way to place an order, `PlaceOrderRequest`, and a confirmed extraction goes
// through it like everything else. A second one would be a second set of rules about
// prices, addresses and caps, kept in step by hand.
import type { OrderLine } from './stream';

/**
 * Whether a model was actually asked.
 *
 * `recorded` is the state of the public demo, which holds no key: the extractor
 * replays `fixtures/extractions.json`. It is carried on every answer rather than
 * read once from the page, because it is a fact about that answer, and a page whose
 * whole argument is that it can be checked cannot let a replay look like a call.
 */
export type ExtractionMode = 'live' | 'recorded';

/**
 * The two checks between a model and the database, in the extractor's own words.
 *
 * `schema` is `orderSchema`: the answer has to look like an order, strictly, so an
 * invented `discountPercent` is refused as hard as a missing address. `catalog` is
 * `findUnknownSkus`: the articles have to be ones we sell. A model can write a
 * plausible article number but it cannot write one into the products table.
 */
export const EXTRACTION_CHECKS = ['schema', 'catalog'] as const;
export type ExtractionCheck = (typeof EXTRACTION_CHECKS)[number];

export function isExtractionCheck(value: string): value is ExtractionCheck {
  return (EXTRACTION_CHECKS as readonly string[]).includes(value);
}

/** The order shape a model answer has to have. Mirrors `orderSchema` in the extractor,
 *  which imports this type, so the two cannot drift without failing to compile. */
export interface ExtractedOrder {
  customer: { name: string; email: string };
  items: Array<{ sku: string; qty: number }>;
  notes: string | null;
}

/**
 * What POST /internal/extract answers with.
 *
 * `raw` is on both halves and is the point of the whole type: it is what the model
 * actually said, kept verbatim so a refusal can show its evidence rather than
 * summarise it. A refused reading is a 200 with `ok: false`, never a 500. The model
 * being wrong is a normal event here; only our own faults are server errors.
 */
export type ExtractResult =
  | { ok: true; order: ExtractedOrder; mode: ExtractionMode; raw: unknown }
  | {
      ok: false; reason: ExtractionCheck; detail: string;
      raw: unknown; mode: ExtractionMode;
    };

/**
 * How much free text a stranger may hand to a model in one press.
 *
 * Read by the field and by the endpoint, so the browser refuses the paste at the
 * moment it happens and the endpoint refuses it again for anybody not using the
 * page. Long enough for a real order mail with a greeting and a signature, short
 * enough that a pasted book is not a bill.
 */
export const MAX_ORDER_TEXT = 1200;

export interface ExtractOrderRequest { text: string }

/**
 * The typed record the whole feature is about: prose in, this out.
 *
 * The money is ours, not the model's. `lines` are priced from the products table by
 * the api, and the model is never asked what anything costs. It is still only a
 * proposal: nothing is booked until a person confirms it, and the price that is
 * charged is computed again from the same table when they do.
 *
 * `customer.email` and `notes` are carried because they are part of what was read,
 * and neither is used to place anything. The address in particular is shown and not
 * written to: an address a stranger typed into a public text box, chosen by a model,
 * is a way to send mail from this domain to anybody at all.
 */
export interface ProposedOrder {
  customerName: string;
  customerEmail: string;
  notes: string | null;
  lines: OrderLine[];
  totalCents: number;
}

/**
 * What the page gets back from POST /api/extract-order.
 *
 * A refusal is as ordinary as a proposal and carries the same two facts, the mode
 * and the raw answer, so the page can show what the model said in either case. What
 * a refusal does not carry is anything that can be placed: there is no basket on it
 * to press a button next to.
 */
export type ExtractOrderResponse =
  | { ok: true; mode: ExtractionMode; raw: unknown; proposal: ProposedOrder }
  | {
      ok: false; mode: ExtractionMode; raw: unknown;
      stoppedBy: ExtractionCheck; detail: string;
    };
