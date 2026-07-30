-- packages/db/migrations/004_invoice_sequence.sql
-- Invoice numbers come from a sequence, not from counting rows: two workers
-- inserting at once must never land on the same number, and a rolled-back
-- insert must not hand its number to the next invoice.
--
-- This lives in its own file rather than being edited into 001. An already
-- applied migration is never rewritten — the runner records it by filename and
-- would silently skip the change on any database that has run before.

CREATE SEQUENCE IF NOT EXISTS invoice_number_seq START 1000;
