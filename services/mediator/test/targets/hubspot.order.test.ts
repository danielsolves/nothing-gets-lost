// services/mediator/test/targets/hubspot.order.test.ts
// The order as HubSpot holds it: a deal for the purchase, line items for the basket
// pointing at catalogue products, all of it hung off the buyer's contact.
//
// The claims worth pinning are the ones about a second attempt. A contact has the
// email address as a natural key; a deal has nothing of the sort, so the deal's name
// is made from the event id and a retry searches for it. If that ever stops holding,
// a cut line to HubSpot would fill the CRM with duplicate orders and duplicate
// baskets, which is the exact failure this demo claims cannot happen.
import { describe, it, expect } from 'vitest';
import { HubSpotOrders, dealNameFor, type OrderPayload } from '../../src/targets/hubspot.order';
import { HubSpotCatalogue } from '../../src/targets/hubspot.catalogue';
import type { CatalogueLog, ClaimResult } from '../../src/hubspot-catalogue.log';

const CREDS = { token: 'pat-test', visitor: false };
const EVENT = '366efd15-025e-4d46-b3ca-4951a3312e0a';

const PAYLOAD: OrderPayload = {
  customerName: 'M. Berger',
  customerEmail: 'm@example.com',
  totalCents: 7300,
  lines: [
    { sku: 'TEAPOT', name: 'Teapot', qty: 1, cents: 4900 },
    { sku: 'MUG-BLUE', name: 'Blue mug', qty: 2, cents: 2400 },
  ],
};

interface Call { method: string; path: string; body: Record<string, unknown> | null }

/** The claim book, in memory. Its real form is pinned in hubspot-catalogue.log.test. */
function book(): CatalogueLog {
  const claims = new Map<string, ClaimResult>();
  return {
    claim: async (sku) => claims.get(sku) ?? { status: 'fresh' },
    record: async (sku, productId) => { claims.set(sku, { status: 'mirrored', productId }); },
    release: async (sku) => { claims.delete(sku); },
  };
}

/**
 * A HubSpot that remembers. Not a list of canned answers: the point of nearly every
 * test here is what the second attempt does, and a stub that answered the same thing
 * twice could not tell a retry that found the deal from one that made another.
 *
 * Line items inherit name and sku from the product they point at, the way the live
 * api does. That is what lets a retry recognise a basket it already wrote.
 */
function portal(options: { dealExists?: boolean; lineSkus?: string[] } = {}) {
  const calls: Call[] = [];
  const deals = new Map<string, string>();
  const productSkus = new Map<string, string>();
  const lineItemsOnDeal = new Map<string, string[]>();
  const lineItemSkus = new Map<string, string>();
  let nextId = 1000;

  if (options.dealExists) deals.set(dealNameFor(EVENT), 'deal-existing');
  for (const sku of options.lineSkus ?? []) {
    const id = `li-${nextId++}`;
    lineItemSkus.set(id, sku);
    lineItemsOnDeal.set('deal-existing', [...(lineItemsOnDeal.get('deal-existing') ?? []), id]);
  }

  const doFetch = async (url: string, init?: RequestInit) => {
    const path = url.replace('https://gate/proxy/hubspot', '');
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : null;
    calls.push({ method, path, body });
    const json = (value: unknown, status = 200) =>
      new Response(JSON.stringify(value), { status });

    if (path === '/crm/v3/objects/deals/search') {
      const filters = body as { filterGroups: Array<{ filters: Array<{ value: string }> }> };
      const id = deals.get(filters.filterGroups[0].filters[0].value);
      return json({ total: id ? 1 : 0, results: id ? [{ id }] : [] });
    }
    if (path === '/crm/v3/objects/deals' && method === 'POST') {
      const props = (body as { properties: { dealname: string } }).properties;
      const id = `deal-${nextId++}`;
      deals.set(props.dealname, id);
      return json({ id }, 201);
    }
    if (path === '/crm/v3/objects/products' && method === 'POST') {
      const props = (body as { properties: { hs_sku: string } }).properties;
      const id = `prod-${nextId++}`;
      productSkus.set(id, props.hs_sku);
      return json({ id }, 201);
    }
    if (path === '/crm/v3/objects/products/search') {
      // Nothing is findable here: the live index runs seconds behind a create, so a
      // fake that answered instantly would hide the very race the claim book exists
      // to close.
      return json({ total: 0, results: [] });
    }
    if (path === '/crm/v3/objects/line_items' && method === 'POST') {
      const props = (body as { properties: { hs_product_id: string } }).properties;
      const id = `li-${nextId++}`;
      const sku = productSkus.get(props.hs_product_id);
      if (sku) lineItemSkus.set(id, sku);
      return json({ id }, 201);
    }
    if (path.endsWith('/associations/line_items')) {
      // /crm/v4/objects/deals/<id>/associations/line_items
      const dealId = path.split('/')[5];
      const ids = lineItemsOnDeal.get(dealId) ?? [];
      return json({ results: ids.map((id) => ({ toObjectId: id })) });
    }
    if (path === '/crm/v3/objects/line_items/batch/read') {
      const inputs = (body as { inputs: Array<{ id: string }> }).inputs;
      return json({
        results: inputs.map(({ id }) => ({ id, properties: { hs_sku: lineItemSkus.get(id) } })),
      });
    }
    if (method === 'PUT' && path.includes('/associations/default/')) {
      // /crm/v4/objects/<from>/<fromId>/associations/default/<to>/<toId>
      const parts = path.split('/');
      if (parts[4] === 'line_items') {
        const dealId = parts[9];
        lineItemsOnDeal.set(dealId, [...(lineItemsOnDeal.get(dealId) ?? []), parts[5]]);
      }
      return json({ status: 'COMPLETE' });
    }
    return json({}, 404);
  };

  const base = 'https://gate/proxy/hubspot';
  return {
    orders: new HubSpotOrders(base, new HubSpotCatalogue(base, book(), doFetch), doFetch),
    calls,
    productSkus,
    pathsOf: (method: string, needle: string) =>
      calls.filter((call) => call.method === method && call.path.includes(needle)),
    postsTo: (path: string) =>
      calls.filter((call) => call.method === 'POST' && call.path === path),
    /** The skus whose products the basket ended up pointing at, in order. */
    lineSkusCreated: () =>
      calls
        .filter((call) => call.method === 'POST' && call.path === '/crm/v3/objects/line_items')
        .map((call) =>
          productSkus.get((call.body as { properties: { hs_product_id: string } })
            .properties.hs_product_id)),
    lineBodies: () =>
      calls
        .filter((call) => call.method === 'POST' && call.path === '/crm/v3/objects/line_items')
        .map((call) => (call.body as { properties: Record<string, string> }).properties),
    dealProperties: () => {
      const [created] = calls.filter(
        (call) => call.method === 'POST' && call.path === '/crm/v3/objects/deals',
      );
      return (created?.body as { properties: Record<string, string> } | undefined)?.properties;
    },
  };
}

describe('HubSpotOrders', () => {
  it('names the deal after the order, so a person can find it again', () => {
    expect(dealNameFor(EVENT)).toBe('Order 366efd15');
  });

  it('creates the deal, the basket and the link to the buyer', async () => {
    const hubspot = portal();
    const { dealId } = await hubspot.orders.record(CREDS, {
      eventId: EVENT, contactId: 'contact-1', payload: PAYLOAD,
    });

    expect(dealId).toMatch(/^deal-/);
    expect(hubspot.lineSkusCreated()).toEqual(['TEAPOT', 'MUG-BLUE']);
    expect(hubspot.pathsOf('PUT', `/deals/${dealId}/associations/default/contacts/contact-1`))
      .toHaveLength(1);
  });

  it('points every line item at the catalogue product for its sku', async () => {
    // The reason the catalogue exists. A line item that names no product is a real
    // record the api will hand back, but the card listing a deal's contents counts
    // only the ones pointing at a product, so the CRM showed a total and no contents.
    const hubspot = portal();
    await hubspot.orders.record(CREDS, {
      eventId: EVENT, contactId: 'contact-1', payload: PAYLOAD,
    });

    for (const properties of hubspot.lineBodies()) {
      expect(properties.hs_product_id).toMatch(/^prod-/);
    }
    expect(hubspot.postsTo('/crm/v3/objects/products')).toHaveLength(2);
  });

  it('prices a line item per unit, because that is what HubSpot multiplies out', async () => {
    // The payload carries the whole line, since that is the figure a visitor holds
    // against the receipt. Handing HubSpot 24.00 for two mugs would show 48.00.
    const hubspot = portal();
    await hubspot.orders.record(CREDS, {
      eventId: EVENT, contactId: 'contact-1', payload: PAYLOAD,
    });

    expect(hubspot.lineBodies().map(({ quantity, price }) => ({ quantity, price })))
      .toEqual([
        { quantity: '1', price: '49.00' },
        { quantity: '2', price: '12.00' },
      ]);
  });

  it('never copies the basket into the deal description', async () => {
    // It did once, as a stopgap, because line items were invisible without the
    // catalogue. The products card carries the basket now, and a second copy in prose
    // would only be a second total to disagree with the first.
    const hubspot = portal();
    await hubspot.orders.record(CREDS, {
      eventId: EVENT, contactId: 'contact-1', payload: PAYLOAD,
    });

    expect(hubspot.dealProperties()).not.toHaveProperty('description');
  });

  it('carries the order total onto the deal', async () => {
    const hubspot = portal();
    await hubspot.orders.record(CREDS, {
      eventId: EVENT, contactId: 'contact-1', payload: PAYLOAD,
    });

    expect(hubspot.dealProperties()?.amount).toBe('73.00');
  });

  it('finds the deal it already made instead of making a second one', async () => {
    const hubspot = portal({ dealExists: true });
    const { dealId } = await hubspot.orders.record(CREDS, {
      eventId: EVENT, contactId: 'contact-1', payload: PAYLOAD,
    });

    expect(dealId).toBe('deal-existing');
    expect(hubspot.postsTo('/crm/v3/objects/deals')).toHaveLength(0);
  });

  it('never doubles a basket, whatever the retry found', async () => {
    // The failure this demo exists to say cannot happen. A cut line to HubSpot means
    // six attempts, and six attempts that each appended the basket would leave the
    // CRM holding twelve mugs somebody ordered two of.
    const hubspot = portal({ dealExists: true, lineSkus: ['TEAPOT', 'MUG-BLUE'] });
    await hubspot.orders.record(CREDS, {
      eventId: EVENT, contactId: 'contact-1', payload: PAYLOAD,
    });

    expect(hubspot.lineSkusCreated()).toEqual([]);
  });

  it('fills in only the half of a basket a crash left missing', async () => {
    // The worker died between the deal and its second line. The retry has to finish
    // the job rather than start it again or skip it.
    const hubspot = portal({ dealExists: true, lineSkus: ['TEAPOT'] });
    await hubspot.orders.record(CREDS, {
      eventId: EVENT, contactId: 'contact-1', payload: PAYLOAD,
    });

    expect(hubspot.lineSkusCreated()).toEqual(['MUG-BLUE']);
  });

  it('writes no basket for an order that was never booked as one', async () => {
    // A Stripe payment webhook reaches the queue with no order row behind it.
    const hubspot = portal();
    await hubspot.orders.record(CREDS, {
      eventId: EVENT, contactId: 'contact-1',
      payload: { customerName: 'M. Berger', customerEmail: 'm@example.com', totalCents: 7300 },
    });

    expect(hubspot.lineSkusCreated()).toEqual([]);
    expect(hubspot.postsTo('/crm/v3/objects/products')).toEqual([]);
    expect(hubspot.postsTo('/crm/v3/objects/deals')).toHaveLength(1);
  });
});
