-- Own migration: a new enum value cannot be used in the transaction that adds it.
ALTER TYPE public."MemberRole" ADD VALUE IF NOT EXISTS 'vendor';
