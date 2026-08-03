-- packages/db/migrations/009_order_numbers.sql
-- A number a visitor can read out loud for every order. The queue headed each card
-- with the first block of the event uuid, which says nothing about which order came
-- first and cannot be dictated over a phone.
--
-- It comes from a sequence rather than from counting rows, for the same reason
-- invoice numbers do (004): two intakes running at once must never land on the same
-- number, and a rolled-back insert must not hand its number to the next order.
--
-- On events rather than on orders, because the queue is built from deliveries and a
-- delivery has an event id and nothing else. There are also events with no orders
-- row at all, a Stripe payment webhook being one, and those appear in the queue too.
--
-- Deliberately not OWNED BY the column. POST /api/reset truncates events, and
-- numbering that restarted there would let one number mean two different orders on
-- two different afternoons. A gap in the numbers costs nothing; a number that has
-- been handed out twice costs the visitor who wrote it down.

CREATE SEQUENCE IF NOT EXISTS order_number_seq START 1000;

ALTER TABLE events
  ADD COLUMN number bigint NOT NULL DEFAULT nextval('order_number_seq');
ALTER TABLE events
  ADD CONSTRAINT events_number_key UNIQUE (number);

-- The number is only worth printing if it leads somewhere. The public console
-- reaches these four views and nothing else, so without this line the card would
-- carry a handle no visitor could resolve, which is worse than the uuid fragment it
-- replaces. Replaced rather than dropped and recreated: a DROP would take the grant
-- in 005 with it.
CREATE OR REPLACE VIEW v_events AS
SELECT id, external_id, kind, received_at, number FROM events;
