-- packages/db/migrations/010_paypal_route.sql
-- PayPal becomes a real target, and an order records which of the two providers it
-- sent the money to. Exactly one of them, never both: an order billed twice is not
-- a thing that happens in a shop.
--
-- Numbered 010 because 009 is already applied. The runner records migrations by
-- filename, so editing 001 to widen the constraints there would be silently skipped
-- on every database that has run before, including the one on the demo host.
--
-- The two CHECK constraints below are what makes adding a value to
-- packages/contracts/src/targets.ts a breaking change: the vocabulary is enforced by
-- the database rather than by the code that writes to it. They are widened and not
-- dropped, because an unknown target must still be refused. A queue that accepts a
-- delivery no worker can make would sit at "waiting" forever and the counter that
-- says nothing is lost would be the thing that lied about it.

ALTER TABLE deliveries DROP CONSTRAINT deliveries_target_check;
ALTER TABLE deliveries ADD CONSTRAINT deliveries_target_check CHECK (target IN
  ('hubspot','stripe','paypal','slack','ledger','mailer','custom_webhook'));

ALTER TABLE switches DROP CONSTRAINT switches_target_check;
ALTER TABLE switches ADD CONSTRAINT switches_target_check CHECK (target IN
  ('hubspot','stripe','paypal','slack','ledger','mailer'));

-- Without this row the gate reads no state for paypal and forwards everything, so
-- "cut the line to PayPal" would be a switch that does nothing while looking like it
-- does. ON CONFLICT so a database that already carries the row is left alone.
INSERT INTO switches (target) VALUES ('paypal') ON CONFLICT (target) DO NOTHING;

-- The route on the order, next to the basket and the total.
--
-- It is also in the event payload, which is the copy the mediator reads: an event can
-- reach the queue with no orders row at all, a Stripe payment webhook being one. This
-- copy exists for the other reader. The public SQL console reaches four views over
-- tables and cannot dig through a jsonb payload, so a route that lived only there
-- could not be checked by the visitor it is a promise to.
--
-- Neither copy is what the queue stands on. That is the delivery rows written at
-- intake: exactly one of stripe and paypal exists for an order, and a mediator that
-- restarts reads them back rather than deciding anything again.
--
-- DEFAULT 'stripe' rather than a bare NOT NULL: every order written before this
-- migration went to Stripe, because there was nothing else, so the backfill states a
-- fact instead of guessing one. It is the same value DEFAULT_PAYMENT_ROUTE names in
-- the contract, so the two cannot disagree about what "unstated" means.
ALTER TABLE orders
  ADD COLUMN payment_route text NOT NULL DEFAULT 'stripe'
    CHECK (payment_route IN ('stripe','paypal'));

-- Replaced rather than dropped and recreated: a DROP would take the grant in 005 with
-- it and the console would lose the view altogether.
CREATE OR REPLACE VIEW v_orders AS
SELECT o.id, o.event_id, o.customer_name,
       regexp_replace(o.customer_email, '(^.).*(@.*$)', '\1***\2') AS customer_email,
       o.items, o.total_cents, o.source, o.created_at, o.payment_route
FROM orders o;
