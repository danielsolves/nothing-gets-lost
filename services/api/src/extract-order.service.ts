// services/api/src/extract-order.service.ts
// A model answer, kept.
//
// `ChaosService` calls the same extractor, reads `response.ok` and throws the body
// away, which is why the seam has been decorative: no order was ever made from an
// extraction and nobody could see what the model said. This keeps the answer, prices
// what survived both checks, and hands back a proposal.
//
// A proposal, not an order. Nothing here can place anything: the service holds a pool
// and an extractor and no intake at all, so the confirmation step is not a policy
// somebody has to remember, it is the only way through. What a visitor confirms goes
// to OrdersService like every other order, and is priced again there from this same
// table, so the figure on the proposal is a preview and never the figure charged.
//
// The catalogue is read here as well as in the extractor, which looks like the same
// check twice and is not. The extractor decides whether the model invented an
// article; this decides what the articles cost, and it cannot price a row that is not
// there. Trusting the other process and pricing whatever it approved would put a hole
// in the proposal the moment the two disagree, and they run against different
// connections at different moments.
import type { Pool } from 'pg';
import type { ExtractOrderResponse, OrderLine } from '@ngl/contracts';
import type { Extractor } from './extractor.client';

interface Product { sku: string; name: string; cents: number }

export class ExtractOrderService {
  constructor(
    private readonly pool: Pool,
    private readonly extractor: Extractor,
  ) {}

  async read(text: string): Promise<ExtractOrderResponse> {
    const result = await this.extractor.read(text);

    if (!result.ok) {
      return {
        ok: false, mode: result.mode, raw: result.raw,
        stoppedBy: result.reason, detail: result.detail,
      };
    }

    const priced = await this.price(result.order.items);
    if (priced.missing.length > 0) {
      return {
        ok: false, mode: result.mode, raw: result.raw, stoppedBy: 'catalog',
        detail: `unknown sku: ${priced.missing.join(', ')}`,
      };
    }

    return {
      ok: true, mode: result.mode, raw: result.raw,
      proposal: {
        customerName: result.order.customer.name,
        customerEmail: result.order.customer.email,
        notes: result.order.notes,
        lines: priced.lines,
        totalCents: priced.lines.reduce((sum, line) => sum + line.cents, 0),
      },
    };
  }

  /**
   * The basket at today's prices, in the order the model listed it.
   *
   * `cents` is the whole line rather than the unit price, so a reader holding the
   * proposal against the card in the queue afterwards never has to multiply, and the
   * total is these lines added up rather than a second sum arrived at separately.
   */
  private async price(
    items: ReadonlyArray<{ sku: string; qty: number }>,
  ): Promise<{ lines: OrderLine[]; missing: string[] }> {
    const { rows } = await this.pool.query<Product>(
      'SELECT sku, name, cents FROM products WHERE sku = ANY($1)',
      [items.map((item) => item.sku)],
    );
    const known = new Map(rows.map((row) => [row.sku, row]));

    const lines: OrderLine[] = [];
    const missing: string[] = [];
    for (const item of items) {
      const product = known.get(item.sku);
      if (product === undefined) {
        missing.push(item.sku);
        continue;
      }
      lines.push({
        sku: item.sku, name: product.name, qty: item.qty,
        cents: product.cents * item.qty,
      });
    }
    return { lines, missing };
  }
}
