-- packages/db/migrations/001_initial.sql
-- Core schema. The UNIQUE (event_id, target) on deliveries is the single
-- source of the exactly-once guarantee — it lives here, not in application code,
-- so it holds even with several workers running.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE events (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  external_id  text UNIQUE NOT NULL,
  kind         text NOT NULL CHECK (kind IN ('order.placed', 'payment.succeeded')),
  payload      jsonb NOT NULL,
  received_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE deliveries (
  id          bigserial PRIMARY KEY,
  event_id    uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  target      text NOT NULL CHECK (target IN
                ('hubspot','stripe','slack','ledger','mailer','custom_webhook')),
  state       text NOT NULL DEFAULT 'pending'
                CHECK (state IN ('pending','inflight','done','dead')),
  attempts    int  NOT NULL DEFAULT 0,
  next_at     timestamptz NOT NULL DEFAULT now(),
  last_error  text,
  remote_ref  text,
  remote_at   timestamptz,
  locked_at   timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id, target)
);

CREATE INDEX deliveries_due_idx ON deliveries (next_at)
  WHERE state = 'pending';
CREATE INDEX deliveries_stuck_idx ON deliveries (locked_at)
  WHERE state = 'inflight';

CREATE TABLE products (
  sku    text PRIMARY KEY,
  name   text NOT NULL,
  cents  int  NOT NULL CHECK (cents > 0)
);

CREATE TABLE orders (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id       uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  customer_name  text NOT NULL,
  customer_email text NOT NULL,
  items          jsonb NOT NULL,
  total_cents    int  NOT NULL,
  source         text NOT NULL CHECK (source IN ('form','email')),
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE invoices (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id    uuid UNIQUE NOT NULL,
  number      text UNIQUE NOT NULL,
  total_cents int  NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sent_mail (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id   uuid UNIQUE NOT NULL,
  recipient  text NOT NULL,
  message_id text,
  sent_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE switches (
  target       text PRIMARY KEY CHECK (target IN
                 ('hubspot','stripe','slack','ledger','mailer')),
  state        text NOT NULL DEFAULT 'up'
                 CHECK (state IN ('up','slow','error','cut')),
  changed_at   timestamptz NOT NULL DEFAULT now()
);
INSERT INTO switches (target) VALUES
  ('hubspot'), ('stripe'), ('slack'), ('ledger'), ('mailer');

CREATE TABLE oauth_tokens (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider       text NOT NULL CHECK (provider IN ('slack','hubspot')),
  encrypted      bytea NOT NULL,
  iv             bytea NOT NULL,
  auth_tag       bytea NOT NULL,
  target_ref     text,
  expires_at     timestamptz NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX oauth_tokens_expiry_idx ON oauth_tokens (expires_at);

CREATE TABLE rate_limits (
  bucket     text NOT NULL,
  ip_hash    text NOT NULL,
  window_at  timestamptz NOT NULL,
  count      int NOT NULL DEFAULT 1,
  PRIMARY KEY (bucket, ip_hash, window_at)
);
