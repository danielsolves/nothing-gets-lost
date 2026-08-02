// services/mcp/test/orders.repository.test.ts
// The order reader against a real Postgres as ngl_ro, and the privacy claim proved
// end to end on top of it.
//
// The orders are placed by the api's own OrdersService rather than by INSERTs written
// here, and that is the whole reason this file boots a container. `customerEmail` and
// `confirmTo` are decided in that service and nowhere else: an order booked under a
// visitor's own address exactly when they asked to be written to. A fixture that
// wrote the payload by hand would prove only that the fixture holds no address.
//
// The tools are then asked through a real MCP client over linked in-memory
// transports, and the assertion is made against the JSON text a client receives
// rather than against the objects behind it. A field that leaked under another name,
// or nested a level deeper than expected, still spells the address, and a substring
// check over the whole answer catches both.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Pool } from 'pg';
import { runMigrations } from '@ngl/db';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { OrdersService } from '../../api/src/orders.service';
import { IntakeService } from '../../mediator/src/intake.service';
import { QueueRepository } from '../../mediator/src/queue.repository';
import { OrdersRepository } from '../src/orders.repository';
import { registerOrderTools } from '../src/orders.tools';

/** The two strings that must never reach a client, in one place so the tests agree. */
const NAME = 'Rita Vogel';
const ADDRESS = 'rita@example.com';

let container: StartedPostgreSqlContainer;
let admin: Pool;
let readonly: Pool;
let past: OrdersRepository;
let plain: number;
let named: number;

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine').start();
  admin = new Pool({ connectionString: container.getConnectionUri() });
  await runMigrations(admin);
  readonly = new Pool({
    connectionString: container.getConnectionUri().replace(/\/\/[^:]+:[^@]+@/, '//ngl_ro:ngl_ro@'),
  });
  past = new OrdersRepository(readonly);

  const orders = new OrdersService(admin, new IntakeService(admin, new QueueRepository(admin)));
  // Nobody's address on the first one, so it is booked under the house identity.
  plain = await place(orders, { items: [{ sku: 'TEAPOT', qty: 1 }] });
  named = await place(orders, {
    items: [{ sku: 'MUG-BLUE', qty: 2 }, { sku: 'TEAPOT', qty: 1 }],
    customerName: NAME,
    customerEmail: ADDRESS,
  });
  await settle(named);
}, 180_000);

afterAll(async () => { await admin.end(); await readonly.end(); await container.stop(); });

/** Places an order the production way and reports the number the visitor is shown. */
async function place(
  orders: OrdersService,
  request: { items: { sku: string; qty: number }[]; customerName?: string; customerEmail?: string },
): Promise<number> {
  const { eventId } = await orders.place(request);
  const { rows } = await admin.query<{ number: string }>(
    'SELECT number FROM events WHERE id = $1', [eventId],
  );
  return Number(rows[0].number);
}

/**
 * Moves the order's deliveries on the way the mediator would, so there is something
 * other than "pending" to report. The confirmation mail is added rather than updated:
 * rule 6.7 queues it only once the rest have landed, so a freshly placed order has
 * four deliveries and not five. This one is left parked, which is what makes the
 * missing third-party reference in the answer a real case rather than a hypothesis.
 *
 * Its error string quotes the address on purpose. That is how a rejection from a
 * third party reads, last_error is a column on v_deliveries, and these tools could
 * have reported it. The test below is the reason they do not.
 */
async function settle(orderNumber: number): Promise<void> {
  await admin.query(
    `UPDATE deliveries d SET state = 'done', attempts = 1,
            remote_ref = 'ref-' || d.target, remote_at = now()
       FROM events e WHERE e.id = d.event_id AND e.number = $1`,
    [orderNumber],
  );
  await admin.query(
    `INSERT INTO deliveries (event_id, target, state, attempts, last_error)
     SELECT e.id, 'mailer', 'dead', 6, $2 FROM events e WHERE e.number = $1`,
    [orderNumber, `the mail server refused ${ADDRESS}`],
  );
}

const TEXT_RESULT = z.object({
  content: z.array(z.object({ type: z.literal('text'), text: z.string() })).min(1),
});

/** One tool call over the protocol, answered as the raw text a client would read. */
async function ask(name: string, args: Record<string, unknown>): Promise<string> {
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  registerOrderTools(server, past);
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  await Promise.all([client.connect(clientSide), server.connect(serverSide)]);
  const result = TEXT_RESULT.parse(await client.callTool({ name, arguments: args }));
  await client.close();
  await server.close();
  return result.content[0].text;
}

describe('OrdersRepository', () => {
  it('puts the newest order first', async () => {
    const orders = await past.list({});
    expect(orders.map((order) => order.orderNumber)).toEqual([named, plain]);
  });

  it('honours the limit and still counts the rest', async () => {
    expect(await past.list({ limit: 1 })).toHaveLength(1);
    expect(await past.count()).toBe(2);
  });

  it('reads one order by the number the visitor was shown', async () => {
    const order = await past.byNumber(named);
    expect(order?.totalCents).toBe(7300);
    expect(order?.lines).toEqual([
      { sku: 'MUG-BLUE', name: 'Blue mug', qty: 2, cents: 2400 },
      { sku: 'TEAPOT', name: 'Teapot', qty: 1, cents: 4900 },
    ]);
    expect(Date.parse(order?.receivedAt ?? '')).not.toBeNaN();
  });

  it('says how each system fared, in the order they were queued', async () => {
    const order = await past.byNumber(named);
    expect(order?.deliveries).toEqual([
      { target: 'stripe', state: 'done', attempts: 1, remoteRef: 'ref-stripe' },
      { target: 'hubspot', state: 'done', attempts: 1, remoteRef: 'ref-hubspot' },
      { target: 'ledger', state: 'done', attempts: 1, remoteRef: 'ref-ledger' },
      { target: 'slack', state: 'done', attempts: 1, remoteRef: 'ref-slack' },
      { target: 'mailer', state: 'dead', attempts: 6, remoteRef: null },
    ]);
  });

  it('answers null for a number no order carries', async () => {
    expect(await past.byNumber(999_999)).toBeNull();
  });

  // Migration 016 exists so the priced basket can be read without the payload. If
  // the payload itself were reachable, the view would be decoration.
  it('cannot reach the payload the lines are projected out of', async () => {
    await expect(readonly.query('SELECT payload FROM events')).rejects.toThrow(/permission denied/i);
    await expect(readonly.query('SELECT * FROM orders')).rejects.toThrow(/permission denied/i);
  });
});

describe('what the order tools hand a client', () => {
  it('carries the order, priced, so the checks below are not vacuous', async () => {
    const text = await ask('orders_entry', { orderNumber: named });
    const answer: unknown = JSON.parse(text);
    expect(answer).toMatchObject({ found: true, order: { totalCents: 7300 } });
    expect(text).toContain('Blue mug');
    expect(text).toContain(String(named));
  });

  // The point of these tools. The order was placed with both a name and an address,
  // through the service that decides what each of the two fields means.
  it('never carries the name or the address, through either tool', async () => {
    for (const text of [
      await ask('orders_list', {}),
      await ask('orders_list', { limit: 100 }),
      await ask('orders_entry', { orderNumber: named }),
      await ask('orders_entry', { orderNumber: plain }),
    ]) {
      expect(text).not.toContain(NAME);
      expect(text).not.toContain(ADDRESS);
      // Not even the masked form v_orders offers, and not the key it would arrive
      // under if a column were ever added back by name.
      expect(text).not.toContain('r***@example.com');
      expect(text).not.toContain('customer');
      expect(text).not.toContain('confirmTo');
    }
  });

  it('answers found: false for a number nobody was given', async () => {
    const answer: unknown = JSON.parse(await ask('orders_entry', { orderNumber: 999_999 }));
    expect(answer).toEqual({ found: false, orderNumber: 999_999 });
  });
});
