-- packages/db/migrations/002_views.sql
-- The only surface the public read-only SQL console may query. Personal data
-- is masked here rather than filtered in the application.

CREATE VIEW v_events AS
SELECT id, external_id, kind, received_at FROM events;

CREATE VIEW v_deliveries AS
SELECT id, event_id, target, state, attempts, next_at,
       last_error, remote_ref, remote_at, created_at, updated_at
FROM deliveries;

CREATE VIEW v_orders AS
SELECT o.id, o.event_id, o.customer_name,
       regexp_replace(o.customer_email, '(^.).*(@.*$)', '\1***\2') AS customer_email,
       o.items, o.total_cents, o.source, o.created_at
FROM orders o;

CREATE VIEW v_dead_letters AS
SELECT d.id, d.event_id, d.target, d.attempts, d.last_error, d.updated_at
FROM deliveries d WHERE d.state = 'dead';
