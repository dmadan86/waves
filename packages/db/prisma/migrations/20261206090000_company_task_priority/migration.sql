-- Company tasks get an explicit priority (normal / urgent / very_urgent) instead of painting late dates red.
ALTER TABLE public.company_work_tasks ADD COLUMN priority text NOT NULL DEFAULT 'normal' CHECK (priority IN ('normal','urgent','very_urgent'));

-- Its own writer: the task writer's overloads stay untouched, so every older client and edge function keeps working.
-- Only the owner or the person's manager changes it; anyone else (an employee updating status) is a silent no-op.
CREATE FUNCTION public.waves_company_work_priority_set(p_group_id uuid,p_task_id uuid,p_priority text) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
BEGIN
 PERFORM public.waves_company_actor(p_group_id);
 IF p_priority IS NULL OR p_priority NOT IN ('normal','urgent','very_urgent') THEN RAISE EXCEPTION 'INVALID_DATA: priority'; END IF;
 UPDATE public.company_work_tasks SET priority=p_priority,updated_at=now()
  WHERE id=p_task_id AND group_id=p_group_id AND deleted_at IS NULL AND priority IS DISTINCT FROM p_priority
   AND (public.is_group_admin(p_group_id) OR public.waves_company_team(p_group_id,member_id));
END $$;

REVOKE ALL ON FUNCTION public.waves_company_work_priority_set(uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.waves_company_work_priority_set(uuid,uuid,text) TO authenticated,service_role;
