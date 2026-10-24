-- STAGED: apply only after the minimum supported app version includes the
-- owner-only reads (waves_my_profile). Builds before that select `address`
-- and `notification_prefs` directly and would fail to load the profile.
-- Table privileges override column revokes, so replace the broad grant first.
REVOKE SELECT ON public.profiles FROM authenticated, anon;
REVOKE SELECT (address, notification_prefs) ON public.profiles FROM authenticated, anon;
DO $$
DECLARE cols text;
BEGIN
  SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) INTO cols
  FROM pg_attribute
  WHERE attrelid = 'public.profiles'::regclass AND attnum > 0 AND NOT attisdropped
    AND attname NOT IN ('address', 'notification_prefs');
  EXECUTE format('GRANT SELECT (%s) ON public.profiles TO authenticated', cols);
END $$;
