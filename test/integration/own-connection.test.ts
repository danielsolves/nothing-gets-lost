// test/integration/own-connection.test.ts
// The tenth integration test, for the one thing spec 9.4 and 10.1 promise and the
// first session left half built: an entry that lands in the visitor's own account.
//
// Everything below the fake HTTP endpoint is production code. Real Postgres, real
// queue, real worker loop, real TokenStore doing real AES-256-GCM, real credential
// resolver, real Slack and HubSpot targets. Only slack.com and api.hubapi.com are
// stood in for, which is the same line the other integration tests draw.
//
// What it has to prove, in order:
//   1. connect nothing, and the entry goes to the house account as it always did
//   2. connect, and the very next delivery carries the visitor's own token
//   3. disconnect, and the one after that goes back, without a restart
//   4. a cut line still heals in the visitor's workspace
//   5. a worker that dies mid-post parks the delivery instead of posting twice
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Pool } from 'pg';
import { randomBytes } from 'node:crypto';
import { runMigrations, TokenStore } from '@ngl/db';
import { QueueRepository } from '../../services/mediator/src/queue.repository';
import { IntakeService } from '../../services/mediator/src/intake.service';
import { WorkerService } from '../../services/mediator/src/worker.service';
import { CredentialResolver } from '../../services/mediator/src/credentials';
import { PgSlackSendLog } from '../../services/mediator/src/slack-send.log';
import { SlackClient, SlackTarget } from '../../services/mediator/src/targets/slack.target';
import { HubSpotClient, HubSpotTarget } from '../../services/mediator/src/targets/hubspot.target';

/** Stands in for slack.com and api.hubapi.com, and records who called with what. */
class FakeWorld {
  slackPosts: Array<{ token: string; channel: string; text: string }> = [];
  hubspotWrites: Array<{ token: string; email: string }> = [];
  slackReachable = true;
  private contacts = new Map<string, string>();
  private nextTs = 1;
  private nextContact = 1;

  fetch = async (url: string, init?: RequestInit): Promise<Response> => {
    const token = String((init?.headers as Record<string, string>).authorization)
      .replace('Bearer ', '');
    const body = init?.body ? JSON.parse(String(init.body)) : {};

    if (url.includes('conversations.history')) {
      if (!this.slackReachable) throw new TypeError('fetch failed');
      const messages = this.slackPosts
        .filter((p) => p.channel === body.channel)
        .map((p, i) => ({ text: p.text, ts: `${1_800_000_000 + i}.000100` }));
      return json({ ok: true, messages });
    }

    if (url.includes('chat.postMessage')) {
      if (!this.slackReachable) throw new TypeError('fetch failed');
      this.slackPosts.push({ token, channel: body.channel, text: body.text });
      return json({ ok: true, ts: `${1_800_000_000 + this.nextTs++}.000100` });
    }

    if (url.includes('/search')) {
      const email = body.filterGroups[0].filters[0].value;
      const id = this.contacts.get(email);
      return json({
        total: id ? 1 : 0,
        results: id ? [{ id, properties: { email, createdate: '2026-07-30T14:06:31.000Z' } }] : [],
      });
    }

    if (init?.method === 'POST' && url.endsWith('/contacts')) {
      const email = body.properties.email;
      this.hubspotWrites.push({ token, email });
      const id = `contact-${this.nextContact++}`;
      this.contacts.set(email, id);
      return json({ id, properties: { createdate: '2026-07-30T14:06:31.000Z' } }, 201);
    }

    if (init?.method === 'PATCH') {
      const id = String(url.split('/').pop());
      this.hubspotWrites.push({ token, email: body.properties.email });
      return json({ id, properties: { createdate: '2026-07-30T14:06:31.000Z' } });
    }

    return json({ ok: false, error: 'unknown' }, 404);
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status, headers: { 'content-type': 'application/json' },
  });
}

const HOUSE = {
  slackToken: 'xoxb-house', slackChannel: 'C-HOUSE', hubspotToken: 'pat-house',
};

let container: StartedPostgreSqlContainer;
let pool: Pool;
let tokens: TokenStore;
let queue: QueueRepository;
let intake: IntakeService;
let worker: WorkerService;
let world: FakeWorld;
let sendLog: PgSlackSendLog;

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine').start();
  pool = new Pool({ connectionString: container.getConnectionUri() });
  await runMigrations(pool);

  // One key for both sides, which is what a configured TOKEN_ENCRYPTION_KEY buys.
  const key = randomBytes(32);
  tokens = new TokenStore(pool, key);
  queue = new QueueRepository(pool);
  intake = new IntakeService(pool, queue);
  sendLog = new PgSlackSendLog(pool);
  world = new FakeWorld();

  const credentials = new CredentialResolver(HOUSE, new TokenStore(pool, key));
  worker = new WorkerService(
    queue,
    [
      new SlackTarget(
        new SlackClient('http://gate/proxy/slack', world.fetch),
        () => credentials.slack(),
        sendLog,
      ),
      new HubSpotTarget(
        new HubSpotClient('http://gate/proxy/hubspot', world.fetch),
        () => credentials.hubspot(),
      ),
    ],
    pool,
  );
}, 180_000);

afterAll(async () => { await pool.end(); await container.stop(); });

beforeEach(async () => {
  await pool.query('TRUNCATE events CASCADE');
  await pool.query('TRUNCATE oauth_tokens');
  world.slackPosts.length = 0;
  world.hubspotWrites.length = 0;
  world.slackReachable = true;
});

async function placeOrder(externalId: string): Promise<string> {
  const { eventId } = await intake.accept({
    externalId,
    kind: 'order.placed',
    payload: { customerName: 'M. Berger', customerEmail: `${externalId}@example.com`, totalCents: 4900 },
    targets: ['slack', 'hubspot'],
  });
  return eventId;
}

/** Works the queue until nothing is due, pulling scheduled retries forward. */
async function drain(rounds = 10): Promise<void> {
  for (let i = 0; i < rounds; i++) {
    let handled = 0;
    for (;;) {
      const done = await worker.tick();
      if (done === 0) break;
      handled += done;
    }
    const { rowCount } = await pool.query(
      `UPDATE deliveries SET next_at = now() WHERE state = 'pending' AND next_at > now()`,
    );
    if (handled === 0 && (rowCount ?? 0) === 0) return;
  }
}

describe('connecting your own Slack and HubSpot', () => {
  it('uses the house accounts while the visitor has connected nothing', async () => {
    await placeOrder('evt_house');
    await drain();

    expect(world.slackPosts).toHaveLength(1);
    expect(world.slackPosts[0].token).toBe('xoxb-house');
    expect(world.slackPosts[0].channel).toBe('C-HOUSE');
    expect(world.hubspotWrites[0].token).toBe('pat-house');
  });

  it('posts into the visitor workspace on the next delivery after connecting', async () => {
    // No restart between these two lines. That is the point.
    await tokens.save('slack', 'xoxb-theirs', 'C-THEIRS');
    await placeOrder('evt_connected');
    await drain();

    expect(world.slackPosts).toHaveLength(1);
    expect(world.slackPosts[0].token).toBe('xoxb-theirs');
    expect(world.slackPosts[0].channel).toBe('C-THEIRS');
  });

  it('writes the contact into the visitor portal after connecting', async () => {
    await tokens.save('hubspot', 'pat-theirs', '4242');
    await placeOrder('evt_hs_connected');
    await drain();

    expect(world.hubspotWrites.every((w) => w.token === 'pat-theirs')).toBe(true);
  });

  it('tells the visitor the connection ends by itself', async () => {
    await tokens.save('slack', 'xoxb-theirs', 'C-THEIRS');
    await placeOrder('evt_notice');
    await drain();

    expect(world.slackPosts[0].text).toMatch(/24 hours/);
  });

  it('goes back to the house account after disconnecting', async () => {
    await tokens.save('slack', 'xoxb-theirs', 'C-THEIRS');
    await placeOrder('evt_before_disconnect');
    await drain();

    await tokens.forget('slack');
    await placeOrder('evt_after_disconnect');
    await drain();

    expect(world.slackPosts.map((p) => p.token)).toEqual(['xoxb-theirs', 'xoxb-house']);
  });

  it('heals a cut line in the visitor workspace, exactly once', async () => {
    // The control panel demo, with their own Slack connected. This is the moment the
    // whole page exists for, and it has to survive the new code path.
    await tokens.save('slack', 'xoxb-theirs', 'C-THEIRS');
    world.slackReachable = false;

    const eventId = await placeOrder('evt_cut');
    await worker.tick();

    const cut = await pool.query(
      `SELECT state FROM deliveries WHERE event_id = $1 AND target = 'slack'`, [eventId],
    );
    expect(cut.rows[0].state).toBe('pending');
    expect(world.slackPosts).toHaveLength(0);

    world.slackReachable = true;
    await drain();

    expect(world.slackPosts).toHaveLength(1);
    const healed = await pool.query(
      `SELECT state FROM deliveries WHERE event_id = $1 AND target = 'slack'`, [eventId],
    );
    expect(healed.rows[0].state).toBe('done');
  });

  it('parks rather than posts twice when a worker died mid-post', async () => {
    await tokens.save('slack', 'xoxb-theirs', 'C-THEIRS');
    const eventId = await placeOrder('evt_died');

    // The worker claimed it, called Slack, and the process ended there. The send log
    // row is all that is left, and it cannot say whether the message arrived.
    await sendLog.begin(eventId, `${eventId}:slack`);
    await drain();

    const { rows } = await pool.query(
      `SELECT state, attempts, last_error FROM deliveries
        WHERE event_id = $1 AND target = 'slack'`, [eventId],
    );
    expect(rows[0].state).toBe('dead');
    expect(rows[0].attempts).toBe(1);
    expect(rows[0].last_error).toMatch(/could not be confirmed/i);
    expect(world.slackPosts).toHaveLength(0);
  });

  it('keeps lost at zero even when a delivery is parked', async () => {
    // Spec 6.6: parked is not lost. A visitor who sees "needs a human" must still
    // see the counter that carries the whole claim sitting at zero.
    await tokens.save('slack', 'xoxb-theirs', 'C-THEIRS');
    const eventId = await placeOrder('evt_parked_not_lost');
    await sendLog.begin(eventId, `${eventId}:slack`);
    await drain();

    const { rows } = await pool.query<{ state: string; count: string }>(
      `SELECT state, count(*) FROM deliveries WHERE event_id = $1 GROUP BY state`,
      [eventId],
    );
    const byState = Object.fromEntries(rows.map((r) => [r.state, Number(r.count)]));
    expect(byState).toEqual({ dead: 1, done: 1 });
  });
});
