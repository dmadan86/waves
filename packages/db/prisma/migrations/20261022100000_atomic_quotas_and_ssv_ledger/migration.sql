-- Atomic meters, refunds that name their bucket, and permanent ledgers.
--
-- Closes (abuse audit, Oct 2026):
--   WAV-02 / M2  receipt scans were check-then-spend (a parallel burst at
--                limit-1 all passed) and fell open on a quota read error.
--   WAV-03       a client-chosen `source` / cross-group receipt id failed the
--                recorder AFTER the model call, so the scan was never counted.
--   WAV-07       SSV replay memory lived in ad_rewards (cascaded with the
--                profile); refused callbacks were never recorded.
--   WAV-11 / L7  a statement continuation token let one "file" read any number
--                of chunks for an hour.
--   WAV-12 / M1  follow-up turns were keyed by a client-chosen expense id, so a
--                rotating id bought 300 LLM calls a month outside the allowance.
--   WAV-13       refunds decremented whichever month / pool was current at refund
--                time, not the one the reservation came from.
--   WAV-16       a TRANSFER moved rows regardless of event order.
--   L4           usage_events was INSERT/UPDATE-granted to authenticated.
--   L5           grace subscriptions were metered as Free.
--   M6 / H1      stream mints were the only bound on Deepgram minutes.
--   oracle       waves_scans_used_this_month(uuid) answered for any profile.
--
-- Pieces:
--   1. Receipt scans move onto ai_usage ('receipt_scan'): waves_receipt_scan_reserve
--      is the one atomic reservation (INSERT ... ON CONFLICT ... WHERE count < limit),
--      the current month is backfilled from usage_events, and usage_events becomes
--      analytics only (and client-read-only).
--   2. waves_voice_agent_refund / waves_ai_usage_refund take the bucket (month,
--      trial pool) the reservation reported; the quota answers now carry `month`.
--   3. Follow-up turns need a slot: a metered command that produced an action
--      opens one (3 turns, 10 minutes, waves_voice_agent_followup_open); a turn
--      with no open slot is refused. The expense id stays a per-expense window key.
--   4. statement_import_sessions bound the requests one import id may make.
--   5. ad_ssv_transactions: every verified callback's transaction id, forever,
--      with its outcome. waves_ads_grant writes it first.
--   6. Grace counts as paid in the voice meters; a stream mint RESERVES its
--      seconds (20 s) atomically against a seconds budget, as a reservation
--      row the relay settles exactly once against its own month; the TRANSFER
--      honours store_event_at.
--   7. Every reservation starts with waves_usage_guard (20261022090000): the
--      per-profile lock shared with deletion and restoration, the profile must
--      exist, and a deleted account's month must have been restored first.

SET LOCAL lock_timeout = '10s';

-- 1. Receipt scans -----------------------------------------------------------------

REVOKE INSERT, UPDATE, DELETE ON TABLE public.usage_events FROM anon, authenticated;

-- The month so far, from the events that were the counter until now.
INSERT INTO public.ai_usage AS a (profile_id, month, feature, count, updated_at)
SELECT ue.profile_id, to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM'), 'receipt_scan', count(*)::int, now()
  FROM public.usage_events ue
 WHERE ue.kind = 'receipt_scan'
   AND ue.created_at >= (date_trunc('month', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')
 GROUP BY ue.profile_id
ON CONFLICT (profile_id, month, feature) DO UPDATE
  SET count = GREATEST(a.count, EXCLUDED.count), updated_at = now();

-- A signed-in caller only ever reads their own count; the argument is honoured
-- for the service role and direct sessions.
CREATE OR REPLACE FUNCTION public.waves_scans_used_this_month(p_profile_id uuid DEFAULT NULL::uuid) RETURNS integer
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_role    text := COALESCE(NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '');
  v_profile uuid := CASE WHEN v_role IN ('anon', 'authenticated')
                         THEN public.waves_current_profile_id()
                         ELSE COALESCE(p_profile_id, public.waves_current_profile_id()) END;
  v_count   integer;
BEGIN
  IF v_profile IS NULL THEN RETURN 0; END IF;
  SELECT count INTO v_count
    FROM public.ai_usage
   WHERE profile_id = v_profile
     AND month = to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM')
     AND feature = 'receipt_scan';
  RETURN COALESCE(v_count, 0);
END
$$;

REVOKE ALL ON FUNCTION public.waves_scans_used_this_month(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.waves_scans_used_this_month(uuid) TO authenticated, service_role;

-- One scan, reserved before the model is asked. The limit is the plan's
-- (waves_my_plan, honouring the profile for the service role) plus this
-- month's ad credit for Free. {used, limit, allowed, tier, month}.
CREATE OR REPLACE FUNCTION public.waves_receipt_scan_reserve(p_profile uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_plan  jsonb;
  v_tier  text;
  v_limit integer;
  v_month text := to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM');
BEGIN
  IF p_profile IS NULL THEN
    RAISE EXCEPTION 'waves_receipt_scan_reserve needs a profile';
  END IF;
  v_plan  := public.waves_my_plan(p_profile);
  v_tier  := COALESCE(v_plan ->> 'tier', 'free');
  v_limit := COALESCE((v_plan ->> 'scanLimit')::integer, 0);
  IF v_tier = 'free' THEN
    v_limit := v_limit + public.waves_ads_bonus(p_profile, 'scan');
  END IF;
  RETURN public.waves_ai_usage_reserve(p_profile, 'receipt_scan', v_limit)
      || jsonb_build_object('tier', v_tier, 'month', v_month);
END
$$;

REVOKE ALL ON FUNCTION public.waves_receipt_scan_reserve(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.waves_receipt_scan_reserve(uuid) TO service_role;

-- waves_record_receipt from 20261015190000_receipt_parse_cache, plus p_reserved:
-- the edge function reserved the scan up front, so the recorder must not count
-- it again. A caller that did not reserve (p_reserved false, the old path)
-- still bumps the meter, so nothing is ever free. usage_events keeps the
-- token counts for cost analytics.
DROP FUNCTION IF EXISTS public.waves_record_receipt(uuid, uuid, uuid, text, text, text, jsonb, text, integer, integer, boolean);

CREATE OR REPLACE FUNCTION public.waves_record_receipt(p_group_id uuid, p_receipt_id uuid, p_profile_id uuid, p_source text, p_storage_path text, p_raw_text text, p_parsed jsonb, p_status text, p_input_tokens integer DEFAULT 0, p_output_tokens integer DEFAULT 0, p_cached boolean DEFAULT false, p_reserved boolean DEFAULT false) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_id uuid;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('waves_record_receipt:' || p_group_id::text)::bigint);

  IF p_receipt_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.receipts
     WHERE id = p_receipt_id AND group_id <> p_group_id
  ) THEN
    RAISE EXCEPTION 'RECEIPT_GROUP_MISMATCH'
      USING ERRCODE = 'check_violation',
            HINT = 'That receipt belongs to a different group.';
  END IF;

  IF NOT public.waves_group_is_paid(p_group_id)
     AND (p_receipt_id IS NULL
          OR NOT EXISTS (
            SELECT 1 FROM public.receipts
             WHERE id = p_receipt_id AND group_id = p_group_id
          ))
     AND (SELECT count(*) FROM public.receipts WHERE group_id = p_group_id)
         >= public.waves_receipt_cap()
  THEN
    RAISE EXCEPTION 'RECEIPT_CAP'
      USING ERRCODE = 'check_violation',
            HINT = 'This group has reached its receipt limit; upgrade or add storage to add more.';
  END IF;

  INSERT INTO public.receipts
    (id, group_id, storage_path, source, raw_text, parse_status, parsed, created_by)
  VALUES
    (COALESCE(p_receipt_id, gen_random_uuid()), p_group_id, p_storage_path,
     p_source::"ReceiptSource", p_raw_text, p_status::"ParseStatus", p_parsed,
     public.waves_my_member_id_for(p_group_id, p_profile_id))
  ON CONFLICT (id) DO UPDATE
    SET parsed = excluded.parsed,
        parse_status = excluded.parse_status,
        raw_text = excluded.raw_text
    WHERE receipts.group_id = p_group_id
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    RAISE EXCEPTION 'RECEIPT_GROUP_MISMATCH'
      USING ERRCODE = 'check_violation',
            HINT = 'That receipt belongs to a different group.';
  END IF;

  INSERT INTO public.usage_events
    (profile_id, group_id, kind, input_tokens, output_tokens, metadata)
  VALUES (p_profile_id, p_group_id,
          CASE WHEN p_cached THEN 'receipt_scan_cached' ELSE 'receipt_scan' END,
          p_input_tokens, p_output_tokens,
          jsonb_build_object('receiptId', v_id, 'status', p_status, 'cached', p_cached, 'reserved', p_reserved));

  -- The meter: only when nobody reserved it up front, and never for a cache hit.
  IF NOT p_cached AND NOT p_reserved THEN
    INSERT INTO public.ai_usage AS a (profile_id, month, feature, count, updated_at)
    VALUES (p_profile_id, to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM'), 'receipt_scan', 1, now())
    ON CONFLICT (profile_id, month, feature) DO UPDATE
      SET count = a.count + 1, updated_at = now();
  END IF;

  RETURN v_id;
END
$$;

REVOKE ALL ON FUNCTION public.waves_record_receipt(uuid, uuid, uuid, text, text, text, jsonb, text, integer, integer, boolean, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.waves_record_receipt(uuid, uuid, uuid, text, text, text, jsonb, text, integer, integer, boolean, boolean) TO service_role;

-- 2. Refunds name their bucket ------------------------------------------------------

-- waves_ai_usage_refund from 20261012150000_screenshot_import, with the month
-- the reservation was taken in. Without one, the current month (as before).
DROP FUNCTION IF EXISTS public.waves_ai_usage_refund(uuid, text);

CREATE OR REPLACE FUNCTION public.waves_ai_usage_refund(p_profile uuid, p_feature text, p_month text DEFAULT NULL) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_count integer;
BEGIN
  UPDATE public.ai_usage
     SET count = GREATEST(0, count - 1), updated_at = now()
   WHERE profile_id = p_profile
     AND feature = p_feature
     AND month = COALESCE(p_month, to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM'))
  RETURNING count INTO v_count;
  RETURN COALESCE(v_count, 0);
END
$$;

REVOKE ALL ON FUNCTION public.waves_ai_usage_refund(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.waves_ai_usage_refund(uuid, text, text) TO service_role;

-- waves_ai_usage_reserve from 20261012150000_screenshot_import: answers carry the month.
CREATE OR REPLACE FUNCTION public.waves_ai_usage_reserve(
  p_profile uuid,
  p_feature text,
  p_limit integer
) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_month text := to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM');
  v_count integer;
BEGIN
  PERFORM public.waves_usage_guard(p_profile);
  INSERT INTO public.ai_usage AS u (profile_id, month, feature, count, updated_at)
  SELECT p_profile, v_month, p_feature, 1, now()
   WHERE p_limit >= 1
  ON CONFLICT (profile_id, month, feature) DO UPDATE
    SET count = u.count + 1, updated_at = now()
    WHERE u.count < p_limit
  RETURNING u.count INTO v_count;

  IF v_count IS NOT NULL THEN
    RETURN jsonb_build_object('used', v_count, 'limit', p_limit, 'allowed', true, 'month', v_month);
  END IF;

  SELECT count INTO v_count
    FROM public.ai_usage
   WHERE profile_id = p_profile AND month = v_month AND feature = p_feature;
  RETURN jsonb_build_object('used', COALESCE(v_count, 0), 'limit', p_limit, 'allowed', false, 'month', v_month);
END
$$;

REVOKE ALL ON FUNCTION public.waves_ai_usage_reserve(uuid, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.waves_ai_usage_reserve(uuid, text, integer) TO service_role;

-- waves_voice_agent_quota from 20261016120000_two_tiers_free_and_pro: grace is
-- paid (as waves_profile_is_paid says), and the answer names its bucket.
CREATE OR REPLACE FUNCTION public.waves_voice_agent_quota(
  p_profile uuid,
  p_free_limit integer DEFAULT 10,
  p_pro_limit integer DEFAULT 100,
  p_plus_limit integer DEFAULT 100,
  p_trial_limit integer DEFAULT 20
) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_month text := to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM');
  v_tier  text;
  v_limit integer;
  v_count integer;
  v_bonus integer := 0;
  v_until timestamptz := public.waves_voice_trial_until(p_profile);
  v_ttier text := CASE WHEN public.waves_pro_trial_active(p_profile) IS NOT NULL THEN 'pro' ELSE 'free' END;
BEGIN
  PERFORM public.waves_usage_guard(p_profile);
  IF v_until IS NOT NULL THEN
    UPDATE public.pro_trials
       SET voice_used = voice_used + 1
     WHERE profile_id = p_profile AND voice_used < p_trial_limit
    RETURNING voice_used INTO v_count;
    IF v_count IS NOT NULL THEN
      RETURN jsonb_build_object('used', v_count, 'limit', p_trial_limit, 'tier', v_ttier, 'trial', true, 'until', v_until, 'allowed', true, 'month', v_month);
    END IF;
    SELECT voice_used INTO v_count FROM public.pro_trials WHERE profile_id = p_profile;
    RETURN jsonb_build_object('used', COALESCE(v_count, 0), 'limit', p_trial_limit, 'tier', v_ttier, 'trial', true, 'until', v_until, 'allowed', false, 'month', v_month);
  END IF;

  SELECT CASE WHEN count(*) = 0 THEN 'free' ELSE 'pro' END
    INTO v_tier
    FROM public.subscriptions s
   WHERE s.profile_id = p_profile
     AND s.status IN ('active', 'grace')
     AND s.store <> 'trial'
     AND (s.current_period_end IS NULL OR s.current_period_end > now())
     AND s.tier IN ('plus', 'pro');
  IF v_tier = 'free' THEN
    v_bonus := public.waves_ads_bonus(p_profile, 'voice');
  END IF;
  v_limit := CASE v_tier WHEN 'pro' THEN p_pro_limit ELSE p_free_limit + v_bonus END;

  INSERT INTO public.voice_agent_usage AS u (profile_id, month, count, updated_at)
  SELECT p_profile, v_month, 1, now()
   WHERE v_limit >= 1
  ON CONFLICT (profile_id, month) DO UPDATE
    SET count = u.count + 1, updated_at = now()
    WHERE u.count < v_limit
  RETURNING u.count INTO v_count;

  IF v_count IS NOT NULL THEN
    RETURN jsonb_build_object('used', v_count, 'limit', v_limit, 'tier', v_tier, 'allowed', true, 'month', v_month);
  END IF;

  SELECT count INTO v_count
    FROM public.voice_agent_usage WHERE profile_id = p_profile AND month = v_month;
  RETURN jsonb_build_object(
    'used', COALESCE(v_count, 0), 'limit', v_limit, 'tier', v_tier, 'allowed', false, 'month', v_month
  );
END
$$;

REVOKE ALL ON FUNCTION public.waves_voice_agent_quota(uuid, integer, integer, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.waves_voice_agent_quota(uuid, integer, integer, integer, integer) TO service_role;

-- The refund gives back exactly the bucket the reservation named: the trial
-- pool when `p_trial`, else the month `p_month`. With neither it decides as it
-- used to (the bucket that is current now).
DROP FUNCTION IF EXISTS public.waves_voice_agent_refund(uuid);

CREATE OR REPLACE FUNCTION public.waves_voice_agent_refund(p_profile uuid, p_month text DEFAULT NULL, p_trial boolean DEFAULT NULL) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_count integer;
  v_trial boolean := COALESCE(p_trial, public.waves_voice_trial_until(p_profile) IS NOT NULL);
BEGIN
  IF v_trial THEN
    UPDATE public.pro_trials
       SET voice_used = GREATEST(0, voice_used - 1)
     WHERE profile_id = p_profile
    RETURNING voice_used INTO v_count;
    RETURN COALESCE(v_count, 0);
  END IF;
  UPDATE public.voice_agent_usage
     SET count = GREATEST(0, count - 1), updated_at = now()
   WHERE profile_id = p_profile
     AND month = COALESCE(p_month, to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM'))
  RETURNING count INTO v_count;
  RETURN COALESCE(v_count, 0);
END
$$;

REVOKE ALL ON FUNCTION public.waves_voice_agent_refund(uuid, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.waves_voice_agent_refund(uuid, text, boolean) TO service_role;

-- A stream's seconds reservation: one row per mint, settled exactly once
-- against the month it was taken in (a stream admitted before UTC midnight on
-- the last day and closed after it settles the old month, not the new one).
CREATE TABLE IF NOT EXISTS public.voice_stream_reservations (
  id         uuid DEFAULT gen_random_uuid() NOT NULL,
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON UPDATE CASCADE ON DELETE CASCADE,
  month      text NOT NULL,
  seconds    numeric(10, 2) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  settled_at timestamptz,
  CONSTRAINT voice_stream_reservations_pkey PRIMARY KEY (id),
  CONSTRAINT voice_stream_reservations_month_shape CHECK (month ~ '^[0-9]{4}-[0-9]{2}$'),
  CONSTRAINT voice_stream_reservations_seconds_nonneg CHECK (seconds >= 0)
);
CREATE INDEX IF NOT EXISTS voice_stream_reservations_open_idx
  ON public.voice_stream_reservations (profile_id, created_at) WHERE settled_at IS NULL;

ALTER TABLE public.voice_stream_reservations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.voice_stream_reservations FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.voice_stream_reservations TO service_role;

-- Settles one reservation against its own month, exactly once: the reserved
-- seconds come off and the measured seconds go on. A second call is a no-op.
CREATE OR REPLACE FUNCTION public.waves_voice_stream_settle(p_reservation uuid, p_seconds numeric) RETURNS numeric
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  r         public.voice_stream_reservations%ROWTYPE;
  v_seconds numeric := round(least(greatest(COALESCE(p_seconds, 0), 0), 30), 2);
  v_total   numeric;
BEGIN
  IF p_reservation IS NULL THEN RETURN NULL; END IF;
  SELECT profile_id INTO r.profile_id FROM public.voice_stream_reservations WHERE id = p_reservation;
  IF NOT FOUND THEN RETURN NULL; END IF;
  PERFORM public.waves_profile_lock(r.profile_id);
  UPDATE public.voice_stream_reservations
     SET settled_at = now()
   WHERE id = p_reservation AND settled_at IS NULL
  RETURNING * INTO r;
  IF NOT FOUND THEN RETURN NULL; END IF;

  INSERT INTO public.voice_agent_usage AS u (profile_id, month, count, stream_seconds, updated_at)
  VALUES (r.profile_id, r.month, 0, v_seconds, now())
  ON CONFLICT (profile_id, month) DO UPDATE
    SET stream_seconds = GREATEST(0, u.stream_seconds - r.seconds + v_seconds), updated_at = now()
  RETURNING u.stream_seconds INTO v_total;
  RETURN v_total;
END
$$;

REVOKE ALL ON FUNCTION public.waves_voice_stream_settle(uuid, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.waves_voice_stream_settle(uuid, numeric) TO service_role;

-- waves_voice_stream_mint from 20261016120000_two_tiers_free_and_pro: grace is
-- paid, and a mint RESERVES p_reserve_seconds (the relay's 20 s cap) against a
-- seconds budget in the same atomic UPDATE as the mint count, so the minutes
-- Deepgram bills are bounded by the server whatever the stream count. The
-- answer carries `reservation` (and `month`); the relay settles it on close.
-- A reservation left open (a relay that died) is released after ten minutes,
-- well past the relay's 25 s wall clock.
DROP FUNCTION IF EXISTS public.waves_voice_stream_mint(uuid, integer, integer, integer, integer);

CREATE OR REPLACE FUNCTION public.waves_voice_stream_mint(
  p_profile uuid,
  p_free_budget integer DEFAULT 30,
  p_pro_budget integer DEFAULT 300,
  p_plus_budget integer DEFAULT 300,
  p_trial_budget integer DEFAULT 60,
  p_seconds_budget integer DEFAULT NULL,
  p_reserve_seconds integer DEFAULT 20
) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_month   text := to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM');
  v_tier    text;
  v_budget  integer;
  v_mints   integer;
  v_seconds numeric;
  v_reserve numeric := LEAST(GREATEST(COALESCE(p_reserve_seconds, 20), 0), 30);
  v_cap     numeric;
  v_trial   boolean;
  v_stale   uuid;
  v_id      uuid;
BEGIN
  IF p_profile IS NULL THEN
    RAISE EXCEPTION 'waves_voice_stream_mint needs a profile';
  END IF;
  PERFORM public.waves_usage_guard(p_profile);
  v_trial := public.waves_voice_trial_until(p_profile) IS NOT NULL;

  -- Reservations a dead relay never settled: release them (0 s streamed).
  FOR v_stale IN
    SELECT id FROM public.voice_stream_reservations
     WHERE profile_id = p_profile AND settled_at IS NULL AND created_at < now() - interval '10 minutes'
  LOOP
    PERFORM public.waves_voice_stream_settle(v_stale, 0);
  END LOOP;

  IF v_trial THEN
    v_tier := CASE WHEN public.waves_pro_trial_active(p_profile) IS NOT NULL THEN 'pro' ELSE 'free' END;
    v_budget := p_trial_budget;
  ELSE
    SELECT CASE WHEN count(*) = 0 THEN 'free' ELSE 'pro' END
      INTO v_tier
      FROM public.subscriptions s
     WHERE s.profile_id = p_profile
       AND s.status IN ('active', 'grace')
       AND s.store <> 'trial'
       AND (s.current_period_end IS NULL OR s.current_period_end > now())
       AND s.tier IN ('plus', 'pro');
    IF v_tier = 'free' THEN
      RETURN jsonb_build_object(
        'mints', 0, 'budget', 0, 'tier', 'free', 'trial', false, 'allowed', false, 'reason', 'free_tier'
      );
    END IF;
    v_budget := p_pro_budget;
  END IF;
  v_cap := COALESCE(p_seconds_budget, v_budget * 20);

  -- One atomic step: the mint and its seconds, or neither.
  INSERT INTO public.voice_agent_usage AS u (profile_id, month, count, stream_mints, stream_seconds, updated_at)
  SELECT p_profile, v_month, 0, 1, v_reserve, now()
   WHERE v_budget >= 1 AND v_reserve <= v_cap
  ON CONFLICT (profile_id, month) DO UPDATE
    SET stream_mints = u.stream_mints + 1,
        stream_seconds = u.stream_seconds + v_reserve,
        updated_at = now()
    WHERE u.stream_mints < v_budget AND u.stream_seconds + v_reserve <= v_cap
  RETURNING u.stream_mints, u.stream_seconds INTO v_mints, v_seconds;

  IF v_mints IS NOT NULL THEN
    INSERT INTO public.voice_stream_reservations (profile_id, month, seconds)
    VALUES (p_profile, v_month, v_reserve)
    RETURNING id INTO v_id;
    RETURN jsonb_build_object(
      'mints', v_mints, 'budget', v_budget, 'tier', v_tier, 'trial', v_trial, 'allowed', true,
      'reserved_seconds', v_reserve, 'seconds', v_seconds, 'reservation', v_id, 'month', v_month
    );
  END IF;

  SELECT stream_mints, stream_seconds INTO v_mints, v_seconds
    FROM public.voice_agent_usage WHERE profile_id = p_profile AND month = v_month;
  RETURN jsonb_build_object(
    'mints', COALESCE(v_mints, 0), 'budget', v_budget, 'tier', v_tier, 'trial', v_trial, 'allowed', false,
    'reason', CASE WHEN COALESCE(v_mints, 0) >= v_budget THEN 'mint_budget' ELSE 'seconds_budget' END,
    'seconds', COALESCE(v_seconds, 0)
  );
END
$$;

REVOKE ALL ON FUNCTION public.waves_voice_stream_mint(uuid, integer, integer, integer, integer, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.waves_voice_stream_mint(uuid, integer, integer, integer, integer, integer, integer) TO service_role;

-- waves_voice_stream_seconds from 20261008090000, the signature the relay
-- deployed BEFORE this change calls (profile, seconds). Kept so a rollout where
-- the migration lands before the relay does not over-count: an old relay's
-- settle is applied to this profile's oldest open reservation (released and
-- replaced by the measured seconds); with no open reservation it adds the
-- seconds to the current month as it always did. The new relay calls
-- waves_voice_stream_settle with its reservation id.
CREATE OR REPLACE FUNCTION public.waves_voice_stream_seconds(
  p_profile uuid,
  p_seconds numeric
) RETURNS numeric
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_month   text := to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM');
  v_seconds numeric := round(least(greatest(COALESCE(p_seconds, 0), 0), 30), 2);
  v_open    uuid;
  v_total   numeric;
BEGIN
  IF p_profile IS NULL THEN
    RAISE EXCEPTION 'waves_voice_stream_seconds needs a profile';
  END IF;
  PERFORM public.waves_profile_lock(p_profile);

  SELECT id INTO v_open FROM public.voice_stream_reservations
   WHERE profile_id = p_profile AND settled_at IS NULL
   ORDER BY created_at ASC LIMIT 1;
  IF v_open IS NOT NULL THEN
    RETURN public.waves_voice_stream_settle(v_open, v_seconds);
  END IF;

  INSERT INTO public.voice_agent_usage AS u (profile_id, month, count, stream_seconds, updated_at)
  VALUES (p_profile, v_month, 0, v_seconds, now())
  ON CONFLICT (profile_id, month) DO UPDATE
    SET stream_seconds = u.stream_seconds + v_seconds, updated_at = now()
  RETURNING u.stream_seconds INTO v_total;
  RETURN v_total;
END
$$;

REVOKE ALL ON FUNCTION public.waves_voice_stream_seconds(uuid, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.waves_voice_stream_seconds(uuid, numeric) TO service_role;

-- 3. Follow-ups need a slot -----------------------------------------------------------

-- Opened by the edge function after a metered command produced an action the
-- app will save. Consumed by waves_voice_agent_followup, newest first.
CREATE TABLE IF NOT EXISTS public.voice_agent_followup_slots (
  id         uuid DEFAULT gen_random_uuid() NOT NULL,
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON UPDATE CASCADE ON DELETE CASCADE,
  turns_left integer NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT voice_agent_followup_slots_pkey PRIMARY KEY (id),
  CONSTRAINT voice_agent_followup_slots_turns_nonneg CHECK (turns_left >= 0)
);
CREATE INDEX IF NOT EXISTS voice_agent_followup_slots_profile_idx
  ON public.voice_agent_followup_slots (profile_id, expires_at);

ALTER TABLE public.voice_agent_followup_slots ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.voice_agent_followup_slots FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.voice_agent_followup_slots TO service_role;

CREATE OR REPLACE FUNCTION public.waves_voice_agent_followup_open(
  p_profile uuid,
  p_turns integer DEFAULT 3,
  p_window_seconds integer DEFAULT 600
) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_id uuid;
BEGIN
  IF p_profile IS NULL THEN
    RAISE EXCEPTION 'waves_voice_agent_followup_open needs a profile';
  END IF;
  PERFORM public.waves_usage_guard(p_profile);
  DELETE FROM public.voice_agent_followup_slots d
   WHERE d.profile_id = p_profile AND d.expires_at < now() - interval '1 day';
  INSERT INTO public.voice_agent_followup_slots (profile_id, turns_left, expires_at)
  VALUES (p_profile, GREATEST(0, LEAST(COALESCE(p_turns, 3), 10)),
          now() + make_interval(secs => LEAST(GREATEST(COALESCE(p_window_seconds, 600), 1), 3600)))
  RETURNING id INTO v_id;
  RETURN v_id;
END
$$;

REVOKE ALL ON FUNCTION public.waves_voice_agent_followup_open(uuid, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.waves_voice_agent_followup_open(uuid, integer, integer) TO service_role;

-- waves_voice_agent_followup from 20261021120000_voice_agent_followup_meter:
-- grace is paid; a turn first takes one from an open slot (reason 'no_slot'
-- when there is none), then the per-expense window, then the month.
CREATE OR REPLACE FUNCTION public.waves_voice_agent_followup(
  p_profile uuid,
  p_expense_id text,
  p_month_limit integer DEFAULT 300,
  p_expense_limit integer DEFAULT 3,
  p_window_seconds integer DEFAULT 600
) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_month text := to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM');
  v_tier  text;
  v_used  integer;
  v_turns integer;
  v_slot  uuid;
BEGIN
  IF p_profile IS NULL OR p_expense_id IS NULL OR char_length(p_expense_id) NOT BETWEEN 1 AND 64 THEN
    RAISE EXCEPTION 'waves_voice_agent_followup needs a profile and an expense id';
  END IF;
  PERFORM public.waves_usage_guard(p_profile);

  IF public.waves_pro_trial_active(p_profile) IS NOT NULL THEN
    v_tier := 'pro';
  ELSE
    SELECT CASE WHEN count(*) = 0 THEN 'free' ELSE 'pro' END
      INTO v_tier
      FROM public.subscriptions s
     WHERE s.profile_id = p_profile
       AND s.status IN ('active', 'grace')
       AND s.store <> 'trial'
       AND (s.current_period_end IS NULL OR s.current_period_end > now())
       AND s.tier IN ('plus', 'pro');
  END IF;
  IF v_tier = 'free' THEN
    RETURN jsonb_build_object(
      'used', 0, 'limit', 0, 'tier', 'free', 'allowed', false, 'reason', 'free_tier'
    );
  END IF;

  -- A slot: proof that a metered command preceded this turn. Locked so two
  -- concurrent turns cannot both take the last one.
  UPDATE public.voice_agent_followup_slots s
     SET turns_left = s.turns_left - 1
   WHERE s.id = (
     SELECT o.id FROM public.voice_agent_followup_slots o
      WHERE o.profile_id = p_profile AND o.turns_left > 0 AND o.expires_at > now()
      ORDER BY o.created_at DESC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
   )
  RETURNING s.id INTO v_slot;
  IF v_slot IS NULL THEN
    SELECT COALESCE(sum(f.followups), 0)::integer INTO v_used
      FROM public.voice_agent_usage f WHERE f.profile_id = p_profile AND f.month = v_month;
    RETURN jsonb_build_object(
      'used', COALESCE(v_used, 0), 'limit', p_month_limit, 'tier', v_tier,
      'allowed', false, 'reason', 'no_slot'
    );
  END IF;

  INSERT INTO public.voice_agent_followup_turns AS t (profile_id, expense_id, window_start, turns)
  VALUES (p_profile, p_expense_id, now(), 1)
  ON CONFLICT (profile_id, expense_id) DO UPDATE
    SET window_start = CASE
          WHEN t.window_start <= now() - make_interval(secs => p_window_seconds) THEN now()
          ELSE t.window_start END,
        turns = CASE
          WHEN t.window_start <= now() - make_interval(secs => p_window_seconds) THEN 1
          ELSE t.turns + 1 END
    WHERE t.window_start <= now() - make_interval(secs => p_window_seconds)
       OR t.turns < p_expense_limit
  RETURNING t.turns INTO v_turns;

  IF v_turns IS NULL THEN
    UPDATE public.voice_agent_followup_slots SET turns_left = turns_left + 1 WHERE id = v_slot;
    SELECT COALESCE(sum(f.followups), 0)::integer INTO v_used
      FROM public.voice_agent_usage f WHERE f.profile_id = p_profile AND f.month = v_month;
    RETURN jsonb_build_object(
      'used', COALESCE(v_used, 0), 'limit', p_month_limit, 'tier', v_tier,
      'allowed', false, 'reason', 'expense_cap'
    );
  END IF;

  INSERT INTO public.voice_agent_usage AS u (profile_id, month, count, followups, updated_at)
  SELECT p_profile, v_month, 0, 1, now()
   WHERE p_month_limit >= 1
  ON CONFLICT (profile_id, month) DO UPDATE
    SET followups = u.followups + 1, updated_at = now()
    WHERE u.followups < p_month_limit
  RETURNING u.followups INTO v_used;

  IF v_used IS NULL THEN
    UPDATE public.voice_agent_followup_slots SET turns_left = turns_left + 1 WHERE id = v_slot;
    UPDATE public.voice_agent_followup_turns t
       SET turns = GREATEST(t.turns - 1, 0)
     WHERE t.profile_id = p_profile AND t.expense_id = p_expense_id;
    SELECT f.followups INTO v_used
      FROM public.voice_agent_usage f WHERE f.profile_id = p_profile AND f.month = v_month;
    RETURN jsonb_build_object(
      'used', COALESCE(v_used, 0), 'limit', p_month_limit, 'tier', v_tier,
      'allowed', false, 'reason', 'month_cap'
    );
  END IF;

  DELETE FROM public.voice_agent_followup_turns d
   WHERE d.profile_id = p_profile
     AND d.window_start < now() - interval '1 day';

  RETURN jsonb_build_object(
    'used', v_used, 'limit', p_month_limit, 'tier', v_tier, 'allowed', true, 'month', v_month
  );
END
$$;

REVOKE ALL ON FUNCTION public.waves_voice_agent_followup(uuid, text, integer, integer, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.waves_voice_agent_followup(uuid, text, integer, integer, integer)
  TO service_role;

-- 4. One statement import, a bounded number of requests ---------------------------------

CREATE TABLE IF NOT EXISTS public.statement_import_sessions (
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON UPDATE CASCADE ON DELETE CASCADE,
  import_id  text NOT NULL,
  chunks     integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (profile_id, import_id),
  CONSTRAINT statement_import_sessions_id_shape CHECK (import_id ~ '^[A-Za-z0-9_-]{8,64}$'),
  CONSTRAINT statement_import_sessions_chunks_nonneg CHECK (chunks >= 0)
);

ALTER TABLE public.statement_import_sessions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.statement_import_sessions FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.statement_import_sessions TO service_role;

-- Counts one request of this import, atomically, up to p_max_chunks.
CREATE OR REPLACE FUNCTION public.waves_statement_import_chunk(
  p_profile uuid,
  p_import_id text,
  p_max_chunks integer
) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_chunks integer;
BEGIN
  IF p_profile IS NULL OR p_import_id IS NULL THEN
    RAISE EXCEPTION 'waves_statement_import_chunk needs a profile and an import id';
  END IF;
  PERFORM public.waves_usage_guard(p_profile);
  DELETE FROM public.statement_import_sessions d
   WHERE d.profile_id = p_profile AND d.updated_at < now() - interval '2 days';

  INSERT INTO public.statement_import_sessions AS s (profile_id, import_id, chunks, updated_at)
  SELECT p_profile, p_import_id, 1, now()
   WHERE p_max_chunks >= 1
  ON CONFLICT (profile_id, import_id) DO UPDATE
    SET chunks = s.chunks + 1, updated_at = now()
    WHERE s.chunks < p_max_chunks
  RETURNING s.chunks INTO v_chunks;

  IF v_chunks IS NOT NULL THEN
    RETURN jsonb_build_object('chunks', v_chunks, 'limit', p_max_chunks, 'allowed', true);
  END IF;
  SELECT chunks INTO v_chunks FROM public.statement_import_sessions
   WHERE profile_id = p_profile AND import_id = p_import_id;
  RETURN jsonb_build_object('chunks', COALESCE(v_chunks, 0), 'limit', p_max_chunks, 'allowed', false);
END
$$;

REVOKE ALL ON FUNCTION public.waves_statement_import_chunk(uuid, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.waves_statement_import_chunk(uuid, text, integer) TO service_role;

-- 5. SSV transaction ledger --------------------------------------------------------------

-- Every transaction id a verified callback ever carried, with what happened to
-- it. No FK to profiles: a replay after "delete and sign up again" finds it.
CREATE TABLE IF NOT EXISTS public.ad_ssv_transactions (
  transaction_id text NOT NULL,
  profile_id     uuid,
  kind           text,
  ad_unit        text,
  outcome        text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ad_ssv_transactions_pkey PRIMARY KEY (transaction_id)
);
CREATE INDEX IF NOT EXISTS ad_ssv_transactions_profile_idx ON public.ad_ssv_transactions (profile_id, created_at);

ALTER TABLE public.ad_ssv_transactions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.ad_ssv_transactions FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.ad_ssv_transactions TO service_role;

-- Transaction ids rewarded before this ledger existed.
INSERT INTO public.ad_ssv_transactions (transaction_id, profile_id, kind, ad_unit, outcome, created_at)
SELECT r.transaction_id, r.profile_id, r.kind, r.ad_unit, 'granted', r.created_at
  FROM public.ad_rewards r
ON CONFLICT (transaction_id) DO NOTHING;

-- waves_ads_grant from 20261016090000_rewarded_ads: the ledger is written
-- first, so a transaction id is terminal on its first sight whatever the
-- outcome, and survives the profile.
CREATE OR REPLACE FUNCTION public.waves_ads_grant(
  p_profile uuid,
  p_kind text,
  p_transaction_id text,
  p_ad_unit text
) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_set    public.ad_reward_settings%ROWTYPE;
  v_elig   jsonb;
  v_amount integer;
  v_rows   integer;
  v_outcome text;
BEGIN
  IF p_profile IS NULL OR p_kind NOT IN ('voice', 'scan')
     OR COALESCE(btrim(p_transaction_id), '') = '' OR COALESCE(btrim(p_ad_unit), '') = '' THEN
    RETURN jsonb_build_object('outcome', 'invalid');
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('ads_grant:' || p_profile::text, 0));

  -- First sight of this transaction id wins; anything after is a replay.
  INSERT INTO public.ad_ssv_transactions (transaction_id, profile_id, kind, ad_unit, outcome)
  VALUES (p_transaction_id, p_profile, p_kind, p_ad_unit, 'pending')
  ON CONFLICT (transaction_id) DO NOTHING;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 OR EXISTS (SELECT 1 FROM public.ad_rewards WHERE transaction_id = p_transaction_id) THEN
    RETURN jsonb_build_object('outcome', 'duplicate');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_profile) THEN
    UPDATE public.ad_ssv_transactions SET outcome = 'ineligible:unknown_profile' WHERE transaction_id = p_transaction_id;
    RETURN jsonb_build_object('outcome', 'ineligible', 'reason', 'unknown_profile');
  END IF;
  PERFORM public.waves_usage_guard(p_profile);

  v_elig := public.waves_ads_eligibility(p_profile);
  IF NOT (v_elig ->> 'eligible')::boolean THEN
    v_outcome := CASE WHEN v_elig ->> 'reason' = 'capped' THEN 'capped' ELSE 'ineligible' END;
    UPDATE public.ad_ssv_transactions
       SET outcome = v_outcome || ':' || COALESCE(v_elig ->> 'reason', '')
     WHERE transaction_id = p_transaction_id;
    RETURN jsonb_build_object('outcome', v_outcome, 'reason', v_elig ->> 'reason');
  END IF;

  SELECT * INTO v_set FROM public.ad_reward_settings WHERE id;
  v_amount := CASE p_kind WHEN 'voice' THEN v_set.voice_per_ad ELSE v_set.scans_per_ad END;
  IF v_amount <= 0 THEN
    UPDATE public.ad_ssv_transactions SET outcome = 'ineligible:disabled' WHERE transaction_id = p_transaction_id;
    RETURN jsonb_build_object('outcome', 'ineligible', 'reason', 'disabled');
  END IF;

  INSERT INTO public.ad_rewards (profile_id, kind, amount, transaction_id, ad_unit)
  VALUES (p_profile, p_kind, v_amount, p_transaction_id, p_ad_unit)
  ON CONFLICT (transaction_id) DO NOTHING;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN
    RETURN jsonb_build_object('outcome', 'duplicate');
  END IF;
  UPDATE public.ad_ssv_transactions SET outcome = 'granted' WHERE transaction_id = p_transaction_id;

  RETURN jsonb_build_object(
    'outcome', 'granted',
    'kind', p_kind,
    'amount', v_amount,
    'usedToday', (v_elig ->> 'usedToday')::integer + 1,
    'dailyCap', v_set.daily_cap
  );
END
$$;

REVOKE ALL ON FUNCTION public.waves_ads_grant(uuid, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.waves_ads_grant(uuid, text, text, text) TO service_role;

-- 6. RevenueCat: a TRANSFER is ordered like every other event ----------------------------
-- waves_revenuecat_apply from 20261015220000_pro_trial; the transfer moves only
-- rows whose last store event is not newer than this one.
CREATE OR REPLACE FUNCTION public.waves_revenuecat_apply(
  p_event_id    text,
  p_type        text,
  p_app_user_id text,
  p_event_at    timestamptz,
  p_action      jsonb
) RETURNS text
    LANGUAGE plpgsql
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_uuid_re constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
  v_kind    text := COALESCE(p_action ->> 'kind', 'ignore');
  v_profile uuid;
  v_from    uuid[];
  v_rows    integer;
  v_outcome text;
BEGIN
  IF p_event_id IS NULL OR length(p_event_id) = 0 THEN
    RAISE EXCEPTION 'waves_revenuecat_apply needs an event id';
  END IF;

  INSERT INTO public.revenuecat_events (id, type, app_user_id, event_at)
  VALUES (p_event_id, p_type, p_app_user_id, p_event_at)
  ON CONFLICT (id) DO NOTHING;
  IF NOT FOUND THEN
    RETURN 'duplicate';
  END IF;

  IF v_kind = 'upsert' THEN
    IF p_app_user_id IS NULL OR p_app_user_id !~ v_uuid_re THEN
      v_outcome := 'unknown_profile';
    ELSE
      SELECT id INTO v_profile FROM public.profiles WHERE id = p_app_user_id::uuid;
      IF NOT FOUND THEN
        v_outcome := 'unknown_profile';
      END IF;
    END IF;

    IF v_outcome IS NULL THEN
      INSERT INTO public.subscriptions AS s (
        profile_id, tier, period, status, current_period_end, store, store_txn_id,
        price_minor, currency, country_code, store_event_at, updated_at
      ) VALUES (
        v_profile,
        p_action ->> 'tier',
        p_action ->> 'period',
        p_action ->> 'status',
        (p_action ->> 'current_period_end')::timestamptz,
        p_action ->> 'store',
        p_action ->> 'store_txn_id',
        (p_action ->> 'price_minor')::bigint,
        p_action ->> 'currency',
        p_action ->> 'country_code',
        p_event_at,
        now()
      )
      ON CONFLICT (store_txn_id) DO UPDATE SET
        profile_id         = EXCLUDED.profile_id,
        tier               = EXCLUDED.tier,
        period             = EXCLUDED.period,
        status             = EXCLUDED.status,
        current_period_end = EXCLUDED.current_period_end,
        store              = EXCLUDED.store,
        price_minor        = COALESCE(EXCLUDED.price_minor, s.price_minor),
        currency           = COALESCE(EXCLUDED.currency, s.currency),
        country_code       = COALESCE(EXCLUDED.country_code, s.country_code),
        store_event_at     = EXCLUDED.store_event_at,
        updated_at         = now()
      WHERE s.store_event_at IS NULL
         OR EXCLUDED.store_event_at IS NULL
         OR s.store_event_at <= EXCLUDED.store_event_at;
      GET DIAGNOSTICS v_rows = ROW_COUNT;
      v_outcome := CASE WHEN v_rows = 0 THEN 'stale' ELSE 'applied' END;
    END IF;

  ELSIF v_kind = 'transfer' THEN
    IF COALESCE(p_action ->> 'to', '') !~ v_uuid_re THEN
      v_outcome := 'unknown_profile';
    ELSE
      SELECT id INTO v_profile FROM public.profiles WHERE id = (p_action ->> 'to')::uuid;
      IF NOT FOUND THEN
        v_outcome := 'unknown_profile';
      ELSE
        SELECT COALESCE(array_agg(f::uuid), '{}')
          INTO v_from
          FROM jsonb_array_elements_text(COALESCE(p_action -> 'from', '[]'::jsonb)) AS f
         WHERE f ~ v_uuid_re;
        -- Store purchases only, and only rows this event is newer than.
        UPDATE public.subscriptions
           SET profile_id = v_profile, store_event_at = p_event_at, updated_at = now()
         WHERE profile_id = ANY (v_from)
           AND profile_id <> v_profile
           AND store NOT IN ('promo', 'trial')
           AND (store_event_at IS NULL OR p_event_at IS NULL OR store_event_at <= p_event_at);
        GET DIAGNOSTICS v_rows = ROW_COUNT;
        v_outcome := CASE WHEN v_rows = 0 AND EXISTS (
          SELECT 1 FROM public.subscriptions
           WHERE profile_id = ANY (v_from) AND profile_id <> v_profile AND store NOT IN ('promo', 'trial')
        ) THEN 'stale' ELSE 'applied' END;
      END IF;
    END IF;

  ELSE
    v_outcome := 'ignored';
  END IF;

  UPDATE public.revenuecat_events SET outcome = v_outcome WHERE id = p_event_id;
  RETURN v_outcome;
END
$$;

REVOKE ALL ON FUNCTION public.waves_revenuecat_apply(text, text, text, timestamptz, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.waves_revenuecat_apply(text, text, text, timestamptz, jsonb) TO service_role;
