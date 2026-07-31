-- packages/db/migrations/012_hubspot_products.sql
-- Which HubSpot product each catalogue sku became.
--
-- A line item that names a product is what fills the products card on a deal, so the
-- eight catalogue rows have to exist in HubSpot as products before an order can point
-- at them. HubSpot has no idempotency keys, and the natural key it would need here
-- lives on a search index that runs behind: a product created now is not found by a
-- search on its own sku for about seven seconds, measured. The first two retry gaps
-- are two and eight seconds (spec 6.4), so a mirror that trusted search alone would
-- create the same product twice on the retry after a cut line. Duplicating the
-- catalogue is a smaller sin than duplicating an order and it is the same sin, in a
-- demo whose whole claim is that this does not happen here.
--
-- So the sku is claimed here before the call goes out and completed after it returns.
-- A row that still has no product_id on the next attempt means the worker died in
-- between, and claimed_at says how long ago: once that is comfortably past the search
-- lag, a search that finds nothing is proof nothing was created, and the mirror may
-- try again. See hubspot-catalogue.log.ts for the other half of that.
--
-- No reference to events and no cascade: the catalogue outlives any single order, and
-- POST /api/reset clears the demo's traffic, not the products HubSpot now holds.

CREATE TABLE hubspot_products (
  sku          text PRIMARY KEY,
  product_id   text,
  claimed_at   timestamptz NOT NULL DEFAULT now(),
  mirrored_at  timestamptz
);
