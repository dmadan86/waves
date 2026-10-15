-- Two changes that ship together.
--
-- A. The Plus price test. Pro stays as it is; only the Plus monthly price is
--    tried at three levels (49 / 79 / 99 rupees). The app never hardcodes a
--    price: the `plus_price` flag assigns an arm (`p49`, `p79`, `p99`) and the
--    phone shows the RevenueCat offering of the same name. The flag is
--    inserted OFF at 0% rollout, so shipping this changes nothing until it is
--    switched on in the admin console. `premium_viewed` may now carry the arm
--    (`variant`) so conversion can be compared per arm.
--
-- B. A flood guard for `waves_track_event`. It is callable signed-out, and its
--    only limit was per install_id, which a script defeats by minting fresh
--    uuids. Two more limits are added: per client address (a salted hash, never
--    the address itself) and one global ceiling on installs.

-- ─────────────────────────────────────────────────────── the flag ──
INSERT INTO public.feature_flags (key, description, enabled, rollout_percent, variants)
VALUES (
  'plus_price',
  'Plus monthly price test: which RevenueCat offering (plus_p49 / plus_p79 / plus_p99) the paywall shows',
  false,
  0,
  ARRAY['p49', 'p79', 'p99']
)
ON CONFLICT (key) DO NOTHING;

-- ───────────────────────────────────────────── per-address hit log ──
--
-- One row per accepted call from an address. Holds sha256(salt || address),
-- never the address. Disposable: `waves_track_event` sweeps rows older than two
-- days, and the table is safe to truncate at any time at the cost of resetting
-- everybody's allowance.
CREATE TABLE public.app_event_ip_hits (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ip_hash    text NOT NULL,
  is_install boolean NOT NULL DEFAULT false,
  at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX app_event_ip_hits_ip_hash_at_idx ON public.app_event_ip_hits (ip_hash, at);
CREATE INDEX app_event_ip_hits_at_idx ON public.app_event_ip_hits (at);

ALTER TABLE public.app_event_ip_hits ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.app_event_ip_hits FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.app_event_ip_hits TO service_role;
REVOKE ALL ON SEQUENCE public.app_event_ip_hits_id_seq FROM PUBLIC, anon, authenticated;
GRANT ALL ON SEQUENCE public.app_event_ip_hits_id_seq TO service_role;

-- ───────────────────────────────────────────────────── the write ──
--
-- Same contract as before (a quiet `false` for anything dropped, an exception
-- only for an unknown name), with:
--   * `variant` allowed as a prop key;
--   * at most 20 `app_installed` and 300 events in total per address per hour;
--   * at most 5000 `app_installed` per hour across everyone (last resort);
--   * the address read from PostgREST's request headers: `cf-connecting-ip`
--     (set by Cloudflare, which cannot be forged through it), else the first
--     `x-forwarded-for` entry. No header means no per-address limit, only the
--     per-install and global ones.
--
-- The existing rate_limit_* machinery counts per profile or per
-- `ip:<address>` subject with the raw address and is built for edge functions;
-- it would store the address, which is the thing this must not do.
CREATE OR REPLACE FUNCTION public.waves_track_event(
  p_install_id uuid,
  p_name text,
  p_platform text DEFAULT NULL,
  p_app_version text DEFAULT NULL,
  p_props jsonb DEFAULT '{}'::jsonb
) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_profile    uuid;
  v_platform   text;
  v_version    text;
  v_props      jsonb := '{}'::jsonb;
  v_count      integer;
  v_headers    json;
  v_ip         text;
  v_ip_hash    text;
  v_ip_total   integer;
  v_ip_installs integer;
  v_is_install boolean := (p_name = 'app_installed');
BEGIN
  IF p_install_id IS NULL THEN
    RAISE EXCEPTION 'MISSING_INSTALL_ID';
  END IF;
  IF p_name IS NULL OR p_name <> ALL (ARRAY[
       'app_installed', 'signup_started', 'onboarding_completed', 'premium_viewed'
     ]) THEN
    RAISE EXCEPTION 'UNKNOWN_EVENT';
  END IF;

  v_platform := CASE WHEN p_platform IN ('ios', 'android', 'web') THEN p_platform END;
  v_version  := CASE WHEN p_app_version ~ '^[0-9A-Za-z.+_-]{1,32}$' THEN p_app_version END;

  -- Only short lowercase words under a known key survive. Whatever else a
  -- client sends — a number, a sentence, a nested object — is dropped.
  IF p_props IS NOT NULL AND jsonb_typeof(p_props) = 'object' THEN
    SELECT COALESCE(jsonb_object_agg(e.key, e.value), '{}'::jsonb)
      INTO v_props
      FROM jsonb_each(p_props) e
     WHERE e.key IN ('method', 'source', 'screen', 'variant')
       AND jsonb_typeof(e.value) = 'string'
       AND (e.value #>> '{}') ~ '^[a-z0-9_-]{1,32}$';
  END IF;

  SELECT count(*) INTO v_count
    FROM public.app_events
   WHERE install_id = p_install_id
     AND occurred_at > now() - interval '1 hour';
  IF v_count >= 200 THEN
    RETURN false;
  END IF;

  -- Last-resort ceiling: no matter how many addresses, this many installs an
  -- hour is not organic.
  IF v_is_install THEN
    SELECT count(*) INTO v_count
      FROM public.app_events
     WHERE name = 'app_installed'
       AND occurred_at > now() - interval '1 hour';
    IF v_count >= 5000 THEN
      RETURN false;
    END IF;
  END IF;

  -- The caller's address, from the proxy headers PostgREST exposes. Anything
  -- unparseable is "no address", never an error.
  BEGIN
    v_headers := NULLIF(current_setting('request.headers', true), '')::json;
    v_ip := COALESCE(
      NULLIF(btrim(v_headers ->> 'cf-connecting-ip'), ''),
      NULLIF(btrim(split_part(COALESCE(v_headers ->> 'x-forwarded-for', ''), ',', 1)), '')
    );
  EXCEPTION WHEN OTHERS THEN
    v_ip := NULL;
  END;

  IF v_ip IS NOT NULL THEN
    v_ip_hash := encode(sha256(convert_to('waves-app-events-ip-v1:' || left(v_ip, 64), 'UTF8')), 'hex');

    SELECT count(*), count(*) FILTER (WHERE is_install)
      INTO v_ip_total, v_ip_installs
      FROM public.app_event_ip_hits
     WHERE ip_hash = v_ip_hash
       AND at > now() - interval '1 hour';

    -- Over the limit: dropped quietly, and not logged, so a flood cannot
    -- grow this table past the cap per address.
    IF v_ip_total >= 300 OR (v_is_install AND v_ip_installs >= 20) THEN
      RETURN false;
    END IF;

    INSERT INTO public.app_event_ip_hits (ip_hash, is_install) VALUES (v_ip_hash, v_is_install);

    -- Housekeeping: about one call in a hundred sweeps rows older than two days.
    IF random() < 0.01 THEN
      DELETE FROM public.app_event_ip_hits WHERE at < now() - interval '2 days';
    END IF;
  END IF;

  -- profiles.id is the auth user id. A signed-out call, or one whose profile
  -- is not there yet, is recorded without a profile rather than refused.
  SELECT p.id INTO v_profile
    FROM public.profiles p
   WHERE p.id = public.waves_current_profile_id();

  INSERT INTO public.app_events (install_id, profile_id, name, platform, app_version, props)
  VALUES (p_install_id, v_profile, p_name, v_platform, v_version, v_props)
  ON CONFLICT (install_id) WHERE name = 'app_installed' DO NOTHING;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count > 0;
END
$$;

REVOKE ALL ON FUNCTION public.waves_track_event(uuid, text, text, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.waves_track_event(uuid, text, text, text, jsonb)
  TO anon, authenticated, service_role;

-- ─────────────────────────────────────────── the test's read-out ──
--
-- Per arm of `plus_price`: how many people are in it, how many distinct
-- installs opened the plans screen while on it (the `variant` prop on
-- `premium_viewed`), and how many people have a Plus subscription row.
-- service_role only, like every other admin read.
CREATE FUNCTION public.waves_admin_plus_price_results() RETURNS TABLE(
  variant text,
  people bigint,
  premium_viewed_installs bigint,
  plus_started bigint
)
    LANGUAGE sql STABLE
    SET search_path TO 'public', 'pg_temp'
    AS $$
  WITH enrolled AS (
    SELECT p.id AS profile_id, public.waves_variant('plus_price', p.id) AS variant
      FROM public.profiles p
     WHERE public.waves_variant('plus_price', p.id) IS NOT NULL
  ),
  people AS (
    SELECT e.variant,
           count(*)::bigint AS people,
           count(*) FILTER (WHERE EXISTS (
             SELECT 1 FROM public.subscriptions s
              WHERE s.profile_id = e.profile_id AND s.tier = 'plus'
           ))::bigint AS plus_started
      FROM enrolled e
     GROUP BY e.variant
  ),
  views AS (
    SELECT a.props ->> 'variant' AS variant, count(DISTINCT a.install_id)::bigint AS installs
      FROM public.app_events a
     WHERE a.name = 'premium_viewed' AND a.props ? 'variant'
     GROUP BY a.props ->> 'variant'
  )
  SELECT COALESCE(p.variant, v.variant),
         COALESCE(p.people, 0)::bigint,
         COALESCE(v.installs, 0)::bigint,
         COALESCE(p.plus_started, 0)::bigint
    FROM people p
    FULL JOIN views v ON v.variant = p.variant
   ORDER BY 1;
$$;

REVOKE ALL ON FUNCTION public.waves_admin_plus_price_results() FROM PUBLIC, anon, authenticated;
GRANT ALL ON FUNCTION public.waves_admin_plus_price_results() TO service_role;
