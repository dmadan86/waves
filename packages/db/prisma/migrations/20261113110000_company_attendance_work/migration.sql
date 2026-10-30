-- Company attendance (Present / Half day / Absent per person per day) and daily work (one-line tasks).
-- Reads follow waves_company_detail: owners see all, a manager their team, an employee only their own rows.
-- Writes are RPC-only (offline queue -> sync), so the tables grant SELECT alone.
CREATE TABLE public.company_attendance (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 group_id uuid NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
 member_id uuid NOT NULL REFERENCES public.group_members(id) ON DELETE CASCADE,
 day date NOT NULL,
 status text NOT NULL CHECK(status IN ('present','half','absent')),
 note text CHECK(note IS NULL OR length(note) BETWEEN 1 AND 200),
 marked_by uuid NOT NULL REFERENCES public.group_members(id),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 deleted_at timestamptz, updated_seq bigint NOT NULL DEFAULT 0,
 UNIQUE(group_id,member_id,day)
);
CREATE INDEX company_attendance_sync_idx ON public.company_attendance(group_id,updated_seq);

CREATE TABLE public.company_work_tasks (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 group_id uuid NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
 member_id uuid NOT NULL REFERENCES public.group_members(id) ON DELETE CASCADE,
 day date NOT NULL,
 title text NOT NULL CHECK(length(title) BETWEEN 1 AND 200),
 project_id uuid,
 status text NOT NULL DEFAULT 'todo' CHECK(status IN ('todo','doing','done','blocked')),
 blocked_reason text CHECK(blocked_reason IS NULL OR length(blocked_reason) BETWEEN 1 AND 120),
 note text CHECK(note IS NULL OR length(note) BETWEEN 1 AND 200),
 created_by uuid NOT NULL REFERENCES public.group_members(id),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 deleted_at timestamptz, updated_seq bigint NOT NULL DEFAULT 0,
 CONSTRAINT company_work_blocked_reason CHECK((status='blocked')=(blocked_reason IS NOT NULL)),
 FOREIGN KEY(project_id,group_id) REFERENCES public.company_projects(id,group_id)
);
CREATE INDEX company_work_tasks_sync_idx ON public.company_work_tasks(group_id,updated_seq);
CREATE INDEX company_work_tasks_day_idx ON public.company_work_tasks(group_id,day,member_id);

CREATE TRIGGER company_attendance_stamp BEFORE INSERT OR UPDATE ON public.company_attendance FOR EACH ROW EXECUTE FUNCTION public.waves_stamp_seq();
CREATE TRIGGER company_work_tasks_stamp BEFORE INSERT OR UPDATE ON public.company_work_tasks FOR EACH ROW EXECUTE FUNCTION public.waves_stamp_seq();
ALTER TABLE public.company_attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_work_tasks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.company_attendance, public.company_work_tasks FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.company_attendance, public.company_work_tasks TO authenticated;
GRANT ALL ON public.company_attendance, public.company_work_tasks TO service_role;
CREATE POLICY company_attendance_select ON public.company_attendance FOR SELECT TO authenticated USING(public.waves_company_detail(group_id,member_id));
CREATE POLICY company_work_tasks_select ON public.company_work_tasks FOR SELECT TO authenticated USING(public.waves_company_detail(group_id,member_id));

-- Owner (or the person's manager) marks one person for one day; a null status clears the mark.
CREATE FUNCTION public.waves_company_attendance_set(p_group_id uuid,p_member_id uuid,p_day date,p_status text,p_note text) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
DECLARE v_me uuid; v_note text:=nullif(btrim(coalesce(p_note,'')),'');
BEGIN
 v_me:=public.waves_company_actor(p_group_id);
 IF NOT public.is_group_admin(p_group_id) AND NOT public.waves_company_team(p_group_id,p_member_id) THEN RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE='insufficient_privilege'; END IF;
 IF p_day IS NULL OR p_day>current_date+1 OR p_day<current_date-400 THEN RAISE EXCEPTION 'INVALID_DATA: day'; END IF;
 IF p_status IS NOT NULL AND p_status NOT IN ('present','half','absent') THEN RAISE EXCEPTION 'INVALID_DATA: status'; END IF;
 IF length(coalesce(v_note,''))>200 THEN RAISE EXCEPTION 'INVALID_DATA: note'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.group_members WHERE id=p_member_id AND group_id=p_group_id AND role::text='member' AND left_at IS NULL AND removed_at IS NULL AND merged_into_member_id IS NULL) THEN RAISE EXCEPTION 'UNKNOWN_MEMBER' USING ERRCODE='insufficient_privilege'; END IF;
 IF p_status IS NULL THEN
  UPDATE public.company_attendance SET deleted_at=now(),updated_at=now(),marked_by=v_me WHERE group_id=p_group_id AND member_id=p_member_id AND day=p_day AND deleted_at IS NULL;
 ELSE
  INSERT INTO public.company_attendance(group_id,member_id,day,status,note,marked_by) VALUES(p_group_id,p_member_id,p_day,p_status,v_note,v_me)
  ON CONFLICT(group_id,member_id,day) DO UPDATE SET status=EXCLUDED.status,note=EXCLUDED.note,marked_by=v_me,deleted_at=NULL,updated_at=now();
 END IF;
END $$;

-- Owner/manager create or edit a task; the employee it is for may only move its status and add a note.
CREATE FUNCTION public.waves_company_work_set(p_group_id uuid,p_task_id uuid,p_member_id uuid,p_day date,p_title text,p_project_id uuid,p_status text,p_blocked_reason text,p_note text) RETURNS void
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
   UPDATE public.company_work_tasks SET title=v_title,project_id=p_project_id,day=p_day,status=p_status,blocked_reason=v_reason,note=v_note,updated_at=now() WHERE id=r.id;
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
 INSERT INTO public.company_work_tasks(id,group_id,member_id,day,title,project_id,status,blocked_reason,note,created_by) VALUES(p_task_id,p_group_id,p_member_id,p_day,v_title,p_project_id,p_status,v_reason,v_note,v_me);
END $$;

CREATE FUNCTION public.waves_company_work_remove(p_group_id uuid,p_task_id uuid) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
DECLARE r public.company_work_tasks;
BEGIN
 PERFORM public.waves_company_actor(p_group_id);
 SELECT * INTO r FROM public.company_work_tasks WHERE id=p_task_id AND group_id=p_group_id AND deleted_at IS NULL FOR UPDATE;
 IF NOT FOUND THEN RETURN; END IF;
 IF NOT public.is_group_admin(p_group_id) AND NOT public.waves_company_team(p_group_id,r.member_id) THEN RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE='insufficient_privilege'; END IF;
 UPDATE public.company_work_tasks SET deleted_at=now(),updated_at=now() WHERE id=r.id;
END $$;

-- A new manager's next pull must carry the person's history: re-stamp on reassignment.
CREATE FUNCTION public.waves_company_restamp_on_assign() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
BEGIN
 UPDATE public.company_attendance SET updated_at=now() WHERE member_id=NEW.id;
 UPDATE public.company_work_tasks SET updated_at=now() WHERE member_id=NEW.id;
 RETURN NEW;
END $$;
CREATE TRIGGER group_members_restamp_attendance_work AFTER UPDATE OF manager_id ON public.group_members
 FOR EACH ROW WHEN (OLD.manager_id IS DISTINCT FROM NEW.manager_id) EXECUTE FUNCTION public.waves_company_restamp_on_assign();

REVOKE ALL ON FUNCTION public.waves_company_attendance_set(uuid,uuid,date,text,text),public.waves_company_work_set(uuid,uuid,uuid,date,text,uuid,text,text,text),public.waves_company_work_remove(uuid,uuid),public.waves_company_restamp_on_assign() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.waves_company_attendance_set(uuid,uuid,date,text,text),public.waves_company_work_set(uuid,uuid,uuid,date,text,uuid,text,text,text),public.waves_company_work_remove(uuid,uuid) TO authenticated,service_role;
