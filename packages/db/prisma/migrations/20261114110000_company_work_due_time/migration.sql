-- Daily Work: optional time of day on a task. The "tag" pill reuses the task's existing site (project_id).
ALTER TABLE public.company_work_tasks ADD COLUMN due_time time;

-- The 9-argument signature stays as a thin wrapper so an edge function not yet redeployed keeps working.
DROP FUNCTION public.waves_company_work_set(uuid,uuid,uuid,date,text,uuid,text,text,text);

CREATE FUNCTION public.waves_company_work_set(p_group_id uuid,p_task_id uuid,p_member_id uuid,p_day date,p_title text,p_project_id uuid,p_status text,p_blocked_reason text,p_note text,p_due_time time) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
DECLARE v_me uuid; r public.company_work_tasks; v_boss boolean;
 v_title text:=btrim(coalesce(p_title,'')); v_reason text:=nullif(btrim(coalesce(p_blocked_reason,'')),''); v_note text:=nullif(btrim(coalesce(p_note,'')),'');
BEGIN
 v_me:=public.waves_company_actor(p_group_id);
 IF p_status IS NULL OR p_status NOT IN ('todo','doing','done','blocked') THEN RAISE EXCEPTION 'INVALID_DATA: status'; END IF;
 IF p_status='blocked' AND v_reason IS NULL THEN RAISE EXCEPTION 'INVALID_DATA: blocked reason'; END IF;
 IF p_status<>'blocked' THEN v_reason:=NULL; END IF;
 IF length(coalesce(v_reason,''))>120 OR length(coalesce(v_note,''))>200 THEN RAISE EXCEPTION 'INVALID_DATA: text too long'; END IF;
 SELECT * INTO r FROM public.company_work_tasks WHERE id=p_task_id AND group_id=p_group_id AND deleted_at IS NULL FOR UPDATE;
 IF FOUND THEN
  v_boss:=public.is_group_admin(p_group_id) OR public.waves_company_team(p_group_id,r.member_id);
  IF NOT v_boss AND r.member_id IS DISTINCT FROM v_me THEN RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE='insufficient_privilege'; END IF;
  IF v_boss THEN
   IF v_title='' OR length(v_title)>200 THEN RAISE EXCEPTION 'INVALID_DATA: title'; END IF;
   IF p_project_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.company_projects WHERE id=p_project_id AND group_id=p_group_id AND deleted_at IS NULL) THEN RAISE EXCEPTION 'INVALID_DATA: site'; END IF;
   IF p_day IS NULL OR p_day>current_date+7 OR p_day<current_date-400 THEN RAISE EXCEPTION 'INVALID_DATA: day'; END IF;
   -- Handing a task to someone else: the editor must manage the new assignee too, who must be a live employee.
   IF p_member_id IS DISTINCT FROM r.member_id AND (NOT (public.is_group_admin(p_group_id) OR public.waves_company_team(p_group_id,p_member_id))
    OR NOT EXISTS(SELECT 1 FROM public.group_members WHERE id=p_member_id AND group_id=p_group_id AND role::text='member' AND left_at IS NULL AND removed_at IS NULL AND merged_into_member_id IS NULL)) THEN RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE='insufficient_privilege'; END IF;
   UPDATE public.company_work_tasks SET member_id=p_member_id,title=v_title,project_id=p_project_id,due_time=p_due_time,day=p_day,status=p_status,blocked_reason=v_reason,note=v_note,updated_at=now() WHERE id=r.id;
  ELSE
   UPDATE public.company_work_tasks SET status=p_status,blocked_reason=v_reason,note=v_note,updated_at=now() WHERE id=r.id;
  END IF;
  RETURN;
 END IF;
 IF EXISTS(SELECT 1 FROM public.company_work_tasks WHERE id=p_task_id) THEN RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE='insufficient_privilege'; END IF;
 IF NOT public.is_group_admin(p_group_id) AND NOT public.waves_company_team(p_group_id,p_member_id) THEN RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE='insufficient_privilege'; END IF;
 IF v_title='' OR length(v_title)>200 THEN RAISE EXCEPTION 'INVALID_DATA: title'; END IF;
 IF p_day IS NULL OR p_day>current_date+7 OR p_day<current_date-400 THEN RAISE EXCEPTION 'INVALID_DATA: day'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.group_members WHERE id=p_member_id AND group_id=p_group_id AND role::text='member' AND left_at IS NULL AND removed_at IS NULL AND merged_into_member_id IS NULL) THEN RAISE EXCEPTION 'UNKNOWN_MEMBER' USING ERRCODE='insufficient_privilege'; END IF;
 IF p_project_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.company_projects WHERE id=p_project_id AND group_id=p_group_id AND deleted_at IS NULL) THEN RAISE EXCEPTION 'INVALID_DATA: site'; END IF;
 INSERT INTO public.company_work_tasks(id,group_id,member_id,day,title,project_id,status,blocked_reason,note,due_time,created_by) VALUES(p_task_id,p_group_id,p_member_id,p_day,v_title,p_project_id,p_status,v_reason,v_note,p_due_time,v_me);
END $$;

CREATE FUNCTION public.waves_company_work_set(p_group_id uuid,p_task_id uuid,p_member_id uuid,p_day date,p_title text,p_project_id uuid,p_status text,p_blocked_reason text,p_note text) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
BEGIN
 PERFORM public.waves_company_work_set(p_group_id,p_task_id,p_member_id,p_day,p_title,p_project_id,p_status,p_blocked_reason,p_note,
  (SELECT due_time FROM public.company_work_tasks WHERE id=p_task_id AND group_id=p_group_id AND deleted_at IS NULL));
END $$;

REVOKE ALL ON FUNCTION public.waves_company_work_set(uuid,uuid,uuid,date,text,uuid,text,text,text,time),public.waves_company_work_set(uuid,uuid,uuid,date,text,uuid,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.waves_company_work_set(uuid,uuid,uuid,date,text,uuid,text,text,text,time),public.waves_company_work_set(uuid,uuid,uuid,date,text,uuid,text,text,text) TO authenticated,service_role;
