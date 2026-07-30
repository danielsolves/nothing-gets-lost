-- packages/db/migrations/003_seed.sql
-- Eight products. Fixed on purpose: the extractor validates every SKU the model
-- returns against this table, which is what catches invented article numbers.
INSERT INTO products (sku, name, cents) VALUES
  ('MUG-BLUE',    'Blue mug',            1200),
  ('MUG-WHITE',   'White mug',           1200),
  ('COASTER-OAK', 'Oak coaster',          450),
  ('PLATE-SMALL', 'Small plate',         1800),
  ('PLATE-LARGE', 'Large plate',         2600),
  ('TEAPOT',      'Teapot',              4900),
  ('SPOON-SET',   'Spoon set of six',    2200),
  ('TRAY-WALNUT', 'Walnut tray',         5400)
ON CONFLICT (sku) DO NOTHING;
