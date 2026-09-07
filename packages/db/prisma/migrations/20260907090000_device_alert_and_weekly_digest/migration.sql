-- Two mails that had no producer, and one that had no reason to exist yet.
--
-- Everything here writes ordinary `notifications` rows; `notify-fanout` and
-- `_shared/email.ts` already know how to turn one into mail. What was missing
-- was somebody to write them:
--
--   * **new_device_login** — a sign-in on a device this account has never used.
--     A security notice, not ledger news, and it is treated differently in
--     three places on purpose: it ignores the "email me" preference, it never
--     waits to see whether a push landed, and the mail it produces carries no
--     unsubscribe line (`SECURITY_TEMPLATES` in @waves/core). Somebody whose
--     account was taken needs this mail exactly when they are *not* holding the
--     phone that got the push.
--   * **digest_weekly** — Monday morning, what the last seven days came to, and
--     only for accounts that actually did something in them. An empty digest is
--     how a sender teaches people to write a filter rule.
--
-- The daily digest kind is deliberately left alone: it has a template and tests
-- but still no producer, and giving the weekly one its own kind means either
-- can be turned on without dragging the other with it.

-- ────────────────────────────────────── a sign-in worth telling somebody ──
--
-- The only change to the body of this function is the block marked below; the
-- rest is `20260904000000_waves_baseline` verbatim, because `CREATE OR REPLACE`
-- replaces the whole thing and a partial copy would silently drop the device
-- cap.
--
-- What counts as new: a device id never seen on this account, or one that was
-- signed out and has come back. The second case is the one that matters —
-- revoking a device is what somebody does when they think it is not theirs any
-- more, so its return is news.

CREATE OR REPLACE FUNCTION public.waves_register_device(p_device_id text, p_label text DEFAULT 'This device'::text, p_platform text DEFAULT 'unknown'::text, p_app_version text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_profile uuid := public.waves_current_profile_id();
  v_tier    text := public.waves_my_plan() ->> 'tier';
  v_limit   int;
  v_active  int;
  v_label   text;
  v_platform text;
  v_known   boolean;
  v_fresh   boolean;
BEGIN
  IF v_profile IS NULL THEN
    RAISE EXCEPTION 'NOT_SIGNED_IN: only a signed-in account has devices'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF p_device_id IS NULL OR length(trim(p_device_id)) = 0 THEN
    RAISE EXCEPTION 'BAD_DEVICE_ID: a device id is required'
      USING ERRCODE = 'check_violation';
  END IF;

  v_label    := COALESCE(NULLIF(trim(p_label), ''), 'This device');
  v_platform := COALESCE(NULLIF(trim(p_platform), ''), 'unknown');

  -- Read before write, because the answer disappears the moment the upsert
  -- runs. `v_known` is false for a device id never seen; `v_fresh` is true when
  -- it is new *or* returning from a revoke.
  SELECT TRUE, d.revoked_at IS NOT NULL
    INTO v_known, v_fresh
  FROM public.device_sessions d
  WHERE d.profile_id = v_profile AND d.device_id = p_device_id;

  IF NOT FOUND THEN
    v_known := FALSE;
    v_fresh := TRUE;
  END IF;

  INSERT INTO public.device_sessions
    (profile_id, device_id, label, platform, app_version, last_seen_at, revoked_at)
  VALUES
    (v_profile, p_device_id, v_label, v_platform, p_app_version, now(), NULL)
  ON CONFLICT (profile_id, device_id) DO UPDATE
    SET label        = EXCLUDED.label,
        platform     = EXCLUDED.platform,
        app_version  = EXCLUDED.app_version,
        last_seen_at = now(),
        revoked_at   = NULL;

  -- ── the new block ──
  --
  -- Guests are skipped: an anonymous account has no address to warn and no
  -- password to change, so the mail would be a row nothing can ever deliver
  -- (`waves_email_for` returns null and the claim suppresses it anyway) and a
  -- push to the one device that just arrived.
  --
  -- The dedupe key carries the date, not just the device: a phone reinstalling
  -- twice in an afternoon should not send two mails, but the same device
  -- signing in again next month is a genuinely new event.
  IF v_fresh AND NOT public.waves_is_guest(v_profile) THEN
    PERFORM public.waves_notify(
      v_profile,
      NULL,
      'new_device_login',
      'New sign-in on ' || v_label,
      'If this was not you, sign that device out and change how you sign in.',
      'waves://settings/devices',
      jsonb_build_object('device', v_label || ' · ' || v_platform),
      'new_device:' || v_profile::text || ':' || p_device_id || ':' || current_date::text
    );
  END IF;

  v_limit := public.waves_device_cap(v_profile, v_tier = 'plus');

  SELECT count(*) INTO v_active
  FROM public.device_sessions
  WHERE profile_id = v_profile
    AND revoked_at IS NULL
    AND last_seen_at > now() - interval '14 days';

  RETURN jsonb_build_object(
    'tier', v_tier,
    'limit', v_limit,
    'activeCount', v_active,
    'overLimit', v_active > v_limit,
    -- Told to the client so the app can say "we mailed you about this" on the
    -- device screen. `v_known` is what the caller wants, not `v_fresh`: a
    -- returning device is not a first sighting.
    'firstSighting', NOT v_known
  );
END
$$;

-- Anonymous accounts, named once so both this file and anything later asks the
-- question the same way. `auth.users.is_anonymous` is the only truth for it —
-- `profiles` does not carry the flag.
--
-- plpgsql, not sql, and guarded exactly like `waves_create_group`: CI runs these
-- migrations against a stub `auth` schema whose users table has no
-- `is_anonymous` column, and a SQL function body naming a missing column fails
-- at CREATE. plpgsql plans the statement lazily, so the guard is real. Where the
-- column does not exist there are no anonymous users, so `false` is the true
-- answer, not a hole.
CREATE OR REPLACE FUNCTION public.waves_is_guest(p_profile_id uuid) RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_is_guest boolean;
BEGIN
  IF to_regclass('auth.users') IS NULL
     OR NOT EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'auth'
         AND table_name = 'users'
         AND column_name = 'is_anonymous'
     ) THEN
    RETURN FALSE;
  END IF;

  SELECT u.is_anonymous INTO v_is_guest FROM auth.users u WHERE u.id = p_profile_id;
  RETURN COALESCE(v_is_guest, FALSE);
END
$$;

REVOKE ALL ON FUNCTION public.waves_is_guest(uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.waves_is_guest(uuid) TO service_role;

-- ──────────────────────────────────────────── Monday morning, seven days ──
--
-- Runs from cron at 03:30 UTC on Mondays — 09:00 in Asia/Kolkata, which is
-- where the people are. One row per account, and only for an account that has
-- something to be told about.
--
-- `p_now` is a parameter rather than `now()` inline so a test can run a Monday
-- without waiting for one.

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
           -- Expenses filed in the last seven days in any group this person is
           -- still a member of. Their own and everybody else's: a digest is
           -- "what happened around you", not "what you typed".
           (SELECT count(*)
              FROM public.expenses e
              JOIN public.group_members m
                ON m.group_id = e.group_id
               AND m.profile_id = p.id
               AND m.left_at IS NULL
              JOIN public.groups g ON g.id = e.group_id AND g.archived_at IS NULL
             WHERE e.deleted_at IS NULL
               AND e.created_at > v_since) AS expense_count,
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

-- ─────────────────────────────────────── which of these leave as email ──
--
-- Two kinds added to the list, and one exception written into the suppression
-- clauses: `new_device_login` is not held back by the "email me" preference.
-- Everything else here is `20260904000000_waves_baseline` verbatim.

CREATE OR REPLACE FUNCTION public.waves_claim_email_notifications(p_limit integer DEFAULT 100) RETURNS TABLE(id uuid, kind text, title text, body text, deep_link text, payload jsonb, locale text, address text, group_name text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_ids UUID[];
BEGIN
  WITH picked AS (
    SELECT n.id
    FROM public.notifications n
    WHERE n.email_status IS NULL
      -- Same two days as push — a mail about a reminder from Tuesday is
      -- worse than no mail.
      AND n.created_at > now() - interval '2 days'
      AND n.kind IN ('settlement_initiated', 'settlement_confirm_request',
                     'digest_daily', 'digest_weekly', 'nudge', 'group_added',
                     'new_device_login')
      AND (
        n.kind <> 'group_added'
        OR n.push_status = 'sent'
        OR (n.push_status = 'failed' AND n.push_next_retry_at IS NULL)
      )
    ORDER BY n.created_at
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  ),
  claimed AS (
    UPDATE public.notifications n
       SET email_status = 'queued'
      FROM picked
     WHERE n.id = picked.id
    RETURNING n.id
  )
  SELECT COALESCE(array_agg(claimed.id), '{}') INTO v_ids FROM claimed;

  -- No address is the end of it for every kind. The *preference* is not:
  -- turning off email means "stop telling me about ledgers", and nobody means
  -- it to include "and stop telling me when my account is opened somewhere".
  -- A hard suppression (bounce, complaint, unsubscribe) still wins below —
  -- that one is the mailbox refusing, not the person choosing.
  UPDATE public.notifications n
     SET email_status = 'suppressed'
   WHERE n.id = ANY(v_ids)
     AND (
       public.waves_email_for(n.profile_id) IS NULL
       OR (
         n.kind <> 'new_device_login'
         AND NOT COALESCE(
              (SELECT (p.notification_prefs ->> 'email')::boolean
               FROM public.profiles p WHERE p.id = n.profile_id),
              TRUE
            )
       )
     );

  UPDATE public.notifications n
     SET email_status = 'suppressed'
   WHERE n.id = ANY(v_ids)
     AND n.email_status = 'queued'
     AND public.waves_email_suppressed(public.waves_email_for(n.profile_id));

  -- TDR §7.4: a nudge goes by email only to somebody with no live device —
  -- everybody else already got a buzz about it. `new_device_login` is
  -- deliberately absent from this rule: the push goes to the devices, and the
  -- device is the thing in question.
  UPDATE public.notifications n
     SET email_status = 'suppressed'
   WHERE n.id = ANY(v_ids)
     AND n.email_status = 'queued'
     AND n.kind = 'nudge'
     AND EXISTS (
       SELECT 1 FROM public.push_tokens t
       WHERE t.profile_id = n.profile_id AND t.revoked_at IS NULL
     );

  UPDATE public.notifications n
     SET email_status = 'suppressed'
   WHERE n.id = ANY(v_ids)
     AND n.email_status = 'queued'
     AND n.kind = 'group_added'
     AND (
       n.push_status = 'sent'
       OR (
         EXISTS (
           SELECT 1 FROM public.push_tokens t
           WHERE t.profile_id = n.profile_id AND t.revoked_at IS NULL
         )
         AND NOT (n.push_status = 'failed' AND n.push_attempts >= 3)
       )
     );

  RETURN QUERY
  SELECT n.id, n.kind, n.title, n.body, n.deep_link, n.payload,
         COALESCE(p.locale, 'en'),
         public.waves_email_for(n.profile_id),
         g.name
  FROM public.notifications n
  LEFT JOIN public.profiles p ON p.id = n.profile_id
  LEFT JOIN public.groups g ON g.id = n.group_id
  WHERE n.id = ANY(v_ids) AND n.email_status = 'queued';
END
$$;

-- ───────────────────────────────────────────────────────── the schedule ──
--
-- Guarded, because a local stack has no pg_cron and a migration that assumes
-- one cannot be run before it is deployed. Unscheduling first makes the whole
-- block idempotent — `cron.schedule` on an existing name updates it, but only
-- if the name matches exactly, and a rename would otherwise leave two.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('waves-weekly-digest')
      WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'waves-weekly-digest');
    PERFORM cron.schedule(
      'waves-weekly-digest',
      '30 3 * * 1',
      $cron$SELECT public.waves_enqueue_weekly_digest();$cron$
    );
  END IF;
END
$$;
