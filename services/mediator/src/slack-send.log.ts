// services/mediator/src/slack-send.log.ts
// What the visitor path uses instead of reading their channel history.
//
// Our own app can hold channels:history, so a delivery into the house workspace reads
// the channel back and recognises its own marker (spec 6.5). We do not ask a visitor
// for that scope: reading a stranger's Slack messages to spare ourselves some
// bookkeeping is the wrong trade for a project whose subject is trustworthiness.
//
// So the row is written before the call and completed after it. The three answers it
// can give map onto the three things that actually happen:
//
//   fresh    nothing has gone out — post
//   sent     it already went out, here is the timestamp — do not post again
//   unknown  an earlier attempt called Slack and never came back
//
// "unknown" is only reachable when the worker died between the call and its own catch
// block. A cut line, a 503, a timeout — anything the worker lives through — calls
// abandon() and reads "fresh" next time, which is what keeps the control panel demo
// healing. See slack.target.ts for the other half of that.
import type { Pool } from 'pg';

export type BeginResult =
  | { status: 'fresh' }
  | { status: 'sent'; messageTs: string }
  | { status: 'unknown' };

export interface SlackSendLog {
  begin(eventId: string, marker: string): Promise<BeginResult>;
  complete(eventId: string, messageTs: string): Promise<void>;
  abandon(eventId: string): Promise<void>;
}

export class PgSlackSendLog implements SlackSendLog {
  constructor(private readonly pool: Pool) {}

  async begin(eventId: string, marker: string): Promise<BeginResult> {
    // Claiming and reading in one statement: two workers racing here must not both
    // come away thinking they are the first one.
    const { rows } = await this.pool.query<{ message_ts: string | null }>(
      `INSERT INTO slack_visitor_sends (event_id, marker)
       VALUES ($1::uuid, $2)
       ON CONFLICT (event_id) DO NOTHING
       RETURNING message_ts`,
      [eventId, marker],
    );
    if (rows.length === 1) return { status: 'fresh' };

    const existing = await this.pool.query<{ message_ts: string | null }>(
      'SELECT message_ts FROM slack_visitor_sends WHERE event_id = $1::uuid',
      [eventId],
    );
    const messageTs = existing.rows[0]?.message_ts;
    // Gone between the two statements — reset ran, or the row lapsed. Start over.
    if (existing.rows.length === 0) return { status: 'fresh' };
    if (messageTs) return { status: 'sent', messageTs };
    return { status: 'unknown' };
  }

  async complete(eventId: string, messageTs: string): Promise<void> {
    await this.pool.query(
      `UPDATE slack_visitor_sends
          SET message_ts = $2, sent_at = now()
        WHERE event_id = $1::uuid`,
      [eventId, messageTs],
    );
  }

  /** Called when Slack itself told us the post did not happen. */
  async abandon(eventId: string): Promise<void> {
    await this.pool.query(
      'DELETE FROM slack_visitor_sends WHERE event_id = $1::uuid AND message_ts IS NULL',
      [eventId],
    );
  }
}
