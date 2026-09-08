-- The kill switch, and who is allowed to touch it.
--
-- `app_releases` holds `minimum_version` per platform: the app reads it before
-- its own sign-in screen and refuses to run when it is below that number. It is
-- the one row in this database that can stop every install of Waves at once.
--
-- `authenticated` holds SELECT, INSERT and UPDATE on it — from the baseline
-- (`20260904000000` :12545) and re-granted by `20260904160000` :61. Only SELECT
-- was ever intended; the table's own comment says so in as many words: "Public
-- read, service-role write."
--
-- **This is not currently exploitable, and the migration should not be read as
-- fixing a live hole.** Checked by trying it as `authenticated` rather than by
-- reading the grants:
--
--   * `UPDATE app_releases SET minimum_version = '99.0.0'` — succeeds and
--     changes **zero rows**. RLS is on and the only policy is
--     `FOR SELECT ... USING (true)`; with no UPDATE policy no row is visible to
--     update, so the statement is a silent no-op rather than an error.
--   * `INSERT` — refused outright: "new row violates row-level security policy".
--
-- So RLS is doing the work, and the grant is redundant. It is revoked because
-- redundant is not the same as harmless: an UPDATE or ALL policy added later for
-- some good reason would turn this into a denial of service against the entire
-- product, delivered by any signed-in account — a guest included — and the
-- person adding that policy would have no reason to look for a leftover grant.
-- The blast radius is the whole install base, which is a poor thing to leave
-- resting on one policy nobody is thinking about.
--
-- This is the same shape as `20260908120000_revoke_admin_voice_attempts_grant`,
-- and the same root cause: `20260904160000_anon_surface_on_hosted` re-granted
-- the schema by replaying a local build, faithfully reproducing a grant the
-- baseline should never have carried.
--
-- Nothing breaks. Writes come from the admin console over the service-role key
-- (`apps/admin/src/lib/data.ts`), and the pre-sign-in version gate only reads —
-- `anon` and `authenticated` keep SELECT.

REVOKE INSERT, UPDATE, DELETE ON TABLE public.app_releases FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.app_releases FROM anon;

-- Restated rather than assumed: the version gate has to answer before there is
-- a session, so both roles keep read.
GRANT SELECT ON TABLE public.app_releases TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.app_releases TO service_role;
