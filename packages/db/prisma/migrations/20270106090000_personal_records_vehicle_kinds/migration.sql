-- Vehicles and driving licences ride the owner-only personal_records store as two
-- more kinds. Older apps decode unknown kinds to nothing and never write them, so
-- this is additive. (Couple/home spaces are end to end encrypted and opaque to the server.)
ALTER TABLE personal_records DROP CONSTRAINT IF EXISTS personal_records_kind_known;
ALTER TABLE personal_records
  ADD CONSTRAINT personal_records_kind_known
  CHECK (record_kind = ANY (ARRAY['txn'::text, 'recurring'::text, 'loan'::text, 'budget'::text, 'date'::text, 'investment'::text, 'property'::text, 'tenancy'::text, 'vehicle'::text, 'licence'::text]));
