// services/extractor/test/extract.service.test.ts
// Proves the two checks of spec 8.3 against a real database: the schema catches a
// malformed answer, the catalogue lookup catches an invented SKU. The model is a
// stub here, so the suite never needs a key and never reaches the network.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Pool } from 'pg';
import { runMigrations } from '@ngl/db';
import { ExtractService, type Model } from '../src/extract.service';

let container: StartedPostgreSqlContainer;
let pool: Pool;

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine').start();
  pool = new Pool({ connectionString: container.getConnectionUri() });
  await runMigrations(pool);
}, 120_000);

afterAll(async () => { await pool.end(); await container.stop(); });

const MAIL = 'Hi, three blue mugs and two oak coasters please. M. Berger, m@example.com';

function modelReturning(value: unknown): Model {
  return { async complete() { return JSON.stringify(value); } };
}

const GOOD = {
  customer: { name: 'M. Berger', email: 'm@example.com' },
  items: [{ sku: 'MUG-BLUE', qty: 3 }, { sku: 'COASTER-OAK', qty: 2 }],
  notes: null,
};

describe('ExtractService', () => {
  it('accepts a well formed answer whose skus exist', async () => {
    const service = new ExtractService(pool, modelReturning(GOOD));
    const result = await service.extract(MAIL);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.order.items).toHaveLength(2);
      expect(result.order.customer.email).toBe('m@example.com');
    }
  });

  it('rejects a quantity that is a word instead of a number', async () => {
    const service = new ExtractService(pool, modelReturning({
      ...GOOD, items: [{ sku: 'MUG-BLUE', qty: 'three' }],
    }));
    const result = await service.extract(MAIL);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('schema');
      expect(result.detail).toMatch(/qty/);
    }
  });

  it('rejects a missing customer email', async () => {
    const service = new ExtractService(pool, modelReturning({
      customer: { name: 'M. Berger' }, items: [{ sku: 'MUG-BLUE', qty: 1 }], notes: null,
    }));
    const result = await service.extract(MAIL);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('schema');
  });

  it('rejects invented extra fields', async () => {
    const service = new ExtractService(pool, modelReturning({
      ...GOOD, discountPercent: 20,
    }));
    const result = await service.extract(MAIL);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('schema');
  });

  it('rejects a sku that looks plausible but does not exist', async () => {
    // This is the check people forget. The shape is perfect; the article is invented.
    const service = new ExtractService(pool, modelReturning({
      ...GOOD, items: [{ sku: 'MUG-AZURE', qty: 3 }],
    }));
    const result = await service.extract(MAIL);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('catalog');
      expect(result.detail).toContain('MUG-AZURE');
    }
  });

  it('keeps the raw model answer so the operator can see what it said', async () => {
    const service = new ExtractService(pool, modelReturning({ nonsense: true }));
    const result = await service.extract(MAIL);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.raw).toEqual({ nonsense: true });
  });

  it('rejects an answer that is not json at all', async () => {
    const service = new ExtractService(pool, {
      async complete() { return 'Sure! Here is your order:'; },
    });
    const result = await service.extract(MAIL);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('schema');
  });

  it('falls back to recorded answers when no model is configured', async () => {
    const service = new ExtractService(pool, null);
    const result = await service.extract(MAIL);
    expect(result.mode).toBe('recorded');
    expect(result.ok).toBe(true);
  });

  it('refuses recorded text that names nothing we sell', async () => {
    // This is the garbage order the page offers as the second thing the button can
    // send, worded as free text a model has to make sense of and cannot. It names
    // "the blue ones", which matches no recorded answer.
    //
    // It used to fall through to the FIRST recorded answer, so the one input offered
    // as unreadable came back as a tidy three mug order with two valid article
    // numbers. Nothing on screen was false, because the sentence beside it is
    // written by hand, but the demonstration the page promises did not happen. On a
    // page asking to be checked, a demonstration that quietly does not happen is the
    // most expensive kind of wrong.
    const service = new ExtractService(pool, null);
    const result = await service.extract('Hi, send me the blue ones. 12,00 for each I think');

    expect(result.mode).toBe('recorded');
    expect(result.ok).toBe(false);
    // Well formed and naming no article, so it is the schema that stops it, by the
    // empty basket. That is the same path a live model's answer would take.
    if (!result.ok) expect(result.reason).toBe('schema');
  });

  it('still answers recorded text that does name something', async () => {
    // The other half, so the test above cannot pass by refusing everything.
    const service = new ExtractService(pool, null);
    const result = await service.extract('two teapot please');
    expect(result.ok).toBe(true);
  });

  it('produces a rejected extraction on demand for the chaos button', async () => {
    const service = new ExtractService(pool, modelReturning(GOOD));
    const result = await service.extract(MAIL, { hallucinate: true });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(['schema', 'catalog']).toContain(result.reason);
  });
});
