// services/mailer/src/mail.service.ts
// Sends the confirmation mail exactly once per event.
//
// The claim is inserted BEFORE the send and rolled back if the send throws. Inserting
// afterwards would let two retries send two mails; inserting and keeping the row on
// failure would swallow the mail entirely.
//
// Exactly-once rests on the UNIQUE (event_id) and nothing else. That matters more
// than it looks: the nightly sweep in the api replaces recipient with a marker after
// 24 hours, so a rule that read the address back to decide anything would start
// misfiring a day late. sent_at and message_id survive, and they are what the repeat
// answer is built from.
import type { Pool } from 'pg';

export interface Transport {
  send(message: {
    from: string; to: string; subject: string; text: string;
  }): Promise<{ messageId: string }>;
}

export interface SentMail {
  recipient: string;
  messageId: string | null;
  sentAt: Date;
}

export class MailService {
  constructor(
    private readonly pool: Pool,
    private readonly transport: Transport,
    private readonly from: string,
  ) {}

  async send(
    eventId: string, recipient: string, subject: string, body: string,
  ): Promise<{ messageId: string | null; sentAt: Date; alreadySent: boolean }> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const claim = await client.query<{ sent_at: Date; message_id: string | null }>(
        `INSERT INTO sent_mail (event_id, recipient)
         VALUES ($1, $2)
         ON CONFLICT (event_id) DO NOTHING
         RETURNING sent_at, message_id`,
        [eventId, recipient],
      );

      const claimed = claim.rows[0];
      if (!claimed) {
        await client.query('COMMIT');
        const existing = await this.findByEvent(eventId);
        return {
          messageId: existing?.messageId ?? null,
          sentAt: existing?.sentAt ?? new Date(),
          alreadySent: true,
        };
      }

      const { messageId } = await this.transport.send({
        from: this.from, to: recipient, subject, text: body,
      });
      await client.query(
        'UPDATE sent_mail SET message_id = $2 WHERE event_id = $1', [eventId, messageId],
      );
      await client.query('COMMIT');
      return { messageId, sentAt: claimed.sent_at, alreadySent: false };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async findByEvent(eventId: string): Promise<SentMail | null> {
    const { rows } = await this.pool.query<{
      recipient: string; message_id: string | null; sent_at: Date;
    }>(
      'SELECT recipient, message_id, sent_at FROM sent_mail WHERE event_id = $1', [eventId],
    );
    const row = rows[0];
    if (!row) return null;
    return {
      recipient: row.recipient,
      messageId: row.message_id,
      sentAt: row.sent_at,
    };
  }
}
