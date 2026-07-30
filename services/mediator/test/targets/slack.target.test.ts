// services/mediator/test/targets/slack.target.test.ts
// Proves the weakest of the three idempotency techniques still holds (spec 6.5):
// Slack offers no key, so the delivery embeds its own marker and reads the channel
// history before posting. The fake stands in for slack.com and keeps the posts.
import { describe, it, expect, beforeEach } from 'vitest';
import { SlackTarget, SlackClient } from '../../src/targets/slack.target';

class FakeSlack {
  posted: Array<{ text: string; ts: string }> = [];
  private next = 1;

  fetch = async (url: string, init?: RequestInit): Promise<Response> => {
    if (url.includes('conversations.history')) {
      return json({ ok: true, messages: this.posted.map((m) => ({ text: m.text, ts: m.ts })) });
    }
    if (url.includes('chat.postMessage')) {
      const body = JSON.parse(String(init?.body));
      const ts = `${1_800_000_000 + this.next++}.000100`;
      this.posted.push({ text: body.text, ts });
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

let api: FakeSlack;
let target: SlackTarget;

beforeEach(() => {
  api = new FakeSlack();
  target = new SlackTarget(
    new SlackClient('http://gate/proxy/slack', 'xoxb-x', 'C123', api.fetch),
  );
});

const ctx = {
  eventId: 'evt-7',
  idempotencyKey: 'evt-7:slack',
  payload: { customerName: 'M. Berger', totalCents: 4900 },
};

describe('SlackTarget', () => {
  it('posts a message and returns the slack timestamp', async () => {
    const outcome = await target.deliver(ctx);
    expect(outcome.remoteRef).toMatch(/^\d+\.\d+$/);
    expect(api.posted).toHaveLength(1);
  });

  it('embeds the delivery marker so a retry can recognise its own message', async () => {
    await target.deliver(ctx);
    expect(api.posted[0].text).toContain('evt-7:slack');
  });

  it('does not post twice when the delivery is retried', async () => {
    const first = await target.deliver(ctx);
    const second = await target.deliver(ctx);
    expect(api.posted).toHaveLength(1);
    expect(second.remoteRef).toBe(first.remoteRef);
  });

  it('throws when slack answers not ok', async () => {
    const failing = new SlackClient('http://gate/proxy/slack', 'xoxb-x', 'C123',
      async () => json({ ok: false, error: 'channel_not_found' }));
    await expect(new SlackTarget(failing).deliver(ctx))
      .rejects.toThrow(/channel_not_found/);
  });

  it('throws when slack is unreachable', async () => {
    const failing = new SlackClient('http://gate/proxy/slack', 'xoxb-x', 'C123',
      async () => { throw new TypeError('fetch failed'); });
    await expect(new SlackTarget(failing).deliver(ctx)).rejects.toThrow(/fetch failed/);
  });
});
