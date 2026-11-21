-- Private dates (birthdays, anniversaries) ride the owner-only personal_records
-- store as a fifth kind. Older apps decode unknown kinds to nothing (the ledger
-- switch ignores them) and never write them, so this is additive.
ALTER TABLE personal_records DROP CONSTRAINT IF EXISTS personal_records_kind_known;
ALTER TABLE personal_records
  ADD CONSTRAINT personal_records_kind_known
  CHECK (record_kind = ANY (ARRAY['txn'::text, 'recurring'::text, 'loan'::text, 'budget'::text, 'date'::text]));
