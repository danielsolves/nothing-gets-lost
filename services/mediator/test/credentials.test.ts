// services/mediator/test/credentials.test.ts
// Decides, per delivery, whose Slack workspace and whose HubSpot portal the entry
// lands in (spec 9.4, 10.1). Run against a real database and a real TokenStore,
// because the interesting cases are all about what is actually in oauth_tokens.
//
// The rule the whole file exists to pin down: falling back to the house credentials
// is always allowed, failing the delivery never is. A visitor who connects nothing
// must not notice this code, and a visitor whose connection is unreadable must get
// the house behaviour rather than a stuck queue.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Pool } from 'pg';
import { randomBytes } from 'node:crypto';
import { runMigrations, TokenStore } from '@ngl/db';
import { CredentialResolver } from '../src/credentials';

let container: StartedPostgreSqlContainer;
let pool: Pool;
let key: Buffer;
let store: TokenStore;
let resolver: CredentialResolver;

const HOUSE = {
  slackToken: 'xoxb-house',
  slackChannel: 'C-HOUSE',
  hubspotToken: 'pat-house',
};

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine').start();
  pool = new Pool({ connectionString: container.getConnectionUri() });
  await runMigrations(pool);
  key = randomBytes(32);
  store = new TokenStore(pool, key);
}, 120_000);

afterAll(async () => { await pool.end(); await container.stop(); });

beforeEach(async () => {
  await pool.query('TRUNCATE oauth_tokens');
  resolver = new CredentialResolver(HOUSE, new TokenStore(pool, key));
});

describe('CredentialResolver', () => {
  it('uses the house workspace when the visitor connected nothing', async () => {
    const slack = await resolver.slack();
    expect(slack).toEqual({
      token: 'xoxb-house', channel: 'C-HOUSE', visitor: false,
    });
  });

  it('uses the house portal when the visitor connected nothing', async () => {
    expect(await resolver.hubspot()).toEqual({ token: 'pat-house', visitor: false });
  });

  it('posts into the visitor workspace once they connected it', async () => {
    await store.save('slack', 'xoxb-theirs', 'C-THEIRS');
    expect(await resolver.slack()).toEqual({
      token: 'xoxb-theirs', channel: 'C-THEIRS', visitor: true,
    });
  });

  it('writes into the visitor portal once they connected it', async () => {
    await store.save('hubspot', 'pat-theirs', '4242');
    expect(await resolver.hubspot()).toEqual({ token: 'pat-theirs', visitor: true });
  });

  it('keeps the house workspace when the visitor token names no channel', async () => {
    // Their token cannot post into our channel, so half a connection is no connection.
    await store.save('slack', 'xoxb-theirs', null);
    expect(await resolver.slack()).toEqual({
      token: 'xoxb-house', channel: 'C-HOUSE', visitor: false,
    });
  });

  it('keeps the house workspace when the stored token cannot be decrypted', async () => {
    // api and mediator with different keys — what happens when TOKEN_ENCRYPTION_KEY
    // is unset and each process invents its own. A dead delivery would be the worst
    // possible answer to a misconfiguration.
    await store.save('slack', 'xoxb-theirs', 'C-THEIRS');
    const strange = new CredentialResolver(HOUSE, new TokenStore(pool, randomBytes(32)));
    expect(await strange.slack()).toEqual({
      token: 'xoxb-house', channel: 'C-HOUSE', visitor: false,
    });
  });

  it('goes back to the house workspace on the next delivery after disconnecting', async () => {
    await store.save('slack', 'xoxb-theirs', 'C-THEIRS');
    expect((await resolver.slack()).visitor).toBe(true);

    await store.forget('slack');
    expect((await resolver.slack()).visitor).toBe(false);
  });

  it('treats a lapsed connection as gone without waiting for the sweeper', async () => {
    await store.save('slack', 'xoxb-theirs', 'C-THEIRS');
    await pool.query(`UPDATE oauth_tokens SET expires_at = now() - interval '1 minute'`);
    expect((await resolver.slack()).visitor).toBe(false);
  });
});
