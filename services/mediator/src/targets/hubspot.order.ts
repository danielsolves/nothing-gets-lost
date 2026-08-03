// services/mediator/src/targets/hubspot.order.ts
// Writes the order itself into HubSpot: a deal for the order, line items for the
// basket, both hung off the contact the buyer became.
//
// A contact is a person, not a purchase. Ten orders from one buyer are one contact
// and ten deals, and a demo that wrote only the contact showed a CRM where the
// orders were invisible: the record said who bought and never what. This is the
// shape every shop integration produces, so it is the shape a visitor recognises.
//
// Exactly-once is the interesting part, and it is harder here than for the contact.
// A contact has a natural key, the email address, so a retry after a crash finds the
// existing one and patches it. A deal has nothing of the sort. The event id is the
// only stable thing the mediator holds, so it becomes the deal's name, and the name
// is what a retry searches for. That is a weaker key than an email — somebody could
// rename a deal by hand and the next retry would make a second one — and it is the
// strongest one available without inventing a custom property, which would make the
// demo need a setup step before it could be believed.
import type { HubSpotCredentials } from '../credentials';
import { HubSpotHttp, type Fetch } from './hubspot.http';
import type { HubSpotCatalogue } from './hubspot.catalogue';

/** The basket as the order was priced, frozen into the event payload at intake. */
export interface OrderLine {
  sku: string;
  name: string;
  qty: number;
  /** The whole line, not the unit price. */
  cents: number;
}

export interface OrderPayload {
  customerName: string;
  customerEmail: string;
  totalCents: number;
  lines?: OrderLine[];
}

interface Created { id?: string }
interface Found { total?: number; results?: Array<{ id: string }> }
interface Associated { results?: Array<{ toObjectId: string | number }> }
interface ReadBack { results?: Array<{ properties?: { hs_sku?: string } }> }

function euros(cents: number): string {
  return (cents / 100).toFixed(2);
}

/**
 * Readable in a HubSpot list and unique per order. The whole event id would be
 * unique too and would read as a machine's name for something; the first block is
 * what the demo already prints when it has to name an event out loud.
 */
export function dealNameFor(eventId: string): string {
  return `Order ${eventId.slice(0, 8)}`;
}

export class HubSpotOrders {
  private readonly http: HubSpotHttp;

  constructor(
    baseUrl: string,
    private readonly catalogue: HubSpotCatalogue,
    doFetch: Fetch = fetch,
  ) {
    this.http = new HubSpotHttp(baseUrl, doFetch);
  }

  /**
   * The deal, its basket, and the link to the buyer. Returns the deal id so the
   * caller can say what it wrote rather than that it wrote something.
   */
  async record(
    creds: HubSpotCredentials,
    input: { eventId: string; contactId: string; payload: OrderPayload },
  ): Promise<{ dealId: string }> {
    const dealId = await this.upsertDeal(creds, input.eventId, input.payload);
    await this.link(creds, 'deals', dealId, 'contacts', input.contactId);
    await this.addMissingLines(creds, dealId, input.payload.lines ?? []);
    return { dealId };
  }

  private async upsertDeal(
    creds: HubSpotCredentials, eventId: string, payload: OrderPayload,
  ): Promise<string> {
    const dealname = dealNameFor(eventId);
    const existing = await this.findDeal(creds, dealname);
    if (existing) return existing;

    // No description. The basket used to be copied in here as prose, because line
    // items pointing at nothing were invisible on the deal, and it left the record
    // stating its total twice and disagreeing with itself if anyone edited one. The
    // products card carries the basket now (see hubspot.catalogue.ts), and the
    // amount below is the only place the total is stated.
    const created = await this.http.call(creds, '/crm/v3/objects/deals', {
      method: 'POST',
      body: JSON.stringify({
        properties: {
          dealname,
          amount: euros(payload.totalCents),
        },
      }),
    });
    const id = (created.body as Created).id;
    if (id) return id;

    // Another worker got there first, or the create landed and the answer did not.
    // Either way the deal exists and reading it back beats making a second one.
    const again = await this.findDeal(creds, dealname);
    if (!again) throw new Error('HubSpot took the deal but named no id');
    return again;
  }

  private async findDeal(
    creds: HubSpotCredentials, dealname: string,
  ): Promise<string | null> {
    const found = await this.http.call(creds, '/crm/v3/objects/deals/search', {
      method: 'POST',
      body: JSON.stringify({
        filterGroups: [{ filters: [{ propertyName: 'dealname', operator: 'EQ', value: dealname }] }],
        properties: ['dealname'],
      }),
    });
    return (found.body as Found).results?.[0]?.id ?? null;
  }

  /**
   * Only the lines that are not on the deal already, matched by sku.
   *
   * A retry that simply created the basket again would double it, and a basket that
   * doubles on a retry is precisely the failure this whole demo is built to say
   * cannot happen here. Reading first costs one call and makes the claim true even
   * when the worker dies between creating the deal and filling it.
   *
   * Matched by sku rather than by the name a person reads: two catalogue entries may
   * end up sharing a name, and none of them can share a sku. The line item carries
   * one because it points at a product that does.
   */
  private async addMissingLines(
    creds: HubSpotCredentials, dealId: string, lines: OrderLine[],
  ): Promise<void> {
    if (lines.length === 0) return;
    const already = await this.lineSkusOn(creds, dealId);
    for (const line of lines) {
      if (already.has(line.sku)) continue;
      const productId = await this.catalogue.idFor(creds, line);
      const created = await this.http.call(creds, '/crm/v3/objects/line_items', {
        method: 'POST',
        body: JSON.stringify({
          properties: {
            // Naming the product is what puts this line on the deal's products card.
            // Name and sku come across from it, so they are not repeated here and
            // cannot drift from the catalogue.
            hs_product_id: productId,
            quantity: String(line.qty),
            // HubSpot prices a line item per unit and multiplies it out itself. The
            // payload carries the whole line, because that is the figure a visitor
            // checks against the receipt, so it is divided back down here. Stated
            // even though the product carries a price, because an order is the price
            // it was placed at and the catalogue may move afterwards.
            price: euros(line.cents / line.qty),
          },
        }),
      });
      const id = (created.body as Created).id;
      if (id) await this.link(creds, 'line_items', id, 'deals', dealId);
    }
  }

  private async lineSkusOn(
    creds: HubSpotCredentials, dealId: string,
  ): Promise<Set<string>> {
    const links = await this.http.call(
      creds, `/crm/v4/objects/deals/${dealId}/associations/line_items`,
    );
    const ids = ((links.body as Associated).results ?? [])
      .map((row) => String(row.toObjectId));
    if (ids.length === 0) return new Set();

    const read = await this.http.call(creds, '/crm/v3/objects/line_items/batch/read', {
      method: 'POST',
      body: JSON.stringify({ properties: ['hs_sku'], inputs: ids.map((id) => ({ id })) }),
    });
    const skus = ((read.body as ReadBack).results ?? [])
      .map((row) => row.properties?.hs_sku)
      .filter((sku): sku is string => typeof sku === 'string');
    return new Set(skus);
  }

  /**
   * The default association between two object types. It is a PUT and it names both
   * ends, so running it again on a delivery that already ran is not a second link.
   */
  private async link(
    creds: HubSpotCredentials,
    from: string, fromId: string, to: string, toId: string,
  ): Promise<void> {
    await this.http.call(
      creds, `/crm/v4/objects/${from}/${fromId}/associations/default/${to}/${toId}`,
      { method: 'PUT' },
    );
  }
}
