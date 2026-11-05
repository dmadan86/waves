-- Several people on one task, one of them responsible. member_id stays the responsible person (counts, grouping, manager
-- scoping, notifications and the red dot all key on it); helper_ids are the others, who see the task and change its STATUS.
ALTER TABLE public.company_work_tasks
 ADD COLUMN helper_ids uuid[] NOT NULL DEFAULT '{}',
 ADD CONSTRAINT company_work_tasks_helpers_max CHECK (cardinality(helper_ids)<=5),
 ADD CONSTRAINT company_work_tasks_helpers_not_owner CHECK (NOT (member_id = ANY(helper_ids)));

-- Reassigning the task to one of its helpers makes them the responsible one and drops them from the helpers.
CREATE FUNCTION public.waves_company_task_helpers_clean() RETURNS trigger
 LANGUAGE plpgsql SET search_path TO 'public','pg_temp' AS $$
BEGIN
 NEW.helper_ids:=array_remove(NEW.helper_ids,NEW.member_id);
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.waves_company_task_helpers_clean() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER company_work_tasks_helpers_clean BEFORE INSERT OR UPDATE ON public.company_work_tasks FOR EACH ROW EXECUTE FUNCTION public.waves_company_task_helpers_clean();

-- Is the signed-in caller a live member of this company who is listed as a helper?
CREATE FUNCTION public.waves_company_is_helper(p_group_id uuid,p_helper_ids uuid[]) RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
 SELECT EXISTS(SELECT 1 FROM public.group_members me JOIN public.groups g ON g.id=me.group_id
 WHERE me.group_id=p_group_id AND g.type='company' AND g.deleted_at IS NULL AND me.id=ANY(p_helper_ids)
 AND me.profile_id=public.waves_current_profile_id() AND me.left_at IS NULL AND me.removed_at IS NULL AND me.merged_into_member_id IS NULL);
$$;
REVOKE ALL ON FUNCTION public.waves_company_is_helper(uuid,uuid[]) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.waves_company_is_helper(uuid,uuid[]) TO authenticated,service_role;

-- A helper reads the task (and its photos) like the responsible person.
DROP POLICY company_work_tasks_select ON public.company_work_tasks;
CREATE POLICY company_work_tasks_select ON public.company_work_tasks FOR SELECT TO authenticated
 USING(public.waves_company_detail(group_id,member_id) OR public.waves_company_is_helper(group_id,helper_ids));
CREATE OR REPLACE FUNCTION public.waves_can_read_company_work_task(p_task_id uuid) RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
 SELECT EXISTS(SELECT 1 FROM public.company_work_tasks k WHERE k.id=p_task_id
  AND (public.waves_company_detail(k.group_id,k.member_id) OR public.waves_company_is_helper(k.group_id,k.helper_ids)));
$$;

-- The 11-argument task writer, unchanged except that a helper may also change status, blocked reason and note (the non-boss branch).
CREATE OR REPLACE FUNCTION public.waves_company_work_set(p_group_id uuid,p_task_id uuid,p_member_id uuid,p_day date,p_title text,p_project_id uuid,p_status text,p_blocked_reason text,p_note text,p_due_time time,p_client_id uuid) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
DECLARE v_me uuid; r public.company_work_tasks; v_boss boolean;
 v_title text:=btrim(coalesce(p_title,'')); v_reason text:=nullif(btrim(coalesce(p_blocked_reason,'')),''); v_note text:=nullif(btrim(coalesce(p_note,'')),'');
 v_roles text[]:=CASE WHEN p_client_id IS NULL THEN ARRAY['member'] ELSE ARRAY['member','manager','admin'] END;
BEGIN
 v_me:=public.waves_company_actor(p_group_id);
 IF p_status IS NULL OR p_status NOT IN ('todo','doing','done','blocked') THEN RAISE EXCEPTION 'INVALID_DATA: status'; END IF;
 IF p_status='blocked' AND v_reason IS NULL THEN RAISE EXCEPTION 'INVALID_DATA: blocked reason'; END IF;
 IF p_status<>'blocked' THEN v_reason:=NULL; END IF;
 IF length(coalesce(v_reason,''))>120 OR length(coalesce(v_note,''))>200 THEN RAISE EXCEPTION 'INVALID_DATA: text too long'; END IF;
 SELECT * INTO r FROM public.company_work_tasks WHERE id=p_task_id AND group_id=p_group_id AND deleted_at IS NULL FOR UPDATE;
 IF FOUND THEN
  v_boss:=public.is_group_admin(p_group_id) OR public.waves_company_team(p_group_id,r.member_id);
  IF NOT v_boss AND r.member_id IS DISTINCT FROM v_me AND NOT (v_me = ANY(r.helper_ids)) THEN RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE='insufficient_privilege'; END IF;
  IF v_boss THEN
   IF v_title='' OR length(v_title)>200 THEN RAISE EXCEPTION 'INVALID_DATA: title'; END IF;
   IF p_project_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.company_projects WHERE id=p_project_id AND group_id=p_group_id AND deleted_at IS NULL) THEN RAISE EXCEPTION 'INVALID_DATA: site'; END IF;
   IF p_day IS NULL OR p_day>current_date+730 OR p_day<current_date-400 THEN RAISE EXCEPTION 'INVALID_DATA: day'; END IF;
   IF p_client_id IS NOT NULL AND (p_client_id IS DISTINCT FROM r.client_id) AND NOT EXISTS(SELECT 1 FROM public.company_clients WHERE id=p_client_id AND group_id=p_group_id AND deleted_at IS NULL AND public.waves_company_client_visible(p_group_id,id)) THEN RAISE EXCEPTION 'INVALID_DATA: client'; END IF;
   -- Handing a task to someone else: the editor must manage the new assignee too, who must be a live employee.
   IF p_member_id IS DISTINCT FROM r.member_id AND (NOT (public.is_group_admin(p_group_id) OR public.waves_company_team(p_group_id,p_member_id))
    OR NOT EXISTS(SELECT 1 FROM public.group_members WHERE id=p_member_id AND group_id=p_group_id AND role::text=ANY(v_roles) AND left_at IS NULL AND removed_at IS NULL AND merged_into_member_id IS NULL)) THEN RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE='insufficient_privilege'; END IF;
   UPDATE public.company_work_tasks SET member_id=p_member_id,title=v_title,project_id=p_project_id,due_time=p_due_time,day=p_day,status=p_status,blocked_reason=v_reason,note=v_note,client_id=p_client_id,updated_at=now() WHERE id=r.id;
  ELSE
   UPDATE public.company_work_tasks SET status=p_status,blocked_reason=v_reason,note=v_note,updated_at=now() WHERE id=r.id;
  END IF;
  RETURN;
 END IF;
 IF EXISTS(SELECT 1 FROM public.company_work_tasks WHERE id=p_task_id) THEN RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE='insufficient_privilege'; END IF;
 IF NOT public.is_group_admin(p_group_id) AND NOT public.waves_company_team(p_group_id,p_member_id) AND NOT (p_client_id IS NOT NULL AND p_member_id=v_me) THEN RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE='insufficient_privilege'; END IF;
 IF v_title='' OR length(v_title)>200 THEN RAISE EXCEPTION 'INVALID_DATA: title'; END IF;
 IF p_day IS NULL OR p_day>current_date+730 OR p_day<current_date-400 THEN RAISE EXCEPTION 'INVALID_DATA: day'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.group_members WHERE id=p_member_id AND group_id=p_group_id AND role::text=ANY(v_roles) AND left_at IS NULL AND removed_at IS NULL AND merged_into_member_id IS NULL) THEN RAISE EXCEPTION 'UNKNOWN_MEMBER' USING ERRCODE='insufficient_privilege'; END IF;
 IF p_project_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.company_projects WHERE id=p_project_id AND group_id=p_group_id AND deleted_at IS NULL) THEN RAISE EXCEPTION 'INVALID_DATA: site'; END IF;
 IF p_client_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.company_clients WHERE id=p_client_id AND group_id=p_group_id AND deleted_at IS NULL AND public.waves_company_client_visible(p_group_id,id)) THEN RAISE EXCEPTION 'INVALID_DATA: client'; END IF;
 INSERT INTO public.company_work_tasks(id,group_id,member_id,day,title,project_id,status,blocked_reason,note,due_time,created_by,client_id) VALUES(p_task_id,p_group_id,p_member_id,p_day,v_title,p_project_id,p_status,v_reason,v_note,p_due_time,v_me,p_client_id);
END $$;

-- Its own writer, like priority: the task writer's overloads stay untouched, so every older client keeps working.
-- Only the owner or the responsible person's manager sets helpers; anyone else (an employee saving a status) is a silent no-op.
-- New helpers must be people the caller could assign; ones already on the task stay even if the caller does not manage them.
CREATE FUNCTION public.waves_company_work_helpers_set(p_group_id uuid,p_task_id uuid,p_helper_ids uuid[]) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
DECLARE r public.company_work_tasks; h uuid;
BEGIN
 PERFORM public.waves_company_actor(p_group_id);
 IF p_helper_ids IS NULL OR cardinality(p_helper_ids)>5 OR array_position(p_helper_ids,NULL) IS NOT NULL
  OR cardinality(p_helper_ids)<>(SELECT count(DISTINCT x) FROM unnest(p_helper_ids) x) THEN RAISE EXCEPTION 'INVALID_DATA: helpers'; END IF;
 SELECT * INTO r FROM public.company_work_tasks WHERE id=p_task_id AND group_id=p_group_id AND deleted_at IS NULL FOR UPDATE;
 -- A task gone between the writer and this call must fail the mutation (the client retries), not report success unsaved.
 IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND: task' USING ERRCODE='no_data_found'; END IF;
 IF r.helper_ids IS NOT DISTINCT FROM p_helper_ids THEN RETURN; END IF;
 IF NOT (public.is_group_admin(p_group_id) OR public.waves_company_team(p_group_id,r.member_id)) THEN RETURN; END IF;
 IF r.member_id=ANY(p_helper_ids) THEN RAISE EXCEPTION 'INVALID_DATA: the responsible person cannot also be a helper'; END IF;
 FOREACH h IN ARRAY p_helper_ids LOOP
  IF NOT EXISTS(SELECT 1 FROM public.group_members WHERE id=h AND group_id=p_group_id AND role::text='member' AND left_at IS NULL AND removed_at IS NULL AND merged_into_member_id IS NULL)
   THEN RAISE EXCEPTION 'INVALID_DATA: helper'; END IF;
  IF NOT (h=ANY(r.helper_ids)) AND NOT (public.is_group_admin(p_group_id) OR public.waves_company_team(p_group_id,h))
   THEN RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE='insufficient_privilege'; END IF;
 END LOOP;
 UPDATE public.company_work_tasks SET helper_ids=p_helper_ids,updated_at=now() WHERE id=r.id;
END $$;
REVOKE ALL ON FUNCTION public.waves_company_work_helpers_set(uuid,uuid,uuid[]) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.waves_company_work_helpers_set(uuid,uuid,uuid[]) TO authenticated,service_role;
