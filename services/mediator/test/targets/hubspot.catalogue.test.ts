// services/mediator/test/targets/hubspot.catalogue.test.ts
// The catalogue as HubSpot holds it: eight products, one per sku, created once.
//
// The claims worth pinning are the ones about a second attempt. A deal is named after
// its event and a retry searches for that name; a product has the sku, which HubSpot
// only indexes for search some seconds after the create. So the sku is claimed in the
// database first, and this is where that claim is spent. If it ever stops holding, a
// cut line to HubSpot would leave the CRM holding the same eight products several
// times over.
import { describe, it, expect } from 'vitest';
import { HubSpotCatalogue } from '../../src/targets/hubspot.catalogue';
import type { CatalogueLog, ClaimResult } from '../../src/hubspot-catalogue.log';
import type { OrderLine } from '../../src/targets/hubspot.order';

const CREDS = { token: 'pat-test', visitor: false };
const TEAPOT: OrderLine = { sku: 'TEAPOT', name: 'Teapot', qty: 1, cents: 4900 };
const MUGS: OrderLine = { sku: 'MUG-BLUE', name: 'Blue mug', qty: 2, cents: 2400 };

/** The claim book, in memory. Its real form is pinned in hubspot-catalogue.log.test. */
function book(seed: Record<string, ClaimResult> = {}): CatalogueLog & {
  recorded: Map<string, string>; released: string[];
} {
  const claims = new Map<string, ClaimResult>(Object.entries(seed));
  const recorded = new Map<string, string>();
  const released: string[] = [];
  return {
    recorded,
    released,
    claim: async (sku) => claims.get(sku) ?? { status: 'fresh' },
    record: async (sku, productId) => {
      recorded.set(sku, productId);
      claims.set(sku, { status: 'mirrored', productId });
    },
    release: async (sku) => { released.push(sku); claims.delete(sku); },
  };
}

interface Call { method: string; path: string; body: Record<string, unknown> | null }

/**
 * A HubSpot whose search index runs behind, because the real one does. Products
 * created here are findable only once `settled` is called, which is the whole reason
 * the claim book exists.
 */
function portal(options: {
  indexed?: Array<{ sku: string; id: string }>;
  failCreate?: boolean;
  /** A sku the portal holds but has not indexed yet: create refuses, search misses. */
  heldButUnindexed?: string;
} = {}) {
  const calls: Call[] = [];
  const bySku = new Map<string, string>();
  let nextId = 400;
  for (const row of options.indexed ?? []) bySku.set(row.sku, row.id);

  const doFetch = async (url: string, init?: RequestInit) => {
    const path = url.replace('https://gate/proxy/hubspot', '');
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : null;
    calls.push({ method, path, body });
    const json = (value: unknown, status = 200) =>
      new Response(JSON.stringify(value), { status });

    if (path === '/crm/v3/objects/products/search') {
      const filters = body as { filterGroups: Array<{ filters: Array<{ value: string }> }> };
      const wanted = filters.filterGroups[0].filters[0].value;
      // The second search finds it: a create that was refused proves the product is
      // there, and by the time we ask again the index has caught up.
      if (wanted === options.heldButUnindexed && calls.filter(
        (c) => c.path === '/crm/v3/objects/products/search',
      ).length > 1) {
        return json({ total: 1, results: [{ id: 'prod-held' }] });
      }
      const id = bySku.get(wanted);
      return json({ total: id ? 1 : 0, results: id ? [{ id }] : [] });
    }
    if (path === '/crm/v3/objects/products' && method === 'POST') {
      if (options.failCreate) return json({ message: 'Property values were not valid' }, 400);
      const props = (body as { properties: { hs_sku: string } }).properties;
      if (props.hs_sku === options.heldButUnindexed) {
        // HubSpot's own words, near enough: hs_sku is unique on a product.
        return json({
          status: 'error',
          category: 'VALIDATION_ERROR',
          message: `Cannot set hs_sku value ${props.hs_sku} on 999. prod-held already has that value.`,
        }, 400);
      }
      return json({ id: `prod-${nextId++}` }, 201);
    }
    return json({}, 404);
  };

  return {
    calls,
    createdBodies: () =>
      calls
        .filter((call) => call.method === 'POST' && call.path === '/crm/v3/objects/products')
        .map((call) => (call.body as { properties: Record<string, string> }).properties),
    searches: () =>
      calls.filter((call) => call.path === '/crm/v3/objects/products/search'),
    make: (log: CatalogueLog) => new HubSpotCatalogue('https://gate/proxy/hubspot', log, doFetch),
  };
}

describe('HubSpotCatalogue', () => {
  it('creates the product a sku has never been mirrored to', async () => {
    const hubspot = portal();
    const log = book();
    const id = await hubspot.make(log).idFor(CREDS, TEAPOT);

    expect(id).toMatch(/^prod-/);
    expect(log.recorded.get('TEAPOT')).toBe(id);
  });

  it('carries the sku, the name and the unit price onto the product', async () => {
    // The unit price, not the line: the payload carries the whole line, and a
    // product priced at 24.00 would make every future basket of two mugs read 48.00.
    const hubspot = portal();
    await hubspot.make(book()).idFor(CREDS, MUGS);

    expect(hubspot.createdBodies()).toEqual([
      { name: 'Blue mug', price: '12.00', hs_sku: 'MUG-BLUE' },
    ]);
  });

  it('adopts a product the portal already holds', async () => {
    // The claim book is ours and the portal is not. A fresh database against a
    // portal that has been used before is the normal case, not the odd one: it
    // happens on every deployment, and it happened on the first one. Treating a
    // fresh claim as proof the product does not exist made HubSpot refuse all
    // eight, because hs_sku is unique on a product and it says so.
    const hubspot = portal({ indexed: [{ sku: 'TEAPOT', id: 'prod-already-there' }] });
    const log = book();

    expect(await hubspot.make(log).idFor(CREDS, TEAPOT)).toBe('prod-already-there');
    expect(hubspot.createdBodies()).toEqual([]);
    expect(log.recorded.get('TEAPOT')).toBe('prod-already-there');
  });

  it('adopts the product HubSpot names when it refuses the sku as a duplicate', async () => {
    // The belt to the braces above. The portal holds the sku but has not indexed
    // it, so the search misses and the create is refused. A refusal for that
    // reason is itself proof the product is there, and asking again finds it.
    const hubspot = portal({ heldButUnindexed: 'TEAPOT' });
    const log = book();

    expect(await hubspot.make(log).idFor(CREDS, TEAPOT)).toBe('prod-held');
    expect(log.recorded.get('TEAPOT')).toBe('prod-held');
    expect(log.released).toEqual([]);
  });

  it('reuses the product it already made instead of making a second one', async () => {
    const hubspot = portal();
    const log = book({ TEAPOT: { status: 'mirrored', productId: 'prod-existing' } });

    expect(await hubspot.make(log).idFor(CREDS, TEAPOT)).toBe('prod-existing');
    expect(hubspot.createdBodies()).toEqual([]);
    // Nothing to ask HubSpot: the claim book already knew the answer.
    expect(hubspot.searches()).toHaveLength(0);
  });

  it('never mirrors a sku twice across the orders of one basket', async () => {
    const hubspot = portal();
    const log = book();
    const catalogue = hubspot.make(log);
    const first = await catalogue.idFor(CREDS, TEAPOT);
    const second = await catalogue.idFor(CREDS, TEAPOT);

    expect(second).toBe(first);
    expect(hubspot.createdBodies()).toHaveLength(1);
  });

  it('adopts the product a crashed attempt left behind', async () => {
    // The worker died between creating the product and writing down its id. By now
    // the search index has caught up, so the product can be found and adopted.
    const hubspot = portal({ indexed: [{ sku: 'TEAPOT', id: 'prod-orphan' }] });
    const log = book({ TEAPOT: { status: 'unknown', claimedAt: new Date(Date.now() - 1000) } });

    expect(await hubspot.make(log).idFor(CREDS, TEAPOT)).toBe('prod-orphan');
    expect(log.recorded.get('TEAPOT')).toBe('prod-orphan');
    expect(hubspot.createdBodies()).toEqual([]);
  });

  it('waits rather than risk a duplicate while the search index is behind', async () => {
    // A crashed attempt, seconds old, and search says nothing. That is not proof:
    // HubSpot indexes a new product some seconds after creating it. Failing here
    // costs one retry. Creating here costs a duplicate nobody would notice.
    const hubspot = portal();
    const log = book({ TEAPOT: { status: 'unknown', claimedAt: new Date(Date.now() - 1000) } });

    await expect(hubspot.make(log).idFor(CREDS, TEAPOT)).rejects.toThrow(/settle|index|behind/i);
    expect(hubspot.createdBodies()).toEqual([]);
  });

  it('creates once the claim is older than the index can lag', async () => {
    // Same crashed claim, now minutes old. Search finding nothing is proof nothing
    // was created, so the mirror finishes the job instead of parking forever.
    const hubspot = portal();
    const log = book({ TEAPOT: { status: 'unknown', claimedAt: new Date(Date.now() - 600_000) } });

    expect(await hubspot.make(log).idFor(CREDS, TEAPOT)).toMatch(/^prod-/);
  });

  it('gives the claim back when HubSpot refuses the product', async () => {
    // HubSpot answered, so we know nothing was created. Holding the claim would park
    // this sku as permanently unknown and cost every later order a retry.
    const hubspot = portal({ failCreate: true });
    const log = book();

    await expect(hubspot.make(log).idFor(CREDS, TEAPOT)).rejects.toThrow();
    expect(log.released).toEqual(['TEAPOT']);
  });
});
