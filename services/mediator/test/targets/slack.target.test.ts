// services/mediator/test/targets/slack.target.test.ts
// One path now, into the workspace this demo owns (spec 6.5): our own app, with
// channels:history granted, so the delivery reads the channel back and recognises
// its own marker before posting.
//
// There was a second path and a second describe block here, for a visitor who had
// connected their own workspace. It held chat:write and no read scope, so a send log
// did the remembering, and its most interesting case was a worker that died mid-call
// leaving nobody able to say whether the message landed: that delivery was parked
// rather than posted twice into a stranger's Slack. The visitor OAuth is gone, so
// both the path and the send log went with it.
import { describe, it, expect, beforeEach } from 'vitest';
import { SlackTarget, SlackClient } from '../../src/targets/slack.target';
import type { SlackCredentials } from '../../src/credentials';

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

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status, headers: { 'content-type': 'application/json' },
  });
}

const HOUSE: SlackCredentials = { token: 'xoxb-house', channel: 'C-HOUSE' };

let api: FakeSlack;

function targetFor(fetcher = api.fetch): SlackTarget {
  return new SlackTarget(
    new SlackClient('http://gate/proxy/slack', fetcher),
    async () => HOUSE,
  );
}

beforeEach(() => { api = new FakeSlack(); });

const ctx = {
  eventId: 'evt-7',
  idempotencyKey: 'evt-7:slack',
  payload: { customerName: 'M. Berger', totalCents: 4900 },
};

describe('SlackTarget', () => {
  it('posts a message and returns the slack timestamp', async () => {
    const outcome = await targetFor().deliver(ctx);
    expect(outcome.remoteRef).toMatch(/^\d+\.\d+$/);
    expect(api.posted).toHaveLength(1);
  });

  it('embeds the delivery marker so a retry can recognise its own message', async () => {
    await targetFor().deliver(ctx);
    expect(api.posted[0].text).toContain('evt-7:slack');
  });

  it('reads the channel back before posting', async () => {
    await targetFor().deliver(ctx);
    expect(api.historyCalls).toBe(1);
  });

  it('does not post twice when the delivery is retried', async () => {
    const target = targetFor();
    const first = await target.deliver(ctx);
    const second = await target.deliver(ctx);
    expect(api.posted).toHaveLength(1);
    expect(second.remoteRef).toBe(first.remoteRef);
  });

  it('throws when slack answers not ok', async () => {
    const target = targetFor(async () => json({ ok: false, error: 'channel_not_found' }));
    await expect(target.deliver(ctx)).rejects.toThrow(/channel_not_found/);
  });

  it('throws when slack is unreachable', async () => {
    const target = targetFor(async () => { throw new TypeError('fetch failed'); });
    await expect(target.deliver(ctx)).rejects.toThrow(/fetch failed/);
  });

  it('posts with the house token into the house channel', async () => {
    await targetFor().deliver(ctx);
    expect(api.posted[0].channel).toBe('C-HOUSE');
    expect(api.posted[0].token).toBe('Bearer xoxb-house');
  });

  // The message no longer explains that a connection removes itself after 24 hours,
  // because there is no connection to remove. Pinned so the sentence cannot come
  // back with nothing behind it.
  it('says nothing about a connection the visitor has to end', async () => {
    await targetFor().deliver(ctx);
    expect(api.posted[0].text).not.toMatch(/24 hours/);
    expect(api.posted[0].text).not.toMatch(/disconnect/i);
  });

  it('lets a cut line heal instead of stranding the delivery', async () => {
    let cut = true;
    const target = targetFor(async (url, init) => {
      if (cut) throw new TypeError('fetch failed');
      return api.fetch(url, init);
    });

    await expect(target.deliver(ctx)).rejects.toThrow(/fetch failed/);
    cut = false;
    await expect(target.deliver(ctx)).resolves.toBeDefined();
    expect(api.posted).toHaveLength(1);
  });
});
