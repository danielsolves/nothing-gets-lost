-- packages/db/migrations/016_order_lines_view.sql
-- The basket of an order, priced the way it was actually charged.
--
-- Added for the MCP order tools, which could already say which order, when it
-- arrived, what it was worth and how every system fared, and could not say what was
-- in it. v_orders carries orders.items, and that is a sku and a quantity per line.
--
-- Naming and pricing those from products was the obvious alternative and is wrong
-- twice over. ngl_ro cannot see products and must not be given it, because a role
-- that reads the catalogue is a role that reads a table rather than a view. And a
-- join to today's catalogue prints today's price onto an order that was charged last
-- week, which is the one thing an order history must not do.
--
-- The priced basket was written down when the order was taken, and this view is only
-- how it is reached. services/api/src/orders.service.ts stores it on
-- events.payload.lines, because a target that has to write the order somewhere needs
-- a name and a figure per line and holds no catalogue to look either up in.
--
-- Four columns are projected by name rather than the payload being handed over. The
-- payload is also where the visitor's own address sits, under `confirmTo`, and where
-- the identity the order is booked under sits, under `customerEmail`. Naming the
-- columns means a payload that grows a field tomorrow cannot quietly widen what this
-- view shows.
--
-- The line number is a column rather than an ORDER BY. A view that carries its own
-- order lies to anyone who adds one (see 014).
--
-- The three type guards are not decoration. payload is jsonb with no schema behind
-- it and the chaos buttons put half-formed orders through the same pipeline, so a
-- single line whose quantity is the word "two" would otherwise fail every read of
-- this view rather than being the only line missing from its own order.

CREATE VIEW v_order_lines AS
SELECT e.id                                             AS event_id,
       line.ord                                         AS line_no,
       line.item->>'sku'                                AS sku,
       COALESCE(line.item->>'name', line.item->>'sku')  AS name,
       (line.item->>'qty')::int                         AS qty,
       -- The whole line and not the unit price, as it was stored: a reader holding
       -- this against the Stripe receipt should never have to multiply.
       (line.item->>'cents')::int                       AS cents
FROM events e,
     LATERAL jsonb_array_elements(
       CASE WHEN jsonb_typeof(e.payload->'lines') = 'array'
            THEN e.payload->'lines'
            ELSE '[]'::jsonb
       END
     ) WITH ORDINALITY AS line(item, ord)
WHERE jsonb_typeof(line.item->'sku') = 'string'
  AND jsonb_typeof(line.item->'qty') = 'number'
  AND jsonb_typeof(line.item->'cents') = 'number';

GRANT SELECT ON v_order_lines TO ngl_ro;
