-- Narrow the client grants on the two voice-agent tables to what was intended.
--
-- 20261007120000_voice_agent (already applied) granted only SELECT on
-- voice_agent_usage to `authenticated` and nothing on voice_agent_allowlist, but
-- the schema's default table privileges (baseline: ALTER DEFAULT PRIVILEGES ...
-- GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated) had already
-- handed `authenticated` full DML on both as they were created.
--
-- Not an exposure: RLS is on for both, voice_agent_usage has a single
-- SELECT-own policy and voice_agent_allowlist has none, so a client write
-- matched no row and a client read of the allowlist came back empty. But the
-- grant is the boundary here (ADR-013), so a write must be refused outright, not
-- quietly filtered to nothing, the way app_notices does it.
--
-- Functions need nothing: the 20260904200000 default-privilege revoke already
-- left waves_voice_agent_enabled / _quota / _refund service-role only and
-- waves_my_voice_agent_enabled callable by `authenticated`.

REVOKE ALL ON TABLE public.voice_agent_usage FROM anon, authenticated;
GRANT SELECT ON TABLE public.voice_agent_usage TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.voice_agent_usage TO service_role;

REVOKE ALL ON TABLE public.voice_agent_allowlist FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.voice_agent_allowlist TO service_role;
