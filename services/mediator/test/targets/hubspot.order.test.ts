// services/mediator/test/targets/hubspot.order.test.ts
// The order as HubSpot holds it: a deal for the purchase, line items for the basket,
// both hung off the buyer's contact.
//
// The claims worth pinning are the ones about a second attempt. A contact has the
// email address as a natural key; a deal has nothing of the sort, so the deal's name
// is made from the event id and a retry searches for it. If that ever stops holding,
// a cut line to HubSpot would fill the CRM with duplicate orders and duplicate
// baskets, which is the exact failure this demo claims cannot happen.
import { describe, it, expect } from 'vitest';
import { HubSpotOrders, dealNameFor, type OrderPayload } from '../../src/targets/hubspot.order';

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

/**
 * A HubSpot that remembers. Not a list of canned answers: the point of nearly every
 * test here is what the second attempt does, and a stub that answered the same thing
 * twice could not tell a retry that found the deal from one that made another.
 */
function portal(options: { dealExists?: boolean; lineNames?: string[] } = {}) {
  const calls: Call[] = [];
  const deals = new Map<string, string>();
  const lineItemsOnDeal = new Map<string, string[]>();
  const lineItemNames = new Map<string, string>();
  let nextId = 1000;

  if (options.dealExists) deals.set(dealNameFor(EVENT), 'deal-existing');
  for (const name of options.lineNames ?? []) {
    const id = `li-${nextId++}`;
    lineItemNames.set(id, name);
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
      const wanted = filters.filterGroups[0].filters[0].value;
      const id = deals.get(wanted);
      return json({ total: id ? 1 : 0, results: id ? [{ id }] : [] });
    }
    if (path === '/crm/v3/objects/deals' && method === 'POST') {
      const props = (body as { properties: { dealname: string } }).properties;
      const id = `deal-${nextId++}`;
      deals.set(props.dealname, id);
      return json({ id }, 201);
    }
    if (path === '/crm/v3/objects/line_items' && method === 'POST') {
      const props = (body as { properties: { name: string } }).properties;
      const id = `li-${nextId++}`;
      lineItemNames.set(id, props.name);
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
        results: inputs.map(({ id }) => ({ id, properties: { name: lineItemNames.get(id) } })),
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

  return {
    orders: new HubSpotOrders('https://gate/proxy/hubspot', doFetch),
    calls,
    pathsOf: (method: string, needle: string) =>
      calls.filter((call) => call.method === method && call.path.includes(needle)),
    lineNamesCreated: () =>
      calls
        .filter((call) => call.method === 'POST' && call.path === '/crm/v3/objects/line_items')
        .map((call) => (call.body as { properties: { name: string } }).properties.name),
    lineBodies: () =>
      calls
        .filter((call) => call.method === 'POST' && call.path === '/crm/v3/objects/line_items')
        .map((call) => (call.body as { properties: Record<string, string> }).properties),
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
    expect(hubspot.lineNamesCreated()).toEqual(['Teapot', 'Blue mug']);
    expect(hubspot.pathsOf('PUT', `/deals/${dealId}/associations/default/contacts/contact-1`))
      .toHaveLength(1);
  });

  it('prices a line item per unit, because that is what HubSpot multiplies out', async () => {
    // The payload carries the whole line, since that is the figure a visitor holds
    // against the receipt. Handing HubSpot 24.00 for two mugs would show 48.00.
    const hubspot = portal();
    await hubspot.orders.record(CREDS, {
      eventId: EVENT, contactId: 'contact-1', payload: PAYLOAD,
    });
    expect(hubspot.lineBodies()).toEqual([
      { name: 'Teapot', quantity: '1', price: '49.00' },
      { name: 'Blue mug', quantity: '2', price: '12.00' },
    ]);
  });

  it('writes the basket onto the deal in words a person can read', async () => {
    // HubSpot holds the basket as line items, and on an account without the paid
    // products tooling there is no card on the deal that shows them: the record says
    // 193.00 and never what was bought. The same basket goes into the description,
    // which every tier renders, so the order is legible without an API client.
    const hubspot = portal();
    await hubspot.orders.record(CREDS, {
      eventId: EVENT, contactId: 'contact-1', payload: PAYLOAD,
    });
    const [created] = hubspot.calls.filter(
      (call) => call.method === 'POST' && call.path === '/crm/v3/objects/deals',
    );
    const { description } = (created.body as { properties: { description: string } }).properties;
    expect(description).toContain('1 x Teapot');
    expect(description).toContain('49.00');
    expect(description).toContain('2 x Blue mug');
    expect(description).toContain('24.00');
    expect(description).toContain('73.00');
  });

  it('leaves the description off an order that has no basket', async () => {
    const hubspot = portal();
    await hubspot.orders.record(CREDS, {
      eventId: EVENT, contactId: 'contact-1',
      payload: { customerName: 'M. Berger', customerEmail: 'm@example.com', totalCents: 7300 },
    });
    const [created] = hubspot.calls.filter(
      (call) => call.method === 'POST' && call.path === '/crm/v3/objects/deals',
    );
    expect((created.body as { properties: Record<string, string> }).properties)
      .not.toHaveProperty('description');
  });

  it('carries the order total onto the deal', async () => {
    const hubspot = portal();
    await hubspot.orders.record(CREDS, {
      eventId: EVENT, contactId: 'contact-1', payload: PAYLOAD,
    });
    const [created] = hubspot.calls.filter(
      (call) => call.method === 'POST' && call.path === '/crm/v3/objects/deals',
    );
    expect((created.body as { properties: { amount: string } }).properties.amount)
      .toBe('73.00');
  });

  it('finds the deal it already made instead of making a second one', async () => {
    const hubspot = portal({ dealExists: true });
    const { dealId } = await hubspot.orders.record(CREDS, {
      eventId: EVENT, contactId: 'contact-1', payload: PAYLOAD,
    });
    expect(dealId).toBe('deal-existing');
    expect(hubspot.calls.filter(
      (call) => call.method === 'POST' && call.path === '/crm/v3/objects/deals',
    )).toHaveLength(0);
  });

  it('never doubles a basket, whatever the retry found', async () => {
    // The failure this demo exists to say cannot happen. A cut line to HubSpot means
    // six attempts, and six attempts that each appended the basket would leave the
    // CRM holding twelve mugs somebody ordered two of.
    const hubspot = portal({ dealExists: true, lineNames: ['Teapot', 'Blue mug'] });
    await hubspot.orders.record(CREDS, {
      eventId: EVENT, contactId: 'contact-1', payload: PAYLOAD,
    });
    expect(hubspot.lineNamesCreated()).toEqual([]);
  });

  it('fills in only the half of a basket a crash left missing', async () => {
    // The worker died between the deal and its second line. The retry has to finish
    // the job rather than start it again or skip it.
    const hubspot = portal({ dealExists: true, lineNames: ['Teapot'] });
    await hubspot.orders.record(CREDS, {
      eventId: EVENT, contactId: 'contact-1', payload: PAYLOAD,
    });
    expect(hubspot.lineNamesCreated()).toEqual(['Blue mug']);
  });

  it('writes no basket for an order that was never booked as one', async () => {
    // A Stripe payment webhook reaches the queue with no order row behind it.
    const hubspot = portal();
    await hubspot.orders.record(CREDS, {
      eventId: EVENT, contactId: 'contact-1',
      payload: { customerName: 'M. Berger', customerEmail: 'm@example.com', totalCents: 7300 },
    });
    expect(hubspot.lineNamesCreated()).toEqual([]);
    expect(hubspot.calls.filter(
      (call) => call.method === 'POST' && call.path === '/crm/v3/objects/deals',
    )).toHaveLength(1);
  });
});
