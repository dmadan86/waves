-- Waves Assistant telemetry: ten new event names and the enum-word props they
-- carry.
--
-- A. `app_events_name_known` also allows the ten `assistant_*` events from
--    spec section 3.7. The table is otherwise untouched.
--
-- B. `waves_track_event` keeps the new prop keys `kind` (follow-up kind),
--    `outcome`, `path`, `scope`, `how`, `field` and `what`, each a short
--    lowercase [a-z0-9_-] word like every other prop. `source` was already kept.
--    The body is otherwise identical to 20261015200000_campaign_attribution:
--    only the event list and the prop filter changed; the flood guards are
--    untouched. Nothing the person typed or said can reach this table.

ALTER TABLE public.app_events DROP CONSTRAINT app_events_name_known;
ALTER TABLE public.app_events ADD CONSTRAINT app_events_name_known CHECK (name = ANY (ARRAY[
  'app_installed'::text, 'signup_started'::text, 'onboarding_completed'::text, 'premium_viewed'::text,
  'assistant_opened'::text, 'assistant_command'::text, 'assistant_followup_shown'::text,
  'assistant_followup_answered'::text, 'assistant_followup_skipped'::text,
  'assistant_followup_muted'::text, 'assistant_correction'::text, 'assistant_undo'::text,
  'assistant_question_answered'::text, 'assistant_teaser_viewed'::text
]));

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
       'app_installed', 'signup_started', 'onboarding_completed', 'premium_viewed',
       'assistant_opened', 'assistant_command', 'assistant_followup_shown',
       'assistant_followup_answered', 'assistant_followup_skipped', 'assistant_followup_muted',
       'assistant_correction', 'assistant_undo', 'assistant_question_answered',
       'assistant_teaser_viewed'
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
         (e.key IN ('method', 'screen', 'variant', 'kind', 'outcome', 'path', 'scope', 'how', 'field', 'what')
           AND (e.value #>> '{}') ~ '^[a-z0-9_-]{1,32}$')
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
