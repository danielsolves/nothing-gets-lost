-- packages/db/migrations/014_backlog_view.sql
-- The backlog: what a person still has to deal with, in one place with enough
-- around it to act on.
--
-- v_dead_letters (002) already lists the same rows and stays exactly as it is. It
-- answers "which deliveries gave up", which is a question about the queue. This one
-- answers "what is waiting for me", which is a question about the work: it carries
-- the order number a visitor can read out loud, who the order was for and what it
-- was worth. Reviewing a parked delivery without those means opening a second query
-- to find out what the row is even about.
--
-- Built on v_events and v_orders rather than on the tables under them, so the email
-- masking is written once. A backlog view that selected customer_email straight from
-- orders would be the one place on this database where the address is not masked,
-- and it would be the place a stranger looks first.
--
-- No ORDER BY here. A view that carries its own order lies to anyone who adds one.

CREATE VIEW v_backlog AS
SELECT d.id,
       d.event_id,
       e.number        AS order_number,
       d.target,
       d.attempts,
       d.last_error,
       -- The moment it was parked. On a dead row nothing writes updated_at again,
       -- so this stays the instant the last attempt was given up on.
       d.updated_at    AS parked_at,
       o.customer_name,
       o.customer_email,
       o.total_cents
FROM deliveries d
  JOIN v_events e ON e.id = d.event_id
  -- Left, because not every event is an order. A Stripe payment webhook reaches the
  -- queue with no orders row, and a delivery of one can be parked like any other.
  LEFT JOIN v_orders o ON o.event_id = d.event_id
WHERE d.state = 'dead';

GRANT SELECT ON v_backlog TO ngl_ro;
