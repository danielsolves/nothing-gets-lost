-- packages/db/migrations/007_dropped_duplicates.sql
-- One row per webhook that arrived with an external id we had already seen.
--
-- The events table cannot answer this: a dropped duplicate leaves no trace there,
-- which is exactly the point of ON CONFLICT DO NOTHING. Without this table the
-- "duplicates dropped" counter would sit at zero forever and quietly claim that
-- the deduplication never fired.

CREATE TABLE dropped_duplicates (
  id          bigserial PRIMARY KEY,
  external_id text NOT NULL,
  dropped_at  timestamptz NOT NULL DEFAULT now()
);
