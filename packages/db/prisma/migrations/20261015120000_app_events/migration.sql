-- First-party product analytics: a few anonymous app steps, kept in our own
-- database.
--
-- The app counts four things the database cannot work out for itself — an
-- install, a sign-up that was started, onboarding finished, a plans screen
-- looked at. Everything else in the funnel (a profile, an expense, a
-- settlement, an invite) is already a row somewhere, so it is derived from
-- those rows by `waves_admin_kpis` and never reported by the client.
--
-- What a row may hold is deliberately narrow. `install_id` is a random uuid the
-- app makes for itself; it is not an advertising identifier and is not
-- derived from the device. `props` carries only short enum-like words
-- (`{"method":"phone"}`, `{"screen":"paywall"}`) and the RPC drops anything
-- else, so no amount, description, name, phone number, email or SMS text can
-- reach this table even from a modified client.
--
-- No one reads the table directly. RLS is on with no policy, anon and
-- authenticated have no grant, and the only way in is `waves_track_event`.

CREATE TABLE public.app_events (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  install_id  uuid NOT NULL,
  profile_id  uuid REFERENCES public.profiles(id) ON UPDATE CASCADE ON DELETE SET NULL,
  name        text NOT NULL,
  platform    text,
  app_version text,
  props       jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT app_events_name_known CHECK (name = ANY (ARRAY[
    'app_installed'::text, 'signup_started'::text, 'onboarding_completed'::text, 'premium_viewed'::text
  ])),
  CONSTRAINT app_events_platform_known CHECK (
    platform IS NULL OR platform = ANY (ARRAY['ios'::text, 'android'::text, 'web'::text])
  ),
  CONSTRAINT app_events_props_object CHECK (jsonb_typeof(props) = 'object'),
  CONSTRAINT app_events_props_small CHECK (pg_column_size(props) < 1024)
);

CREATE INDEX app_events_name_occurred_at_idx ON public.app_events (name, occurred_at);
CREATE INDEX app_events_profile_id_idx ON public.app_events (profile_id);
-- Leads with install_id, so it also answers the rate-limit count in the RPC.
CREATE INDEX app_events_install_id_occurred_at_idx ON public.app_events (install_id, occurred_at);
-- One install per install_id, enforced rather than hoped for.
CREATE UNIQUE INDEX app_events_one_install_idx ON public.app_events (install_id)
  WHERE name = 'app_installed';

ALTER TABLE public.app_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.app_events FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.app_events TO service_role;
REVOKE ALL ON SEQUENCE public.app_events_id_seq FROM PUBLIC, anon, authenticated;
GRANT ALL ON SEQUENCE public.app_events_id_seq TO service_role;

-- ───────────────────────────────────────────────────────── the write ──
--
-- Callable signed-out on purpose: `app_installed` is sent on first launch,
-- before there is any session. It is the one definer function besides the RLS
-- helpers that `anon` may run, so it is strict about what it accepts.
--
-- It returns whether a row was written, and raises only for a name that is not
-- on the list. A rate-limited or duplicate call is a quiet `false`: the app
-- never needs to know, and nothing here should make it retry.
--
-- Rate limit: an install that has sent 200 events in the last hour is ignored.
-- Cheap and per install; it stops a runaway loop, not a determined flood of
-- fresh install ids.
CREATE FUNCTION public.waves_track_event(
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
  v_profile  uuid;
  v_platform text;
  v_version  text;
  v_props    jsonb := '{}'::jsonb;
  v_count    integer;
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
     WHERE e.key IN ('method', 'source', 'screen')
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

-- ──────────────────────────────────────────────────────── the KPIs ──
--
-- Definitions, written once.
--
--   Registered   a profile that is not a guest (`waves_is_guest`). Every
--                install signs in as a guest first, so counting every profile
--                would make install-to-registration meaningless.
--   Activated    a registered profile that, within 7 days of
--                `profiles.created_at`, created a live expense
--                (expenses.created_by is a member; group_members.profile_id
--                maps it to the profile), a settlement (settlements has no
--                author column; from_member_id is the side that starts one),
--                or a live personal_records row (owner_user_id is the profile).
--   Active on a day  any activity_log row by one of the profile's members, or
--                any of the creations above, on that calendar day.
--   Day N retained   active on `created_at::date + N`. A cohort counts toward
--                dN only once that day has fully passed, so a young cohort
--                never drags the ratio down. Every metric returns its
--                numerator and its denominator so the page can show maturity.

-- Everything a profile created, one row each. Internal: the two KPI functions
-- below read it, and so does nobody else.
CREATE FUNCTION public.waves_admin_creations(p_since date) RETURNS TABLE(profile_id uuid, created_at timestamp with time zone)
    LANGUAGE sql STABLE
    SET search_path TO 'public', 'pg_temp'
    AS $$
  SELECT m.profile_id, e.created_at
    FROM public.expenses e
    JOIN public.group_members m ON m.id = e.created_by
   WHERE e.deleted_at IS NULL AND m.profile_id IS NOT NULL AND e.created_at::date >= p_since
  UNION ALL
  SELECT m.profile_id, s.created_at
    FROM public.settlements s
    JOIN public.group_members m ON m.id = s.from_member_id
   WHERE m.profile_id IS NOT NULL AND s.created_at::date >= p_since
  UNION ALL
  SELECT r.owner_user_id, r.created_at
    FROM public.personal_records r
   WHERE r.deleted_at IS NULL AND r.created_at::date >= p_since;
$$;

-- The calendar days each profile was active on, one row per profile per day.
CREATE FUNCTION public.waves_admin_activity_days(p_since date) RETURNS TABLE(profile_id uuid, day date)
    LANGUAGE sql STABLE
    SET search_path TO 'public', 'pg_temp'
    AS $$
  SELECT c.profile_id, c.created_at::date FROM public.waves_admin_creations(p_since) c
  UNION
  SELECT m.profile_id, a.created_at::date
    FROM public.activity_log a
    JOIN public.group_members m ON m.id = a.actor_member_id
   WHERE m.profile_id IS NOT NULL AND a.created_at::date >= p_since;
$$;

CREATE FUNCTION public.waves_admin_kpis(p_days integer DEFAULT 30) RETURNS TABLE(
  installs bigint,
  registrations bigint,
  install_to_registration numeric,
  activation_cohort bigint,
  activated bigint,
  registration_to_activation numeric,
  d1_cohort bigint, d1_retained bigint, d1 numeric,
  d7_cohort bigint, d7_retained bigint, d7 numeric,
  d30_cohort bigint, d30_retained bigint, d30 numeric,
  invites_sent bigint,
  invite_registrations bigint,
  invite_to_registration numeric
)
    LANGUAGE sql STABLE
    SET search_path TO 'public', 'pg_temp'
    AS $$
  WITH win AS (
    SELECT (current_date - (GREATEST(p_days, 1) - 1))::date AS since
  ),
  cohort AS (
    SELECT p.id, p.created_at, p.created_at::date AS signup_day
      FROM public.profiles p, win
     WHERE p.created_at::date >= win.since AND NOT public.waves_is_guest(p.id)
  ),
  creations AS (SELECT * FROM public.waves_admin_creations((SELECT since FROM win))),
  days AS (SELECT * FROM public.waves_admin_activity_days((SELECT since FROM win))),
  flags AS (
    SELECT
      c.id,
      c.signup_day,
      (c.created_at + interval '7 days' <= now()) AS act_mature,
      EXISTS (
        SELECT 1 FROM creations x
         WHERE x.profile_id = c.id
           AND x.created_at >= c.created_at
           AND x.created_at < c.created_at + interval '7 days'
      ) AS is_activated,
      EXISTS (SELECT 1 FROM days d WHERE d.profile_id = c.id AND d.day = c.signup_day + 1) AS r1,
      EXISTS (SELECT 1 FROM days d WHERE d.profile_id = c.id AND d.day = c.signup_day + 7) AS r7,
      EXISTS (SELECT 1 FROM days d WHERE d.profile_id = c.id AND d.day = c.signup_day + 30) AS r30
    FROM cohort c
  ),
  agg AS (
    SELECT
      (SELECT count(DISTINCT e.install_id) FROM public.app_events e, win
        WHERE e.name = 'app_installed' AND e.occurred_at::date >= win.since) AS installs,
      (SELECT count(*) FROM flags) AS registrations,
      count(*) FILTER (WHERE act_mature) AS activation_cohort,
      count(*) FILTER (WHERE act_mature AND is_activated) AS activated,
      count(*) FILTER (WHERE signup_day + 1 < current_date) AS d1_cohort,
      count(*) FILTER (WHERE signup_day + 1 < current_date AND r1) AS d1_retained,
      count(*) FILTER (WHERE signup_day + 7 < current_date) AS d7_cohort,
      count(*) FILTER (WHERE signup_day + 7 < current_date AND r7) AS d7_retained,
      count(*) FILTER (WHERE signup_day + 30 < current_date) AS d30_cohort,
      count(*) FILTER (WHERE signup_day + 30 < current_date AND r30) AS d30_retained
    FROM flags
  ),
  -- An invite "led to a registration" when someone who is not its author, and
  -- whose profile was created after it, joined its group through an invite
  -- link (group_members.joined_via) or had a "this is me" claim approved there
  -- (member_claims). Counted per invite, not per joiner: a group link is
  -- reusable, and one link that brought five people is one invite that worked.
  inv AS (
    SELECT
      i.id,
      (
        EXISTS (
          SELECT 1
            FROM public.group_members m
            JOIN public.profiles pr ON pr.id = m.profile_id
           WHERE m.group_id = i.group_id
             AND m.joined_via IN ('invite_link', 'invite_link_claim')
             AND m.profile_id IS DISTINCT FROM i.created_by
             AND m.created_at >= i.created_at
             AND pr.created_at >= i.created_at
             AND NOT public.waves_is_guest(pr.id)
        )
        OR EXISTS (
          SELECT 1
            FROM public.member_claims mc
            JOIN public.profiles pr ON pr.id = mc.requester_id
           WHERE mc.group_id = i.group_id
             AND mc.status = 'approved'
             AND mc.requester_id IS DISTINCT FROM i.created_by
             AND mc.created_at >= i.created_at
             AND pr.created_at >= i.created_at
             AND NOT public.waves_is_guest(pr.id)
        )
      ) AS led
    FROM public.invites i, win
    WHERE i.created_at::date >= win.since
  ),
  inv_agg AS (
    SELECT count(*) AS sent, count(*) FILTER (WHERE led) AS converted FROM inv
  )
  SELECT
    a.installs,
    a.registrations,
    CASE WHEN a.installs = 0 THEN NULL ELSE round(a.registrations::numeric / a.installs, 4) END,
    a.activation_cohort,
    a.activated,
    CASE WHEN a.activation_cohort = 0 THEN NULL ELSE round(a.activated::numeric / a.activation_cohort, 4) END,
    a.d1_cohort, a.d1_retained,
    CASE WHEN a.d1_cohort = 0 THEN NULL ELSE round(a.d1_retained::numeric / a.d1_cohort, 4) END,
    a.d7_cohort, a.d7_retained,
    CASE WHEN a.d7_cohort = 0 THEN NULL ELSE round(a.d7_retained::numeric / a.d7_cohort, 4) END,
    a.d30_cohort, a.d30_retained,
    CASE WHEN a.d30_cohort = 0 THEN NULL ELSE round(a.d30_retained::numeric / a.d30_cohort, 4) END,
    v.sent,
    v.converted,
    CASE WHEN v.sent = 0 THEN NULL ELSE round(v.converted::numeric / v.sent, 4) END
  FROM agg a, inv_agg v;
$$;

-- Weekly signup cohorts (weeks start on Monday), newest last. A week with no
-- signups still gets a row. Each retention figure carries its own eligible
-- count: a cohort too young for a day is 0 eligible, not 0 retained.
CREATE FUNCTION public.waves_admin_retention_cohorts(p_weeks integer DEFAULT 8) RETURNS TABLE(
  week_start date,
  size bigint,
  activation_eligible bigint, activated bigint,
  d1_eligible bigint, d1_retained bigint,
  d7_eligible bigint, d7_retained bigint,
  d30_eligible bigint, d30_retained bigint
)
    LANGUAGE sql STABLE
    SET search_path TO 'public', 'pg_temp'
    AS $$
  WITH weeks AS (
    SELECT (date_trunc('week', current_date)::date - 7 * g) AS week_start
      FROM generate_series(GREATEST(p_weeks, 1) - 1, 0, -1) g
  ),
  cohort AS (
    SELECT p.id, p.created_at, p.created_at::date AS signup_day,
           date_trunc('week', p.created_at)::date AS week_start
      FROM public.profiles p
     WHERE p.created_at::date >= (SELECT min(week_start) FROM weeks)
       AND NOT public.waves_is_guest(p.id)
  ),
  creations AS (SELECT * FROM public.waves_admin_creations((SELECT min(week_start) FROM weeks))),
  days AS (SELECT * FROM public.waves_admin_activity_days((SELECT min(week_start) FROM weeks))),
  flags AS (
    SELECT
      c.week_start,
      c.signup_day,
      (c.created_at + interval '7 days' <= now()) AS act_mature,
      EXISTS (
        SELECT 1 FROM creations x
         WHERE x.profile_id = c.id
           AND x.created_at >= c.created_at
           AND x.created_at < c.created_at + interval '7 days'
      ) AS is_activated,
      EXISTS (SELECT 1 FROM days d WHERE d.profile_id = c.id AND d.day = c.signup_day + 1) AS r1,
      EXISTS (SELECT 1 FROM days d WHERE d.profile_id = c.id AND d.day = c.signup_day + 7) AS r7,
      EXISTS (SELECT 1 FROM days d WHERE d.profile_id = c.id AND d.day = c.signup_day + 30) AS r30
    FROM cohort c
  )
  SELECT
    w.week_start,
    count(f.signup_day),
    count(*) FILTER (WHERE f.act_mature),
    count(*) FILTER (WHERE f.act_mature AND f.is_activated),
    count(*) FILTER (WHERE f.signup_day + 1 < current_date),
    count(*) FILTER (WHERE f.signup_day + 1 < current_date AND f.r1),
    count(*) FILTER (WHERE f.signup_day + 7 < current_date),
    count(*) FILTER (WHERE f.signup_day + 7 < current_date AND f.r7),
    count(*) FILTER (WHERE f.signup_day + 30 < current_date),
    count(*) FILTER (WHERE f.signup_day + 30 < current_date AND f.r30)
  FROM weeks w
  LEFT JOIN flags f ON f.week_start = w.week_start
  GROUP BY w.week_start
  ORDER BY w.week_start;
$$;

-- service_role only, like every other admin read. Postgres gives EXECUTE to
-- PUBLIC on creation and Supabase adds a direct grant to anon on top, so both
-- are revoked by name.
REVOKE ALL ON FUNCTION public.waves_admin_creations(date) FROM PUBLIC, anon, authenticated;
GRANT ALL ON FUNCTION public.waves_admin_creations(date) TO service_role;
REVOKE ALL ON FUNCTION public.waves_admin_activity_days(date) FROM PUBLIC, anon, authenticated;
GRANT ALL ON FUNCTION public.waves_admin_activity_days(date) TO service_role;
REVOKE ALL ON FUNCTION public.waves_admin_kpis(integer) FROM PUBLIC, anon, authenticated;
GRANT ALL ON FUNCTION public.waves_admin_kpis(integer) TO service_role;
REVOKE ALL ON FUNCTION public.waves_admin_retention_cohorts(integer) FROM PUBLIC, anon, authenticated;
GRANT ALL ON FUNCTION public.waves_admin_retention_cohorts(integer) TO service_role;
