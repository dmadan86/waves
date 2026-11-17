-- Admin dashboard numbers leave out test accounts (public.test_accounts) and
-- everything they created: groups, expenses, settlements, activity, sign-ins,
-- installs, invites, subscriptions. Signatures, return shapes, security mode and
-- grants are unchanged; each function below only gains an exclusion.

-- Internal: is this group member one of the marked test accounts?
CREATE FUNCTION public.waves_admin_is_test_member(p_member uuid) RETURNS boolean
    LANGUAGE sql STABLE
    SET search_path TO 'public', 'pg_temp'
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.group_members gm
      JOIN public.test_accounts t ON t.user_id = gm.profile_id
     WHERE gm.id = p_member);
$$;
REVOKE ALL ON FUNCTION public.waves_admin_is_test_member(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.waves_admin_is_test_member(uuid) TO service_role;


CREATE OR REPLACE FUNCTION public.waves_admin_overview() RETURNS TABLE(profiles_total bigint, profiles_new_7d bigint, profiles_new_30d bigint, groups_total bigint, groups_new_30d bigint, groups_active_30d bigint, expenses_total bigint, expenses_new_30d bigint, expenses_deleted bigint, settlements_total bigint, settlements_confirmed bigint, active_profiles_7d bigint, active_profiles_30d bigint)
    LANGUAGE sql STABLE
    SET search_path TO 'public', 'pg_temp'
    AS $$
  SELECT
    (SELECT count(*) FROM public.profiles WHERE NOT EXISTS (SELECT 1 FROM public.test_accounts t WHERE t.user_id = id)),
    (SELECT count(*) FROM public.profiles WHERE created_at >= now() - interval '7 days' AND NOT EXISTS (SELECT 1 FROM public.test_accounts t WHERE t.user_id = id)),
    (SELECT count(*) FROM public.profiles WHERE created_at >= now() - interval '30 days' AND NOT EXISTS (SELECT 1 FROM public.test_accounts t WHERE t.user_id = id)),
    (SELECT count(*) FROM public.groups WHERE NOT EXISTS (SELECT 1 FROM public.test_accounts t WHERE t.user_id = created_by)),
    (SELECT count(*) FROM public.groups WHERE created_at >= now() - interval '30 days' AND NOT EXISTS (SELECT 1 FROM public.test_accounts t WHERE t.user_id = created_by)),
    (SELECT count(DISTINCT group_id) FROM public.activity_log
      WHERE created_at >= now() - interval '30 days' AND NOT public.waves_admin_is_test_member(actor_member_id)),
    (SELECT count(*) FROM public.expenses WHERE deleted_at IS NULL AND NOT public.waves_admin_is_test_member(created_by)),
    (SELECT count(*) FROM public.expenses
      WHERE deleted_at IS NULL AND created_at >= now() - interval '30 days' AND NOT public.waves_admin_is_test_member(created_by)),
    (SELECT count(*) FROM public.expenses WHERE deleted_at IS NOT NULL AND NOT public.waves_admin_is_test_member(created_by)),
    (SELECT count(*) FROM public.settlements WHERE NOT public.waves_admin_is_test_member(from_member_id)),
    (SELECT count(*) FROM public.settlements WHERE status = 'confirmed' AND NOT public.waves_admin_is_test_member(from_member_id)),
    (SELECT count(DISTINCT m.profile_id)
       FROM public.activity_log a
       JOIN public.group_members m ON m.id = a.actor_member_id
      WHERE a.created_at >= now() - interval '7 days' AND m.profile_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.test_accounts t WHERE t.user_id = m.profile_id)),
    (SELECT count(DISTINCT m.profile_id)
       FROM public.activity_log a
       JOIN public.group_members m ON m.id = a.actor_member_id
      WHERE a.created_at >= now() - interval '30 days' AND m.profile_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.test_accounts t WHERE t.user_id = m.profile_id));
$$;

CREATE OR REPLACE FUNCTION public.waves_admin_daily(p_days integer DEFAULT 30) RETURNS TABLE(day date, new_profiles bigint, new_groups bigint, new_expenses bigint, active_profiles bigint)
    LANGUAGE sql STABLE
    SET search_path TO 'public', 'pg_temp'
    AS $$
  WITH days AS (
    SELECT generate_series(
      (current_date - (GREATEST(p_days, 1) - 1))::date,
      current_date,
      interval '1 day'
    )::date AS day
  )
  SELECT
    d.day,
    (SELECT count(*) FROM public.profiles p WHERE p.created_at::date = d.day AND NOT EXISTS (SELECT 1 FROM public.test_accounts t WHERE t.user_id = p.id)),
    (SELECT count(*) FROM public.groups g WHERE g.created_at::date = d.day AND NOT EXISTS (SELECT 1 FROM public.test_accounts t WHERE t.user_id = g.created_by)),
    (SELECT count(*) FROM public.expenses e
      WHERE e.created_at::date = d.day AND e.deleted_at IS NULL AND NOT public.waves_admin_is_test_member(e.created_by)),
    (SELECT count(DISTINCT m.profile_id)
       FROM public.activity_log a
       JOIN public.group_members m ON m.id = a.actor_member_id
      WHERE a.created_at::date = d.day AND m.profile_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.test_accounts t WHERE t.user_id = m.profile_id))
  FROM days d
  ORDER BY d.day;
$$;

CREATE OR REPLACE FUNCTION public.waves_admin_geo() RETURNS TABLE(country_code text, profile_count bigint, group_count bigint, expense_count bigint)
    LANGUAGE sql STABLE
    SET search_path TO 'public', 'pg_temp'
    AS $$
  WITH countries AS (
    SELECT DISTINCT country_code::text AS code FROM public.profiles WHERE NOT EXISTS (SELECT 1 FROM public.test_accounts t WHERE t.user_id = id)
    UNION
    SELECT DISTINCT country_code::text AS code FROM public.groups WHERE NOT EXISTS (SELECT 1 FROM public.test_accounts t WHERE t.user_id = created_by)
  )
  SELECT
    c.code,
    (SELECT count(*) FROM public.profiles p WHERE p.country_code::text IS NOT DISTINCT FROM c.code AND NOT EXISTS (SELECT 1 FROM public.test_accounts t WHERE t.user_id = p.id)),
    (SELECT count(*) FROM public.groups g WHERE g.country_code::text IS NOT DISTINCT FROM c.code AND NOT EXISTS (SELECT 1 FROM public.test_accounts t WHERE t.user_id = g.created_by)),
    (SELECT count(*)
       FROM public.expenses e
       JOIN public.groups g ON g.id = e.group_id
      WHERE g.country_code::text IS NOT DISTINCT FROM c.code AND e.deleted_at IS NULL AND NOT public.waves_admin_is_test_member(e.created_by))
  FROM countries c
  ORDER BY 2 DESC, 1;
$$;

CREATE OR REPLACE FUNCTION public.waves_admin_money() RETURNS TABLE(currency text, expense_count bigint, expense_minor numeric, settlement_count bigint, settlement_minor numeric)
    LANGUAGE sql STABLE
    SET search_path TO 'public', 'pg_temp'
    AS $$
  WITH live AS (
    SELECT v.currency::text AS currency, v.amount
      FROM public.expenses e
      JOIN public.expense_versions v ON v.id = e.current_version_id
     WHERE e.deleted_at IS NULL AND NOT public.waves_admin_is_test_member(e.created_by)
  ),
  paid AS (
    SELECT s.currency::text AS currency, s.amount
      FROM public.settlements s
     WHERE s.status = 'confirmed' AND NOT public.waves_admin_is_test_member(s.from_member_id)
  ),
  currencies AS (
    SELECT currency FROM live UNION SELECT currency FROM paid
  )
  SELECT
    c.currency,
    (SELECT count(*) FROM live l WHERE l.currency = c.currency),
    COALESCE((SELECT sum(l.amount) FROM live l WHERE l.currency = c.currency), 0),
    (SELECT count(*) FROM paid p WHERE p.currency = c.currency),
    COALESCE((SELECT sum(p.amount) FROM paid p WHERE p.currency = c.currency), 0)
  FROM currencies c
  ORDER BY 3 DESC;
$$;

CREATE OR REPLACE FUNCTION public.waves_admin_logins(p_days integer DEFAULT 30) RETURNS TABLE(day date, sign_ins bigint)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $_$
BEGIN
  IF to_regclass('auth.audit_log_entries') IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY EXECUTE format(
    $q$
      SELECT a.created_at::date AS day, count(*)::bigint
        FROM auth.audit_log_entries a
       WHERE a.created_at >= current_date - (%s - 1)
         AND a.payload ->> 'action' IN ('login', 'token_refreshed')
         AND NOT EXISTS (SELECT 1 FROM public.test_accounts t
                          WHERE t.user_id::text = a.payload ->> 'actor_id')
       GROUP BY 1
       ORDER BY 1 DESC
    $q$,
    GREATEST(p_days, 1)
  );
END
$_$;

CREATE OR REPLACE FUNCTION public.waves_admin_campaign_funnel(p_campaign_id uuid) RETURNS TABLE(cohort text, people bigint, seen bigint, redeemed bigint, paid bigint)
    LANGUAGE sql STABLE
    SET search_path TO 'public', 'pg_temp'
    AS $$
  WITH c AS (
    SELECT * FROM public.campaigns WHERE id = p_campaign_id
  ),
  audience AS (
    SELECT p.id AS profile_id,
           public.waves_campaign_cohort(c.id, p.id) AS cohort
      FROM public.profiles p
      CROSS JOIN c
     WHERE (c.audience_countries IS NULL OR p.country_code = ANY (c.audience_countries))
       AND p.created_at <= c.ends_at
       AND NOT EXISTS (SELECT 1 FROM public.test_accounts t WHERE t.user_id = p.id)
  )
  SELECT
    a.cohort,
    count(*)::bigint,
    count(*) FILTER (
      WHERE EXISTS (
        SELECT 1 FROM public.campaign_impressions i
         WHERE i.campaign_id = p_campaign_id AND i.profile_id = a.profile_id
      )
    )::bigint,
    count(*) FILTER (
      WHERE EXISTS (
        SELECT 1
          FROM public.promo_redemptions r
          JOIN c ON c.promo_code = r.code
         WHERE r.profile_id = a.profile_id
      )
    )::bigint,
    -- Paid means a real store purchase, not the giveaway. `store <> 'promo'` is
    -- the whole distinction: counting the comped rows here would report every
    -- campaign as a total success.
    count(*) FILTER (
      WHERE EXISTS (
        SELECT 1
          FROM public.subscriptions s
          CROSS JOIN c
         WHERE s.profile_id = a.profile_id
           AND s.store <> 'promo'
           AND s.created_at >= c.starts_at
      )
    )::bigint
  FROM audience a
  GROUP BY a.cohort
  ORDER BY a.cohort;
$$;

CREATE OR REPLACE FUNCTION public.waves_admin_campaign_revenue(p_campaign_id uuid) RETURNS TABLE(cohort text, currency text, payers bigint, revenue_minor numeric)
    LANGUAGE sql STABLE
    SET search_path TO 'public', 'pg_temp'
    AS $$
  WITH c AS (
    SELECT * FROM public.campaigns WHERE id = p_campaign_id
  )
  SELECT
    public.waves_campaign_cohort(c.id, s.profile_id),
    s.currency::text,
    count(DISTINCT s.profile_id)::bigint,
    COALESCE(sum(s.price_minor), 0)
  FROM public.subscriptions s
  JOIN public.profiles p ON p.id = s.profile_id
  CROSS JOIN c
  WHERE s.store <> 'promo'
    AND NOT EXISTS (SELECT 1 FROM public.test_accounts t WHERE t.user_id = s.profile_id)
    AND s.price_minor IS NOT NULL
    AND s.currency IS NOT NULL
    AND s.created_at >= c.starts_at
    AND (c.audience_countries IS NULL OR p.country_code = ANY (c.audience_countries))
  GROUP BY 1, 2
  ORDER BY 1, 2;
$$;

CREATE OR REPLACE FUNCTION public.waves_admin_creations(p_since date) RETURNS TABLE(profile_id uuid, created_at timestamp with time zone)
    LANGUAGE sql STABLE
    SET search_path TO 'public', 'pg_temp'
    AS $$
  SELECT m.profile_id, e.created_at
    FROM public.expenses e
    JOIN public.group_members m ON m.id = e.created_by
   WHERE e.deleted_at IS NULL AND m.profile_id IS NOT NULL AND e.created_at::date >= p_since
     AND NOT EXISTS (SELECT 1 FROM public.test_accounts t WHERE t.user_id = m.profile_id)
  UNION ALL
  SELECT m.profile_id, s.created_at
    FROM public.settlements s
    JOIN public.group_members m ON m.id = s.from_member_id
   WHERE m.profile_id IS NOT NULL AND s.created_at::date >= p_since
     AND NOT EXISTS (SELECT 1 FROM public.test_accounts t WHERE t.user_id = m.profile_id)
  UNION ALL
  SELECT r.owner_user_id, r.created_at
    FROM public.personal_records r
   WHERE r.deleted_at IS NULL AND r.created_at::date >= p_since
     AND NOT EXISTS (SELECT 1 FROM public.test_accounts t WHERE t.user_id = r.owner_user_id);
$$;

CREATE OR REPLACE FUNCTION public.waves_admin_activity_days(p_since date) RETURNS TABLE(profile_id uuid, day date)
    LANGUAGE sql STABLE
    SET search_path TO 'public', 'pg_temp'
    AS $$
  SELECT c.profile_id, c.created_at::date FROM public.waves_admin_creations(p_since) c
  UNION
  SELECT m.profile_id, a.created_at::date
    FROM public.activity_log a
    JOIN public.group_members m ON m.id = a.actor_member_id
   WHERE m.profile_id IS NOT NULL AND a.created_at::date >= p_since
     AND NOT EXISTS (SELECT 1 FROM public.test_accounts t WHERE t.user_id = m.profile_id);
$$;

CREATE OR REPLACE FUNCTION public.waves_admin_kpis(p_days integer DEFAULT 30) RETURNS TABLE(
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
       AND NOT EXISTS (SELECT 1 FROM public.test_accounts t WHERE t.user_id = p.id)
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
        WHERE e.name = 'app_installed' AND e.occurred_at::date >= win.since
          AND NOT EXISTS (SELECT 1 FROM public.app_events x
                          JOIN public.test_accounts t ON t.user_id = x.profile_id
                         WHERE x.install_id = e.install_id)) AS installs,
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
             AND NOT EXISTS (SELECT 1 FROM public.test_accounts t WHERE t.user_id = pr.id)
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
             AND NOT EXISTS (SELECT 1 FROM public.test_accounts t WHERE t.user_id = pr.id)
        )
      ) AS led
    FROM public.invites i, win
    WHERE i.created_at::date >= win.since AND NOT EXISTS (SELECT 1 FROM public.test_accounts t WHERE t.user_id = i.created_by)
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

CREATE OR REPLACE FUNCTION public.waves_admin_retention_cohorts(p_weeks integer DEFAULT 8) RETURNS TABLE(
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
       AND NOT EXISTS (SELECT 1 FROM public.test_accounts t WHERE t.user_id = p.id)
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

CREATE OR REPLACE FUNCTION public.waves_admin_campaigns(p_days integer DEFAULT 30) RETURNS TABLE(
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
       AND NOT EXISTS (SELECT 1 FROM public.app_events x
                          JOIN public.test_accounts t ON t.user_id = x.profile_id
                         WHERE x.install_id = e.install_id)
     ORDER BY e.install_id, e.occurred_at
  ),
  creations AS (SELECT * FROM public.waves_admin_creations((SELECT since FROM win))),
  -- One row per (install, registered profile).
  reg AS (
    SELECT DISTINCT i.install_id, p.id AS profile_id, p.created_at
      FROM inst i
      JOIN public.app_events ev ON ev.install_id = i.install_id AND ev.profile_id IS NOT NULL
      JOIN public.profiles p ON p.id = ev.profile_id
     WHERE NOT public.waves_is_guest(p.id) AND NOT EXISTS (SELECT 1 FROM public.test_accounts t WHERE t.user_id = p.id)
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
