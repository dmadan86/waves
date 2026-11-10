-- Task permissions: (1) the owner may assign a task to a manager (a manager may assign to the employees they manage, or themself);
-- (2) anyone may add a task for THEMSELF and edit / remove / prioritise only the tasks they made for themself; (3) the assignee
-- and the helpers may add photos to their task, and remove the ones they uploaded. Everything else is exactly as before.

-- The 11-argument task writer, copied from 20261206110000; changed lines are marked.
CREATE OR REPLACE FUNCTION public.waves_company_work_set(p_group_id uuid,p_task_id uuid,p_member_id uuid,p_day date,p_title text,p_project_id uuid,p_status text,p_blocked_reason text,p_note text,p_due_time time,p_client_id uuid) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
DECLARE v_me uuid; r public.company_work_tasks; v_boss boolean;
 v_title text:=btrim(coalesce(p_title,'')); v_reason text:=nullif(btrim(coalesce(p_blocked_reason,'')),''); v_note text:=nullif(btrim(coalesce(p_note,'')),'');
 v_roles text[]:=CASE WHEN p_client_id IS NULL THEN ARRAY['member','manager'] ELSE ARRAY['member','manager','admin'] END;
BEGIN
 v_me:=public.waves_company_actor(p_group_id);
 IF p_status IS NULL OR p_status NOT IN ('todo','doing','done','blocked') THEN RAISE EXCEPTION 'INVALID_DATA: status'; END IF;
 IF p_status='blocked' AND v_reason IS NULL THEN RAISE EXCEPTION 'INVALID_DATA: blocked reason'; END IF;
 IF p_status<>'blocked' THEN v_reason:=NULL; END IF;
 IF length(coalesce(v_reason,''))>120 OR length(coalesce(v_note,''))>200 THEN RAISE EXCEPTION 'INVALID_DATA: text too long'; END IF;
 SELECT * INTO r FROM public.company_work_tasks WHERE id=p_task_id AND group_id=p_group_id AND deleted_at IS NULL FOR UPDATE;
 IF FOUND THEN
  v_boss:=public.is_group_admin(p_group_id) OR public.waves_company_team(p_group_id,r.member_id)
   OR (r.member_id=v_me AND r.created_by=v_me); -- a task the caller made for themself is theirs to edit
  IF NOT v_boss AND r.member_id IS DISTINCT FROM v_me AND NOT (v_me = ANY(r.helper_ids)) THEN RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE='insufficient_privilege'; END IF;
  IF v_boss THEN
   IF v_title='' OR length(v_title)>200 THEN RAISE EXCEPTION 'INVALID_DATA: title'; END IF;
   IF p_project_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.company_projects WHERE id=p_project_id AND group_id=p_group_id AND deleted_at IS NULL) THEN RAISE EXCEPTION 'INVALID_DATA: site'; END IF;
   IF p_day IS NULL OR p_day>current_date+730 OR p_day<current_date-400 THEN RAISE EXCEPTION 'INVALID_DATA: day'; END IF;
   IF p_client_id IS NOT NULL AND (p_client_id IS DISTINCT FROM r.client_id) AND NOT EXISTS(SELECT 1 FROM public.company_clients WHERE id=p_client_id AND group_id=p_group_id AND deleted_at IS NULL AND public.waves_company_client_visible(p_group_id,id)) THEN RAISE EXCEPTION 'INVALID_DATA: client'; END IF;
   -- Handing a task to someone else: the editor must manage the new assignee too, who must be a live employee.
   IF p_member_id IS DISTINCT FROM r.member_id AND (NOT (public.is_group_admin(p_group_id) OR public.waves_company_team(p_group_id,p_member_id) OR p_member_id=v_me)
    OR NOT EXISTS(SELECT 1 FROM public.group_members WHERE id=p_member_id AND group_id=p_group_id AND role::text=ANY(v_roles) AND left_at IS NULL AND removed_at IS NULL AND merged_into_member_id IS NULL)) THEN RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE='insufficient_privilege'; END IF;
   UPDATE public.company_work_tasks SET member_id=p_member_id,title=v_title,project_id=p_project_id,due_time=p_due_time,day=p_day,status=p_status,blocked_reason=v_reason,note=v_note,client_id=p_client_id,updated_at=now() WHERE id=r.id;
  ELSE
   UPDATE public.company_work_tasks SET status=p_status,blocked_reason=v_reason,note=v_note,updated_at=now() WHERE id=r.id;
  END IF;
  RETURN;
 END IF;
 IF EXISTS(SELECT 1 FROM public.company_work_tasks WHERE id=p_task_id) THEN RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE='insufficient_privilege'; END IF;
 IF NOT public.is_group_admin(p_group_id) AND NOT public.waves_company_team(p_group_id,p_member_id) AND p_member_id IS DISTINCT FROM v_me THEN RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE='insufficient_privilege'; END IF;
 IF v_title='' OR length(v_title)>200 THEN RAISE EXCEPTION 'INVALID_DATA: title'; END IF;
 IF p_day IS NULL OR p_day>current_date+730 OR p_day<current_date-400 THEN RAISE EXCEPTION 'INVALID_DATA: day'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.group_members WHERE id=p_member_id AND group_id=p_group_id AND role::text=ANY(v_roles) AND left_at IS NULL AND removed_at IS NULL AND merged_into_member_id IS NULL) THEN RAISE EXCEPTION 'UNKNOWN_MEMBER' USING ERRCODE='insufficient_privilege'; END IF;
 IF p_project_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.company_projects WHERE id=p_project_id AND group_id=p_group_id AND deleted_at IS NULL) THEN RAISE EXCEPTION 'INVALID_DATA: site'; END IF;
 IF p_client_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.company_clients WHERE id=p_client_id AND group_id=p_group_id AND deleted_at IS NULL AND public.waves_company_client_visible(p_group_id,id)) THEN RAISE EXCEPTION 'INVALID_DATA: client'; END IF;
 INSERT INTO public.company_work_tasks(id,group_id,member_id,day,title,project_id,status,blocked_reason,note,due_time,created_by,client_id) VALUES(p_task_id,p_group_id,p_member_id,p_day,v_title,p_project_id,p_status,v_reason,v_note,p_due_time,v_me,p_client_id);
END $$;

-- Remove: also the person who made a task for themself.
CREATE OR REPLACE FUNCTION public.waves_company_work_remove(p_group_id uuid,p_task_id uuid) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
DECLARE r public.company_work_tasks; v_me uuid;
BEGIN
 v_me:=public.waves_company_actor(p_group_id);
 SELECT * INTO r FROM public.company_work_tasks WHERE id=p_task_id AND group_id=p_group_id AND deleted_at IS NULL FOR UPDATE;
 IF NOT FOUND THEN RETURN; END IF;
 IF NOT public.is_group_admin(p_group_id) AND NOT public.waves_company_team(p_group_id,r.member_id)
  AND NOT (r.member_id=v_me AND r.created_by=v_me) THEN RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE='insufficient_privilege'; END IF;
 UPDATE public.company_work_tasks SET deleted_at=now(),updated_at=now() WHERE id=r.id;
END $$;

-- Priority: also on a task the caller made for themself (else still a silent no-op).
CREATE OR REPLACE FUNCTION public.waves_company_work_priority_set(p_group_id uuid,p_task_id uuid,p_priority text) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
DECLARE v_me uuid;
BEGIN
 v_me:=public.waves_company_actor(p_group_id);
 IF p_priority IS NULL OR p_priority NOT IN ('normal','urgent','very_urgent') THEN RAISE EXCEPTION 'INVALID_DATA: priority'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.company_work_tasks WHERE id=p_task_id AND group_id=p_group_id AND deleted_at IS NULL) THEN RAISE EXCEPTION 'NOT_FOUND: task' USING ERRCODE='no_data_found'; END IF;
 UPDATE public.company_work_tasks SET priority=p_priority,updated_at=now()
  WHERE id=p_task_id AND group_id=p_group_id AND deleted_at IS NULL AND priority IS DISTINCT FROM p_priority
   AND (public.is_group_admin(p_group_id) OR public.waves_company_team(p_group_id,member_id) OR (member_id=v_me AND created_by=v_me));
END $$;

-- Photos: the assignee and the helpers join the owner and the assignee's manager as actors on a task's photos.
CREATE OR REPLACE FUNCTION public.waves_company_task_photo_actor(p_task_id uuid,p_profile_id uuid) RETURNS uuid
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
 SELECT m.id FROM public.company_work_tasks k
 JOIN public.group_members a ON a.id=k.member_id AND a.group_id=k.group_id
 JOIN public.group_members m ON m.group_id=k.group_id
 JOIN public.groups g ON g.id=k.group_id
 WHERE k.id=p_task_id AND k.deleted_at IS NULL AND g.type='company' AND g.deleted_at IS NULL
 AND m.profile_id=p_profile_id AND m.left_at IS NULL AND m.removed_at IS NULL AND m.merged_into_member_id IS NULL
 AND (m.role::text='admin' OR (m.role::text='manager' AND a.role::text='member' AND a.manager_id=m.id)
  OR m.id=k.member_id OR m.id=ANY(k.helper_ids)); -- changed: assignee and helpers
$$;

-- Removing a photo: the owner and the assignee's manager remove any; the assignee and helpers only their own uploads.
CREATE OR REPLACE FUNCTION public.waves_remove_company_task_image(p_attachment_id uuid) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $fn$
DECLARE a public.company_work_task_attachments%ROWTYPE; actor uuid; v_member uuid;
BEGIN
 SELECT * INTO a FROM public.company_work_task_attachments WHERE id=p_attachment_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE='insufficient_privilege'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(a.group_id::text,4));
 SELECT * INTO a FROM public.company_work_task_attachments WHERE id=p_attachment_id FOR UPDATE;
 actor:=public.waves_company_task_photo_actor(a.entry_id,public.waves_current_profile_id());
 IF actor IS NULL OR NOT public.waves_can_read_company_work_task(a.entry_id) THEN RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE='insufficient_privilege'; END IF;
 SELECT member_id INTO v_member FROM public.company_work_tasks WHERE id=a.entry_id;
 IF a.uploader_member_id IS DISTINCT FROM actor AND NOT (public.is_group_admin(a.group_id) OR public.waves_company_team(a.group_id,v_member))
  THEN RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE='insufficient_privilege'; END IF;
 IF a.deleted_at IS NOT NULL THEN RETURN; END IF;
 UPDATE public.company_work_task_attachments SET deleted_at=now(),updated_at=now() WHERE id=a.id;
 DELETE FROM public.storage_objects WHERE logical_bucket='company-entry-images' AND path IN(a.storage_path,a.storage_path||'.thumb.jpg');
END
$fn$;
