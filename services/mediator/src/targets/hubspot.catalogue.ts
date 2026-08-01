// services/mediator/src/targets/hubspot.catalogue.ts
// Mirrors the eight catalogue skus into HubSpot products, once each.
//
// This exists so a line item can name a product. A line item that names nothing is
// still a real record and the api returns it, but the card that lists a deal's
// contents counts only the ones pointing at a product, so the CRM showed an order
// with a total and no contents. Mirroring the catalogue is how every shop
// integration solves that, and it is the shape a visitor recognises.
//
// Exactly-once is harder here than for a deal. A deal is named after its event, so a
// retry searches for that name and finds it. A product has the sku, and HubSpot only
// makes a new product findable by search some seconds after creating it: measured at
// about seven, against retry gaps of two and eight (spec 6.4). A mirror that trusted
// search would create the catalogue twice on the first cut line.
//
// So the claim is written to the database before the call and the id after it, and
// this class only spends claims. The one case the book cannot settle by itself is a
// claim whose worker died mid-call: it cannot know whether a product was created. Age
// decides. Below the settling time a search finding nothing means nothing, and the
// delivery is retried rather than risking a duplicate; above it, a search finding
// nothing is proof, and the mirror finishes the job.
import type { HubSpotCredentials } from '../credentials';
import type { CatalogueLog } from '../hubspot-catalogue.log';
import { HubSpotHttp, type Fetch } from './hubspot.http';
import type { OrderLine } from './hubspot.order';

interface Created { id?: string }
interface Found { results?: Array<{ id: string }> }

/**
 * How long after a create HubSpot may still fail to find a product by its sku.
 *
 * Measured at about seven seconds against the live api. Thirty is four times that,
 * and the retry gaps reach it on the fourth attempt (2 + 8 + 30), which leaves two
 * more before the dead letter box. Erring high costs a retry; erring low costs a
 * duplicate product, and only one of those is visible to the person we are trying
 * to convince.
 */
export const SEARCH_SETTLES_MS = 30_000;

export class HubSpotCatalogue {
  private readonly http: HubSpotHttp;

  constructor(
    baseUrl: string,
    private readonly log: CatalogueLog,
    doFetch: Fetch = fetch,
  ) {
    this.http = new HubSpotHttp(baseUrl, doFetch);
  }

  /** The HubSpot product this line's sku belongs to, mirroring it if it is new. */
  async idFor(creds: HubSpotCredentials, line: OrderLine): Promise<string> {
    const claim = await this.log.claim(line.sku);
    if (claim.status === 'mirrored') return claim.productId;

    // A fresh claim says this database has never mirrored the sku. It does not say
    // the portal has never seen it, and those are different things: the claim book
    // is ours and the products are not. A new deployment against the portal that
    // has been carrying the demo all along is the normal case, and treating fresh
    // as proof of absence made HubSpot refuse every product on the first one.
    const existing = await this.findBySku(creds, line.sku);
    if (existing) {
      await this.log.record(line.sku, existing);
      return existing;
    }

    // Nothing found, and an interrupted attempt may have created it seconds ago
    // where search cannot see it yet. Retrying costs a delivery attempt. Creating
    // costs a duplicate, and the create below would be refused anyway.
    if (claim.status === 'unknown'
      && Date.now() - claim.claimedAt.getTime() < SEARCH_SETTLES_MS) {
      throw new Error(
        `HubSpot may already hold a product for ${line.sku}; its search index is `
        + 'still behind the attempt that was interrupted',
      );
    }

    return this.create(creds, line);
  }

  private async create(creds: HubSpotCredentials, line: OrderLine): Promise<string> {
    // A 5xx or a cut line throws out of here, with the claim left standing. That is
    // the honest state: HubSpot may or may not have taken it, and the next attempt
    // weighs the claim's age rather than guessing.
    const created = await this.http.call(creds, '/crm/v3/objects/products', {
      method: 'POST',
      body: JSON.stringify({
        properties: {
          name: line.name,
          // Per unit, the way HubSpot prices a product. The payload carries the
          // whole line, so it is divided back down, and every basket that later
          // points here multiplies it out again.
          price: (line.cents / line.qty / 100).toFixed(2),
          hs_sku: line.sku,
        },
      }),
    });

    const id = (created.body as Created).id;
    if (id) {
      await this.log.record(line.sku, id);
      return id;
    }

    // HubSpot answered and refused. hs_sku is unique on a product and HubSpot says
    // so in as many words, so by far the likeliest refusal is that the sku is
    // already on one that search had not caught up with. Asking again settles it
    // without reading the error message: a product that turns up now is the one
    // that caused the refusal. Anything else is a genuine refusal.
    const held = await this.findBySku(creds, line.sku);
    if (held) {
      await this.log.record(line.sku, held);
      return held;
    }

    // Nothing was created and nothing is there. Hand the claim back rather than
    // leave the sku looking permanently unresolved.
    await this.log.release(line.sku);
    throw new Error(`HubSpot refused the product for ${line.sku} with ${created.status}`);
  }

  private async findBySku(
    creds: HubSpotCredentials, sku: string,
  ): Promise<string | null> {
    const found = await this.http.call(creds, '/crm/v3/objects/products/search', {
      method: 'POST',
      body: JSON.stringify({
        filterGroups: [{ filters: [{ propertyName: 'hs_sku', operator: 'EQ', value: sku }] }],
        properties: ['hs_sku'],
      }),
    });
    return (found.body as Found).results?.[0]?.id ?? null;
  }
}
