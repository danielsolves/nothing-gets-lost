// services/api/test/extract-order.service.test.ts
// What the api does with a model answer it used to throw away.
//
// The two assertions that carry the feature are at the bottom. Nothing is placed by
// reading a mail, ever, whatever the answer says; and the money is ours rather than
// the model's, so an answer is priced from the products table and the model is never
// asked what anything costs.
//
// The extractor is a stub here. Its own two checks have their own suite against a
// real database, and repeating them would be testing the same thing twice while
// hiding the one thing this file is for: that the api does not take the extractor's
// verdict on trust either.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Pool } from 'pg';
import { runMigrations } from '@ngl/db';
import type { ExtractResult } from '@ngl/contracts';
import { ExtractOrderService } from '../src/extract-order.service';
import type { Extractor } from '../src/extractor.client';

let container: StartedPostgreSqlContainer;
let pool: Pool;

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine').start();
  pool = new Pool({ connectionString: container.getConnectionUri() });
  await runMigrations(pool);
}, 120_000);

afterAll(async () => { await pool.end(); await container.stop(); });
beforeEach(async () => { await pool.query('TRUNCATE events CASCADE'); });

const MAIL = 'Hello, three blue mugs and two oak coasters please. M. Berger';

const GOOD: ExtractResult = {
  ok: true,
  mode: 'recorded',
  raw: { anything: 'the model actually said' },
  order: {
    customer: { name: 'M. Berger', email: 'm@example.com' },
    items: [{ sku: 'MUG-BLUE', qty: 3 }, { sku: 'COASTER-OAK', qty: 2 }],
    notes: 'invoice to head office as usual',
  },
};

function answering(result: ExtractResult): Extractor {
  return { async read() { return result; } };
}

function service(result: ExtractResult): ExtractOrderService {
  return new ExtractOrderService(pool, answering(result));
}

describe('ExtractOrderService', () => {
  it('prices the proposal from the catalogue, never from the model', async () => {
    const answer = await service(GOOD).read(MAIL);
    expect(answer.ok).toBe(true);
    if (!answer.ok) return;
    expect(answer.proposal.lines).toEqual([
      { sku: 'MUG-BLUE', name: 'Blue mug', qty: 3, cents: 3600 },
      { sku: 'COASTER-OAK', name: 'Oak coaster', qty: 2, cents: 900 },
    ]);
    expect(answer.proposal.totalCents).toBe(4500);
  });

  it('prices a line as the whole line, so nobody has to multiply to check it', async () => {
    const answer = await service(GOOD).read(MAIL);
    if (!answer.ok) throw new Error('expected a proposal');
    expect(answer.proposal.lines[0].cents).toBe(3 * 1200);
  });

  it('adds the total up from the lines it is showing', async () => {
    const answer = await service(GOOD).read(MAIL);
    if (!answer.ok) throw new Error('expected a proposal');
    const summed = answer.proposal.lines.reduce((sum, line) => sum + line.cents, 0);
    expect(summed).toBe(answer.proposal.totalCents);
  });

  it('carries the name, the address and the note it read', async () => {
    const answer = await service(GOOD).read(MAIL);
    if (!answer.ok) throw new Error('expected a proposal');
    expect(answer.proposal.customerName).toBe('M. Berger');
    expect(answer.proposal.customerEmail).toBe('m@example.com');
    expect(answer.proposal.notes).toBe('invoice to head office as usual');
  });

  it('keeps what the model said, on a proposal as much as on a refusal', async () => {
    // The raw answer is the evidence. A page that shows a tidy proposal and hides
    // the sentence it came from is asking to be believed, which is the one thing
    // this demo does not do.
    const answer = await service(GOOD).read(MAIL);
    expect(answer.raw).toEqual({ anything: 'the model actually said' });
  });

  it('says a recorded answer is recorded, and never quietly upgrades it', async () => {
    const recorded = await service(GOOD).read(MAIL);
    const live = await service({ ...GOOD, mode: 'live' }).read(MAIL);
    expect(recorded.mode).toBe('recorded');
    expect(live.mode).toBe('live');
  });

  it('reports the check that refused an invented article, and what was said', async () => {
    const answer = await service({
      ok: false, mode: 'recorded', reason: 'catalog',
      detail: 'unknown sku: MUG-AZURE',
      raw: { items: [{ sku: 'MUG-AZURE', qty: 4 }] },
    }).read(MAIL);

    expect(answer.ok).toBe(false);
    if (answer.ok) return;
    expect(answer.stoppedBy).toBe('catalog');
    expect(answer.detail).toContain('MUG-AZURE');
    expect(answer.raw).toEqual({ items: [{ sku: 'MUG-AZURE', qty: 4 }] });
  });

  it('reports the check that refused a malformed answer', async () => {
    const answer = await service({
      ok: false, mode: 'recorded', reason: 'schema',
      detail: 'items: Array must contain at least 1 element(s)',
      raw: { customer: { name: 'M. Berger' }, items: [], notes: null },
    }).read(MAIL);

    expect(answer.ok).toBe(false);
    if (answer.ok) return;
    expect(answer.stoppedBy).toBe('schema');
    expect(answer.detail).toMatch(/items/);
  });

  it('does not take the extractor word for it that the articles exist', async () => {
    // The catalogue check runs in another process against another connection. This
    // one prices from the table itself, so an article that is not on the shelf has
    // no price to be given, and a proposal with a hole in it is not a proposal.
    const passedTheOtherProcess: ExtractResult = {
      ok: true, mode: 'recorded', raw: {},
      order: {
        customer: { name: 'M. Berger', email: 'm@example.com' },
        items: [{ sku: 'MUG-AZURE', qty: 4 }],
        notes: null,
      },
    };
    const answer = await service(passedTheOtherProcess).read(MAIL);

    expect(answer.ok).toBe(false);
    if (answer.ok) return;
    expect(answer.stoppedBy).toBe('catalog');
    expect(answer.detail).toContain('MUG-AZURE');
  });

  it('places nothing, whatever the answer was', async () => {
    // The whole point of the confirmation step. Reading a mail is not ordering, and
    // this service holds no intake to order with.
    await service(GOOD).read(MAIL);
    await service({
      ok: false, mode: 'recorded', reason: 'catalog', detail: 'unknown sku: X', raw: {},
    }).read(MAIL);

    const events = await pool.query('SELECT count(*)::int AS n FROM events');
    const orders = await pool.query('SELECT count(*)::int AS n FROM orders');
    expect(events.rows[0].n).toBe(0);
    expect(orders.rows[0].n).toBe(0);
  });
});
