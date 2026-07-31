// services/mailer/test/mail.service.test.ts
// Holds the mailer to "exactly once per event": one send, no second send on a retry,
// and no record left behind when the SMTP call fails. The proof chain reads this row.
//
// The last case keeps the promise honest from the other side: a day later the api's
// sweep empties the address out of this table, and exactly-once has to survive it.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Pool } from 'pg';
import { runMigrations } from '@ngl/db';
import { MailService, type Transport } from '../src/mail.service';

let container: StartedPostgreSqlContainer;
let pool: Pool;

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine').start();
  pool = new Pool({ connectionString: container.getConnectionUri() });
  await runMigrations(pool);
}, 120_000);

afterAll(async () => { await pool.end(); await container.stop(); });
beforeEach(async () => { await pool.query('TRUNCATE sent_mail'); });

const eventId = '22222222-2222-2222-2222-222222222222';

function fakeTransport(): Transport & { calls: number } {
  const transport = {
    calls: 0,
    async send() {
      transport.calls += 1;
      return { messageId: `<msg-${transport.calls}@demo>` };
    },
  };
  return transport;
}

describe('MailService', () => {
  it('sends once and records the message id', async () => {
    const transport = fakeTransport();
    const service = new MailService(pool, transport, 'demo@example.com');
    const result = await service.send(eventId, 'buyer@example.com', 'Subject', 'Body');
    expect(result.alreadySent).toBe(false);
    expect(result.messageId).toBe('<msg-1@demo>');
    expect(transport.calls).toBe(1);
  });

  it('does not send a second mail for the same event', async () => {
    const transport = fakeTransport();
    const service = new MailService(pool, transport, 'demo@example.com');
    await service.send(eventId, 'buyer@example.com', 'Subject', 'Body');
    const second = await service.send(eventId, 'buyer@example.com', 'Subject', 'Body');
    expect(second.alreadySent).toBe(true);
    expect(transport.calls).toBe(1);
  });

  it('does not record a send that failed, so the retry can work', async () => {
    const failing: Transport = { async send() { throw new Error('SMTP down'); } };
    const service = new MailService(pool, failing, 'demo@example.com');
    await expect(
      service.send(eventId, 'buyer@example.com', 'Subject', 'Body'),
    ).rejects.toThrow('SMTP down');
    const { rows } = await pool.query('SELECT count(*) FROM sent_mail');
    expect(Number(rows[0].count)).toBe(0);
  });

  it('refuses a second send after the address has been erased', async () => {
    const transport = fakeTransport();
    const service = new MailService(pool, transport, 'demo@example.com');
    await service.send(eventId, 'buyer@example.com', 'Subject', 'Body');
    // What the nightly sweep does to this row a day later. Exactly-once hangs on the
    // UNIQUE (event_id) alone, so an emptied address must not buy a second mail.
    await pool.query(
      `UPDATE sent_mail SET recipient = '[deleted]' WHERE event_id = $1`, [eventId],
    );
    const second = await service.send(eventId, 'buyer@example.com', 'Subject', 'Body');
    expect(second.alreadySent).toBe(true);
    expect(second.messageId).toBe('<msg-1@demo>');
    expect(transport.calls).toBe(1);
  });

  it('reads the send record back for the proof chain', async () => {
    const service = new MailService(pool, fakeTransport(), 'demo@example.com');
    await service.send(eventId, 'buyer@example.com', 'Subject', 'Body');
    const record = await service.findByEvent(eventId);
    expect(record?.recipient).toBe('buyer@example.com');
    expect(record?.sentAt).toBeInstanceOf(Date);
  });
});
