-- Overview "Active today": which of the caller's visible employees opened Waves since the start of their day.
-- Counts and member ids only: no device, platform, label or timestamp ever leaves this function.
-- Owner sees every live employee; a manager only their own team. Anyone else is refused.
CREATE OR REPLACE FUNCTION public.waves_company_active_today(p_group_id uuid, p_tz_offset_minutes int) RETURNS jsonb
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
DECLARE v_me uuid; v_role text; v_total int; v_ids uuid[]; v_since timestamptz;
BEGIN
 v_me:=public.waves_company_actor(p_group_id);
 SELECT role::text INTO v_role FROM public.group_members WHERE id=v_me;
 IF v_role NOT IN ('admin','manager') THEN RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE='insufficient_privilege'; END IF;
 -- Only the start of the caller's local day is ever compared, so repeated calls cannot probe an exact last-seen time.
 IF p_tz_offset_minutes IS NULL OR p_tz_offset_minutes NOT BETWEEN -840 AND 840 THEN RAISE EXCEPTION 'INVALID_DATA: tz'; END IF;
 v_since:=date_trunc('day', now()+make_interval(mins=>p_tz_offset_minutes)) - make_interval(mins=>p_tz_offset_minutes);
 -- Live employees only: someone marked not employed has left_at/removed_at set and is skipped.
 SELECT count(*), coalesce(array_agg(m.id) FILTER (WHERE EXISTS(
   SELECT 1 FROM public.device_sessions d WHERE d.profile_id=m.profile_id AND d.revoked_at IS NULL AND d.last_seen_at>=v_since)), '{}')
  INTO v_total, v_ids
 FROM public.group_members m
 WHERE m.group_id=p_group_id AND m.role::text='member' AND m.profile_id IS NOT NULL
  AND m.left_at IS NULL AND m.removed_at IS NULL AND m.merged_into_member_id IS NULL
  AND (v_role='admin' OR m.manager_id=v_me);
 RETURN jsonb_build_object('total',v_total,'active',coalesce(array_length(v_ids,1),0),'activeMemberIds',to_jsonb(v_ids));
END $$;
REVOKE ALL ON FUNCTION public.waves_company_active_today(uuid,int) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.waves_company_active_today(uuid,int) TO authenticated,service_role;
