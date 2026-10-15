-- Privacy-safe campaign attribution. No ad SDK, no advertising identifier.
--
-- A. `waves_track_event` now also keeps `medium` and `campaign` props (and
--    `source` up to 40 characters), each a lowercase [a-z0-9_-] word. They
--    travel on the once-per-install `app_installed` event and come from the
--    Play install referrer's utm_source / utm_medium / utm_campaign. The body
--    is otherwise identical to 20261015160000_plus_price_test: only the prop
--    filter changed; the flood guard is untouched.
--
-- B. `waves_admin_campaigns(p_days)`: per (source, medium, campaign), how many
--    installs, how many of those installs later became a registered account,
--    how many of those accounts were activated, and how many bought Plus/Pro.

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
     WHERE jsonb_typeof(e.value) = 'string'
       AND (
         (e.key IN ('method', 'screen', 'variant') AND (e.value #>> '{}') ~ '^[a-z0-9_-]{1,32}$')
         OR (e.key IN ('source', 'medium', 'campaign') AND (e.value #>> '{}') ~ '^[a-z0-9_-]{1,40}$')
       );
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


-- ─────────────────────────────────────────────── the campaign table ──
--
-- Installs in the window are the `app_installed` events since p_days ago, as in
-- waves_admin_kpis. An install "registered" when any app_events row with the
-- same install_id carries a profile_id whose profile is not a guest (the same
-- test waves_admin_kpis uses). "Activated" repeats that function's definition
-- for the registered profile: it made an expense, settlement or personal
-- record (waves_admin_creations) within 7 days of its own sign-up, and only
-- profiles old enough to have had the 7 days count (the same maturity rule),
-- so a young campaign is not marked down. "Subscribed" is a paid Plus or Pro
-- row (not a comped 'promo' grant) created on or after the install. An install
-- with several registered profiles counts once per measure.
-- Missing tags show as '(none)'.
CREATE FUNCTION public.waves_admin_campaigns(p_days integer DEFAULT 30) RETURNS TABLE(
  source text,
  medium text,
  campaign text,
  installs bigint,
  registrations bigint,
  activated bigint,
  subscriptions bigint
)
    LANGUAGE sql STABLE
    SET search_path TO 'public', 'pg_temp'
    AS $$
  WITH win AS (
    SELECT (current_date - (GREATEST(p_days, 1) - 1))::date AS since
  ),
  inst AS (
    SELECT DISTINCT ON (e.install_id)
           e.install_id,
           e.occurred_at,
           COALESCE(e.props ->> 'source', '(none)')   AS source,
           COALESCE(e.props ->> 'medium', '(none)')   AS medium,
           COALESCE(e.props ->> 'campaign', '(none)') AS campaign
      FROM public.app_events e, win
     WHERE e.name = 'app_installed' AND e.occurred_at::date >= win.since
     ORDER BY e.install_id, e.occurred_at
  ),
  creations AS (SELECT * FROM public.waves_admin_creations((SELECT since FROM win))),
  -- One row per (install, registered profile).
  reg AS (
    SELECT DISTINCT i.install_id, p.id AS profile_id, p.created_at
      FROM inst i
      JOIN public.app_events ev ON ev.install_id = i.install_id AND ev.profile_id IS NOT NULL
      JOIN public.profiles p ON p.id = ev.profile_id
     WHERE NOT public.waves_is_guest(p.id)
  ),
  reg_flags AS (
    SELECT r.install_id,
           (r.created_at + interval '7 days' <= now()) AS act_mature,
           EXISTS (
             SELECT 1 FROM creations x
              WHERE x.profile_id = r.profile_id
                AND x.created_at >= r.created_at
                AND x.created_at < r.created_at + interval '7 days'
           ) AS is_activated,
           EXISTS (
             SELECT 1 FROM public.subscriptions s
              WHERE s.profile_id = r.profile_id
                AND s.tier IN ('plus', 'pro')
                AND s.store <> 'promo'
                AND s.created_at >= (SELECT i.occurred_at FROM inst i WHERE i.install_id = r.install_id)
           ) AS is_subscribed
      FROM reg r
  ),
  per_install AS (
    SELECT i.source, i.medium, i.campaign, i.install_id,
           EXISTS (SELECT 1 FROM reg_flags f WHERE f.install_id = i.install_id) AS registered,
           EXISTS (SELECT 1 FROM reg_flags f WHERE f.install_id = i.install_id AND f.act_mature AND f.is_activated) AS activated,
           EXISTS (SELECT 1 FROM reg_flags f WHERE f.install_id = i.install_id AND f.is_subscribed) AS subscribed
      FROM inst i
  )
  SELECT q.source, q.medium, q.campaign,
         count(*)::bigint,
         count(*) FILTER (WHERE q.registered)::bigint,
         count(*) FILTER (WHERE q.activated)::bigint,
         count(*) FILTER (WHERE q.subscribed)::bigint
    FROM per_install q
   GROUP BY q.source, q.medium, q.campaign
   ORDER BY count(*) DESC, q.source, q.medium, q.campaign;
$$;

REVOKE ALL ON FUNCTION public.waves_admin_campaigns(integer) FROM PUBLIC, anon, authenticated;
GRANT ALL ON FUNCTION public.waves_admin_campaigns(integer) TO service_role;
