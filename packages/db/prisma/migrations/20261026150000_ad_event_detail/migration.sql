-- Why an ad failed (SDK error code/message), so failures can be diagnosed from admin.
ALTER TABLE public.ad_events ADD COLUMN IF NOT EXISTS detail text;
ALTER TABLE public.ad_events DROP CONSTRAINT IF EXISTS ad_events_detail_len;
ALTER TABLE public.ad_events ADD CONSTRAINT ad_events_detail_len CHECK (detail IS NULL OR length(detail) <= 200);

DROP FUNCTION IF EXISTS public.waves_log_ad_event(text,text,uuid,timestamptz,uuid);
CREATE OR REPLACE FUNCTION public.waves_log_ad_event(p_placement text, p_outcome text, p_event_id uuid DEFAULT gen_random_uuid(),
 p_occurred_at timestamptz DEFAULT now(), p_profile uuid DEFAULT NULL, p_detail text DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
DECLARE v_profile uuid := public.waves_current_profile_id();
BEGIN
  IF v_profile IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  IF p_profile IS NOT NULL AND p_profile <> v_profile THEN RAISE EXCEPTION 'Wrong account'; END IF;
  IF p_occurred_at > now() + interval '5 minutes' THEN
    RAISE EXCEPTION 'Invalid event time';
  END IF;
  INSERT INTO public.ad_events(id, profile_id, placement, outcome, created_at, detail)
    VALUES (p_event_id, v_profile, p_placement, p_outcome, p_occurred_at, left(p_detail, 200))
    ON CONFLICT (id) DO NOTHING;
END $$;
REVOKE ALL ON FUNCTION public.waves_log_ad_event(text,text,uuid,timestamptz,uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.waves_log_ad_event(text,text,uuid,timestamptz,uuid,text) TO authenticated;
