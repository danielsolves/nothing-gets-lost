// services/mediator/test/targets/slack.target.test.ts
// Two paths, because they hold different scopes (spec 6.5, 10.1).
//
// House workspace: our own app, channels:history granted, so the delivery reads the
// channel back and recognises its own marker.
//
// Visitor workspace: chat:write and incoming-webhook only. No history to read, so the
// send log does the remembering. The case worth staring at is the last one: a worker
// that died mid-call leaves nobody who can say whether the message landed, and the
// answer there is a dead letter, not a second post into a stranger's Slack.
import { describe, it, expect, beforeEach } from 'vitest';
import { SlackTarget, SlackClient } from '../../src/targets/slack.target';
import type { SlackCredentials } from '../../src/credentials';
import type { BeginResult, SlackSendLog } from '../../src/slack-send.log';
import { isTerminal } from '../../src/target.interface';

class FakeSlack {
  posted: Array<{ text: string; ts: string; channel: string; token: string }> = [];
  historyCalls = 0;
  private next = 1;

  fetch = async (url: string, init?: RequestInit): Promise<Response> => {
    const token = String((init?.headers as Record<string, string>).authorization);
    if (url.includes('conversations.history')) {
      this.historyCalls += 1;
      return json({ ok: true, messages: this.posted.map((m) => ({ text: m.text, ts: m.ts })) });
    }
    if (url.includes('chat.postMessage')) {
      const body = JSON.parse(String(init?.body));
      const ts = `${1_800_000_000 + this.next++}.000100`;
      this.posted.push({ text: body.text, ts, channel: body.channel, token });
      return json({ ok: true, ts, channel: body.channel });
    }
    return json({ ok: false, error: 'unknown_method' }, 404);
  };
}

/** Stands in for the table. The durable version is pinned in slack-send.log.test.ts. */
class FakeSendLog implements SlackSendLog {
  rows = new Map<string, { messageTs: string | null }>();
  markers: string[] = [];

  async begin(eventId: string, marker: string): Promise<BeginResult> {
    this.markers.push(marker);
    const existing = this.rows.get(eventId);
    if (!existing) {
      this.rows.set(eventId, { messageTs: null });
      return { status: 'fresh' };
    }
    if (existing.messageTs) return { status: 'sent', messageTs: existing.messageTs };
    return { status: 'unknown' };
  }

  async complete(eventId: string, messageTs: string): Promise<void> {
    this.rows.set(eventId, { messageTs });
  }

  async abandon(eventId: string): Promise<void> {
    if (!this.rows.get(eventId)?.messageTs) this.rows.delete(eventId);
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status, headers: { 'content-type': 'application/json' },
  });
}

const HOUSE: SlackCredentials = {
  token: 'xoxb-house', channel: 'C-HOUSE', visitor: false,
};
const THEIRS: SlackCredentials = {
  token: 'xoxb-theirs', channel: 'C-THEIRS', visitor: true,
};

let api: FakeSlack;
let log: FakeSendLog;

function targetFor(creds: SlackCredentials, fetcher = api.fetch): SlackTarget {
  return new SlackTarget(
    new SlackClient('http://gate/proxy/slack', fetcher),
    async () => creds,
    log,
  );
}

beforeEach(() => {
  api = new FakeSlack();
  log = new FakeSendLog();
});

const ctx = {
  eventId: 'evt-7',
  idempotencyKey: 'evt-7:slack',
  payload: { customerName: 'M. Berger', totalCents: 4900 },
};

describe('SlackTarget, house workspace', () => {
  it('posts a message and returns the slack timestamp', async () => {
    const outcome = await targetFor(HOUSE).deliver(ctx);
    expect(outcome.remoteRef).toMatch(/^\d+\.\d+$/);
    expect(api.posted).toHaveLength(1);
  });

  it('embeds the delivery marker so a retry can recognise its own message', async () => {
    await targetFor(HOUSE).deliver(ctx);
    expect(api.posted[0].text).toContain('evt-7:slack');
  });

  it('does not post twice when the delivery is retried', async () => {
    const target = targetFor(HOUSE);
    const first = await target.deliver(ctx);
    const second = await target.deliver(ctx);
    expect(api.posted).toHaveLength(1);
    expect(second.remoteRef).toBe(first.remoteRef);
  });

  it('throws when slack answers not ok', async () => {
    const target = targetFor(HOUSE, async () => json({ ok: false, error: 'channel_not_found' }));
    await expect(target.deliver(ctx)).rejects.toThrow(/channel_not_found/);
  });

  it('throws when slack is unreachable', async () => {
    const target = targetFor(HOUSE, async () => { throw new TypeError('fetch failed'); });
    await expect(target.deliver(ctx)).rejects.toThrow(/fetch failed/);
  });

  it('posts with the house token into the house channel', async () => {
    await targetFor(HOUSE).deliver(ctx);
    expect(api.posted[0].channel).toBe('C-HOUSE');
    expect(api.posted[0].token).toBe('Bearer xoxb-house');
  });
});

describe('SlackTarget, visitor workspace', () => {
  it('posts with the visitor token into the channel they picked', async () => {
    await targetFor(THEIRS).deliver(ctx);
    expect(api.posted[0].channel).toBe('C-THEIRS');
    expect(api.posted[0].token).toBe('Bearer xoxb-theirs');
  });

  it('never reads their channel history, which we hold no scope for', async () => {
    await targetFor(THEIRS).deliver(ctx);
    expect(api.historyCalls).toBe(0);
  });

  it('remembers the send under the same key every retry carries', async () => {
    await targetFor(THEIRS).deliver(ctx);
    expect(log.markers).toEqual(['evt-7:slack']);
  });

  it('says the connection ends by itself', async () => {
    await targetFor(THEIRS).deliver(ctx);
    expect(api.posted[0].text).toMatch(/24 hours/);
  });

  it('does not post twice when the delivery is retried', async () => {
    const target = targetFor(THEIRS);
    const first = await target.deliver(ctx);
    const second = await target.deliver(ctx);
    expect(api.posted).toHaveLength(1);
    expect(second.remoteRef).toBe(first.remoteRef);
  });

  it('lets a cut line heal instead of stranding the delivery', async () => {
    // The control panel demo, with their own Slack connected: the gate destroys the
    // socket, the attempt fails, and the next one must be free to post.
    let cut = true;
    const target = targetFor(THEIRS, async (url, init) => {
      if (cut) throw new TypeError('fetch failed');
      return api.fetch(url, init);
    });

    await expect(target.deliver(ctx)).rejects.toThrow(/fetch failed/);
    cut = false;
    await expect(target.deliver(ctx)).resolves.toBeDefined();
    expect(api.posted).toHaveLength(1);
  });

  it('parks the delivery when a dead worker left the outcome unknown', async () => {
    // begin() ran, the call went out, and the worker died before either complete()
    // or abandon(). Nobody alive knows whether the message landed.
    await log.begin(ctx.eventId, ctx.idempotencyKey);

    const error = await targetFor(THEIRS).deliver(ctx).catch((e: unknown) => e);
    expect(isTerminal(error)).toBe(true);
    expect((error as Error).message).toMatch(/could not be confirmed/i);
    expect(api.posted).toHaveLength(0);
  });
});
