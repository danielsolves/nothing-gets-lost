// services/api/src/extractor.client.ts
// The one hop between the public api and the model, and the guard on what comes back.
//
// It is a port with an http implementation, the same shape as mediator.intake.ts,
// because the interesting tests of the service behind it are about what it does with
// an answer rather than about how the answer travelled.
//
// The answer is checked rather than asserted. Everywhere else in this repo an
// internal response is trusted and typed on the way in, and that is defensible for a
// queue hop whose payload we wrote a moment earlier. This one is different: the body
// on the other side of it started life as a model's sentence, the whole feature is
// about that sentence being wrong, and a page that printed `undefined` where the
// refusal should be would be failing in exactly the place it is meant to be showing.
// A wrong shape here is a bug of ours, so it is raised as one.
import { isExtractionCheck, type ExtractResult } from '@ngl/contracts';

const EXTRACTOR_URL = process.env.EXTRACTOR_URL ?? 'http://extractor:3006';

/** Free text in, a checked reading out. Nothing here places anything. */
export interface Extractor {
  read(text: string): Promise<ExtractResult>;
}

function isOrder(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false;
  if (!('customer' in value) || !('items' in value) || !('notes' in value)) return false;

  const customer = value.customer;
  if (typeof customer !== 'object' || customer === null) return false;
  if (!('name' in customer) || typeof customer.name !== 'string') return false;
  if (!('email' in customer) || typeof customer.email !== 'string') return false;

  if (!Array.isArray(value.items)) return false;
  return value.items.every((item: unknown) =>
    typeof item === 'object' && item !== null
    && 'sku' in item && typeof item.sku === 'string'
    && 'qty' in item && typeof item.qty === 'number');
}

/**
 * True when the body is one of the two answers the extractor documents.
 *
 * `raw` is deliberately not checked. It is whatever the model said, which is the one
 * field that is allowed to be anything at all.
 */
export function isExtractResult(value: unknown): value is ExtractResult {
  if (typeof value !== 'object' || value === null) return false;
  if (!('mode' in value) || (value.mode !== 'live' && value.mode !== 'recorded')) return false;
  if (!('ok' in value) || !('raw' in value)) return false;

  if (value.ok === true) return 'order' in value && isOrder(value.order);
  if (value.ok !== false) return false;
  if (!('detail' in value) || typeof value.detail !== 'string') return false;
  return 'reason' in value && typeof value.reason === 'string'
    && isExtractionCheck(value.reason);
}

export class HttpExtractor implements Extractor {
  constructor(private readonly baseUrl: string = EXTRACTOR_URL) {}

  async read(text: string): Promise<ExtractResult> {
    const response = await fetch(`${this.baseUrl}/internal/extract`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    // A model that answered badly is a 200 with `ok: false`. A status here means the
    // service itself is wrong or unreachable, which is ours and not the model's.
    if (!response.ok) {
      throw new Error(`the extractor refused the text: ${response.status}`);
    }

    const body: unknown = await response.json();
    if (!isExtractResult(body)) {
      throw new Error('the extractor answered in a shape this service does not know');
    }
    return body;
  }
}
