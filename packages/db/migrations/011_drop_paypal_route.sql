-- packages/db/migrations/011_drop_paypal_route.sql
-- Takes PayPal back out. Migration 010 put it in; this narrows every constraint 010
-- widened rather than editing it, because the runner records migrations by filename
-- and a rewritten 010 would be silently skipped on any database that has run before.
--
-- Why it goes: PayPal will not capture a server-made order until a payer has approved
-- it in a browser, and unlike Stripe's pm_card_visa there is no shared test payer. On
-- a public page every visitor who chose PayPal watched a payment hang for a reason
-- that was neither a fault nor anything they could fix.
--
-- The order of the statements matters. Every CHECK below is validated against the
-- rows already in the table, so the data has to go first or the ALTER refuses.

-- The whole event, not just its payment leg.
--
-- Deleting only the paypal delivery would leave an order whose money never moved and
-- whose proof chain has a hole where the payment was, which is worse than no record:
-- the page would draw a card with four checkpoints and no fifth, and the counter that
-- says nothing is lost would be standing next to one that was. The FKs on deliveries
-- and orders are ON DELETE CASCADE (migration 001), so both go with the event.
DELETE FROM events e
WHERE EXISTS (SELECT 1 FROM deliveries d WHERE d.event_id = e.id AND d.target = 'paypal')
   OR EXISTS (SELECT 1 FROM orders o WHERE o.event_id = e.id AND o.payment_route = 'paypal');

-- invoices and sent_mail carry an event_id but no foreign key to events, so the
-- cascade above does not reach them and they would outlive the order they describe.
DELETE FROM invoices WHERE event_id NOT IN (SELECT id FROM events);
DELETE FROM sent_mail WHERE event_id NOT IN (SELECT id FROM events);

ALTER TABLE deliveries DROP CONSTRAINT deliveries_target_check;
ALTER TABLE deliveries ADD CONSTRAINT deliveries_target_check CHECK (target IN
  ('hubspot','stripe','slack','ledger','mailer','custom_webhook'));

-- The switch row goes before the constraint that would reject it. Nothing reads it
-- any more: the gate looks switches up by target, and there is no paypal target.
DELETE FROM switches WHERE target = 'paypal';
ALTER TABLE switches DROP CONSTRAINT switches_target_check;
ALTER TABLE switches ADD CONSTRAINT switches_target_check CHECK (target IN
  ('hubspot','stripe','slack','ledger','mailer'));

-- The column stays, narrowed to the one route left. Dropping it would take the
-- payment route off v_orders, and the SQL console reads that view: a visitor could
-- see which systems an order reached but not how it was paid. A list of one is still
-- a fact worth recording, and it is where a second provider would come back.
ALTER TABLE orders DROP CONSTRAINT orders_payment_route_check;
ALTER TABLE orders ADD CONSTRAINT orders_payment_route_check
  CHECK (payment_route IN ('stripe'));
