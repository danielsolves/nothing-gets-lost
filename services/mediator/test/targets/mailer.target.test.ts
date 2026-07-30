// services/mediator/test/targets/mailer.target.test.ts
// The confirmation mail is the second witness of the proof chain (spec 9.1): its
// arrival timestamp is stamped by the visitor's own mail server. Sending it twice
// would put two different timestamps in the visitor's inbox and prove nothing.
import { describe, it, expect, beforeEach } from 'vitest';
import { MailerClient, MailerTarget } from '../../src/targets/mailer.target';

/** Stands in for the mailer service, including its alreadySent flag. */
class FakeMailer {
  sent = new Map<string, { messageId: string; sentAt: string }>();
  calls: Array<{ url: string; recipient: string }> = [];
  private next = 1;

  fetch = async (url: string, init?: RequestInit): Promise<Response> => {
    const body = JSON.parse(String(init?.body)) as { eventId: string; recipient: string };
    this.calls.push({ url, recipient: body.recipient });

    const existing = this.sent.get(body.eventId);
    if (existing) return json({ ...existing, alreadySent: true });

    const record = { messageId: `msg-${this.next}`, sentAt: '2026-07-30T14:06:35.000Z' };
    this.next += 1;
    this.sent.set(body.eventId, record);
    return json({ ...record, alreadySent: false });
  };
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200, headers: { 'content-type': 'application/json' },
  });
}

let mailer: FakeMailer;
let target: MailerTarget;

beforeEach(() => {
  mailer = new FakeMailer();
  target = new MailerTarget(new MailerClient('http://gate/proxy/mailer', mailer.fetch));
});

const ctx = (eventId: string) => ({
  eventId,
  idempotencyKey: `${eventId}:mailer`,
  payload: { customerEmail: 'visitor@example.com', customerName: 'M. Berger', totalCents: 1200 },
});

describe('MailerTarget', () => {
  it('sends the confirmation and reports the message id and send time', async () => {
    const outcome = await target.deliver(ctx('evt-1'));
    expect(outcome.remoteRef).toBe('msg-1');
    expect(outcome.remoteAt?.toISOString()).toBe('2026-07-30T14:06:35.000Z');
  });

  it('sends to the address the visitor typed', async () => {
    await target.deliver(ctx('evt-2'));
    expect(mailer.calls[0].recipient).toBe('visitor@example.com');
  });

  it('sends exactly one mail when the delivery is retried', async () => {
    const first = await target.deliver(ctx('evt-3'));
    const second = await target.deliver(ctx('evt-3'));

    expect(second.remoteRef).toBe(first.remoteRef);
    expect(mailer.sent.size).toBe(1);
  });

  it('goes through the egress gate, never straight to the service', async () => {
    await target.deliver(ctx('evt-4'));
    expect(mailer.calls[0].url).toBe('http://gate/proxy/mailer/send');
  });

  it('throws when the mailer is unreachable, so the worker reschedules', async () => {
    const dead = new MailerTarget(new MailerClient('http://gate/proxy/mailer', async () => {
      throw new Error('ECONNRESET');
    }));
    await expect(dead.deliver(ctx('evt-5'))).rejects.toThrow(/ECONNRESET/);
  });
});
