-- packages/db/migrations/006_custom_webhook.sql
-- The visitor's own webhook url. It lives in the database, not in the api's
-- memory, because the mediator reads it from a different process and a restart
-- must not silently switch the target off while deliveries are still queued.
--
-- One row at most: the CHECK on a constant primary key makes a second row
-- impossible, so "set" is an upsert and there is nothing to clean up.

CREATE TABLE custom_webhook (
  id         boolean PRIMARY KEY DEFAULT true CHECK (id),
  url        text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
