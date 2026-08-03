// services/api/test/extract-order.controller.test.ts
// The door a stranger can press to spend our money.
//
// Every other button on this page costs a row in our own database. This one costs a
// model call, so the interesting tests here are the ones about calls that must never
// be made: a request that is not an order mail, a blank field, a pasted book, and a
// visitor who has already had their share of the hour.
//
// The last test is the shape of the feature rather than of the endpoint. Reading is
// not ordering, and this controller has nothing to order with.
import { describe, it, expect, beforeEach } from 'vitest';
import { HttpException } from '@nestjs/common';
import { MAX_ORDER_TEXT, type ExtractResult } from '@ngl/contracts';
import {
  ExtractOrderController, type CallCounter, type MailReader,
} from '../src/extract-order.controller';
import { LIMITS } from '../src/rate-limit.guard';

const MAIL = 'Hello, three blue mugs and two oak coasters please. M. Berger';

let read: string[];
let counted: Array<{ bucket: string; limit: number }>;
let allow: boolean;
let answer: ExtractResult;

/** Records what it was asked to read, so a test can prove it was not asked. */
const reader = {
  async read(text: string) {
    read.push(text);
    if (answer.ok) {
      return {
        ok: true as const, mode: answer.mode, raw: answer.raw,
        proposal: {
          customerName: 'M. Berger', customerEmail: 'm@example.com', notes: null,
          lines: [{ sku: 'MUG-BLUE', name: 'Blue mug', qty: 3, cents: 3600 }],
          totalCents: 3600,
        },
      };
    }
    return {
      ok: false as const, mode: answer.mode, raw: answer.raw,
      stoppedBy: answer.reason, detail: answer.detail,
    };
  },
};

const counter: CallCounter = {
  async check(bucket: string, _subject: string, limit: number) {
    counted.push({ bucket, limit });
    return allow;
  },
};

function controller(service: MailReader = reader): ExtractOrderController {
  return new ExtractOrderController(service, counter);
}

const caller = { ip: '203.0.113.7' };

beforeEach(() => {
  read = [];
  counted = [];
  allow = true;
  answer = {
    ok: true, mode: 'recorded', raw: { said: 'something' },
    order: {
      customer: { name: 'M. Berger', email: 'm@example.com' },
      items: [{ sku: 'MUG-BLUE', qty: 3 }], notes: null,
    },
  };
});

describe('POST /api/extract-order', () => {
  it('reads a mail and hands back what came of it', async () => {
    const response = await controller().read({ text: MAIL }, caller);
    expect(read).toEqual([MAIL]);
    expect(response.ok).toBe(true);
  });

  it('meters the model in a bucket of its own, and a tight one', async () => {
    // Not the orders bucket. An order costs us a row we own; a reading costs a call
    // to somebody else's api that is billed by the token, and the two have no
    // business sharing an allowance.
    await controller().read({ text: MAIL }, caller);
    expect(counted).toEqual([{ bucket: 'model', limit: LIMITS.model }]);
    expect(LIMITS.model).toBeLessThan(LIMITS.orders);
  });

  it('refuses once the hour is spent, and says how many and when', async () => {
    allow = false;
    await expect(controller().read({ text: MAIL }, caller)).rejects.toThrow(HttpException);
    await expect(controller().read({ text: MAIL }, caller))
      .rejects.toThrow(new RegExp(`${LIMITS.model}[\\s\\S]*next hour`, 'i'));
    expect(read).toEqual([]);
  });

  it('refuses a body that is not an order mail at all', async () => {
    await expect(controller().read({ nonsense: true }, caller)).rejects.toThrow(HttpException);
    await expect(controller().read(null, caller)).rejects.toThrow(HttpException);
    expect(read).toEqual([]);
    expect(counted).toEqual([]);
  });

  it('spends nothing on an empty field', async () => {
    await expect(controller().read({ text: '   ' }, caller)).rejects.toThrow(/nothing to read/i);
    expect(read).toEqual([]);
    expect(counted).toEqual([]);
  });

  it('refuses more text than the field allows, before anybody is billed for it', async () => {
    const book = 'a'.repeat(MAX_ORDER_TEXT + 1);
    await expect(controller().read({ text: book }, caller))
      .rejects.toThrow(new RegExp(String(MAX_ORDER_TEXT)));
    expect(read).toEqual([]);
    expect(counted).toEqual([]);
  });

  it('accepts a mail exactly as long as the field allows', async () => {
    await controller().read({ text: 'a'.repeat(MAX_ORDER_TEXT) }, caller);
    expect(read).toHaveLength(1);
  });

  it('answers a refused reading with the refusal, not with an error', async () => {
    // The model being wrong is an ordinary event here and the thing the page is
    // for. A 500 would put it in the same class as our own faults and would give
    // the page nothing to draw.
    answer = {
      ok: false, mode: 'recorded', reason: 'catalog',
      detail: 'unknown sku: MUG-AZURE', raw: { items: [{ sku: 'MUG-AZURE', qty: 4 }] },
    };
    const response = await controller().read({ text: MAIL }, caller);
    expect(response.ok).toBe(false);
    if (response.ok) return;
    expect(response.stoppedBy).toBe('catalog');
  });

  it('says plainly when the extractor could not be reached, and that nothing moved', async () => {
    const broken = { async read(): Promise<never> { throw new Error('fetch failed'); } };
    await expect(controller(broken).read({ text: MAIL }, caller))
      .rejects.toThrow(/nothing was placed/i);
  });

  it('has no way to place an order, which is the whole point of the second step', async () => {
    const surface = Object.getOwnPropertyNames(ExtractOrderController.prototype);
    expect(surface).toEqual(['constructor', 'read']);
  });
});
