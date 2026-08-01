// services/api/src/cleanup.service.ts
// Nightly tidy-up (spec 14). A visitor's email address lives 24 hours.
//
// It swept stored OAuth tokens as well, until the visitor OAuth was removed. The
// table they lived in is gone with it, so there is nothing left here to sweep.
//
// The order row survives with its address replaced, and so does the delivery
// history. Only the address goes, so the pipeline stays readable for anyone still
// looking at it, without keeping a list of who visited.
//
// The address is stored three times. orders.customer_email is the copy a reader sees,
// events.payload is the copy the deliveries were built from, and sent_mail.recipient
// is the mailer's record of where the confirmation went. Erasing one of the three
// left the promise printed under the order form mostly unkept.
//
// The mailer owns that third table and the sweep still lives here, because one
// promise gets one sweeper. The mailer answers requests and holds no schedule of its
// own, so giving it a nightly timer would put two clocks in charge of when 24 hours
// is up, and they would drift apart. Traffic already runs in this direction anyway:
// proof.service.ts reads sent_mail from here for the proof chain.
import type { Pool } from 'pg';

/** What is left in place of an address, in all three copies, so they agree. */
const ERASED = '[deleted]';

export class CleanupService {
  constructor(private readonly pool: Pool) {}

  /**
   * Returns how many rows were touched. Rows, not people: one order placed with an
   * address leaves up to three of them behind and counts once for each.
   */
  async run(): Promise<number> {
    const orders = await this.pool.query(
      `UPDATE orders SET customer_email = $1
        WHERE created_at < now() - interval '24 hours'
          AND customer_email <> $1`,
      [ERASED],
    );
    // Only payloads booked under a person. An order nobody left an address for runs
    // under the house identity, which belongs to no one, and that is most of the
    // rows here: rewriting them would cost an update on the whole demo history every
    // night and hide nothing. `confirmTo` tells the two apart reliably, because an
    // order is booked under a visitor's own address exactly when they asked to be
    // written to (see orders.service.ts).
    //
    // `confirmTo` is removed rather than overwritten. Rule 6.7 reads that key to
    // decide whether a confirmation mail is still owed, and a marker string sitting
    // there would owe a mail to something that is not an address. `customerEmail` is
    // the identity the order is booked under and every reader of the payload expects
    // it to be present, so that one keeps its key and loses its value.
    const events = await this.pool.query(
      `UPDATE events
          SET payload = (payload - 'confirmTo')
                        || jsonb_build_object('customerEmail', $1::text)
        WHERE received_at < now() - interval '24 hours'
          AND coalesce(payload->>'confirmTo', '') <> ''`,
      [ERASED],
    );
    // No house address to spare here and so no filter to write: rule 6.7 queues a
    // mail only for a visitor who asked to be written to, so every row in this table
    // belongs to a real person.
    //
    // The column keeps a marker instead of becoming nullable. NULL would need a
    // migration and would push `string | null` through SentMail for no gain, and it
    // would say the wrong thing: there was an address here, which is not the same as
    // never having had one. Nothing reads recipient to decide whether to resend, that
    // is the UNIQUE (event_id), so emptying it cannot buy anyone a second mail.
    const mail = await this.pool.query(
      `UPDATE sent_mail SET recipient = $1
        WHERE sent_at < now() - interval '24 hours'
          AND recipient <> $1`,
      [ERASED],
    );
    return (orders.rowCount ?? 0) + (events.rowCount ?? 0) + (mail.rowCount ?? 0);
  }
}
