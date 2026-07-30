-- packages/db/migrations/008_slack_visitor_sends.sql
-- One row per Slack notification sent into a visitor's own workspace.
--
-- The house workspace does not need this: our own app holds channels:history, so the
-- delivery reads the channel back and recognises its own marker (spec 6.5). We do not
-- ask a visitor for that scope. Reading a stranger's channel history to save ourselves
-- some bookkeeping is a worse trade than the bookkeeping.
--
-- So the marker is written here before the call goes out and completed after it
-- returns. A row that still has no message_ts on the next attempt means the worker
-- died in the window between the two, and nobody can say whether the message landed.
-- That delivery goes to the dead letter box rather than being posted a second time:
-- visibly parked is the honest answer, a duplicate in someone else's Slack is not.
--
-- ON DELETE CASCADE so POST /api/reset stays a single delete on events.

CREATE TABLE slack_visitor_sends (
  event_id    uuid PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE,
  marker      text NOT NULL,
  message_ts  text,
  started_at  timestamptz NOT NULL DEFAULT now(),
  sent_at     timestamptz
);
