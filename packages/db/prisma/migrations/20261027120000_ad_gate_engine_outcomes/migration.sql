-- Track offline allowances, owed prompts and ad blockers without stalling telemetry.
ALTER TABLE public.ad_events DROP CONSTRAINT IF EXISTS ad_events_outcome_check;
ALTER TABLE public.ad_events ADD CONSTRAINT ad_events_outcome_check CHECK (outcome IN ('shown','completed','skipped','failed','blocked_grace','offline_allowed','owed_offered','owed_declined','blocked_adblock'));

DROP FUNCTION IF EXISTS public.waves_admin_ad_events(integer);
CREATE OR REPLACE FUNCTION public.waves_admin_ad_events(p_days integer DEFAULT 30)
RETURNS TABLE(day date, placement text, shown bigint, completed bigint, skipped bigint, failed bigint, blocked_grace bigint, offline_allowed bigint, owed_offered bigint, owed_declined bigint, blocked_adblock bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
 SELECT (created_at AT TIME ZONE 'UTC')::date, placement,
 count(*) FILTER (WHERE outcome='shown'), count(*) FILTER (WHERE outcome='completed'),
 count(*) FILTER (WHERE outcome='skipped'), count(*) FILTER (WHERE outcome='failed'),
 count(*) FILTER (WHERE outcome='blocked_grace'),
 count(*) FILTER (WHERE outcome='offline_allowed'), count(*) FILTER (WHERE outcome='owed_offered'),
 count(*) FILTER (WHERE outcome='owed_declined'), count(*) FILTER (WHERE outcome='blocked_adblock')
 FROM public.ad_events WHERE created_at >= now() - make_interval(days => LEAST(GREATEST(p_days,1),365))
 GROUP BY 1,2 ORDER BY 1 DESC,2;
$$;
REVOKE ALL ON FUNCTION public.waves_admin_ad_events(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.waves_admin_ad_events(integer) TO service_role;
