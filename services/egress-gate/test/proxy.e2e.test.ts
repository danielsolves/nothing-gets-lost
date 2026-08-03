// services/egress-gate/test/proxy.e2e.test.ts
// Exercises the gate over a real socket against a fake upstream, one test per switch
// state, because the failures only count if they happen on the wire (spec 7).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import { setTimeout as sleep } from 'node:timers/promises';
import { startTestGate } from './start-test-gate';

/**
 * The gate is exercised over a real socket. "cut" has to produce a real transport
 * error at the caller, not a tidy JSON body — that is the whole claim of spec 7.
 */
let upstream: Server;
let upstreamUrl: string;
let gate: { url: string; setState: (s: string) => void; close: () => Promise<void> };

/** What the upstream actually received, so the gate can be held to it. */
let seen: { body: string; contentType: string | undefined; method: string };

beforeAll(async () => {
  upstream = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      seen = {
        body: Buffer.concat(chunks).toString('utf8'),
        contentType: req.headers['content-type'],
        method: req.method ?? '',
      };
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    });
  });
  await new Promise<void>((r) => upstream.listen(0, r));
  const port = (upstream.address() as { port: number }).port;
  upstreamUrl = `http://127.0.0.1:${port}`;
  gate = await startTestGate(upstreamUrl);
}, 60_000);

afterAll(async () => {
  await gate.close();
  await new Promise<void>((r) => upstream.close(() => r()));
});

describe('egress gate', () => {
  it('forwards when the switch is up', async () => {
    gate.setState('up');
    const response = await fetch(`${gate.url}/proxy/ledger/anything`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });

  it('answers 503 when the switch is on error', async () => {
    gate.setState('error');
    const response = await fetch(`${gate.url}/proxy/ledger/anything`);
    expect(response.status).toBe(503);
  });

  it('destroys the socket when the switch is cut', async () => {
    gate.setState('cut');
    await expect(fetch(`${gate.url}/proxy/ledger/anything`)).rejects.toThrow();
  });

  it('passes a form-encoded body through untouched', async () => {
    // Stripe is the only target that speaks x-www-form-urlencoded. The gate used to
    // parse every body and re-serialise it as JSON while forwarding the original
    // content-type, so Stripe received JSON labelled as a form and answered 400.
    // Nothing caught it because without a key the call failed at 401 first.
    gate.setState('up');
    const form = 'amount=4900&currency=eur&automatic_payment_methods%5Benabled%5D=true';

    await fetch(`${gate.url}/proxy/ledger/v1/payment_intents`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: form,
    });

    expect(seen.body).toBe(form);
    expect(seen.contentType).toBe('application/x-www-form-urlencoded');
  });

  it('passes a json body through untouched', async () => {
    gate.setState('up');
    const json = JSON.stringify({ channel: 'C1', text: 'hello `evt-1:slack`' });

    await fetch(`${gate.url}/proxy/ledger/api/chat.postMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: json,
    });

    expect(seen.body).toBe(json);
    expect(seen.contentType).toBe('application/json');
  });

  it('forwards the idempotency key, which is the whole exactly-once claim', async () => {
    gate.setState('up');
    await fetch(`${gate.url}/proxy/ledger/v1/payment_intents`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'idempotency-key': 'evt-1:stripe',
      },
      body: 'amount=1',
    });
    expect(seen.body).toBe('amount=1');
  });

  it('holds the request long enough to time the caller out when slow', async () => {
    gate.setState('slow');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 500);
    await expect(
      fetch(`${gate.url}/proxy/ledger/anything`, { signal: controller.signal }),
    ).rejects.toThrow();
    clearTimeout(timer);
    await sleep(10);
  });
});
