-- Test-account marking for the admin console, so the owner can tell real
-- customers from their own test accounts. Admin-only: service role and the
-- waves_admin_* functions are the only way in. No FK to auth.users (Supabase
-- owns that schema; CI runs on bare Postgres) — an orphan row is harmless.
CREATE TABLE public.test_accounts (
  user_id   uuid PRIMARY KEY,
  marked_at timestamptz NOT NULL DEFAULT now(),
  note      text CHECK (note IS NULL OR length(note) <= 200)
);
ALTER TABLE public.test_accounts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.test_accounts FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.test_accounts TO service_role;

-- waves_admin_users: add is_test per row, a p_test filter (null | 'only' | 'hide')
-- and test_total in the payload. The 4-argument form is replaced, not kept.
DROP FUNCTION IF EXISTS public.waves_admin_users(integer, integer, text, text);
CREATE FUNCTION public.waves_admin_users(p_limit integer DEFAULT 25, p_offset integer DEFAULT 0, p_name_prefix text DEFAULT NULL::text, p_country text DEFAULT NULL::text, p_test text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $_$
DECLARE
  v_total  bigint := 0;
  v_rows   jsonb  := '[]'::jsonb;
  v_test_total bigint := 0;
  v_prefix text   := nullif(btrim(coalesce(p_name_prefix, '')), '');
  v_country text  := nullif(upper(btrim(coalesce(p_country, ''))), '');
  v_test   text   := nullif(lower(btrim(coalesce(p_test, ''))), '');
  v_limit  int    := least(greatest(coalesce(p_limit, 25), 1), 100);
  v_offset int    := greatest(coalesce(p_offset, 0), 0);
BEGIN
  IF v_test IS NOT NULL AND v_test NOT IN ('only', 'hide') THEN
    RAISE EXCEPTION 'p_test must be null, only or hide';
  END IF;
  IF to_regclass('auth.users') IS NULL THEN
    RETURN jsonb_build_object('total', 0, 'rows', '[]'::jsonb, 'test_total', 0, 'unavailable', 'no auth schema');
  END IF;

  EXECUTE format(
    $q$
      WITH base AS (
        SELECT
          u.id,
          u.email,
          u.phone,
          (u.email_confirmed_at IS NOT NULL)  AS email_confirmed,
          COALESCE(u.is_anonymous, false)     AS is_anonymous,
          u.created_at,
          u.last_sign_in_at,
          p.display_name,
          p.country_code,
          EXISTS (
            SELECT 1 FROM public.subscriptions s
             WHERE s.profile_id = u.id
               AND s.tier IN ('plus', 'pro')
               AND s.status IN ('active', 'grace')
          ) AS is_plus,
          EXISTS (SELECT 1 FROM public.test_accounts t WHERE t.user_id = u.id) AS is_test,
          (SELECT count(*) FROM public.device_sessions d
             WHERE d.profile_id = u.id AND d.revoked_at IS NULL) AS device_count,
          (SELECT d.app_version FROM public.device_sessions d
             WHERE d.profile_id = u.id AND d.app_version IS NOT NULL
             ORDER BY d.last_seen_at DESC LIMIT 1) AS app_version,
          (SELECT d.platform FROM public.device_sessions d
             WHERE d.profile_id = u.id
             ORDER BY d.last_seen_at DESC LIMIT 1) AS platform
        FROM auth.users u
        LEFT JOIN public.profiles p ON p.id = u.id
        WHERE (%1$L IS NULL OR p.display_name ILIKE %2$L OR u.email ILIKE %2$L)
          AND (%3$L IS NULL OR p.country_code = %3$L)
      ), shown AS (
        SELECT * FROM base
         WHERE (%6$L IS NULL
                OR (%6$L = 'only' AND is_test)
                OR (%6$L = 'hide' AND NOT is_test))
      )
      SELECT
        (SELECT count(*) FROM shown),
        COALESCE(
          (SELECT jsonb_agg(to_jsonb(t))
             FROM (SELECT * FROM shown ORDER BY created_at DESC OFFSET %4$s LIMIT %5$s) t),
          '[]'::jsonb
        ),
        (SELECT count(*) FROM public.test_accounts)
    $q$,
    v_prefix,                 -- %1$L
    v_prefix || '%',          -- %2$L
    v_country,                -- %3$L
    v_offset,                 -- %4$s
    v_limit,                  -- %5$s
    v_test                    -- %6$L
  )
  INTO v_total, v_rows, v_test_total;

  RETURN jsonb_build_object('total', v_total, 'rows', v_rows, 'test_total', v_test_total);
END
$_$;
REVOKE ALL ON FUNCTION public.waves_admin_users(integer, integer, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.waves_admin_users(integer, integer, text, text, text) TO service_role;

-- Mark or unmark one account.
CREATE FUNCTION public.waves_admin_set_test(p_user uuid, p_test boolean, p_note text DEFAULT NULL::text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
BEGIN
  IF p_user IS NULL THEN RAISE EXCEPTION 'user required'; END IF;
  IF p_test THEN
    IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = p_user) THEN
      RAISE EXCEPTION 'no such user';
    END IF;
    INSERT INTO public.test_accounts (user_id, note) VALUES (p_user, nullif(btrim(p_note), ''))
    ON CONFLICT (user_id) DO UPDATE SET note = EXCLUDED.note;
  ELSE
    DELETE FROM public.test_accounts WHERE user_id = p_user;
  END IF;
END
$$;
REVOKE ALL ON FUNCTION public.waves_admin_set_test(uuid, boolean, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.waves_admin_set_test(uuid, boolean, text) TO service_role;

-- Mark every account whose email matches an ILIKE pattern; returns how many
-- matched. The pattern must contain '@' and start with at least 3 literal
-- characters before any wildcard (% or _), so '%' or '%@%' can never mark everyone.
CREATE FUNCTION public.waves_admin_mark_test_by_email(p_pattern text) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_pat text := btrim(coalesce(p_pattern, ''));
  v_count integer;
BEGIN
  IF length(v_pat) > 200 OR position('@' IN v_pat) = 0
     OR v_pat !~ '^[^%_]{3}' THEN
    RAISE EXCEPTION 'pattern must contain @ and start with at least 3 literal characters';
  END IF;
  WITH m AS (SELECT id FROM auth.users WHERE email ILIKE v_pat),
       i AS (INSERT INTO public.test_accounts (user_id, note)
             SELECT id, 'bulk: ' || v_pat FROM m
             ON CONFLICT (user_id) DO NOTHING)
  SELECT count(*) INTO v_count FROM m;
  RETURN v_count;
END
$$;
REVOKE ALL ON FUNCTION public.waves_admin_mark_test_by_email(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.waves_admin_mark_test_by_email(text) TO service_role;
