-- The weekly digest counts a week the reader was actually in.
--
-- `waves_enqueue_weekly_digest` counted every expense filed in any group the
-- person still belongs to. The comment said why — "a digest is what happened
-- around you, not what you typed" — and for a small group that reads fine. For
-- a large one it does not: somebody in a twelve-person trip who was on none of
-- the week's expenses got mail headed **"Your week on Waves"** reporting a
-- count they had no part in, sitting next to a balance of zero.
--
-- The count is also the gate. `CONTINUE WHEN v_person.expense_count = 0` is
-- what decides who gets mail at all, so counting bystanders did not merely
-- inflate a number: it mailed people who had no week to report, which is how a
-- sender teaches somebody to write a filter rule.
--
-- So the count narrows to expenses the person appears in — as the author, as a
-- payer, or as somebody the bill was split across. Everything else about the
-- function is unchanged, and the whole body is restated because
-- `CREATE OR REPLACE` replaces all of it and a partial copy would silently drop
-- the preference checks.
--
-- Why a new migration rather than a fix to 20260907090000: that one is applied
-- on production (2026-09-07 05:38 UTC). Prisma never re-runs an applied
-- migration, so an edit there would have changed the file, passed CI, and left
-- production running the old body — the exact shape of a fix that looks
-- deployed and is not.

CREATE OR REPLACE FUNCTION public.waves_enqueue_weekly_digest(p_now timestamp with time zone DEFAULT now()) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_since   timestamptz := p_now - interval '7 days';
  v_week    text := to_char(date_trunc('week', p_now), 'IYYY-"W"IW');
  v_person  record;
  v_written integer := 0;
  v_id      uuid;
BEGIN
  FOR v_person IN
    SELECT p.id,
           p.default_currency,
           -- Expenses filed in the last seven days where this person actually
           -- appears: the author/user, a payer/financer, or a share participant
           -- (traveller/rider). A group bystander did not have a week to report.
           (SELECT count(*)
              FROM public.expenses e
              JOIN public.expense_versions v ON v.id = e.current_version_id
              JOIN public.group_members m
                ON m.group_id = e.group_id
               AND m.profile_id = p.id
               AND m.left_at IS NULL
              JOIN public.groups g ON g.id = e.group_id AND g.archived_at IS NULL
             WHERE e.deleted_at IS NULL
               AND e.created_at > v_since
               AND (
                 v.author_member_id = m.id
                 OR EXISTS (
                   SELECT 1 FROM public.expense_payers ep
                    WHERE ep.expense_version_id = v.id AND ep.member_id = m.id
                 )
                 OR EXISTS (
                   SELECT 1 FROM public.expense_shares es
                    WHERE es.expense_version_id = v.id AND es.member_id = m.id
                 )
               )) AS expense_count,
           -- Net across every group, in their own currency only. Mixing
           -- currencies into one number would be a lie, and picking a
           -- "dominant" one would be a lie that changes week to week.
           COALESCE((
             SELECT SUM(CASE WHEN mine.side = 'to' THEN b.amount ELSE -b.amount END)
             FROM public.pairwise_balances b
             JOIN LATERAL (
               SELECT 'to' AS side FROM public.group_members m
                WHERE m.id = b.to_member_id AND m.profile_id = p.id
               UNION ALL
               SELECT 'from' FROM public.group_members m
                WHERE m.id = b.from_member_id AND m.profile_id = p.id
             ) mine ON TRUE
             JOIN public.groups g ON g.id = b.group_id AND g.archived_at IS NULL
             WHERE b.currency = p.default_currency
           ), 0) AS net_amount
    FROM public.profiles p
    WHERE NOT public.waves_is_guest(p.id)
      -- No address, no digest. The claim would suppress it a minute later
      -- anyway; not writing the row keeps the table honest about what was
      -- actually sendable.
      AND public.waves_email_for(p.id) IS NOT NULL
      AND COALESCE((p.notification_prefs ->> 'email')::boolean, TRUE)
      -- Opt-in, and the default is off. Settings → Notifications has carried
      -- "Weekly email digest … Off by default" since before anything produced
      -- one (`DEFAULT_NOTIFICATION_PREFS.weeklyEmail` is false), so a digest
      -- that shipped to everybody would make that screen a lie on the day it
      -- started working. Note the default here is FALSE, unlike every other
      -- preference in this file.
      AND COALESCE((p.notification_prefs ->> 'weeklyEmail')::boolean, FALSE)
  LOOP
    -- Nothing happened: say nothing. This is the whole difference between a
    -- digest people read and a digest people filter.
    CONTINUE WHEN v_person.expense_count = 0;

    v_id := public.waves_notify(
      v_person.id,
      NULL,
      'digest_weekly',
      'Your week on Waves',
      v_person.expense_count::text || ' expenses',
      'waves://activity',
      jsonb_build_object(
        'count', v_person.expense_count::text,
        'amount', v_person.net_amount::text,
        'currency', v_person.default_currency
      ),
      'digest_weekly:' || v_person.id::text || ':' || v_week
    );

    IF v_id IS NOT NULL THEN
      v_written := v_written + 1;
    END IF;
  END LOOP;

  RETURN v_written;
END
$$;

REVOKE ALL ON FUNCTION public.waves_enqueue_weekly_digest(timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION public.waves_enqueue_weekly_digest(timestamp with time zone) TO service_role;
