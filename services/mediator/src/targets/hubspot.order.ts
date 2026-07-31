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
interface ReadBack { results?: Array<{ properties?: { name?: string } }> }

function euros(cents: number): string {
  return (cents / 100).toFixed(2);
}

/**
 * The basket in words, for the deal's description.
 *
 * The line items are the real record and this is a copy of them, which is normally
 * the wrong trade. It earns its place because HubSpot will not show the real one:
 * the card that lists line items on a deal belongs to the paid products tooling, so
 * on a free account the deal says 73.00 and never says what for. A visitor reading
 * the CRM should not have to open an API client to find out what was ordered.
 *
 * Written once, when the deal is created. A retry finds the deal and leaves it
 * alone, so this never overwrites anything a person edited by hand.
 */
export function basketText(lines: OrderLine[], totalCents: number): string {
  const rows = lines.map((line) => `${line.qty} x ${line.name}  ${euros(line.cents)} EUR`);
  return [...rows, `Total  ${euros(totalCents)} EUR`].join('\n');
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

  constructor(baseUrl: string, doFetch: Fetch = fetch) {
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

    const lines = payload.lines ?? [];
    const created = await this.http.call(creds, '/crm/v3/objects/deals', {
      method: 'POST',
      body: JSON.stringify({
        properties: {
          dealname,
          amount: euros(payload.totalCents),
          // Absent rather than empty for an order that was never booked as a basket,
          // a Stripe payment webhook being the one that does that. A description
          // reading "Total 73.00" and nothing else says less than no description.
          ...(lines.length > 0
            ? { description: basketText(lines, payload.totalCents) }
            : {}),
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
   * Only the lines that are not on the deal already, matched by name.
   *
   * A retry that simply created the basket again would double it, and a basket that
   * doubles on a retry is precisely the failure this whole demo is built to say
   * cannot happen here. Reading first costs one call and makes the claim true even
   * when the worker dies between creating the deal and filling it.
   */
  private async addMissingLines(
    creds: HubSpotCredentials, dealId: string, lines: OrderLine[],
  ): Promise<void> {
    if (lines.length === 0) return;
    const already = await this.lineNamesOn(creds, dealId);
    for (const line of lines) {
      if (already.has(line.name)) continue;
      const created = await this.http.call(creds, '/crm/v3/objects/line_items', {
        method: 'POST',
        body: JSON.stringify({
          properties: {
            name: line.name,
            quantity: String(line.qty),
            // HubSpot prices a line item per unit and multiplies it out itself. The
            // payload carries the whole line, because that is the figure a visitor
            // checks against the receipt, so it is divided back down here.
            price: euros(line.cents / line.qty),
          },
        }),
      });
      const id = (created.body as Created).id;
      if (id) await this.link(creds, 'line_items', id, 'deals', dealId);
    }
  }

  private async lineNamesOn(
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
      body: JSON.stringify({ properties: ['name'], inputs: ids.map((id) => ({ id })) }),
    });
    const names = ((read.body as ReadBack).results ?? [])
      .map((row) => row.properties?.name)
      .filter((name): name is string => typeof name === 'string');
    return new Set(names);
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
