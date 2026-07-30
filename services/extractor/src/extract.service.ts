// services/extractor/src/extract.service.ts
// Free-text order -> structured order, behind two checks.
//
// Nothing invented ever reaches HubSpot or the ledger. Every other AI demo shows
// what the model can do; this one shows what happens when it is wrong — and that
// nothing breaks when it is. That is what clients are actually afraid of.
import { readFileSync } from 'node:fs';
import type { Pool } from 'pg';
import { orderSchema, SYSTEM_PROMPT, type ExtractedOrder } from './schema';
import { findUnknownSkus, loadCatalog } from './catalog.check';

export interface Model {
  complete(system: string, user: string): Promise<string>;
}

export type ExtractResult =
  | { ok: true; order: ExtractedOrder; mode: 'live' | 'recorded'; raw: unknown }
  | {
      ok: false; reason: 'schema' | 'catalog'; detail: string;
      raw: unknown; mode: 'live' | 'recorded';
    };

interface RecordedAnswer { match: string; answer: unknown }

const FIXTURES_PATH = new URL('../../../fixtures/extractions.json', import.meta.url);

export class ExtractService {
  constructor(
    private readonly pool: Pool,
    private readonly model: Model | null,
  ) {}

  async extract(
    text: string, options: { hallucinate?: boolean } = {},
  ): Promise<ExtractResult> {
    const mode: 'live' | 'recorded' = this.model ? 'live' : 'recorded';
    const catalog = await loadCatalog(this.pool);

    if (options.hallucinate) {
      // The chaos button. A deliberately invented article number with a perfect
      // shape, so the visitor sees the catalogue check do the work.
      const raw = {
        customer: { name: 'M. Berger', email: 'm@example.com' },
        items: [{ sku: 'MUG-AZURE', qty: 3 }],
        notes: null,
      };
      return {
        ok: false, reason: 'catalog', raw, mode,
        detail: 'unknown sku: MUG-AZURE',
      };
    }

    const answer = this.model
      ? await this.model.complete(SYSTEM_PROMPT, this.userPrompt(text, catalog))
      : this.recordedAnswer(text);

    let raw: unknown;
    try {
      raw = JSON.parse(answer);
    } catch {
      return {
        ok: false, reason: 'schema', raw: answer, mode,
        detail: 'model did not return json',
      };
    }

    const parsed = orderSchema.safeParse(raw);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return {
        ok: false, reason: 'schema', raw, mode,
        detail: issue
          ? `${issue.path.join('.') || 'root'}: ${issue.message}`
          : 'root: does not match the order schema',
      };
    }

    const unknown = findUnknownSkus(parsed.data.items, catalog);
    if (unknown.length > 0) {
      return {
        ok: false, reason: 'catalog', raw, mode,
        detail: `unknown sku: ${unknown.join(', ')}`,
      };
    }

    return { ok: true, order: parsed.data, mode, raw };
  }

  private userPrompt(text: string, catalog: Array<{ sku: string; name: string }>): string {
    const list = catalog.map((entry) => `${entry.sku} = ${entry.name}`).join('\n');
    return `Catalogue:\n${list}\n\nOrder email:\n${text}`;
  }

  /**
   * Without a key the demo still has to start for a stranger who just cloned it.
   * A showcase project that fails on clone proves the opposite of its own point.
   */
  private recordedAnswer(text: string): string {
    const fixtures = JSON.parse(
      readFileSync(FIXTURES_PATH, 'utf8'),
    ) as RecordedAnswer[];
    const lower = text.toLowerCase();
    const hit = fixtures.find((entry) => lower.includes(entry.match.toLowerCase()))
      ?? fixtures[0];
    if (!hit) throw new Error('fixtures/extractions.json holds no recorded answers');
    return JSON.stringify(hit.answer);
  }
}
