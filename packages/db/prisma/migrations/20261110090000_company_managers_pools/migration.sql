-- Phase 4: current-team privacy, manager floats, projects and atomic wage runs.
-- Deliberately deferred: commands, settlement applications, wage lines, people audit,
-- reimburse_v4, access_revision, optional wage_preview and second owner approval.
-- Reassignment changes access to ALL history; funding attribution never changes.
-- Client caches/exports/signing handlers are the application half of Phase 4.
-- Budgets are separate owner-only rows so generic project SELECT/pull is safe.
ALTER TABLE public.group_members ADD COLUMN manager_id uuid,
 ADD CONSTRAINT company_member_manager_fk FOREIGN KEY(manager_id,group_id) REFERENCES public.group_members(id,group_id),
 ADD CONSTRAINT company_member_manager_not_self CHECK(manager_id IS DISTINCT FROM id);
CREATE INDEX company_members_manager_idx ON public.group_members(group_id,manager_id);
ALTER TABLE public.invites ADD COLUMN company_manager_id uuid,
 ADD CONSTRAINT company_invite_manager_fk FOREIGN KEY(company_manager_id,group_id) REFERENCES public.group_members(id,group_id);
CREATE TABLE public.company_projects (
 id uuid PRIMARY KEY, group_id uuid NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
 name text NOT NULL CHECK(name=btrim(name) AND length(name) BETWEEN 1 AND 80),
 archived_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(), deleted_at timestamptz,
 updated_seq bigint NOT NULL DEFAULT 0, UNIQUE(id,group_id)
);
CREATE TABLE public.company_project_budgets (
 project_id uuid PRIMARY KEY, group_id uuid NOT NULL,
 budget_minor bigint CHECK(budget_minor>=0),
 FOREIGN KEY(project_id,group_id) REFERENCES public.company_projects(id,group_id) ON DELETE CASCADE
);
CREATE TABLE public.company_project_members (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), group_id uuid NOT NULL,
 project_id uuid NOT NULL, member_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 deleted_at timestamptz, updated_seq bigint NOT NULL DEFAULT 0,
 UNIQUE(project_id,member_id),
 FOREIGN KEY(project_id,group_id) REFERENCES public.company_projects(id,group_id) ON DELETE CASCADE,
 FOREIGN KEY(member_id,group_id) REFERENCES public.group_members(id,group_id) ON DELETE CASCADE
);
CREATE INDEX company_projects_sync_idx ON public.company_projects(group_id,updated_seq);
CREATE INDEX company_project_members_sync_idx ON public.company_project_members(group_id,updated_seq);
CREATE INDEX company_project_members_member_idx ON public.company_project_members(member_id,project_id);
CREATE TABLE public.company_wage_runs (
 id uuid PRIMARY KEY, group_id uuid NOT NULL REFERENCES public.groups(id),
 period_start date NOT NULL, period_end date NOT NULL CHECK(period_end>=period_start),
 paid_on date NOT NULL, created_by uuid NOT NULL, request_hash text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 deleted_at timestamptz, updated_seq bigint NOT NULL DEFAULT 0, UNIQUE(id,group_id),
 FOREIGN KEY(created_by,group_id) REFERENCES public.group_members(id,group_id)
);
CREATE INDEX company_wage_runs_sync_idx ON public.company_wage_runs(group_id,updated_seq);
CREATE TRIGGER company_projects_stamp BEFORE INSERT OR UPDATE ON public.company_projects FOR EACH ROW EXECUTE FUNCTION public.waves_stamp_seq();
CREATE TRIGGER company_project_members_stamp BEFORE INSERT OR UPDATE ON public.company_project_members FOR EACH ROW EXECUTE FUNCTION public.waves_stamp_seq();
CREATE TRIGGER company_wage_runs_stamp BEFORE INSERT OR UPDATE ON public.company_wage_runs FOR EACH ROW EXECUTE FUNCTION public.waves_stamp_seq();
ALTER TABLE public.company_entries
 ADD COLUMN project_id uuid, ADD COLUMN funding_manager_id uuid, ADD COLUMN wage_run_id uuid,
 ADD COLUMN gross_minor bigint, ADD COLUMN claims_minor bigint, ADD COLUMN recovery_minor bigint,
 ADD COLUMN period_start date, ADD COLUMN period_end date, ADD COLUMN request_hash text,
 ADD CONSTRAINT company_entry_project_fk FOREIGN KEY(project_id,group_id) REFERENCES public.company_projects(id,group_id),
 ADD CONSTRAINT company_entry_funding_fk FOREIGN KEY(funding_manager_id,group_id) REFERENCES public.group_members(id,group_id),
 ADD CONSTRAINT company_entry_run_fk FOREIGN KEY(wage_run_id,group_id) REFERENCES public.company_wage_runs(id,group_id);
-- Replace only kind/amount/mode shape checks; keep GST, category, route and direction checks.
DO $$ DECLARE c record; BEGIN
 FOR c IN SELECT conname FROM pg_constraint WHERE conrelid='public.company_entries'::regclass AND contype='c'
 AND (conname IN ('company_entries_entry_kind_check','company_entries_amount_check','company_entries_calc_mode_v3','company_entries_rate_shape_v3')
 OR pg_get_constraintdef(oid) LIKE '%fixed_weekly%'
 OR (pg_get_constraintdef(oid) LIKE '%days_rate%' AND pg_get_constraintdef(oid) LIKE '%days IS NOT NULL%')) LOOP
 EXECUTE format('ALTER TABLE public.company_entries DROP CONSTRAINT %I',c.conname);
 END LOOP;
END $$;
ALTER TABLE public.company_entries
 ADD CONSTRAINT company_entries_kind_v4 CHECK(entry_kind IN ('expense','advance','allowance','wages','reimbursement','allocation','pool_return','pool_adjustment','wage_payment')),
 ADD CONSTRAINT company_entries_amount_v4 CHECK(amount>0 OR (amount=0 AND (calc_mode IN ('days_rate','distance_rate') OR reimbursement_details IS NOT NULL OR entry_kind='wage_payment')) OR (entry_kind='pool_adjustment' AND amount<>0)),
 ADD CONSTRAINT company_entries_mode_v4 CHECK(calc_mode IN ('typed','days_rate','fixed_weekly','fixed_monthly','distance_rate')),
 ADD CONSTRAINT company_entries_rate_v4 CHECK(
 (calc_mode='days_rate' AND entry_kind IN ('allowance','wages','wage_payment') AND days>0 AND days IS NOT NULL AND rate_minor>=0 AND rate_minor IS NOT NULL AND distance_km IS NULL) OR
 (calc_mode='distance_rate' AND entry_kind='expense' AND category IN ('fuel','transport') AND category IS NOT NULL AND days IS NULL AND distance_km>0 AND distance_km IS NOT NULL AND rate_minor>=0 AND rate_minor IS NOT NULL) OR
 (calc_mode IN ('typed','fixed_weekly','fixed_monthly') AND days IS NULL AND rate_minor IS NULL AND distance_km IS NULL AND (calc_mode='typed' OR entry_kind IN ('wages','wage_payment')))),
 ADD CONSTRAINT company_pool_reason CHECK(entry_kind NOT IN ('pool_return','pool_adjustment') OR (note IS NOT NULL AND note=btrim(note) AND length(note) BETWEEN 1 AND 500)),
 ADD CONSTRAINT company_pool_shape CHECK(entry_kind NOT IN ('allocation','pool_return','pool_adjustment') OR (funding_manager_id IS NOT NULL AND member_id=funding_manager_id AND calc_mode='typed')),
 ADD CONSTRAINT company_wage_shape CHECK((entry_kind='wage_payment' AND wage_run_id IS NOT NULL AND gross_minor IS NOT NULL AND claims_minor IS NOT NULL AND recovery_minor IS NOT NULL AND gross_minor>=claims_minor AND claims_minor>=0 AND recovery_minor BETWEEN 0 AND gross_minor AND amount=gross_minor-recovery_minor AND period_start IS NOT NULL AND period_end>=period_start) OR
 (entry_kind<>'wage_payment' AND wage_run_id IS NULL AND gross_minor IS NULL AND claims_minor IS NULL AND recovery_minor IS NULL AND period_start IS NULL AND period_end IS NULL));
CREATE INDEX company_entries_funding_idx ON public.company_entries(group_id,funding_manager_id,updated_seq);
CREATE INDEX company_entries_project_idx ON public.company_entries(group_id,project_id,occurred_on);
CREATE INDEX company_entries_wage_run_idx ON public.company_entries(wage_run_id);

-- Non-throwing canonical predicate for policies. The target may have left; caller may not.
CREATE FUNCTION public.waves_company_detail(p_group_id uuid,p_member_id uuid) RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
 SELECT EXISTS(SELECT 1 FROM public.groups g JOIN public.group_members me ON me.group_id=g.id
 JOIN public.group_members target ON target.group_id=g.id AND target.id=p_member_id
 WHERE g.id=p_group_id AND g.type='company' AND g.deleted_at IS NULL
 AND me.profile_id=public.waves_current_profile_id() AND me.left_at IS NULL AND me.removed_at IS NULL AND me.merged_into_member_id IS NULL
 AND (me.role::text='admin' OR me.id=target.id OR (me.role::text='manager' AND target.role::text='member' AND target.manager_id=me.id)));
$$;
CREATE FUNCTION public.waves_company_team(p_group_id uuid,p_member_id uuid) RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
 SELECT EXISTS(SELECT 1 FROM public.group_members me JOIN public.group_members t ON t.group_id=me.group_id
 JOIN public.groups g ON g.id=me.group_id WHERE me.group_id=p_group_id AND t.id=p_member_id
 AND me.profile_id=public.waves_current_profile_id() AND me.role::text='manager'
 AND me.left_at IS NULL AND me.removed_at IS NULL AND me.merged_into_member_id IS NULL
 AND t.role::text='member' AND t.manager_id=me.id AND g.deleted_at IS NULL AND g.type='company');
$$;
CREATE OR REPLACE FUNCTION public.waves_company_actor(p_group_id uuid) RETURNS uuid
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
DECLARE v_me uuid;
BEGIN
 IF public.waves_current_profile_id() IS NULL THEN RAISE EXCEPTION 'NOT_SIGNED_IN' USING ERRCODE='insufficient_privilege'; END IF;
 SELECT m.id INTO v_me FROM public.group_members m JOIN public.groups g ON g.id=m.group_id
 WHERE m.group_id=p_group_id AND m.profile_id=public.waves_current_profile_id() AND m.left_at IS NULL
 AND m.removed_at IS NULL AND m.merged_into_member_id IS NULL AND g.type='company' AND g.deleted_at IS NULL;
 IF v_me IS NULL THEN RAISE EXCEPTION 'NOT_A_MEMBER: live company membership required' USING ERRCODE='insufficient_privilege'; END IF;
 RETURN v_me;
END $$;
CREATE OR REPLACE FUNCTION public.waves_can_read_company_entry(p_entry_id uuid) RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
 SELECT EXISTS(SELECT 1 FROM public.company_entries e WHERE e.id=p_entry_id AND public.waves_company_detail(e.group_id,e.member_id));
$$;
DROP POLICY company_entries_select ON public.company_entries;
CREATE POLICY company_entries_select ON public.company_entries FOR SELECT TO authenticated USING(public.waves_company_detail(group_id,member_id));
DROP POLICY company_members_privacy ON public.group_members;
CREATE POLICY company_members_privacy ON public.group_members AS RESTRICTIVE FOR SELECT TO authenticated
 USING(NOT public.waves_is_company(group_id) OR public.waves_company_detail(group_id,id));
CREATE FUNCTION public.waves_company_project_visible(p_group_id uuid,p_project_id uuid) RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
 SELECT EXISTS(SELECT 1 FROM public.group_members me JOIN public.groups g ON g.id=me.group_id
 WHERE me.group_id=p_group_id AND me.profile_id=public.waves_current_profile_id() AND me.left_at IS NULL AND me.removed_at IS NULL AND me.merged_into_member_id IS NULL AND g.type='company' AND g.deleted_at IS NULL
 AND (me.role::text='admin' OR EXISTS(SELECT 1 FROM public.company_project_members pm JOIN public.group_members t ON t.id=pm.member_id
 WHERE pm.project_id=p_project_id AND pm.group_id=p_group_id AND pm.deleted_at IS NULL AND
 (pm.member_id=me.id OR (me.role::text='manager' AND t.manager_id=me.id AND t.role::text='member')))));
$$;
ALTER TABLE public.company_projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_project_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_project_budgets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_wage_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.company_projects,public.company_project_members,public.company_project_budgets,public.company_wage_runs FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.company_projects,public.company_project_members,public.company_project_budgets,public.company_wage_runs TO authenticated;
GRANT ALL ON public.company_projects,public.company_project_members,public.company_project_budgets,public.company_wage_runs TO service_role;
CREATE POLICY company_projects_select ON public.company_projects FOR SELECT TO authenticated USING(public.waves_company_project_visible(group_id,id));
CREATE POLICY company_project_members_select ON public.company_project_members FOR SELECT TO authenticated USING(public.waves_company_detail(group_id,member_id));
CREATE POLICY company_project_budgets_select ON public.company_project_budgets FOR SELECT TO authenticated USING(public.waves_company_detail(group_id,public.waves_my_member_id(group_id)) AND public.is_group_admin(group_id));
-- Run headers contain no employee IDs, selections or financial aggregates.
CREATE POLICY company_wage_runs_select ON public.company_wage_runs FOR SELECT TO authenticated USING(public.is_group_admin(group_id) AND public.is_group_member(group_id));
-- Existing activity_log_company_admin already hides company activity from every non-owner.
CREATE POLICY company_invites_privacy ON public.invites AS RESTRICTIVE FOR SELECT TO authenticated
 USING(NOT public.waves_is_company(group_id) OR public.is_group_admin(group_id) OR company_manager_id=public.waves_my_member_id(group_id));

CREATE FUNCTION public.waves_company_people(p_group_id uuid)
 RETURNS TABLE(member_id uuid,display_name text,role text,manager_id uuid,detail boolean)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
DECLARE actor uuid; own_manager uuid; owner boolean; manager boolean;
BEGIN
 actor:=public.waves_company_actor(p_group_id);
 SELECT m.manager_id,m.role::text='admin',m.role::text='manager' INTO own_manager,owner,manager FROM public.group_members m WHERE m.id=actor;
 RETURN QUERY SELECT m.id,coalesce(p.display_name,m.ghost_name,'Someone'),m.role::text,m.manager_id,public.waves_company_detail(p_group_id,m.id)
 FROM public.group_members m LEFT JOIN public.profiles p ON p.id=m.profile_id
 WHERE m.group_id=p_group_id AND m.left_at IS NULL AND m.removed_at IS NULL AND m.merged_into_member_id IS NULL
 AND (owner OR m.id=actor OR m.role::text='admin' OR (manager AND m.role::text='member' AND m.manager_id=actor) OR m.id=own_manager)
 ORDER BY m.id;
END $$;

CREATE FUNCTION public.waves_company_project_set(p_group_id uuid,p_project_id uuid,p_data jsonb) RETURNS uuid
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
BEGIN
 PERFORM public.waves_company_actor(p_group_id);
 IF NOT public.is_group_admin(p_group_id) THEN RAISE EXCEPTION 'ADMIN_ONLY' USING ERRCODE='insufficient_privilege'; END IF;
 IF p_project_id IS NULL OR jsonb_typeof(p_data) IS DISTINCT FROM 'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_data) k WHERE k NOT IN ('name','budgetMinor','archived')) THEN RAISE EXCEPTION 'INVALID_DATA'; END IF;
 PERFORM 1 FROM public.groups WHERE id=p_group_id FOR UPDATE;
 IF EXISTS(SELECT 1 FROM public.company_projects WHERE id=p_project_id AND group_id<>p_group_id) THEN RAISE EXCEPTION 'NOT_ALLOWED'; END IF;
 INSERT INTO public.company_projects(id,group_id,name,archived_at) VALUES(p_project_id,p_group_id,btrim(p_data->>'name'),CASE WHEN coalesce((p_data->>'archived')::boolean,false) THEN now() END)
 ON CONFLICT(id) DO UPDATE SET name=excluded.name,archived_at=excluded.archived_at,updated_at=now();
 INSERT INTO public.company_project_budgets(project_id,group_id,budget_minor) VALUES(p_project_id,p_group_id,(p_data->>'budgetMinor')::bigint)
 ON CONFLICT(project_id) DO UPDATE SET budget_minor=excluded.budget_minor;
 RETURN p_project_id;
END $$;
CREATE FUNCTION public.waves_company_member_projects_set(p_member_id uuid,p_project_ids uuid[]) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
DECLARE g uuid;
BEGIN
 SELECT group_id INTO g FROM public.group_members WHERE id=p_member_id;
 PERFORM public.waves_company_actor(g);
 PERFORM 1 FROM public.groups WHERE id=g FOR UPDATE;
 IF NOT public.is_group_admin(g) AND NOT public.waves_company_team(g,p_member_id) THEN RAISE EXCEPTION 'ADMIN_ONLY' USING ERRCODE='insufficient_privilege'; END IF;
 IF EXISTS(SELECT 1 FROM unnest(p_project_ids) id WHERE NOT EXISTS(SELECT 1 FROM public.company_projects p WHERE p.id=id AND p.group_id=g AND p.archived_at IS NULL AND p.deleted_at IS NULL)) THEN RAISE EXCEPTION 'INVALID_PROJECT'; END IF;
 UPDATE public.company_project_members SET deleted_at=now(),updated_at=now() WHERE member_id=p_member_id AND deleted_at IS NULL AND NOT(project_id=ANY(coalesce(p_project_ids,'{}'::uuid[])));
 INSERT INTO public.company_project_members(group_id,project_id,member_id)
 SELECT g,id,p_member_id FROM (SELECT DISTINCT unnest(p_project_ids) id) s
 ON CONFLICT(project_id,member_id) DO UPDATE SET deleted_at=NULL,updated_at=now();
END $$;
CREATE FUNCTION public.waves_company_member_assign(p_member_id uuid,p_manager_id uuid,p_reason text) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
DECLARE g uuid;
BEGIN
 SELECT group_id INTO g FROM public.group_members WHERE id=p_member_id;
 PERFORM public.waves_company_actor(g);
 PERFORM 1 FROM public.groups WHERE id=g FOR UPDATE;
 IF NOT public.is_group_admin(g) THEN RAISE EXCEPTION 'ADMIN_ONLY' USING ERRCODE='insufficient_privilege'; END IF;
 -- The reason is optional (an owner may note why); a note is capped.
 IF length(btrim(coalesce(p_reason,''))) > 500 THEN RAISE EXCEPTION 'REASON_TOO_LONG'; END IF;
 UPDATE public.group_members SET manager_id=p_manager_id,updated_at=now() WHERE id=p_member_id AND role::text='member' AND left_at IS NULL AND removed_at IS NULL;
 IF NOT FOUND THEN RAISE EXCEPTION 'UNKNOWN_MEMBER'; END IF;
END $$;
CREATE FUNCTION public.waves_company_member_add(p_group_id uuid,p_member_id uuid,p_data jsonb) RETURNS uuid
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
DECLARE actor uuid; manager uuid; r public.group_members%ROWTYPE;
BEGIN
 actor:=public.waves_company_actor(p_group_id);
 PERFORM 1 FROM public.groups WHERE id=p_group_id FOR UPDATE;
 IF NOT EXISTS(SELECT 1 FROM public.group_members WHERE id=actor AND role::text IN ('admin','manager')) THEN RAISE EXCEPTION 'ADMIN_ONLY' USING ERRCODE='insufficient_privilege'; END IF;
 IF p_member_id IS NULL OR jsonb_typeof(p_data) IS DISTINCT FROM 'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_data) k WHERE k NOT IN ('name','managerId','projectIds')) OR coalesce(length(btrim(p_data->>'name')),0) NOT BETWEEN 1 AND 120 THEN RAISE EXCEPTION 'INVALID_DATA'; END IF;
 manager:=CASE WHEN public.is_group_admin(p_group_id) THEN (p_data->>'managerId')::uuid ELSE actor END;
 SELECT * INTO r FROM public.group_members WHERE id=p_member_id;
 IF FOUND THEN
  IF r.group_id=p_group_id AND r.manager_id IS NOT DISTINCT FROM manager AND r.ghost_name=btrim(p_data->>'name') AND public.waves_company_detail(p_group_id,r.id) THEN RETURN r.id; END IF;
  RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT';
 END IF;
 INSERT INTO public.group_members(id,group_id,ghost_name,role,joined_via,manager_id) VALUES(p_member_id,p_group_id,btrim(p_data->>'name'),'member','ghost',manager);
 PERFORM public.waves_company_member_projects_set(p_member_id,ARRAY(SELECT value::uuid FROM jsonb_array_elements_text(coalesce(p_data->'projectIds','[]'))));
 RETURN p_member_id;
END $$;

-- Latest baseline: 20261105090000_company_expenses_2; changed only Phase 4 scope/fields.
CREATE OR REPLACE FUNCTION public.waves_company_entry_values(p_kind text, p_member uuid, p_data jsonb)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
DECLARE v_mode text := COALESCE(p_data->>'calcMode', CASE WHEN p_kind = 'allowance' THEN 'days_rate' ELSE 'typed' END);
 v_days numeric(8,2); v_rate bigint; v_amount bigint; v_direction text;
BEGIN
 IF NOT EXISTS (SELECT 1 FROM public.group_members m WHERE m.id = p_member
  AND public.waves_company_actor(m.group_id) IS NOT NULL
  AND (m.id = public.waves_my_member_id(m.group_id) OR public.is_group_admin(m.group_id) OR public.waves_company_team(m.group_id,m.id))) THEN
  RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE = 'insufficient_privilege';
 END IF;
 IF jsonb_typeof(p_data) IS DISTINCT FROM 'object' OR EXISTS (
  SELECT 1 FROM jsonb_object_keys(p_data) k WHERE k NOT IN ('amount','category','days','rateMinor','calcMode','occurredOn','note','direction')
 ) THEN RAISE EXCEPTION 'INVALID_DATA' USING ERRCODE = 'check_violation'; END IF;
 IF v_mode = 'days_rate' THEN
  v_days := (p_data->>'days')::numeric;
  v_rate := (p_data->>'rateMinor')::bigint;
  IF v_rate IS NULL THEN SELECT coalesce(m.daily_rate_minor,g.company_default_daily_rate_minor) INTO v_rate FROM public.group_members m JOIN public.groups g ON g.id=m.group_id WHERE m.id=p_member; END IF;
  IF v_rate IS NULL OR v_rate < 0 OR v_days IS NULL OR v_days <= 0 THEN
   RAISE EXCEPTION 'INVALID_RATE: days and rate required' USING ERRCODE = 'check_violation';
  END IF;
  v_amount := round(v_days * v_rate)::bigint;
 ELSE v_amount := (p_data->>'amount')::bigint;
 END IF;
 IF p_data->>'occurredOn' IS NULL OR (p_data->>'occurredOn') !~ '^\d{4}-\d{2}-\d{2}$' THEN
  RAISE EXCEPTION 'INVALID_DATE' USING ERRCODE = 'check_violation';
 END IF;
 IF p_kind = 'reimbursement' THEN v_direction := COALESCE(p_data->>'direction','company_to_employee');
 ELSE v_direction := p_data->>'direction'; END IF;
 RETURN p_data || jsonb_build_object('amount',v_amount,'calcMode',v_mode,'days',v_days,'rateMinor',v_rate,'direction',v_direction);
END $$;

-- Latest baseline: 20261108090000_company_expenses_3; changed only Phase 4 scope/fields.
CREATE OR REPLACE FUNCTION public.waves_company_entry_create(p_group_id uuid, p_entry_id uuid, p_member_id uuid, p_entry_kind text, p_data jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_me uuid; v_admin boolean; r public.company_entries%ROWTYPE; d jsonb; v_currency character(3); funding uuid; project uuid; payload_hash text;
BEGIN
 v_me := public.waves_company_actor(p_group_id); v_admin := public.is_group_admin(p_group_id);
 PERFORM 1 FROM public.groups WHERE id=p_group_id FOR UPDATE;
 IF p_entry_kind NOT IN ('expense','allowance','advance','wages','reimbursement') THEN RAISE EXCEPTION 'INVALID_KIND'; END IF;
 IF NOT v_admin AND public.waves_company_team(p_group_id,p_member_id) THEN
  IF p_entry_kind NOT IN ('expense','allowance','advance','reimbursement') THEN RAISE EXCEPTION 'NOT_ALLOWED'; END IF;
 ELSIF NOT v_admin AND NOT public.waves_company_team(p_group_id,p_member_id) AND (p_member_id IS DISTINCT FROM v_me OR p_entry_kind NOT IN ('expense','allowance')) THEN
  RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE='insufficient_privilege';
 END IF;
 funding:=CASE WHEN NOT v_admin AND p_entry_kind IN ('advance','reimbursement') THEN v_me ELSE (p_data->>'fundingManagerId')::uuid END;
 project:=(p_data->>'projectId')::uuid;
 payload_hash:=encode(sha256(convert_to(jsonb_build_array(p_group_id,p_member_id,p_entry_kind,p_data)::text,'UTF8')),'hex');
 -- Serialize same-id creates, including retries from different devices.
 PERFORM pg_advisory_xact_lock(hashtextextended(p_entry_id::text, 0));
 SELECT * INTO r FROM public.company_entries WHERE id = p_entry_id;
 IF FOUND THEN
  IF r.group_id = p_group_id AND public.waves_company_detail(r.group_id,r.member_id) THEN
   IF r.request_hash IS NOT DISTINCT FROM payload_hash THEN RETURN r.id; END IF;
   RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT';
  END IF;
  RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE = 'insufficient_privilege';
 END IF;
 IF NOT v_admin AND NOT public.waves_company_team(p_group_id,p_member_id) AND (p_member_id IS DISTINCT FROM v_me OR p_entry_kind NOT IN ('expense','allowance')) THEN
  RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE = 'insufficient_privilege';
 END IF;
 IF NOT EXISTS (SELECT 1 FROM public.group_members WHERE id = p_member_id AND group_id = p_group_id AND left_at IS NULL) THEN
  RAISE EXCEPTION 'UNKNOWN_MEMBER' USING ERRCODE = 'insufficient_privilege';
 END IF;
 SELECT default_currency INTO v_currency FROM public.groups WHERE id = p_group_id FOR SHARE;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_member_id::text,3));
 d := public.waves_company_entry_values_v3(p_entry_kind,p_member_id,p_data-ARRAY['projectId','fundingManagerId']);
 INSERT INTO public.company_entries(id,group_id,member_id,entry_kind,category,amount,currency,calc_mode,days,rate_minor,occurred_on,direction,note,created_by,updated_by,vendor,gstin,invoice_no,gst_rate_bps,gst_amount_minor,distance_km,from_text,to_text,project_id,funding_manager_id,request_hash)
 VALUES(p_entry_id,p_group_id,p_member_id,p_entry_kind,d->>'category',(d->>'amount')::bigint,v_currency,d->>'calcMode',(d->>'days')::numeric,(d->>'rateMinor')::bigint,(d->>'occurredOn')::date,d->>'direction',d->>'note',v_me,v_me,d->>'vendor',d->>'gstin',d->>'invoiceNo',(d->>'gstRateBps')::integer,(d->>'gstAmountMinor')::bigint,(d->>'distanceKm')::numeric,d->>'fromText',d->>'toText',project,funding,payload_hash);
 RETURN p_entry_id;
END $function$;

-- Latest baseline: 20261108090000_company_expenses_3; changed only Phase 4 scope/fields.
CREATE OR REPLACE FUNCTION public.waves_company_entry_update(p_entry_id uuid, p_patch jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE r public.company_entries%ROWTYPE; v_me uuid; d jsonb;
BEGIN
 r:=public.waves_company_entry_lock(p_entry_id);
 v_me := public.waves_company_actor(r.group_id);
 PERFORM 1 FROM public.groups WHERE id=r.group_id FOR UPDATE;
 IF r.entry_kind IN ('allocation','pool_return','pool_adjustment','wage_payment') THEN RAISE EXCEPTION 'ENTRY_FROZEN'; END IF;
 IF r.id IS NULL OR r.deleted_at IS NOT NULL OR (NOT public.is_group_admin(r.group_id) AND NOT public.waves_company_team(r.group_id,r.member_id) AND
  (r.member_id <> v_me OR r.created_by <> v_me OR r.entry_kind NOT IN ('expense','allowance'))) THEN
  RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE = 'insufficient_privilege';
 END IF;
 IF r.reimbursement_id IS NOT NULL OR r.reimbursement_details IS NOT NULL THEN RAISE EXCEPTION 'ENTRY_REIMBURSED: covered entries are frozen' USING ERRCODE='check_violation'; END IF;
 IF p_patch ? 'fundingManagerId' THEN RAISE EXCEPTION 'FUNDING_IMMUTABLE'; END IF;
 IF p_patch ? 'projectId' THEN UPDATE public.company_entries SET project_id=(p_patch->>'projectId')::uuid WHERE id=p_entry_id; END IF;
 p_patch:=p_patch-'projectId';
 IF jsonb_typeof(p_patch) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'INVALID_DATA' USING ERRCODE = 'check_violation'; END IF;
 d := public.waves_company_entry_values_v3(r.entry_kind,r.member_id,jsonb_build_object(
  'amount',r.amount::text,'category',r.category,'days',r.days::text,'rateMinor',r.rate_minor::text,'calcMode',r.calc_mode,
  'occurredOn',r.occurred_on,'note',r.note,'direction',r.direction,'vendor',r.vendor,'gstin',r.gstin,'invoiceNo',r.invoice_no,'gstRateBps',r.gst_rate_bps,'gstAmountMinor',r.gst_amount_minor::text,'distanceKm',r.distance_km::text,'fromText',r.from_text,'toText',r.to_text) || p_patch);
 UPDATE public.company_entries SET amount=(d->>'amount')::bigint, category=d->>'category',
  days=(d->>'days')::numeric, rate_minor=(d->>'rateMinor')::bigint, calc_mode=d->>'calcMode',
  occurred_on=(d->>'occurredOn')::date,note=d->>'note',direction=d->>'direction',
  vendor=d->>'vendor',gstin=d->>'gstin',invoice_no=d->>'invoiceNo',gst_rate_bps=(d->>'gstRateBps')::integer,gst_amount_minor=(d->>'gstAmountMinor')::bigint,distance_km=(d->>'distanceKm')::numeric,from_text=d->>'fromText',to_text=d->>'toText',
  version=version+1,updated_by=v_me,updated_at=now() WHERE id=p_entry_id;
END $function$;

-- Latest baseline: 20261108090000_company_expenses_3; changed only Phase 4 scope/fields.
CREATE OR REPLACE FUNCTION public.waves_company_entry_void(p_entry_id uuid, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE r public.company_entries%ROWTYPE; v_me uuid;
BEGIN
 r:=public.waves_company_entry_lock(p_entry_id);
 v_me := public.waves_company_actor(r.group_id);
 PERFORM 1 FROM public.groups WHERE id=r.group_id FOR UPDATE;
 IF r.entry_kind IN ('allocation','pool_return','pool_adjustment','wage_payment') THEN RAISE EXCEPTION 'ENTRY_FROZEN'; END IF;
 IF r.id IS NULL OR (NOT public.is_group_admin(r.group_id) AND NOT public.waves_company_team(r.group_id,r.member_id) AND
  (r.member_id <> v_me OR r.created_by <> v_me OR r.entry_kind NOT IN ('expense','allowance'))) THEN
  RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE = 'insufficient_privilege';
 END IF;
 IF r.reimbursement_id IS NOT NULL OR r.reimbursement_details IS NOT NULL THEN RAISE EXCEPTION 'ENTRY_REIMBURSED: covered entries are frozen' USING ERRCODE='check_violation'; END IF;
 IF r.deleted_at IS NOT NULL THEN RETURN; END IF;
 UPDATE public.company_entries SET deleted_at=now(),void_reason=p_reason,version=version+1,updated_by=v_me,updated_at=now() WHERE id=p_entry_id;
END $function$;

-- Latest baseline: 20261108090000_company_expenses_3; changed only Phase 4 scope/fields.
CREATE OR REPLACE FUNCTION public.waves_company_entry_transition(p_entry_id uuid, p_to text, p_note text DEFAULT NULL::text, p_expected_version integer DEFAULT NULL::integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE r public.company_entries%ROWTYPE; actor uuid;
BEGIN
 r:=public.waves_company_entry_lock(p_entry_id);
 actor:=public.waves_company_actor(r.group_id);
 IF NOT public.is_group_admin(r.group_id) AND NOT public.waves_company_team(r.group_id,r.member_id) THEN RAISE EXCEPTION 'ADMIN_ONLY' USING ERRCODE='insufficient_privilege'; END IF;
 IF r.reimbursement_id IS NOT NULL OR r.reimbursement_details IS NOT NULL THEN RAISE EXCEPTION 'ENTRY_REIMBURSED: covered entries are frozen' USING ERRCODE='check_violation'; END IF;
 IF r.deleted_at IS NOT NULL OR r.status<>'submitted' OR p_to IS NULL OR p_to NOT IN ('approved','rejected') THEN RAISE EXCEPTION 'INVALID_TRANSITION' USING ERRCODE='check_violation'; END IF;
 IF p_expected_version IS NULL OR p_expected_version<>r.version THEN RAISE EXCEPTION 'VERSION_CONFLICT: entry changed; refresh before review' USING ERRCODE='check_violation'; END IF;
 IF p_to='rejected' AND (p_note IS NULL OR p_note !~ '[^[:space:]]') THEN RAISE EXCEPTION 'REVIEW_NOTE_REQUIRED: explain the rejection' USING ERRCODE='check_violation'; END IF;
 UPDATE public.company_entries SET status=p_to,review_note=nullif(btrim(p_note),''),reviewed_by=actor,
 reviewed_at=now(),version=version+1,updated_by=actor,updated_at=now() WHERE id=p_entry_id;
END
$function$;

-- Latest baseline: 20261104100000_company_expenses; changed only Phase 4 scope/fields.
CREATE OR REPLACE FUNCTION public.waves_company_member_rate_set(p_group_id uuid,p_member_id uuid,p_daily_rate_minor bigint) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
BEGIN
 PERFORM public.waves_company_actor(p_group_id);
 IF NOT public.is_group_admin(p_group_id) AND NOT public.waves_company_team(p_group_id,p_member_id) THEN RAISE EXCEPTION 'ADMIN_ONLY' USING ERRCODE = 'insufficient_privilege'; END IF;
 UPDATE public.group_members SET daily_rate_minor=p_daily_rate_minor, updated_at=now()
 WHERE id=p_member_id AND group_id=p_group_id AND left_at IS NULL;
 IF NOT FOUND THEN RAISE EXCEPTION 'UNKNOWN_MEMBER' USING ERRCODE = 'insufficient_privilege'; END IF;
 -- group_members_stamp_seq stamps this update just like all membership changes.
END $$;

-- Latest baseline: 20261108090000_company_expenses_3; changed only Phase 4 scope/fields.
CREATE OR REPLACE FUNCTION public.waves_company_mileage_rate_set(p_group_id uuid,p_member_id uuid,p_rate_minor bigint) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
BEGIN
 PERFORM public.waves_company_actor(p_group_id);
 IF NOT public.is_group_admin(p_group_id) AND NOT public.waves_company_team(p_group_id,p_member_id) THEN RAISE EXCEPTION 'ADMIN_ONLY' USING ERRCODE='insufficient_privilege'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.groups WHERE id=p_group_id AND deleted_at IS NULL) THEN RAISE EXCEPTION 'GROUP_DELETED' USING ERRCODE='check_violation'; END IF;
 IF p_rate_minor<0 THEN RAISE EXCEPTION 'INVALID_RATE: mileage rate must be nonnegative' USING ERRCODE='check_violation'; END IF;
 IF p_member_id IS NULL THEN
  UPDATE public.groups SET company_default_mileage_rate_minor=p_rate_minor,updated_at=now() WHERE id=p_group_id;
 ELSE
  UPDATE public.group_members SET mileage_rate_minor=p_rate_minor,updated_at=now() WHERE id=p_member_id AND group_id=p_group_id AND left_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'UNKNOWN_MEMBER' USING ERRCODE='insufficient_privilege'; END IF;
 END IF;
END $$;

-- Latest baseline: 20261105090000_company_expenses_2; changed only Phase 4 scope/fields.
CREATE OR REPLACE FUNCTION public.waves_company_review_guard() RETURNS trigger
 LANGUAGE plpgsql  SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $fn$
BEGIN
 IF NEW.deleted_at IS NULL AND NOT EXISTS(SELECT 1 FROM public.groups WHERE id=NEW.group_id AND deleted_at IS NULL) THEN RAISE EXCEPTION 'GROUP_DELETED'; END IF;
 IF NEW.entry_kind IN ('allocation','pool_return','pool_adjustment','wage_payment') OR (NEW.entry_kind IN ('advance','reimbursement') AND EXISTS(SELECT 1 FROM public.group_members WHERE id=NEW.created_by AND role::text='manager')) THEN NEW.status:='approved'; RETURN NEW; END IF;
 IF TG_OP='INSERT' THEN
  IF (SELECT company_approvals_enabled FROM public.groups WHERE id=NEW.group_id) THEN NEW.status:='submitted'; END IF;
 ELSIF NEW.deleted_at IS NULL AND
  (to_jsonb(NEW)-ARRAY['status','review_note','reviewed_by','reviewed_at','version','updated_by','updated_at','updated_seq'])
  IS DISTINCT FROM
  (to_jsonb(OLD)-ARRAY['status','review_note','reviewed_by','reviewed_at','version','updated_by','updated_at','updated_seq'])
  AND (SELECT company_approvals_enabled FROM public.groups WHERE id=NEW.group_id) THEN
  NEW.status:='submitted'; NEW.review_note:=NULL; NEW.reviewed_by:=NULL; NEW.reviewed_at:=NULL;
 ELSIF NEW.deleted_at IS NULL AND OLD.status='rejected' AND NEW.status='rejected'
  AND (to_jsonb(NEW)-ARRAY['status','review_note','reviewed_by','reviewed_at','version','updated_by','updated_at','updated_seq'])
  IS DISTINCT FROM
  (to_jsonb(OLD)-ARRAY['status','review_note','reviewed_by','reviewed_at','version','updated_by','updated_at','updated_seq']) THEN
  -- Approvals are off and a rejected claim was edited: it is approved again, not stuck out of the balance.
  NEW.status:='approved'; NEW.review_note:=NULL; NEW.reviewed_by:=NULL; NEW.reviewed_at:=NULL;
 END IF;
 RETURN NEW;
END
$fn$;

-- Latest baseline: 20261108090000_company_expenses_3; changed only Phase 4 scope/fields.
CREATE OR REPLACE FUNCTION public.waves_company_phase3_entry_guard() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
DECLARE rule jsonb; actual numeric; start_on date; end_on date; cover public.company_entries%ROWTYPE;
BEGIN
 IF TG_OP='DELETE' THEN
  IF OLD.reimbursement_id IS NOT NULL OR OLD.reimbursement_details IS NOT NULL THEN RAISE EXCEPTION 'ENTRY_REIMBURSED: covered entries are frozen' USING ERRCODE='check_violation'; END IF;
  RETURN OLD;
 END IF;
 -- UPDATE/DELETE already hold a row lock: callers must lock via waves_company_entry_lock first.
 IF TG_OP='INSERT' THEN PERFORM pg_advisory_xact_lock(hashtextextended(NEW.member_id::text,3)); END IF;
 IF TG_OP='UPDATE' AND (OLD.reimbursement_id IS NOT NULL OR OLD.reimbursement_details IS NOT NULL) THEN
  RAISE EXCEPTION 'ENTRY_REIMBURSED: covered entries are frozen' USING ERRCODE='check_violation';
 END IF;
 IF NEW.reimbursement_id IS NOT NULL THEN
  SELECT * INTO cover FROM public.company_entries WHERE id=NEW.reimbursement_id;
  IF cover.id IS NULL OR cover.group_id<>NEW.group_id OR cover.member_id<>NEW.member_id OR ((cover.entry_kind<>'reimbursement' OR cover.reimbursement_details IS NULL) AND cover.entry_kind<>'wage_payment')
   OR current_setting('waves.company_reimburse',true) IS DISTINCT FROM cover.id::text THEN
   RAISE EXCEPTION 'INVALID_REIMBURSEMENT_LINK' USING ERRCODE='check_violation'; END IF;
  NEW.status:=CASE WHEN NEW.entry_kind IN ('expense','allowance') THEN 'reimbursed' ELSE OLD.status END;
  NEW.review_note:=OLD.review_note; NEW.reviewed_by:=OLD.reviewed_by; NEW.reviewed_at:=OLD.reviewed_at;
 END IF;
 IF NEW.reimbursement_details IS NOT NULL THEN
  IF NEW.entry_kind<>'reimbursement' OR NEW.direction<>'company_to_employee' OR current_setting('waves.company_reimburse',true) IS DISTINCT FROM NEW.id::text THEN
   RAISE EXCEPTION 'INVALID_REIMBURSEMENT_LINK' USING ERRCODE='check_violation'; END IF;
  NEW.status:='approved';
 END IF;
 NEW.gstin:=upper(btrim(NEW.gstin));
 IF (NEW.vendor IS NOT NULL OR NEW.gstin IS NOT NULL OR NEW.invoice_no IS NOT NULL OR NEW.gst_rate_bps IS NOT NULL OR NEW.gst_amount_minor IS NOT NULL)
  AND (NEW.entry_kind<>'expense' OR NEW.calc_mode<>'typed' OR NEW.currency<>'INR' OR NOT EXISTS(SELECT 1 FROM public.groups WHERE id=NEW.group_id AND country_code='IN')) THEN
  RAISE EXCEPTION 'GST_NOT_APPLICABLE: GST requires an IN/INR typed expense' USING ERRCODE='check_violation'; END IF;
 IF NOT public.waves_company_gstin_valid(NEW.gstin) THEN RAISE EXCEPTION 'INVALID_GSTIN: invalid format, state code or checksum' USING ERRCODE='check_violation'; END IF;
 IF NEW.calc_mode='distance_rate' THEN
  NEW.amount:=trunc((NEW.distance_km*100*NEW.rate_minor+50)/100)::bigint;
 END IF;
 IF NEW.deleted_at IS NULL AND NEW.entry_kind IN ('expense','allowance') AND NEW.status IN ('submitted','approved','reimbursed') THEN
  -- Bulk status/link updates preserve previously approved claims; settings are prospective.
  IF NEW.reimbursement_id IS NOT NULL THEN RETURN NEW; END IF;
  FOR rule IN SELECT value FROM public.groups g,jsonb_array_elements(g.company_policies->'rules') WHERE g.id=NEW.group_id LOOP
   IF rule->>'type'<>'period_limit' OR rule->>'effect'<>'block' OR rule->>'target'<>(CASE WHEN NEW.entry_kind='allowance' THEN 'allowance' ELSE coalesce(NEW.category,'other') END) THEN CONTINUE; END IF;
   start_on:=CASE WHEN rule->>'period'='month' THEN date_trunc('month',NEW.occurred_on)::date ELSE NEW.occurred_on END;
   end_on:=CASE WHEN rule->>'period'='month' THEN (start_on+interval '1 month')::date ELSE start_on+1 END;
   SELECT coalesce(sum(amount),0)+NEW.amount INTO actual FROM public.company_entries
    WHERE group_id=NEW.group_id AND member_id=NEW.member_id AND id<>NEW.id AND deleted_at IS NULL
    AND status IN ('submitted','approved','reimbursed') AND occurred_on>=start_on AND occurred_on<end_on
    AND CASE WHEN rule->>'target'='allowance' THEN entry_kind='allowance' ELSE entry_kind='expense' AND coalesce(category,'other')=rule->>'target' END;
   IF actual>(rule->>'limitMinor')::numeric THEN RAISE EXCEPTION 'POLICY_BLOCKED: period limit exceeded (rule %)',rule->>'id' USING ERRCODE='check_violation'; END IF;
  END LOOP;
 END IF;
 RETURN NEW;
END $$;

-- Latest baseline: main (#1488 self-heal version); changed only Phase 4 scope, wage recovery credit and funding.
CREATE OR REPLACE FUNCTION public.waves_company_reimburse(p_group_id uuid, p_reimbursement_id uuid, p_member_id uuid, p_claims jsonb, p_adjustments jsonb, p_cutoff date, p_paid_on date, p_expected_amount_minor bigint, p_note text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE actor uuid; existing public.company_entries%ROWTYPE; r public.company_entries%ROWTYPE; item jsonb;
 claims jsonb; ids uuid[]; claim_ids uuid[]; adjustment_ids uuid[]; selected_ids uuid[]; changed_ids uuid[]:='{}'; skipped_ids uuid[];
 claims_minor numeric:=0; credits_minor numeric:=0; payout numeric; request_hash text; currency character(3);
BEGIN
 actor:=public.waves_company_actor(p_group_id);
 IF NOT public.is_group_admin(p_group_id) AND NOT public.waves_company_team(p_group_id,p_member_id) THEN RAISE EXCEPTION 'ADMIN_ONLY' USING ERRCODE='insufficient_privilege'; END IF;
 IF p_reimbursement_id IS NULL OR p_member_id IS NULL OR p_cutoff IS NULL OR p_paid_on IS NULL OR p_expected_amount_minor IS NULL OR p_expected_amount_minor<0
 OR length(p_note)>500 OR jsonb_typeof(p_claims) IS DISTINCT FROM 'array' OR jsonb_typeof(p_adjustments) IS DISTINCT FROM 'array' THEN
  RAISE EXCEPTION 'INVALID_DATA' USING ERRCODE='check_violation'; END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(p_claims||p_adjustments) LOOP
  IF jsonb_typeof(item) IS DISTINCT FROM 'object' OR jsonb_typeof(item->'entryId') IS DISTINCT FROM 'string'
  OR coalesce(item->>'entryId','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  OR jsonb_typeof(item->'expectedVersion') IS DISTINCT FROM 'number' OR coalesce(item->>'expectedVersion','') !~ '^[1-9][0-9]{0,9}$'
  OR (item->>'expectedVersion')::numeric>2147483647
  OR EXISTS(SELECT 1 FROM jsonb_object_keys(item) k WHERE k NOT IN ('entryId','expectedVersion')) THEN
   RAISE EXCEPTION 'INVALID_DATA' USING ERRCODE='check_violation'; END IF;
 END LOOP;
 SELECT jsonb_agg(jsonb_build_object('entryId',(value->>'entryId')::uuid,'expectedVersion',(value->>'expectedVersion')::integer) ORDER BY (value->>'entryId')::uuid),array_agg((value->>'entryId')::uuid ORDER BY (value->>'entryId')::uuid)
 INTO claims,selected_ids FROM jsonb_array_elements(p_claims);
 claims:=coalesce(claims,'[]'::jsonb); selected_ids:=coalesce(selected_ids,'{}'::uuid[]);
 SELECT coalesce(array_agg((value->>'entryId')::uuid ORDER BY (value->>'entryId')::uuid),'{}'::uuid[])
 INTO adjustment_ids FROM jsonb_array_elements(p_adjustments);
 ids:=selected_ids||adjustment_ids;
 IF cardinality(ids)<>(SELECT count(DISTINCT id) FROM unnest(ids) id) OR p_reimbursement_id=ANY(ids) THEN RAISE EXCEPTION 'INVALID_DATA' USING ERRCODE='check_violation'; END IF;
 request_hash:=encode(sha256(convert_to(jsonb_build_object('groupId',p_group_id,'memberId',p_member_id,'claims',to_jsonb(selected_ids),'cutoff',p_cutoff,'paidOn',p_paid_on,'expectedAmountMinor',p_expected_amount_minor::text,'note',p_note)::text,'UTF8')),'hex');
 PERFORM pg_advisory_xact_lock(hashtextextended(p_reimbursement_id::text,0));
 SELECT * INTO existing FROM public.company_entries WHERE id=p_reimbursement_id;
 IF FOUND THEN
  IF existing.group_id<>p_group_id THEN RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE='insufficient_privilege'; END IF;
  IF existing.reimbursement_details->>'requestHash' IS NOT DISTINCT FROM request_hash THEN RETURN existing.id; END IF;
  RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT: reimbursement ID already used with different payload' USING ERRCODE='check_violation';
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_member_id::text,3));
 IF NOT EXISTS(SELECT 1 FROM public.group_members WHERE id=p_member_id AND group_id=p_group_id AND left_at IS NULL) THEN RAISE EXCEPTION 'UNKNOWN_MEMBER' USING ERRCODE='insufficient_privilege'; END IF;
 SELECT default_currency INTO currency FROM public.groups WHERE id=p_group_id AND deleted_at IS NULL FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'GROUP_DELETED' USING ERRCODE='check_violation'; END IF;
 -- Lock selected claims and eligible credits in stable ID order before reading them.
 -- Claim kinds only, so claim locks never overlap the credit locks below (no lock-order cycle); the member advisory lock above serialises credit inserts/approvals.
 PERFORM id FROM public.company_entries WHERE id=ANY(selected_ids) AND entry_kind IN ('expense','allowance') ORDER BY id FOR UPDATE;
 PERFORM id FROM public.company_entries WHERE group_id=p_group_id AND member_id=p_member_id AND deleted_at IS NULL AND status='approved'
 AND reimbursement_id IS NULL AND reimbursement_details IS NULL AND occurred_on<=p_cutoff AND entry_kind IN ('advance','reimbursement') ORDER BY id FOR UPDATE;
 claim_ids:='{}'::uuid[];
 FOR item IN SELECT value FROM jsonb_array_elements(claims) LOOP
  SELECT * INTO r FROM public.company_entries WHERE id=(item->>'entryId')::uuid;
  IF FOUND AND r.group_id=p_group_id AND r.member_id=p_member_id AND r.deleted_at IS NULL
  AND r.status='approved' AND r.reimbursement_id IS NULL AND r.reimbursement_details IS NULL AND r.occurred_on<=p_cutoff
  AND r.entry_kind IN ('expense','allowance') THEN
   claim_ids:=array_append(claim_ids,r.id); claims_minor:=claims_minor+r.amount;
   IF r.version<>(item->>'expectedVersion')::integer THEN changed_ids:=array_append(changed_ids,r.id); END IF;
  END IF;
 END LOOP;
 SELECT coalesce(array_agg(id ORDER BY id),'{}'::uuid[]),
 coalesce(sum(CASE WHEN entry_kind='reimbursement' AND direction='employee_to_company' THEN -amount ELSE amount END),0)
 INTO adjustment_ids,credits_minor FROM public.company_entries
 WHERE group_id=p_group_id AND member_id=p_member_id AND deleted_at IS NULL AND status='approved'
 AND reimbursement_id IS NULL AND reimbursement_details IS NULL AND occurred_on<=p_cutoff AND entry_kind IN ('advance','reimbursement');
 -- Phase 4: advance already taken back through wage runs is not a credit any more.
 credits_minor:=credits_minor-(SELECT coalesce(sum(recovery_minor),0) FROM public.company_entries WHERE group_id=p_group_id AND member_id=p_member_id AND entry_kind='wage_payment' AND deleted_at IS NULL AND period_end<=p_cutoff);
 payout:=claims_minor-credits_minor;
 -- Version changes are tolerated unless they would exceed the requested ceiling.
 IF payout>p_expected_amount_minor THEN
  SELECT coalesce(array_agg(id ORDER BY id),'{}'::uuid[]),coalesce(sum(amount),0) INTO claim_ids,claims_minor
  FROM public.company_entries WHERE id=ANY(claim_ids) AND NOT (id=ANY(changed_ids));
  payout:=claims_minor-credits_minor;
 END IF;
 IF payout>p_expected_amount_minor OR payout<0 OR cardinality(claim_ids)=0 THEN RETURN NULL; END IF;
 SELECT coalesce(array_agg(id ORDER BY id),'{}'::uuid[]) INTO skipped_ids FROM unnest(selected_ids) id WHERE NOT (id=ANY(claim_ids));
 ids:=claim_ids||adjustment_ids;
 PERFORM set_config('waves.company_reimburse',p_reimbursement_id::text,true);
 INSERT INTO public.company_entries(id,group_id,member_id,entry_kind,amount,currency,occurred_on,direction,status,note,created_by,updated_by,reimbursement_details,funding_manager_id)
 VALUES(p_reimbursement_id,p_group_id,p_member_id,'reimbursement',payout::bigint,currency,p_paid_on,'company_to_employee','approved',p_note,actor,actor,
 jsonb_build_object('requestHash',request_hash,'cutoff',p_cutoff,'claimIds',to_jsonb(claim_ids),'adjustmentIds',to_jsonb(adjustment_ids),'skippedIds',to_jsonb(skipped_ids),'claimsMinor',claims_minor::text,'creditsMinor',credits_minor::text,'payoutMinor',payout::text),CASE WHEN public.is_group_admin(p_group_id) THEN NULL ELSE actor END);
 UPDATE public.company_entries SET reimbursement_id=p_reimbursement_id,
 status=CASE WHEN id=ANY(claim_ids) THEN 'reimbursed' ELSE status END,version=version+1,updated_by=actor,updated_at=now() WHERE id=ANY(ids);
 PERFORM set_config('waves.company_reimburse','',true);
 RETURN p_reimbursement_id;
END $function$;

-- Latest baseline: 20261104100000_company_expenses; changed only Phase 4 scope/fields.
CREATE OR REPLACE FUNCTION public.waves_profiles_share_group(p_a uuid, p_b uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  SELECT p_a = p_b OR EXISTS (
    SELECT 1
      FROM public.group_members ma
      JOIN public.group_members mb ON mb.group_id = ma.group_id
     WHERE ma.profile_id = p_a AND ma.left_at IS NULL
       AND mb.profile_id = p_b AND mb.left_at IS NULL
       AND (NOT public.waves_is_company(ma.group_id) OR public.waves_company_detail(ma.group_id,mb.id))
  );
$$;

-- Latest baseline: 20261104100000_company_expenses; changed only Phase 4 scope/fields.
CREATE OR REPLACE FUNCTION public.waves_shares_a_group_with(p_profile_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  SELECT p_profile_id IS NOT NULL
     AND (
       -- Your own face, always.
       p_profile_id = public.waves_current_profile_id()
       OR EXISTS (
         SELECT 1
         FROM public.group_members mine
         JOIN public.group_members theirs ON theirs.group_id = mine.group_id
         WHERE mine.profile_id = public.waves_current_profile_id()
           AND theirs.profile_id = p_profile_id
           AND mine.left_at IS NULL
           AND (NOT public.waves_is_company(mine.group_id) OR public.waves_company_detail(mine.group_id,theirs.id))
       )
     )
$$;

-- Latest baseline: 20261104100000_company_expenses; changed only Phase 4 scope/fields.
CREATE OR REPLACE FUNCTION public.waves_person_profile(p_person_key text)
RETURNS TABLE(
  person_key       text,
  display_name     text,
  avatar_url       text,
  is_ghost         boolean,
  is_you           boolean,
  shared_groups    integer,
  email            text,
  phone            text,
  payment_rail     text,
  payment_handle   text,
  country_code     character(2),
  -- The difference between "they have not told us" and "they have told us not
  -- to tell you". A screen that cannot tell those apart has to write a weasel
  -- sentence covering both; with this it can say the true one.
  contact_withheld boolean
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_me      uuid := public.waves_current_profile_id();
  v_profile uuid;
  v_shared  integer := 0;
  v_name    text;
  v_avatar  text;
  v_rail    text;
  v_handle  text;
  v_country character(2);
  v_ghost   boolean := true;
  v_visible boolean := false;
  v_email   text;
  v_phone   text;
BEGIN
  IF v_me IS NULL OR p_person_key IS NULL OR btrim(p_person_key) = '' THEN
    RETURN;
  END IF;

  -- Case 1: the key is a real account.
  IF p_person_key ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    SELECT p.id, p.display_name, p.avatar_url, p.payment_rail, p.payment_handle,
           p.country_code, (p.contact_visibility = 'groups')
      INTO v_profile, v_name, v_avatar, v_rail, v_handle, v_country, v_visible
      FROM public.profiles p
     WHERE p.id = p_person_key::uuid;
  END IF;

  IF v_profile IS NOT NULL THEN
    v_ghost := false;

    IF v_profile = v_me THEN
      -- Looking at yourself: your own contact details are always yours to see,
      -- and "shared groups" means every group you are in — every group that
      -- still exists, that is.
      v_shared := (SELECT count(*)::int
                     FROM public.group_members gm
                     JOIN public.groups g ON g.id = gm.group_id AND g.deleted_at IS NULL
                    WHERE gm.profile_id = v_me AND gm.left_at IS NULL);
      v_visible := true;
    ELSE
      -- The shared-group count doubles as the permission check.
      SELECT count(DISTINCT mine.group_id)::int INTO v_shared
        FROM public.group_members mine
        JOIN public.groups g
          ON g.id = mine.group_id
         AND g.deleted_at IS NULL
        JOIN public.group_members theirs
          ON theirs.group_id = mine.group_id
         AND theirs.left_at IS NULL
         AND theirs.profile_id = v_profile
       WHERE mine.profile_id = v_me
         AND mine.left_at IS NULL
         AND (g.type <> 'company' OR public.waves_company_detail(g.id,theirs.id));

      IF coalesce(v_shared, 0) = 0 THEN
        RETURN;
      END IF;
    END IF;

  ELSE
    -- Cases 2 and 3: a merged ghost (the caller's own merge) or a plain ghost.
    -- Either way there is no account, so there is nothing to reveal and the
    -- only question is whether the caller can see this person at all.
    SELECT max(coalesce(mrg.display_name, gm.ghost_name, 'Someone')),
           count(DISTINCT gm.group_id)::int
      INTO v_name, v_shared
      FROM public.group_members gm
      JOIN public.groups g
        ON g.id = gm.group_id
       AND g.deleted_at IS NULL
      JOIN public.group_members mine
        ON mine.group_id = gm.group_id
       AND mine.profile_id = v_me
       AND mine.left_at IS NULL
      LEFT JOIN public.ghost_merges mrg
        ON mrg.member_id = gm.id
       AND mrg.owner = v_me
     WHERE gm.left_at IS NULL
       AND (g.type <> 'company' OR public.waves_company_detail(g.id,gm.id))
       AND gm.profile_id IS NULL
       AND coalesce(mrg.person_id::text, gm.id::text) = p_person_key;

    IF coalesce(v_shared, 0) = 0 THEN
      RETURN;
    END IF;
  END IF;

  -- The reveal. Guarded on a real `auth.users` for the same reason every other
  -- read of it in this schema is: the DB test suite and the self-host stack run
  -- these RPCs against a Postgres with no `auth` schema, or with a stub one,
  -- where the right answer is "no contact on file", not an error.
  IF NOT v_ghost AND v_visible AND public.waves_auth_contact_readable() THEN
    SELECT nullif(btrim(lower(coalesce(u.email, ''))), ''),
           -- Stored bare in `auth.users`; the '+' is put back so the number is
           -- dialable and reads like every other number in the app.
           CASE WHEN nullif(btrim(coalesce(u.phone, '')), '') IS NULL THEN NULL
                ELSE '+' || regexp_replace(u.phone, '[^0-9]', '', 'g') END
      INTO v_email, v_phone
      FROM auth.users u
     WHERE u.id = v_profile
       AND u.deleted_at IS NULL;
  END IF;

  person_key       := p_person_key;
  display_name     := coalesce(v_name, 'Someone');
  avatar_url       := v_avatar;
  is_ghost         := v_ghost;
  is_you           := (v_profile IS NOT NULL AND v_profile = v_me);
  shared_groups    := coalesce(v_shared, 0);
  email            := v_email;
  phone            := v_phone;
  payment_rail     := CASE WHEN v_visible THEN v_rail ELSE NULL END;
  payment_handle   := CASE WHEN v_visible THEN v_handle ELSE NULL END;
  country_code     := CASE WHEN v_visible THEN v_country ELSE NULL END;
  contact_withheld := (NOT v_ghost) AND (NOT v_visible);
  RETURN NEXT;
END
$fn$;

-- Latest baseline: 20261104100000_company_expenses; changed only Phase 4 scope/fields.
CREATE OR REPLACE FUNCTION public.waves_member_link_candidates(p_group_id uuid)
RETURNS TABLE(
  profile_id   uuid,
  display_name text,
  avatar_url   text
)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  SELECT DISTINCT ON (p.id) p.id, p.display_name, p.avatar_url
    FROM public.group_members mine
    JOIN public.group_members theirs
      ON theirs.group_id = mine.group_id
     AND theirs.profile_id IS NOT NULL
     AND theirs.left_at IS NULL
     AND theirs.profile_id <> mine.profile_id
    JOIN public.profiles p ON p.id = theirs.profile_id
   WHERE mine.profile_id = public.waves_current_profile_id()
     AND mine.left_at IS NULL
     AND (NOT public.waves_is_company(mine.group_id) OR public.waves_company_detail(mine.group_id,theirs.id))
     AND EXISTS (
       SELECT 1 FROM public.group_members gm
        WHERE gm.group_id = p_group_id
          AND gm.profile_id = public.waves_current_profile_id()
          AND gm.left_at IS NULL
     )
     AND NOT EXISTS (
       SELECT 1 FROM public.group_members here
        WHERE here.group_id = p_group_id
          AND here.profile_id = p.id
          AND here.left_at IS NULL
     )
     AND NOT public.waves_is_guest(p.id)
   ORDER BY p.id, p.display_name
   LIMIT 200;
$$;

-- Latest baseline: 20261104100000_company_expenses; changed only Phase 4 scope/fields.
CREATE OR REPLACE FUNCTION public.waves_guard_membership_columns()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF current_user NOT IN ('anon', 'authenticated') THEN
    RETURN NEW;
  END IF;

  IF NEW.manager_id IS DISTINCT FROM OLD.manager_id THEN RAISE EXCEPTION 'FORBIDDEN_COLUMN: use member assign' USING ERRCODE='insufficient_privilege'; END IF;
  IF NEW.daily_rate_minor IS DISTINCT FROM OLD.daily_rate_minor THEN
    RAISE EXCEPTION 'FORBIDDEN_COLUMN: use company member rate RPC' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NEW.role IS DISTINCT FROM OLD.role THEN
    RAISE EXCEPTION 'FORBIDDEN_COLUMN: a role is not yours to change'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NEW.profile_id IS DISTINCT FROM OLD.profile_id THEN
    RAISE EXCEPTION 'FORBIDDEN_COLUMN: a ghost is claimed by an admin approving a request, not by an update'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NEW.group_id IS DISTINCT FROM OLD.group_id THEN
    RAISE EXCEPTION 'FORBIDDEN_COLUMN: a membership cannot move between groups'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NEW.removed_at IS DISTINCT FROM OLD.removed_at
     OR NEW.removed_by IS DISTINCT FROM OLD.removed_by THEN
    RAISE EXCEPTION 'FORBIDDEN_COLUMN: a removal is recorded by waves_remove_member, not by an update'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF OLD.removed_at IS NOT NULL AND NEW.left_at IS DISTINCT FROM OLD.left_at THEN
    RAISE EXCEPTION 'FORBIDDEN_COLUMN: a removed member comes back through a new invite, not an update'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NEW.merged_into_member_id IS DISTINCT FROM OLD.merged_into_member_id THEN
    RAISE EXCEPTION 'FORBIDDEN_COLUMN: a placeholder is merged by waves_merge_member_into, not by an update'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF OLD.profile_id IS NULL
     AND (NEW.vpa IS DISTINCT FROM OLD.vpa
       OR NEW.payment_handle IS DISTINCT FROM OLD.payment_handle
       OR NEW.payment_rail IS DISTINCT FROM OLD.payment_rail
       OR NEW.invite_email IS DISTINCT FROM OLD.invite_email
       OR NEW.invite_phone IS DISTINCT FROM OLD.invite_phone)
     AND NOT public.is_group_admin(OLD.group_id) THEN
    RAISE EXCEPTION 'FORBIDDEN_COLUMN: only an admin changes a placeholder''s payment or contact details'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN NEW;
END
$function$
;

-- Latest baseline: 20261104100000_company_expenses; changed only Phase 4 scope/fields.
CREATE OR REPLACE FUNCTION public.waves_add_ghost_member(
  p_group_id uuid,
  p_name text,
  p_member_id uuid DEFAULT NULL::uuid,
  p_email text DEFAULT NULL::text,
  p_phone text DEFAULT NULL::text,
  p_profile_id uuid DEFAULT NULL::uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_profile_id uuid := public.waves_current_profile_id();
  v_member_id  uuid;
  v_email      text := nullif(btrim(lower(coalesce(p_email, ''))), '');
  v_phone      text := nullif(regexp_replace(coalesce(p_phone, ''), '[^0-9+]', '', 'g'), '');
  v_name       text := nullif(btrim(coalesce(p_name, '')), '');
  v_phone_bare text;
  v_target     uuid;
  v_existing   public.group_members%ROWTYPE;
  v_group_name text;
  v_actor_name text;
BEGIN
  IF v_profile_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.group_members gm
    WHERE gm.group_id = p_group_id AND gm.profile_id = v_profile_id AND gm.left_at IS NULL
  ) THEN
    RAISE EXCEPTION 'NOT_A_MEMBER: you are not in that group'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF public.waves_is_company(p_group_id) AND NOT public.is_group_admin(p_group_id) AND NOT EXISTS(SELECT 1 FROM public.group_members WHERE group_id=p_group_id AND profile_id=v_profile_id AND role::text='manager' AND left_at IS NULL AND removed_at IS NULL) THEN
    RAISE EXCEPTION 'ADMIN_ONLY' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF public.waves_is_company(p_group_id) THEN PERFORM public.waves_company_actor(p_group_id); PERFORM 1 FROM public.groups WHERE id=p_group_id FOR UPDATE; END IF;
  -- A name is no longer required, because picking an email out of a contact
  -- card often carries no usable one. Something is still required.
  IF v_name IS NULL AND v_email IS NULL AND v_phone IS NULL THEN
    RAISE EXCEPTION 'NOTHING_TO_ADD: give a name, an email or a number'
      USING ERRCODE = 'check_violation';
  END IF;

  -- A number typed without its country code cannot be assumed Indian just
  -- because this is an India-first app — somebody on a trip is exactly the
  -- person whose contacts are foreign. Reject rather than guess wrong.
  IF v_phone IS NOT NULL AND v_phone !~ '^\+' THEN
    RAISE EXCEPTION 'PHONE_NEEDS_COUNTRY_CODE: % has no country code', v_phone
      USING ERRCODE = 'check_violation';
  END IF;

  -- Replay of a queued offline mutation returns the same member (ADR-005).
  IF p_member_id IS NOT NULL THEN
    SELECT id INTO v_member_id FROM public.group_members
     WHERE id = p_member_id AND group_id = p_group_id;
    IF FOUND THEN
      IF public.waves_is_company(p_group_id) AND NOT public.waves_company_detail(p_group_id,v_member_id) THEN RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE='insufficient_privilege'; END IF;
      RETURN v_member_id;
    END IF;
  END IF;

  -- Adding the same person twice is the common accident when picking from a
  -- contact list, and two ghosts for one human split their balance in half.
  -- Matched on contact rather than name: two people really can be called Ravi.
  IF v_email IS NOT NULL OR v_phone IS NOT NULL THEN
    SELECT gm.id INTO v_member_id
      FROM public.group_members gm
     WHERE gm.group_id = p_group_id
       AND gm.left_at IS NULL
       AND ((v_email IS NOT NULL AND gm.invite_email = v_email)
         OR (v_phone IS NOT NULL AND gm.invite_phone = v_phone))
     LIMIT 1;
    IF v_member_id IS NOT NULL THEN
      IF public.waves_is_company(p_group_id) AND NOT public.waves_company_detail(p_group_id,v_member_id) THEN RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE='insufficient_privilege'; END IF;
      RETURN v_member_id;
    END IF;
  END IF;

  -- ── Somebody you know, named by their account ──────────────────────────────
  -- Yourself is the row you already have. Anyone else counts only when you
  -- already share a group with them and they have a real account; otherwise
  -- the id is ignored and the add goes on as a contact match or a ghost.
  IF p_profile_id = v_profile_id THEN
    SELECT gm.id INTO v_member_id
      FROM public.group_members gm
     WHERE gm.group_id = p_group_id AND gm.profile_id = v_profile_id AND gm.left_at IS NULL;
    RETURN v_member_id;
  END IF;
  IF p_profile_id IS NOT NULL
     AND public.waves_profiles_share_group(v_profile_id, p_profile_id)
     AND NOT public.waves_is_guest(p_profile_id) THEN
    v_target := p_profile_id;
  END IF;

  -- ── Is this somebody already on Waves? ─────────────────────────────────────
  -- `auth.users` stores phone as bare E.164 digits (no leading '+'), so the
  -- typed number is compared digits to digits.
  --
  -- Guarded on `auth.users` existing: the DB test suite runs these RPCs against
  -- a bare Postgres with no `auth` schema. No auth table means no accounts to
  -- match, so a plain ghost is exactly right.
  IF v_target IS NULL AND to_regclass('auth.users') IS NOT NULL
     AND (v_email IS NOT NULL OR v_phone IS NOT NULL) THEN
    v_phone_bare := nullif(regexp_replace(coalesce(v_phone, ''), '[^0-9]', '', 'g'), '');

    SELECT u.id INTO v_target
      FROM auth.users u
      JOIN public.profiles p ON p.id = u.id
     WHERE u.deleted_at IS NULL
       AND (
         (v_email IS NOT NULL AND lower(u.email) = v_email AND p.discoverable_by_email)
         OR (v_phone_bare IS NOT NULL
             AND p.discoverable_by_phone
             AND regexp_replace(coalesce(u.phone, ''), '[^0-9]', '', 'g') = v_phone_bare)
       )
     ORDER BY (v_email IS NOT NULL AND lower(u.email) = v_email) DESC
     LIMIT 1;

    -- Yourself, picked from your own contacts: you are already in, so that row
    -- is the answer. Checked against your own account whatever its
    -- discoverability, which only hides you from other people.
    IF EXISTS (
      SELECT 1 FROM auth.users u
       WHERE u.id = v_profile_id
         AND ((v_email IS NOT NULL AND lower(u.email) = v_email)
           OR (v_phone_bare IS NOT NULL
               AND regexp_replace(coalesce(u.phone, ''), '[^0-9]', '', 'g') = v_phone_bare))
    ) THEN
      SELECT gm.id INTO v_member_id
        FROM public.group_members gm
       WHERE gm.group_id = p_group_id AND gm.profile_id = v_profile_id AND gm.left_at IS NULL;
      IF public.waves_is_company(p_group_id) AND NOT public.waves_company_detail(p_group_id,v_member_id) THEN RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE='insufficient_privilege'; END IF;
      RETURN v_member_id;
    END IF;

    IF v_target = v_profile_id THEN
      v_target := NULL;
    END IF;
  END IF;

  IF v_target IS NOT NULL THEN
    SELECT * INTO v_existing
      FROM public.group_members gm
     WHERE gm.group_id = p_group_id AND gm.profile_id = v_target;
    IF FOUND THEN
      -- Already inside: that row is who they meant.
      IF v_existing.left_at IS NULL THEN
        IF public.waves_is_company(p_group_id) AND NOT public.waves_company_detail(p_group_id,v_existing.id) THEN RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE='insufficient_privilege'; END IF;
        RETURN v_existing.id;
      END IF;
      -- Left or removed: a ghost, and no tap — they are not being let back in.
      v_target := NULL;
    END IF;
  END IF;

  IF v_target IS NOT NULL THEN
    INSERT INTO public.group_members
      (id, group_id, profile_id, joined_via, invite_email, invite_phone)
    VALUES
      (COALESCE(p_member_id, gen_random_uuid()), p_group_id, v_target, 'contact', v_email, v_phone)
    RETURNING id INTO v_member_id;

    SELECT g.name INTO v_group_name FROM public.groups g WHERE g.id = p_group_id;
    SELECT p.display_name INTO v_actor_name FROM public.profiles p WHERE p.id = v_profile_id;

    PERFORM public.waves_notify(
      v_target,
      p_group_id,
      'group_added',
      -- English fallback only; every current build re-renders from kind +
      -- payload in the reader's own language (see render.ts). `counterparty`
      -- is the fact `{actor}` reads from; `group` is `{group}`.
      coalesce(v_actor_name, 'Someone') || ' added you to ' || coalesce(v_group_name, 'a group'),
      'Tap to open the group',
      'waves://group/' || p_group_id::text,
      jsonb_build_object(
        'counterparty', coalesce(v_actor_name, ''),
        'group',        coalesce(v_group_name, '')
      ),
      'group_added:' || p_group_id::text || ':' || v_target::text
    );

    RETURN v_member_id;
  END IF;

  INSERT INTO public.group_members
    (id, group_id, ghost_name, joined_via, invite_email, invite_phone)
  VALUES
    (COALESCE(p_member_id, gen_random_uuid()), p_group_id,
     COALESCE(v_name, v_email, v_phone), 'ghost', v_email, v_phone)
  RETURNING id INTO v_member_id;

  RETURN v_member_id;
END
$function$;

-- Latest baseline: 20260904000000_waves_baseline; changed only Phase 4 scope/fields.
CREATE OR REPLACE FUNCTION public.waves_set_member_role(p_member_id uuid, p_role text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_group_id   uuid;
  v_profile_id uuid;
  v_old_role   public."MemberRole";
  v_admins     int;
BEGIN
  PERFORM 1 FROM public.groups WHERE id=(SELECT group_id FROM public.group_members WHERE id=p_member_id) FOR UPDATE;
  SELECT group_id, profile_id, role
    INTO v_group_id, v_profile_id, v_old_role
  FROM public.group_members WHERE id = p_member_id;

  IF v_group_id IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND: no such member' USING ERRCODE = 'no_data_found';
  END IF;

  IF NOT public.is_group_admin(v_group_id) THEN
    RAISE EXCEPTION 'NOT_AN_ADMIN: only an admin changes another member''s role'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF p_role NOT IN ('admin','member') AND NOT (p_role='manager' AND public.waves_is_company(v_group_id)) THEN
    RAISE EXCEPTION 'INVALID_ROLE: admin or member' USING ERRCODE = 'check_violation';
  END IF;

  -- A ghost has no login; an admin ghost is authority nobody holds.
  IF p_role IN ('admin','manager') AND v_profile_id IS NULL THEN
    RAISE EXCEPTION 'GHOST_CANNOT_ADMIN: a ghost has no account to act with'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Never demote the last admin — a group with no admin can promote nobody.
  IF p_role <> 'admin' AND v_old_role = 'admin' THEN
    SELECT count(*) INTO v_admins
    FROM public.group_members
    WHERE group_id = v_group_id AND role = 'admin' AND left_at IS NULL;
    IF v_admins <= 1 THEN
      RAISE EXCEPTION 'LAST_ADMIN: a group keeps at least one admin'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  UPDATE public.group_members
     SET role = p_role::public."MemberRole", manager_id=CASE WHEN p_role='member' THEN manager_id ELSE NULL END,
         updated_at = now()
   WHERE id = p_member_id;
END
$$;

-- Latest baseline: 20261012160000_removed_member_needs_new_invite; changed only Phase 4 scope/fields.
CREATE OR REPLACE FUNCTION public.waves_remove_member(p_member_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_group_id   uuid;
  v_profile_id uuid;
  v_left_at    timestamptz;
  v_me         uuid := public.waves_current_profile_id();
  v_group_name text;
  v_admin_name text;
BEGIN
  PERFORM 1 FROM public.groups WHERE id=(SELECT group_id FROM public.group_members WHERE id=p_member_id) FOR UPDATE;
  SELECT group_id, profile_id, left_at
    INTO v_group_id, v_profile_id, v_left_at
  FROM public.group_members WHERE id = p_member_id
  FOR UPDATE;

  IF v_group_id IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND: no such member' USING ERRCODE = 'no_data_found';
  END IF;

  IF NOT public.is_group_admin(v_group_id) AND NOT public.waves_company_team(v_group_id,p_member_id) THEN
    RAISE EXCEPTION 'NOT_ADMIN: only an admin removes a member'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF v_profile_id IS NOT DISTINCT FROM v_me THEN
    RAISE EXCEPTION 'CANNOT_REMOVE_SELF: use Leave group'
      USING ERRCODE = 'check_violation';
  END IF;

  IF v_left_at IS NOT NULL THEN
    RAISE EXCEPTION 'NOT_A_MEMBER: they are no longer in this group'
      USING ERRCODE = 'check_violation';
  END IF;

  UPDATE public.group_members
     SET left_at = now(),
         removed_at = now(),
         removed_by = v_me,
         updated_at = now()
   WHERE id = p_member_id;

  IF v_profile_id IS NOT NULL THEN
    SELECT g.name INTO v_group_name FROM public.groups g WHERE g.id = v_group_id;
    SELECT p.display_name INTO v_admin_name FROM public.profiles p WHERE p.id = v_me;

    PERFORM public.waves_notify(
      v_profile_id,
      v_group_id,
      'member_removed',
      -- English fallback only; current builds re-render from kind + payload.
      'You were removed from ' || coalesce(nullif(v_group_name, ''), 'a group'),
      'Your past expenses stay in the group history',
      NULL,
      jsonb_build_object(
        'counterparty', coalesce(v_admin_name, ''),
        'group',        coalesce(v_group_name, '')
      ),
      'member_removed:' || p_member_id::text || ':' || floor(extract(epoch FROM now()))::text
    );
  END IF;
END
$$;

-- Latest baseline: 20261103090000_security_db_hardening; changed only Phase 4 scope/fields.
CREATE OR REPLACE FUNCTION public.waves_guard_invite_insert()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY INVOKER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF current_user IN ('anon', 'authenticated') THEN
    NEW.use_count := 0;
    NEW.max_uses := LEAST(GREATEST(COALESCE(NEW.max_uses, 50), 1), 100);
    NEW.expires_at := LEAST(COALESCE(NEW.expires_at, now() + interval '30 days'), now() + interval '30 days');
    NEW.revoked_at := NULL;
  END IF;
  IF public.waves_is_company(NEW.group_id) THEN
    IF current_user IN ('anon','authenticated') THEN
      NEW.created_by:=public.waves_current_profile_id();
      IF NOT public.is_group_admin(NEW.group_id) AND NOT EXISTS(SELECT 1 FROM public.group_members WHERE group_id=NEW.group_id AND profile_id=NEW.created_by AND role::text='manager' AND left_at IS NULL) THEN RETURN NEW; END IF;
    END IF;
    IF NOT EXISTS(SELECT 1 FROM public.group_members m JOIN public.groups g ON g.id=m.group_id WHERE m.group_id=NEW.group_id AND m.profile_id=NEW.created_by AND m.left_at IS NULL AND m.removed_at IS NULL AND m.merged_into_member_id IS NULL AND m.role::text IN ('admin','manager') AND g.deleted_at IS NULL) THEN RAISE EXCEPTION 'ADMIN_ONLY' USING ERRCODE='insufficient_privilege'; END IF;
    IF EXISTS(SELECT 1 FROM public.group_members WHERE group_id=NEW.group_id AND profile_id=NEW.created_by AND role::text='manager') THEN
      SELECT id INTO NEW.company_manager_id FROM public.group_members WHERE group_id=NEW.group_id AND profile_id=NEW.created_by AND left_at IS NULL;
    END IF;
    IF NEW.company_manager_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.group_members WHERE id=NEW.company_manager_id AND group_id=NEW.group_id AND role::text='manager' AND left_at IS NULL AND removed_at IS NULL) THEN RAISE EXCEPTION 'INVALID_MANAGER'; END IF;
  END IF;
  RETURN NEW;
END
$function$
;

-- Latest baseline: 20261015140000_referral_rewards; changed only Phase 4 scope/fields.
CREATE OR REPLACE FUNCTION public.waves_join_via_invite(p_invite_id uuid, p_profile_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_group_id   uuid;
  v_created_at timestamptz;
  v_inviter    uuid;
  v_member_id  uuid;
  v_left_at    timestamptz;
  v_removed_at timestamptz;
BEGIN
  IF p_profile_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'NOT_AUTHENTICATED');
  END IF;

  IF public.waves_is_guest(p_profile_id) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'ACCOUNT_REQUIRED');
  END IF;

  SELECT group_id, created_at, created_by INTO v_group_id, v_created_at, v_inviter
    FROM public.invites WHERE id = p_invite_id;
  IF v_group_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'INVITE_INVALID');
  END IF;

  IF public.waves_is_company(v_group_id) THEN
    PERFORM 1 FROM public.groups WHERE id=v_group_id AND deleted_at IS NULL FOR UPDATE;
    IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM public.invites i JOIN public.group_members issuer ON issuer.profile_id=i.created_by AND issuer.group_id=i.group_id
      WHERE i.id=p_invite_id AND issuer.left_at IS NULL AND issuer.removed_at IS NULL AND issuer.role::text IN ('admin','manager')
      AND (i.company_manager_id IS NULL OR EXISTS(SELECT 1 FROM public.group_members m WHERE m.id=i.company_manager_id AND m.role::text='manager' AND m.left_at IS NULL AND m.removed_at IS NULL))) THEN RETURN jsonb_build_object('ok',false,'reason','INVITE_INVALID'); END IF;
  END IF;
  SELECT id, left_at, removed_at INTO v_member_id, v_left_at, v_removed_at
    FROM public.group_members
   WHERE group_id = v_group_id AND profile_id = p_profile_id
   FOR UPDATE;

  IF v_member_id IS NOT NULL AND v_left_at IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'member_id', v_member_id, 'group_id', v_group_id, 'already_member', true);
  END IF;

  IF v_removed_at IS NOT NULL AND v_created_at <= v_removed_at THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'REMOVED');
  END IF;

  IF public.waves_consume_invite(p_invite_id) IS NOT TRUE THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'INVITE_INVALID');
  END IF;

  IF v_member_id IS NOT NULL THEN
    UPDATE public.group_members
       SET left_at = NULL, removed_at = NULL, removed_by = NULL,
           role = 'member', joined_via = 'invite_link', manager_id=(SELECT company_manager_id FROM public.invites WHERE id=p_invite_id)
     WHERE id = v_member_id;
  ELSE
    INSERT INTO public.group_members (group_id, profile_id, joined_via,manager_id)
    VALUES (v_group_id, p_profile_id, 'invite_link',(SELECT company_manager_id FROM public.invites WHERE id=p_invite_id))
    RETURNING id INTO v_member_id;
  END IF;

  IF v_inviter IS NOT NULL THEN
    BEGIN
      PERFORM public.waves_referral_register(p_profile_id, v_inviter, 'group_invite');
      PERFORM public.waves_referral_try_qualify(p_profile_id);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'group-invite referral failed for %: %', p_profile_id, SQLERRM;
    END;
  END IF;

  RETURN jsonb_build_object('ok', true, 'member_id', v_member_id, 'group_id', v_group_id);
END
$$;

-- Latest baseline: 20261012160000_removed_member_needs_new_invite; changed only Phase 4 scope/fields.
CREATE OR REPLACE FUNCTION public.waves_request_member_claim(p_group_id uuid, p_member_id uuid, p_profile_id uuid, p_name text DEFAULT NULL::text, p_invite_id uuid DEFAULT NULL::uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_member     public.group_members%ROWTYPE;
  v_group      text;
  v_id         uuid;
  v_admin      record;
  v_consumed   boolean;
  v_removed_at timestamptz;
  v_invited_at timestamptz;
BEGIN
  IF public.waves_is_guest(p_profile_id) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'ACCOUNT_REQUIRED');
  END IF;

  SELECT * INTO v_member
    FROM public.group_members
   WHERE id = p_member_id AND group_id = p_group_id
   FOR UPDATE;

  IF NOT FOUND OR v_member.left_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'NOT_CLAIMABLE');
  END IF;

  IF public.waves_is_company(p_group_id) AND (p_invite_id IS NOT NULL OR v_member.manager_id IS NOT NULL) AND NOT EXISTS(SELECT 1 FROM public.invites i
    WHERE i.id=p_invite_id AND i.group_id=p_group_id AND i.company_manager_id IS NOT DISTINCT FROM v_member.manager_id) THEN
    RETURN jsonb_build_object('ok',false,'reason','NOT_CLAIMABLE');
  END IF;
  IF v_member.profile_id IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'ALREADY_CLAIMED');
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.group_members
     WHERE group_id = p_group_id AND profile_id = p_profile_id AND left_at IS NULL
  ) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'ALREADY_A_MEMBER');
  END IF;

  -- Removed by an admin: only an invite minted after the removal gets them a
  -- claim. Before any invite use is spent or any row is written.
  SELECT removed_at INTO v_removed_at
    FROM public.group_members
   WHERE group_id = p_group_id AND profile_id = p_profile_id AND removed_at IS NOT NULL
   ORDER BY removed_at DESC
   LIMIT 1;

  IF v_removed_at IS NOT NULL THEN
    SELECT created_at INTO v_invited_at FROM public.invites WHERE id = p_invite_id;
    IF v_invited_at IS NULL OR v_invited_at <= v_removed_at THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'REMOVED');
    END IF;
  END IF;

  SELECT id INTO v_id
    FROM public.member_claims
   WHERE member_id = p_member_id AND requester_id = p_profile_id AND status = 'pending';

  IF v_id IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'claim_id', v_id, 'already_pending', true);
  END IF;

  IF p_invite_id IS NOT NULL THEN
    SELECT public.waves_consume_invite(p_invite_id) INTO v_consumed;
    IF v_consumed IS NOT TRUE THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'INVITE_INVALID');
    END IF;
  END IF;

  INSERT INTO public.member_claims (group_id, member_id, requester_id, requested_name)
  VALUES (p_group_id, p_member_id, p_profile_id, NULLIF(btrim(COALESCE(p_name, '')), ''))
  RETURNING id INTO v_id;

  SELECT name INTO v_group FROM public.groups WHERE id = p_group_id;

  FOR v_admin IN
    SELECT profile_id FROM public.group_members
     WHERE group_id = p_group_id AND role = 'admin'
       AND profile_id IS NOT NULL AND left_at IS NULL
  LOOP
    PERFORM public.waves_notify(
      v_admin.profile_id,
      p_group_id,
      'ghost_claim_requested',
      'Someone wants to join ' || COALESCE(v_group, 'a group'),
      'They say they are ' || COALESCE(v_member.ghost_name, 'someone already listed'),
      '/group/' || p_group_id::text || '/members',
      jsonb_build_object(
        'claim_id', v_id,
        'member_id', p_member_id,
        'ghost_name', v_member.ghost_name,
        'requested_name', NULLIF(btrim(COALESCE(p_name, '')), '')
      ),
      'claim:' || v_id::text || ':' || v_admin.profile_id::text
    );
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'claim_id', v_id, 'already_pending', false);
END
$$;

-- Latest baseline: 20261106090000_company_add_past_people; changed only Phase 4 scope/fields.
CREATE OR REPLACE FUNCTION public.waves_company_past_people(p_target_group uuid)
RETURNS TABLE(source_group_id uuid, source_group_name text, source_member_id uuid,
              profile_id uuid, display_name text, phone text, email text, is_placeholder boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_caller uuid := public.waves_current_profile_id();
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.groups g JOIN public.group_members me ON me.group_id = g.id
    WHERE g.id = p_target_group AND g.type = 'company' AND g.deleted_at IS NULL
      AND me.profile_id = v_caller AND me.role::text IN ('admin','manager')
      AND me.left_at IS NULL AND me.removed_at IS NULL AND me.merged_into_member_id IS NULL
  ) THEN
    RAISE EXCEPTION 'ADMIN_ONLY' USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN QUERY
  SELECT g.id, g.name, m.id, m.profile_id,
         CASE WHEN m.profile_id IS NULL THEN m.ghost_name ELSE p.display_name END,
         m.invite_phone, m.invite_email, m.profile_id IS NULL
  FROM public.groups g
  JOIN public.group_members m ON m.group_id = g.id
  LEFT JOIN public.profiles p ON p.id = m.profile_id
  WHERE g.id <> p_target_group AND g.type = 'company' AND g.deleted_at IS NULL
    AND m.left_at IS NULL AND m.removed_at IS NULL AND m.merged_into_member_id IS NULL
    AND (m.profile_id IS NULL OR (m.profile_id <> v_caller AND NOT public.waves_is_guest(m.profile_id)))
    AND EXISTS (
      SELECT 1 FROM public.group_members me
      WHERE me.group_id = g.id AND me.profile_id = v_caller AND (me.role::text='admin' OR (me.role::text='manager' AND m.manager_id=me.id AND m.role::text='member'))
        AND me.left_at IS NULL AND me.removed_at IS NULL AND me.merged_into_member_id IS NULL
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.group_members target
      WHERE target.group_id = p_target_group
        AND target.left_at IS NULL AND target.removed_at IS NULL AND target.merged_into_member_id IS NULL
        AND (target.profile_id = m.profile_id OR target.invite_phone = m.invite_phone
             OR target.invite_email = m.invite_email
             -- A placeholder with no contact is matched by name, so a retry cannot copy it twice.
             OR (m.profile_id IS NULL AND m.invite_phone IS NULL AND m.invite_email IS NULL
                 AND target.profile_id IS NULL AND target.invite_phone IS NULL AND target.invite_email IS NULL
                 AND lower(target.ghost_name) = lower(m.ghost_name)))
    )
  ORDER BY g.name, CASE WHEN m.profile_id IS NULL THEN m.ghost_name ELSE p.display_name END, m.id
  LIMIT 500;
END
$$;

-- Latest baseline: 20261106090000_company_add_past_people; changed only Phase 4 scope/fields.
CREATE OR REPLACE FUNCTION public.waves_company_add_past_people(p_target_group uuid, p_source_member_ids uuid[])
RETURNS TABLE(source_member_id uuid, member_id uuid)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_caller uuid := public.waves_current_profile_id();
  v_id uuid;
  v_source record;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.groups g JOIN public.group_members me ON me.group_id = g.id
    WHERE g.id = p_target_group AND g.type = 'company' AND g.deleted_at IS NULL
      AND me.profile_id = v_caller AND me.role::text IN ('admin','manager')
      AND me.left_at IS NULL AND me.removed_at IS NULL AND me.merged_into_member_id IS NULL
  ) THEN
    RAISE EXCEPTION 'ADMIN_ONLY' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF cardinality(p_source_member_ids) > 100 THEN
    RAISE EXCEPTION 'TOO_MANY_PEOPLE' USING ERRCODE = 'check_violation';
  END IF;

  FOREACH v_id IN ARRAY coalesce(p_source_member_ids, ARRAY[]::uuid[]) LOOP
    SELECT m.profile_id, m.invite_email, m.invite_phone,
           CASE WHEN m.profile_id IS NULL THEN m.ghost_name ELSE p.display_name END AS name
    INTO v_source
    FROM public.group_members m
    JOIN public.groups g ON g.id = m.group_id
    LEFT JOIN public.profiles p ON p.id = m.profile_id
    WHERE m.id = v_id AND g.type = 'company' AND g.deleted_at IS NULL
      AND m.left_at IS NULL AND m.removed_at IS NULL AND m.merged_into_member_id IS NULL
      AND EXISTS (
        SELECT 1 FROM public.group_members me
        WHERE me.group_id = g.id AND me.profile_id = v_caller AND (me.role::text='admin' OR (me.role::text='manager' AND m.manager_id=me.id AND m.role::text='member'))
          AND me.left_at IS NULL AND me.removed_at IS NULL AND me.merged_into_member_id IS NULL
      );
    IF NOT FOUND THEN
      -- Missing and inaccessible ids deliberately have the same answer. Any
      -- failure aborts the statement, including earlier additions in this batch.
      RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = 'insufficient_privilege';
    END IF;
    source_member_id := v_id;
    member_id := NULL;
    IF v_source.profile_id IS NULL AND v_source.invite_phone IS NULL AND v_source.invite_email IS NULL THEN
      SELECT t.id INTO member_id FROM public.group_members t
       WHERE t.group_id = p_target_group AND t.left_at IS NULL AND t.removed_at IS NULL
         AND t.merged_into_member_id IS NULL AND t.profile_id IS NULL
         AND t.invite_phone IS NULL AND t.invite_email IS NULL
         AND lower(t.ghost_name) = lower(v_source.name)
       LIMIT 1;
    END IF;
    IF member_id IS NULL THEN
    member_id := public.waves_add_ghost_member(
      p_target_group, v_source.name, NULL, v_source.invite_email,
      CASE WHEN v_source.invite_phone LIKE '+%' THEN v_source.invite_phone ELSE NULL END,
      v_source.profile_id
    );
    END IF;
    IF NOT public.waves_company_detail(p_target_group,member_id) THEN RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE='insufficient_privilege'; END IF;
    RETURN NEXT;
  END LOOP;
END
$$;

-- Sibling invariants cover privileged writers without weakening generic membership guards.
CREATE FUNCTION public.waves_company_phase4_member_guard() RETURNS trigger
 LANGUAGE plpgsql SET search_path TO 'public','pg_temp' AS $$
DECLARE actor uuid;
BEGIN
 IF NOT public.waves_is_company(NEW.group_id) THEN
  IF NEW.role::text='manager' OR NEW.manager_id IS NOT NULL THEN RAISE EXCEPTION 'COMPANY_ONLY'; END IF;
  RETURN NEW;
 END IF;
 IF TG_OP='INSERT' THEN
  IF current_user IN ('anon','authenticated') AND NEW.manager_id IS NOT NULL AND NOT public.is_group_admin(NEW.group_id) THEN RAISE EXCEPTION 'FORBIDDEN_COLUMN: use company member RPC' USING ERRCODE='insufficient_privilege'; END IF;
  SELECT id INTO actor FROM public.group_members WHERE group_id=NEW.group_id AND profile_id=public.waves_current_profile_id() AND role::text='manager' AND left_at IS NULL AND removed_at IS NULL;
  IF actor IS NOT NULL THEN NEW.manager_id:=actor; NEW.role:='member'; END IF;
 END IF;
 IF NEW.manager_id IS NOT NULL AND (NEW.role::text<>'member' OR NOT EXISTS(SELECT 1 FROM public.group_members WHERE id=NEW.manager_id AND group_id=NEW.group_id AND role::text='manager' AND left_at IS NULL AND removed_at IS NULL AND merged_into_member_id IS NULL)) THEN RAISE EXCEPTION 'INVALID_MANAGER'; END IF;
 IF TG_OP='UPDATE' AND OLD.role::text='manager' AND (NEW.role IS DISTINCT FROM OLD.role OR NEW.left_at IS DISTINCT FROM OLD.left_at OR NEW.removed_at IS DISTINCT FROM OLD.removed_at) THEN
  IF EXISTS(SELECT 1 FROM public.group_members WHERE manager_id=OLD.id AND left_at IS NULL AND removed_at IS NULL)
   OR EXISTS(SELECT 1 FROM public.invites WHERE company_manager_id=OLD.id AND revoked_at IS NULL AND expires_at>now()) THEN RAISE EXCEPTION 'MANAGER_HAS_TEAM_OR_INVITES'; END IF;
  IF (public.waves_company_pool_balance(OLD.group_id,OLD.id)->>'balance')::numeric<>0 THEN RAISE EXCEPTION 'MANAGER_HAS_POOL'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER company_phase4_member_guard BEFORE INSERT OR UPDATE ON public.group_members FOR EACH ROW EXECUTE FUNCTION public.waves_company_phase4_member_guard();
CREATE FUNCTION public.waves_company_phase4_entry_guard() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
BEGIN
 IF TG_OP<>'INSERT' AND OLD.entry_kind IN ('allocation','pool_return','pool_adjustment','wage_payment') THEN RAISE EXCEPTION 'ENTRY_FROZEN'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 IF TG_OP='UPDATE' AND (NEW.funding_manager_id IS DISTINCT FROM OLD.funding_manager_id OR ((OLD.funding_manager_id IS NOT NULL OR OLD.wage_run_id IS NOT NULL) AND (NEW.member_id,NEW.group_id) IS DISTINCT FROM (OLD.member_id,OLD.group_id))) THEN RAISE EXCEPTION 'ENTRY_SCOPE_IMMUTABLE'; END IF;
 IF NEW.project_id IS NOT NULL AND (TG_OP='INSERT' OR NEW.project_id IS DISTINCT FROM OLD.project_id) AND NOT EXISTS(SELECT 1 FROM public.company_projects WHERE id=NEW.project_id AND group_id=NEW.group_id AND archived_at IS NULL AND deleted_at IS NULL) THEN RAISE EXCEPTION 'INVALID_PROJECT'; END IF;
 IF NEW.funding_manager_id IS NOT NULL AND TG_OP='INSERT' AND NOT EXISTS(SELECT 1 FROM public.group_members WHERE id=NEW.funding_manager_id AND group_id=NEW.group_id AND role::text='manager' AND left_at IS NULL AND removed_at IS NULL) THEN RAISE EXCEPTION 'INVALID_MANAGER'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER company_phase4_entry_guard BEFORE INSERT OR UPDATE OR DELETE ON public.company_entries FOR EACH ROW EXECUTE FUNCTION public.waves_company_phase4_entry_guard();
CREATE FUNCTION public.waves_company_phase4_photo_guard() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM public.company_entries WHERE id=coalesce(NEW.entry_id,OLD.entry_id) AND entry_kind IN ('wage_payment','allocation','pool_return','pool_adjustment')) THEN RAISE EXCEPTION 'ENTRY_FROZEN'; END IF;
 RETURN coalesce(NEW,OLD);
END $$;
CREATE TRIGGER company_phase4_photo_guard BEFORE INSERT OR UPDATE OR DELETE ON public.company_entry_attachments FOR EACH ROW EXECUTE FUNCTION public.waves_company_phase4_photo_guard();

CREATE FUNCTION public.waves_company_pool_post(p_group_id uuid,p_entry_id uuid,p_manager_id uuid,p_kind text,p_amount_minor bigint,p_project_id uuid,p_occurred_on date,p_reason text) RETURNS uuid
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
DECLARE actor uuid; h text; r public.company_entries%ROWTYPE;
BEGIN
 actor:=public.waves_company_actor(p_group_id);
 PERFORM 1 FROM public.groups WHERE id=p_group_id FOR UPDATE;
 IF NOT public.is_group_admin(p_group_id) THEN RAISE EXCEPTION 'ADMIN_ONLY' USING ERRCODE='insufficient_privilege'; END IF;
 IF p_kind IS NULL OR p_kind NOT IN ('allocation','pool_return','pool_adjustment') OR p_amount_minor IS NULL OR p_amount_minor=0 OR (p_kind<>'pool_adjustment' AND p_amount_minor<0) OR p_occurred_on IS NULL OR p_entry_id IS NULL OR p_manager_id IS NULL THEN RAISE EXCEPTION 'INVALID_DATA'; END IF;
 IF p_kind IN ('pool_return','pool_adjustment') AND coalesce(length(btrim(p_reason)),0) NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'REASON_REQUIRED'; END IF;
 h:=encode(sha256(convert_to(jsonb_build_array(p_group_id,p_manager_id,p_kind,p_amount_minor::text,p_project_id,p_occurred_on,btrim(p_reason))::text,'UTF8')),'hex');
 PERFORM pg_advisory_xact_lock(hashtextextended(p_entry_id::text,0));
 SELECT * INTO r FROM public.company_entries WHERE id=p_entry_id;
 IF FOUND THEN
  IF r.group_id=p_group_id AND r.request_hash=h THEN RETURN r.id; END IF;
  RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT';
 END IF;
 INSERT INTO public.company_entries(id,group_id,member_id,entry_kind,amount,currency,occurred_on,note,created_by,updated_by,funding_manager_id,project_id,request_hash)
 SELECT p_entry_id,p_group_id,p_manager_id,p_kind,p_amount_minor,default_currency,p_occurred_on,btrim(p_reason),actor,actor,p_manager_id,p_project_id,h FROM public.groups WHERE id=p_group_id;
 RETURN p_entry_id;
END $$;
CREATE FUNCTION public.waves_company_pool_balance(p_group_id uuid,p_manager_id uuid) RETURNS jsonb
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
DECLARE actor uuid; a numeric; r numeric; j numeric; d numeric; b numeric; w numeric; s numeric; c numeric;
BEGIN
 actor:=public.waves_company_actor(p_group_id);
 IF NOT public.is_group_admin(p_group_id) AND NOT (actor=p_manager_id AND EXISTS(SELECT 1 FROM public.group_members WHERE id=actor AND role::text='manager')) THEN RAISE EXCEPTION 'ADMIN_ONLY' USING ERRCODE='insufficient_privilege'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.group_members WHERE id=p_manager_id AND group_id=p_group_id AND role::text='manager') THEN RAISE EXCEPTION 'INVALID_MANAGER'; END IF;
 SELECT coalesce(sum(amount) FILTER(WHERE entry_kind='allocation' AND funding_manager_id=p_manager_id),0),
 coalesce(sum(amount) FILTER(WHERE entry_kind='pool_return' AND funding_manager_id=p_manager_id),0),
 coalesce(sum(amount) FILTER(WHERE entry_kind='pool_adjustment' AND funding_manager_id=p_manager_id),0),
 coalesce(sum(amount) FILTER(WHERE entry_kind='advance' AND funding_manager_id=p_manager_id),0),
 coalesce(sum(amount) FILTER(WHERE entry_kind='reimbursement' AND direction='company_to_employee' AND funding_manager_id=p_manager_id),0),
 coalesce(sum(amount) FILTER(WHERE entry_kind='wage_payment' AND funding_manager_id=p_manager_id),0),
 coalesce(sum(amount) FILTER(WHERE entry_kind IN ('expense','allowance') AND member_id=p_manager_id),0),
 coalesce(sum(amount) FILTER(WHERE entry_kind='reimbursement' AND direction='employee_to_company' AND funding_manager_id=p_manager_id),0)
 INTO a,r,j,d,b,w,s,c FROM public.company_entries WHERE group_id=p_group_id AND deleted_at IS NULL AND status IN ('approved','reimbursed');
 RETURN jsonb_build_object('allocated',a::text,'returned',r::text,'adjusted',j::text,'advances',d::text,'reimbursed',b::text,'wages',w::text,'ownSpend',s::text,'cashReturned',c::text,'balance',(a+j-r-d-b-w-s+c)::text);
END $$;
CREATE FUNCTION public.waves_company_project_report(p_group_id uuid,p_from date,p_to date) RETURNS jsonb
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
DECLARE projects jsonb; pools jsonb;
BEGIN
 PERFORM public.waves_company_actor(p_group_id);
 IF NOT public.is_group_admin(p_group_id) THEN RAISE EXCEPTION 'ADMIN_ONLY' USING ERRCODE='insufficient_privilege'; END IF;
 IF p_from IS NULL OR p_to IS NULL OR p_from>p_to THEN RAISE EXCEPTION 'INVALID_PERIOD'; END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'budget',b.budget_minor::text,'allocated',a.allocated::text,'spent',a.spent::text,'remaining',(b.budget_minor-a.spent)::text) ORDER BY p.id),'[]') INTO projects
 FROM public.company_projects p LEFT JOIN public.company_project_budgets b ON b.project_id=p.id
 CROSS JOIN LATERAL (SELECT coalesce(sum(CASE WHEN e.entry_kind='pool_return' THEN -e.amount ELSE e.amount END) FILTER(WHERE e.entry_kind IN ('allocation','pool_return','pool_adjustment')),0) allocated,
 coalesce(sum(CASE WHEN e.entry_kind='wage_payment' THEN e.gross_minor-e.claims_minor ELSE e.amount END) FILTER(WHERE e.entry_kind IN ('expense','allowance','wages','wage_payment')),0) spent
 FROM public.company_entries e WHERE e.project_id=p.id AND e.deleted_at IS NULL AND e.status IN ('approved','reimbursed') AND e.occurred_on BETWEEN p_from AND p_to) a
 WHERE p.group_id=p_group_id AND p.deleted_at IS NULL;
 SELECT coalesce(jsonb_agg(jsonb_build_object('managerId',m.id,'name',coalesce(p.display_name,m.ghost_name),'balance',public.waves_company_pool_balance(p_group_id,m.id)->>'balance') ORDER BY m.id),'[]') INTO pools FROM public.group_members m LEFT JOIN public.profiles p ON p.id=m.profile_id WHERE m.group_id=p_group_id AND m.role::text='manager' AND m.left_at IS NULL AND m.removed_at IS NULL;
 RETURN jsonb_build_object('projects',projects,'pools',pools);
END $$;

CREATE FUNCTION public.waves_company_wage_pay(p_group_id uuid,p_run_id uuid,p_period_start date,p_period_end date,p_paid_on date,p_lines jsonb) RETURNS uuid
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
DECLARE actor uuid; owner boolean; h text; old public.company_wage_runs%ROWTYPE; line jsonb; claim jsonb; r public.company_entries%ROWTYPE;
 employee uuid; payment uuid; funding uuid; project uuid; mode text; q numeric; rate bigint; base numeric; claims numeric; outstanding numeric; recovery numeric; gross numeric; net numeric; cur character(3); money_key text; lock_id uuid;
BEGIN
 actor:=public.waves_company_actor(p_group_id);
 -- The company row serializes wage, reimbursement, project, membership and entry writers.
 PERFORM 1 FROM public.groups WHERE id=p_group_id FOR UPDATE;
 owner:=public.is_group_admin(p_group_id);
 IF NOT owner AND NOT EXISTS(SELECT 1 FROM public.group_members WHERE id=actor AND role::text='manager') THEN RAISE EXCEPTION 'ADMIN_ONLY' USING ERRCODE='insufficient_privilege'; END IF;
 IF p_run_id IS NULL OR p_period_start IS NULL OR p_period_end IS NULL OR p_period_start>p_period_end OR p_paid_on IS NULL OR jsonb_typeof(p_lines) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'INVALID_DATA'; END IF;
 IF jsonb_array_length(p_lines) NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'INVALID_DATA'; END IF;
 -- Authorization precedes replay: a former manager cannot retrieve a former-team result.
 FOR line IN SELECT value FROM jsonb_array_elements(p_lines) LOOP
  employee:=(line->>'memberId')::uuid;
  IF NOT EXISTS(SELECT 1 FROM public.group_members WHERE id=employee AND group_id=p_group_id AND role::text='member' AND left_at IS NULL AND removed_at IS NULL AND merged_into_member_id IS NULL) OR (NOT owner AND NOT public.waves_company_team(p_group_id,employee)) THEN RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE='insufficient_privilege'; END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_lines) l GROUP BY l->>'memberId' HAVING count(*)>1) OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_lines) l GROUP BY l->>'paymentEntryId' HAVING count(*)>1) THEN RAISE EXCEPTION 'DUPLICATE_LINE'; END IF;
 h:=encode(sha256(convert_to(jsonb_build_array(p_group_id,p_period_start,p_period_end,p_paid_on,p_lines)::text,'UTF8')),'hex');
 PERFORM pg_advisory_xact_lock(hashtextextended(p_run_id::text,0));
 SELECT * INTO old FROM public.company_wage_runs WHERE id=p_run_id;
 IF FOUND THEN
  IF old.group_id=p_group_id AND old.request_hash=h THEN RETURN p_run_id; END IF;
  RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT';
 END IF;
 FOR lock_id IN SELECT (l->>'memberId')::uuid FROM jsonb_array_elements(p_lines) l ORDER BY (l->>'memberId')::uuid LOOP
  PERFORM pg_advisory_xact_lock(hashtextextended(lock_id::text,3));
 END LOOP;
 SELECT default_currency INTO cur FROM public.groups WHERE id=p_group_id;
 INSERT INTO public.company_wage_runs(id,group_id,period_start,period_end,paid_on,created_by,request_hash) VALUES(p_run_id,p_group_id,p_period_start,p_period_end,p_paid_on,actor,h);
 FOR line IN SELECT value FROM jsonb_array_elements(p_lines) ORDER BY (value->>'memberId')::uuid LOOP
  IF jsonb_typeof(line) IS DISTINCT FROM 'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(line) k WHERE k NOT IN ('paymentEntryId','memberId','projectId','fundingManagerId','calcMode','days','rateMinor','fixedMinor','claimIds','expectedGrossMinor','expectedRecoveryMinor','expectedNetMinor','note')) THEN RAISE EXCEPTION 'INVALID_DATA'; END IF;
  employee:=(line->>'memberId')::uuid; payment:=(line->>'paymentEntryId')::uuid; project:=(line->>'projectId')::uuid;
  funding:=CASE WHEN owner THEN (line->>'fundingManagerId')::uuid ELSE actor END;
  mode:=line->>'calcMode';
  IF payment IS NULL OR mode IS NULL OR mode NOT IN ('typed','days_rate','fixed_weekly','fixed_monthly') OR length(line->>'note')>500 OR jsonb_typeof(line->'claimIds') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'INVALID_DATA'; END IF;
  FOREACH money_key IN ARRAY ARRAY['rateMinor','fixedMinor','expectedGrossMinor','expectedRecoveryMinor','expectedNetMinor'] LOOP
   IF line->>money_key IS NOT NULL AND (jsonb_typeof(line->money_key)<>'string' OR (line->>money_key)!~'^[0-9]{1,19}$' OR (line->>money_key)::numeric>9223372036854775807) THEN RAISE EXCEPTION 'INVALID_AMOUNT'; END IF;
  END LOOP;
  q:=NULL; rate:=NULL;
  IF mode='days_rate' THEN
   IF jsonb_typeof(line->'days') IS DISTINCT FROM 'string' OR (line->>'days')!~'^[0-9]{1,6}(\.[0-9]{1,2})?$' OR line->>'rateMinor' IS NULL THEN RAISE EXCEPTION 'INVALID_DAYS'; END IF;
   q:=(line->>'days')::numeric; rate:=(line->>'rateMinor')::bigint;
   IF q<=0 THEN RAISE EXCEPTION 'INVALID_DAYS'; END IF;
   base:=trunc((q*100*rate+50)/100);
  ELSE base:=(line->>'fixedMinor')::bigint;
  END IF;
  IF base IS NULL THEN RAISE EXCEPTION 'INVALID_AMOUNT'; END IF;
  IF EXISTS(SELECT 1 FROM public.company_entries WHERE group_id=p_group_id AND member_id=employee AND entry_kind='wage_payment' AND deleted_at IS NULL AND (period_start<=p_period_end AND period_end>=p_period_start)) THEN RAISE EXCEPTION 'OVERLAPPING_PERIOD'; END IF;
  -- Prevent inserting an earlier run after later recovery has consumed advances.
  IF EXISTS(SELECT 1 FROM public.company_entries WHERE group_id=p_group_id AND member_id=employee AND entry_kind='wage_payment' AND period_end>p_period_end AND deleted_at IS NULL) THEN RAISE EXCEPTION 'WAGE_PERIOD_OUT_OF_ORDER'; END IF;
  claims:=0;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(line->'claimIds') c GROUP BY c->>'entryId' HAVING count(*)>1) THEN RAISE EXCEPTION 'DUPLICATE_CLAIM'; END IF;
  FOR claim IN SELECT value FROM jsonb_array_elements(line->'claimIds') ORDER BY (value->>'entryId')::uuid LOOP
   IF jsonb_typeof(claim) IS DISTINCT FROM 'object' OR jsonb_typeof(claim->'expectedVersion') IS DISTINCT FROM 'number' OR EXISTS(SELECT 1 FROM jsonb_object_keys(claim) k WHERE k NOT IN ('entryId','expectedVersion')) THEN RAISE EXCEPTION 'INVALID_CLAIM'; END IF;
   r:=public.waves_company_entry_lock((claim->>'entryId')::uuid);
   IF r.group_id<>p_group_id OR r.member_id<>employee OR r.version IS DISTINCT FROM (claim->>'expectedVersion')::integer OR r.status<>'approved' OR r.deleted_at IS NOT NULL OR r.reimbursement_id IS NOT NULL OR r.reimbursement_details IS NOT NULL OR r.entry_kind NOT IN ('expense','allowance') OR (r.entry_kind='expense' AND r.calc_mode<>'distance_rate') OR r.occurred_on>p_period_end THEN RAISE EXCEPTION 'SELECTION_CHANGED'; END IF;
   claims:=claims+r.amount;
  END LOOP;
  SELECT greatest(0,coalesce(sum(CASE WHEN entry_kind='advance' AND reimbursement_id IS NULL AND occurred_on<=p_period_end THEN amount WHEN entry_kind='wage_payment' AND period_end<p_period_start THEN -recovery_minor ELSE 0 END),0)) INTO outstanding FROM public.company_entries WHERE group_id=p_group_id AND member_id=employee AND deleted_at IS NULL;
  gross:=base+claims; recovery:=least(outstanding,gross); net:=gross-recovery;
  IF (line->>'expectedGrossMinor')::numeric IS DISTINCT FROM gross OR (line->>'expectedRecoveryMinor')::numeric IS DISTINCT FROM recovery OR (line->>'expectedNetMinor')::numeric IS DISTINCT FROM net THEN RAISE EXCEPTION 'AMOUNT_MISMATCH'; END IF;
  INSERT INTO public.company_entries(id,group_id,member_id,entry_kind,amount,currency,calc_mode,days,rate_minor,occurred_on,note,created_by,updated_by,project_id,funding_manager_id,wage_run_id,gross_minor,claims_minor,recovery_minor,period_start,period_end)
  VALUES(payment,p_group_id,employee,'wage_payment',net::bigint,cur,mode,q,rate,p_paid_on,line->>'note',actor,actor,project,funding,p_run_id,gross::bigint,claims::bigint,recovery::bigint,p_period_start,p_period_end);
  PERFORM set_config('waves.company_reimburse',payment::text,true);
  UPDATE public.company_entries SET reimbursement_id=payment,status='reimbursed',version=version+1,updated_at=now(),updated_by=actor WHERE id IN (SELECT (value->>'entryId')::uuid FROM jsonb_array_elements(line->'claimIds'));
  PERFORM set_config('waves.company_reimburse','',true);
 END LOOP;
 RETURN p_run_id;
END $$;

-- Latest baseline: 20261108090000_company_expenses_3; Phase 4 scope extension.
CREATE OR REPLACE FUNCTION public.waves_company_entry_lock(p_entry_id uuid)
 RETURNS public.company_entries LANGUAGE plpgsql SECURITY DEFINER
 SET search_path TO 'public','pg_temp' AS $$
DECLARE scope public.company_entries%ROWTYPE; locked public.company_entries%ROWTYPE;
BEGIN
 SELECT * INTO scope FROM public.company_entries WHERE id=p_entry_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE='insufficient_privilege'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(scope.group_id::text,4));
 PERFORM 1 FROM public.groups WHERE id=scope.group_id FOR UPDATE;
 PERFORM pg_advisory_xact_lock(hashtextextended(scope.member_id::text,3));
 SELECT * INTO locked FROM public.company_entries WHERE id=p_entry_id FOR UPDATE;
 IF NOT FOUND OR locked.member_id IS DISTINCT FROM scope.member_id OR locked.group_id IS DISTINCT FROM scope.group_id THEN
  RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE='insufficient_privilege';
 END IF;
 RETURN locked;
END $$;

-- Latest baseline: 20261108090000_company_expenses_3; Phase 4 scope extension.
CREATE OR REPLACE FUNCTION public.waves_attach_company_entry_image(p_entry_id uuid,p_storage_path text,p_attachment_id uuid,p_preview text DEFAULT NULL) RETURNS uuid
 LANGUAGE plpgsql  SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $fn$
DECLARE e public.company_entries%ROWTYPE; a public.company_entry_attachments%ROWTYPE; actor uuid; o public.storage_objects%ROWTYPE;
BEGIN
 e:=public.waves_company_entry_lock(p_entry_id);
 actor:=public.waves_company_actor(e.group_id);
 IF e.deleted_at IS NOT NULL OR NOT public.waves_can_read_company_entry(e.id) THEN RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE='insufficient_privilege'; END IF;
 IF e.wage_run_id IS NOT NULL OR e.reimbursement_id IS NOT NULL OR e.reimbursement_details IS NOT NULL THEN RAISE EXCEPTION 'ENTRY_REIMBURSED: covered entries are frozen' USING ERRCODE='check_violation'; END IF;
 SELECT * INTO a FROM public.company_entry_attachments WHERE id=p_attachment_id;
 IF FOUND THEN
  IF a.entry_id=e.id AND a.storage_path=p_storage_path AND a.uploader_member_id=actor
   AND a.preview IS NOT DISTINCT FROM public.waves_clean_image_preview(p_preview) AND a.deleted_at IS NULL THEN RETURN a.id; END IF;
  RAISE EXCEPTION 'ATTACHMENT_CONFLICT' USING ERRCODE='check_violation';
 END IF;
 IF (SELECT count(*) FROM public.company_entry_attachments WHERE entry_id=e.id AND deleted_at IS NULL)>=10 THEN RAISE EXCEPTION 'ATTACHMENT_LIMIT'; END IF;
 SELECT * INTO o FROM public.storage_objects WHERE logical_bucket='company-entry-images' AND path=p_storage_path FOR UPDATE;
 PERFORM public.waves_require_committed_object('company-entry-images',p_storage_path);
 IF o.company_group_id IS DISTINCT FROM e.group_id OR o.owner_profile_id IS DISTINCT FROM public.waves_current_profile_id() THEN RAISE EXCEPTION 'NOT_UPLOADER' USING ERRCODE='insufficient_privilege'; END IF;
 INSERT INTO public.company_entry_attachments(id,entry_id,group_id,uploader_member_id,storage_path,preview)
 VALUES(p_attachment_id,e.id,e.group_id,actor,p_storage_path,public.waves_clean_image_preview(p_preview));
 PERFORM public.waves_company_evidence_changed(e.id,actor);
 RETURN p_attachment_id;
END
$fn$;

-- Latest baseline: 20261108090000_company_expenses_3; Phase 4 scope extension.
CREATE OR REPLACE FUNCTION public.waves_remove_company_entry_image(p_attachment_id uuid) RETURNS void
 LANGUAGE plpgsql  SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $fn$
DECLARE a public.company_entry_attachments%ROWTYPE; actor uuid; attachment_entry uuid;
BEGIN
 SELECT * INTO a FROM public.company_entry_attachments WHERE id=p_attachment_id;
 PERFORM public.waves_company_entry_lock(a.entry_id);
 -- Re-read the attachment after the entry lock and reject a changed association.
 attachment_entry:=a.entry_id;
 SELECT * INTO a FROM public.company_entry_attachments WHERE id=p_attachment_id FOR UPDATE;
 IF NOT FOUND OR a.entry_id IS DISTINCT FROM attachment_entry THEN RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE='insufficient_privilege'; END IF;
 actor:=public.waves_company_actor(a.group_id);
 IF NOT public.waves_can_read_company_entry(a.entry_id) OR (a.uploader_member_id<>actor AND NOT public.is_group_admin(a.group_id) AND NOT public.waves_company_team(a.group_id,(SELECT member_id FROM public.company_entries WHERE id=a.entry_id))) THEN RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE='insufficient_privilege'; END IF;
 IF EXISTS(SELECT 1 FROM public.company_entries WHERE id=a.entry_id AND (reimbursement_id IS NOT NULL OR reimbursement_details IS NOT NULL)) THEN RAISE EXCEPTION 'ENTRY_REIMBURSED: covered entries are frozen' USING ERRCODE='check_violation'; END IF;
 IF a.deleted_at IS NOT NULL THEN RETURN; END IF;
 UPDATE public.company_entry_attachments SET deleted_at=now(),updated_at=now() WHERE id=a.id;
 DELETE FROM public.storage_objects WHERE logical_bucket='company-entry-images' AND path IN(a.storage_path,a.storage_path||'.thumb.jpg');
 PERFORM public.waves_company_evidence_changed(a.entry_id,actor);
END
$fn$;

-- Latest baseline: 20261108090000_company_expenses_3; Phase 4 scope extension.
CREATE OR REPLACE FUNCTION public.waves_company_evidence_changed(p_entry_id uuid,p_actor uuid) RETURNS void
 LANGUAGE plpgsql  SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $fn$
BEGIN
 PERFORM public.waves_company_entry_lock(p_entry_id);
 UPDATE public.company_entries e SET version=version+1,updated_at=now(),updated_by=p_actor,
 status=CASE WHEN e.entry_kind IN ('advance','reimbursement') AND EXISTS(SELECT 1 FROM public.group_members WHERE id=e.created_by AND role::text='manager') THEN 'approved' WHEN g.company_approvals_enabled THEN 'submitted' WHEN e.status='rejected' THEN 'approved' ELSE e.status END,
 review_note=CASE WHEN g.company_approvals_enabled OR e.status='rejected' THEN NULL ELSE e.review_note END,
 reviewed_by=CASE WHEN g.company_approvals_enabled OR e.status='rejected' THEN NULL ELSE e.reviewed_by END,
 reviewed_at=CASE WHEN g.company_approvals_enabled OR e.status='rejected' THEN NULL ELSE e.reviewed_at END
 FROM public.groups g WHERE e.id=p_entry_id AND g.id=e.group_id AND e.deleted_at IS NULL;
END
$fn$;

-- Latest baseline: 20261108090000_company_expenses_3; Phase 4 scope extension.
CREATE OR REPLACE FUNCTION public.waves_company_storage_write(
 p_profile_id uuid,p_group_id uuid,p_path text,p_bytes bigint,p_content_type text,p_commit boolean
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $fn$
DECLARE e public.company_entries%ROWTYPE; o public.storage_objects%ROWTYPE;
 base text:=regexp_replace(p_path,'\.thumb\.jpg$',''); quota bigint; used bigint;
BEGIN
 IF p_bytes IS NULL OR p_bytes<=0 OR p_bytes>12582912 OR p_profile_id IS NULL
  OR p_content_type NOT IN ('image/jpeg','image/png','image/webp','image/heic','image/heif')
  OR p_path !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg(\.thumb\.jpg)?$' THEN RAISE EXCEPTION 'STORAGE_BAD_INPUT'; END IF;
 e:=public.waves_company_entry_lock(split_part(base,'/',1)::uuid);
 IF e.id IS NULL OR e.deleted_at IS NOT NULL OR e.group_id IS DISTINCT FROM p_group_id OR NOT EXISTS(
  SELECT 1 FROM public.groups g JOIN public.group_members m ON m.group_id=g.id
  WHERE g.id=e.group_id AND g.type='company' AND g.deleted_at IS NULL AND m.profile_id=p_profile_id
   AND m.left_at IS NULL AND (m.id=e.member_id OR m.role::text='admin' OR (m.role::text='manager' AND EXISTS(SELECT 1 FROM public.group_members t WHERE t.id=e.member_id AND t.manager_id=m.id AND t.role::text='member'))) AND m.removed_at IS NULL AND m.merged_into_member_id IS NULL
 ) THEN RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE='insufficient_privilege'; END IF;
 IF e.wage_run_id IS NOT NULL OR e.reimbursement_id IS NOT NULL OR e.reimbursement_details IS NOT NULL OR e.entry_kind IN ('allocation','pool_return','pool_adjustment') THEN RAISE EXCEPTION 'ENTRY_REIMBURSED'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('company-storage:'||e.group_id::text,0));
 SELECT * INTO o FROM public.storage_objects WHERE logical_bucket='company-entry-images' AND path=p_path FOR UPDATE;
 IF o.path IS NOT NULL AND o.owner_profile_id IS DISTINCT FROM p_profile_id AND NOT EXISTS(
  SELECT 1 FROM public.group_members WHERE group_id=e.group_id AND profile_id=p_profile_id AND left_at IS NULL AND role='admin'
 ) THEN RAISE EXCEPTION 'NOT_UPLOADER' USING ERRCODE='insufficient_privilege'; END IF;
 IF NOT p_commit AND o.path IS NOT NULL AND NOT o.pending THEN RAISE EXCEPTION 'IMMUTABLE_OBJECT'; END IF;
 IF p_commit AND (o.path IS NULL OR NOT o.pending) THEN
  IF o.path IS NOT NULL AND NOT o.pending AND o.bytes=p_bytes AND o.content_type=p_content_type THEN RETURN; END IF;
  RAISE EXCEPTION 'RESERVATION_REQUIRED';
 END IF;
 IF p_path<>base THEN
  IF p_bytes>524288 OR p_content_type<>'image/jpeg' OR NOT EXISTS(
   SELECT 1 FROM public.storage_objects WHERE logical_bucket='company-entry-images' AND path=base AND NOT pending AND company_group_id=e.group_id
  ) THEN RAISE EXCEPTION 'NO_ORIGINAL'; END IF;
 END IF;
 IF o.path IS NULL THEN
  INSERT INTO public.company_image_keys(path,group_id) VALUES(p_path,e.group_id);
 END IF;
 IF NOT p_commit AND (SELECT count(*) FROM public.storage_objects WHERE company_group_id=e.group_id AND owner_profile_id=p_profile_id AND pending AND path<>p_path)>=16 THEN RAISE EXCEPTION 'STORAGE_TOO_MANY_PENDING'; END IF;
 SELECT storage_quota_bytes INTO quota FROM public.company_plans WHERE group_id=e.group_id;
 SELECT coalesce(sum(bytes),0) INTO used FROM public.storage_objects WHERE company_group_id=e.group_id AND path<>p_path;
 IF quota IS NOT NULL AND used+p_bytes>quota THEN RAISE EXCEPTION 'STORAGE_CAP'; END IF;
 INSERT INTO public.storage_objects(logical_bucket,path,owner_profile_id,group_id,company_group_id,bytes,content_type,counted,pending)
 VALUES('company-entry-images',p_path,p_profile_id,e.group_id,e.group_id,p_bytes,p_content_type,false,NOT p_commit)
 ON CONFLICT(logical_bucket,path) DO UPDATE SET bytes=excluded.bytes,content_type=excluded.content_type,
 pending=excluded.pending,updated_at=now();
END $fn$;

-- Latest baseline: 20261108090000_company_expenses_3; Phase 4 scope extension.
CREATE OR REPLACE FUNCTION public.waves_company_cancel_upload(
 p_entry_id uuid,p_path text,p_profile_id uuid,p_pending_only boolean DEFAULT false
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $fn$
DECLARE e public.company_entries%ROWTYPE; o public.storage_objects%ROWTYPE;
 base text:=regexp_replace(p_path,'\.thumb\.jpg$',''); is_admin boolean;
BEGIN
 e:=public.waves_company_entry_lock(p_entry_id);
 SELECT EXISTS(SELECT 1 FROM public.group_members m JOIN public.groups g ON g.id=m.group_id
  WHERE m.group_id=e.group_id AND m.profile_id=p_profile_id AND m.left_at IS NULL
   AND m.role='admin' AND g.deleted_at IS NULL) INTO is_admin;
 IF e.id IS NULL OR e.deleted_at IS NOT NULL OR split_part(base,'/',1)<>e.id::text OR NOT EXISTS(
  SELECT 1 FROM public.group_members m JOIN public.groups g ON g.id=m.group_id
  WHERE m.group_id=e.group_id AND m.profile_id=p_profile_id AND m.left_at IS NULL
   AND (m.id=e.member_id OR m.role::text='admin' OR (m.role::text='manager' AND EXISTS(SELECT 1 FROM public.group_members t WHERE t.id=e.member_id AND t.manager_id=m.id AND t.role::text='member'))) AND m.removed_at IS NULL AND m.merged_into_member_id IS NULL AND g.deleted_at IS NULL
 ) THEN RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE='insufficient_privilege'; END IF;
 IF e.wage_run_id IS NOT NULL OR e.reimbursement_id IS NOT NULL OR e.reimbursement_details IS NOT NULL OR e.entry_kind IN ('allocation','pool_return','pool_adjustment') THEN RAISE EXCEPTION 'ENTRY_REIMBURSED'; END IF;
 IF EXISTS(SELECT 1 FROM public.company_entry_attachments WHERE entry_id=e.id AND storage_path=base) THEN
  RAISE EXCEPTION 'IMMUTABLE_OBJECT';
 END IF;
 SELECT * INTO o FROM public.storage_objects WHERE logical_bucket='company-entry-images' AND path=p_path FOR UPDATE;
 IF o.path IS NULL THEN RETURN false; END IF;
 IF o.company_group_id IS DISTINCT FROM e.group_id OR
  (o.owner_profile_id IS DISTINCT FROM p_profile_id AND NOT is_admin) THEN RAISE EXCEPTION 'NOT_UPLOADER' USING ERRCODE='insufficient_privilege'; END IF;
 IF p_pending_only AND NOT o.pending THEN RETURN false; END IF;
 DELETE FROM public.storage_objects WHERE logical_bucket='company-entry-images'
  AND (path=p_path OR (NOT p_pending_only AND p_path=base AND path=base||'.thumb.jpg'));
 RETURN true;
END $fn$;

-- Latest baseline: 20261103090000_security_db_hardening; Phase 4 scope extension.
CREATE OR REPLACE FUNCTION public.waves_decide_member_claim(p_claim_id uuid, p_approve boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_profile   uuid := public.waves_current_profile_id();
  v_claim     public.member_claims%ROWTYPE;
  v_admin_id  uuid;
  v_group     text;
  v_ghost     text;
  v_moved     integer;
  v_own       public.group_members%ROWTYPE;
  v_role      text := 'member';
  v_via       text := 'invite_link_claim';
BEGIN
  IF v_profile IS NULL THEN
    RAISE EXCEPTION 'NOT_SIGNED_IN';
  END IF;

  SELECT * INTO v_claim FROM public.member_claims WHERE id = p_claim_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'NO_SUCH_CLAIM');
  END IF;

  SELECT id INTO v_admin_id
    FROM public.group_members
   WHERE group_id = v_claim.group_id
     AND profile_id = v_profile
     AND (role::text='admin' OR public.waves_company_team(v_claim.group_id,v_claim.member_id))
     AND removed_at IS NULL AND merged_into_member_id IS NULL AND left_at IS NULL;

  -- Not an admin of this group. The same answer as a claim that does not
  -- exist, so this cannot be used to find out which claims do.
  IF v_admin_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'NO_SUCH_CLAIM');
  END IF;

  IF v_claim.status <> 'pending' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'ALREADY_DECIDED', 'status', v_claim.status);
  END IF;

  IF public.waves_is_company(v_claim.group_id) THEN PERFORM public.waves_company_actor(v_claim.group_id); END IF;
  SELECT name INTO v_group FROM public.groups WHERE id = v_claim.group_id;
  SELECT ghost_name INTO v_ghost FROM public.group_members WHERE id = v_claim.member_id;

  IF NOT p_approve THEN
    UPDATE public.member_claims
       SET status = 'declined', decided_by = v_admin_id, decided_at = now()
     WHERE id = p_claim_id;

    PERFORM public.waves_notify(
      v_claim.requester_id,
      v_claim.group_id,
      'ghost_claim_declined',
      'Not confirmed',
      COALESCE(v_group, 'The group') || ' did not confirm that place. You can still join as yourself.',
      '/join',
      jsonb_build_object('claim_id', p_claim_id, 'group_name', v_group),
      'claim_declined:' || p_claim_id::text
    );

    RETURN jsonb_build_object('ok', true, 'status', 'declined');
  END IF;

  -- The place must still be free before anything else is touched: a refusal
  -- after the requester's own row is retired below would leave them out of the
  -- group altogether.
  PERFORM 1 FROM public.group_members
   WHERE id = v_claim.member_id
     AND profile_id IS NULL
     AND left_at IS NULL
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'NOT_CLAIMABLE');
  END IF;

  -- Already in the group as themselves: they joined by another route while
  -- this sat waiting, or they are saying "this is me" from inside the group
  -- (20260925120000). One person must not end up as two members, so their own
  -- row gives way to the placeholder, which is the one the history is filed
  -- under. Only an empty row can give way: the ledger is append-only
  -- (ADR-004), so a share or a payment already on it could never be moved.
  SELECT * INTO v_own
    FROM public.group_members
   WHERE group_id = v_claim.group_id
     AND profile_id = v_claim.requester_id
     AND left_at IS NULL
   FOR UPDATE;

  IF FOUND THEN
    IF public.waves_member_has_history(v_own.id) THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'HAS_HISTORY');
    END IF;

    IF public.waves_is_company(v_claim.group_id) AND NOT public.waves_company_detail(v_claim.group_id,v_own.id) THEN RETURN jsonb_build_object('ok',false,'reason','NOT_CLAIMABLE'); END IF;
    v_role := v_own.role;
    v_via := 'self_claim';

    -- Retired, not deleted: the row's id may still be named by an activity
    -- entry or a comment. It lets go of the profile (one live row per person
    -- per group, and the unique index counts left rows too) and keeps the
    -- person's name as its label.
    UPDATE public.group_members
       SET profile_id = NULL,
           ghost_name = COALESCE(
             NULLIF(btrim((SELECT display_name FROM public.profiles WHERE id = v_claim.requester_id)), ''),
             'Member'
           ),
           role = 'member',
           left_at = now()
     WHERE id = v_own.id;
  END IF;

  UPDATE public.group_members
     SET profile_id = v_claim.requester_id,
         ghost_name = NULL,
         joined_via = v_via,
         role = v_role::"MemberRole"
   WHERE id = v_claim.member_id
     AND profile_id IS NULL
     AND left_at IS NULL;

  GET DIAGNOSTICS v_moved = ROW_COUNT;
  IF v_moved = 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'NOT_CLAIMABLE');
  END IF;

  -- The name they gave, written only now. `invite-accept` used to set it while
  -- claiming, which meant an unconfirmed stranger could rename their own
  -- profile through a join request. And only over the placeholder: somebody
  -- who named themselves two years ago must not be renamed by a group they
  -- have just joined.
  IF v_claim.requested_name IS NOT NULL THEN
    UPDATE public.profiles
       SET display_name = v_claim.requested_name
     WHERE id = v_claim.requester_id
       AND (display_name IS NULL OR display_name = '' OR display_name = 'Guest');
  END IF;

  UPDATE public.member_claims
     SET status = 'approved', decided_by = v_admin_id, decided_at = now()
   WHERE id = p_claim_id;

  -- Anybody else waiting on the same place has lost it. Leaving them pending
  -- would mean an admin later approving a claim on a member who now belongs to
  -- somebody, and being told NOT_CLAIMABLE with no idea why.
  UPDATE public.member_claims
     SET status = 'declined', decided_by = v_admin_id, decided_at = now()
   WHERE member_id = v_claim.member_id
     AND status = 'pending'
     AND id <> p_claim_id;

  -- An admin saying "this is me" confirms their own claim; telling them they
  -- are in is noise.
  IF v_claim.requester_id <> v_profile THEN
  PERFORM public.waves_notify(
    v_claim.requester_id,
    v_claim.group_id,
    'ghost_claim_approved',
    'You are in ' || COALESCE(v_group, 'the group'),
    'Everything already filed under ' || COALESCE(v_ghost, 'that name') || ' is yours',
    '/group/' || v_claim.group_id::text,
    jsonb_build_object('claim_id', p_claim_id, 'group_name', v_group, 'ghost_name', v_ghost),
    'claim_approved:' || p_claim_id::text
  );
  END IF;

  INSERT INTO public.activity_log (group_id, actor_member_id, verb, object_type, object_id, payload)
  VALUES (
    v_claim.group_id,
    v_claim.member_id,
    'claimed',
    'member',
    v_claim.member_id,
    jsonb_build_object(
      'via', CASE WHEN v_via = 'self_claim' THEN 'this_is_me' ELSE 'invite_link' END,
      'confirmed_by', v_admin_id
    )
  );

  RETURN jsonb_build_object('ok', true, 'status', 'approved', 'member_id', v_claim.member_id);
END
$function$
;

-- Explicit final function privileges (including every replacement).
REVOKE ALL ON FUNCTION public.waves_company_detail(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.waves_company_detail(uuid,uuid) TO authenticated,service_role;
REVOKE ALL ON FUNCTION public.waves_company_team(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.waves_company_team(uuid,uuid) TO authenticated,service_role;
REVOKE ALL ON FUNCTION public.waves_company_actor(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.waves_company_actor(uuid) TO authenticated,service_role;
REVOKE ALL ON FUNCTION public.waves_can_read_company_entry(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.waves_can_read_company_entry(uuid) TO authenticated,service_role;
REVOKE ALL ON FUNCTION public.waves_company_project_visible(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.waves_company_project_visible(uuid,uuid) TO authenticated,service_role;
REVOKE ALL ON FUNCTION public.waves_company_people(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.waves_company_people(uuid) TO authenticated,service_role;
REVOKE ALL ON FUNCTION public.waves_company_project_set(uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.waves_company_project_set(uuid,uuid,jsonb) TO authenticated,service_role;
REVOKE ALL ON FUNCTION public.waves_company_member_projects_set(uuid,uuid[]) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.waves_company_member_projects_set(uuid,uuid[]) TO authenticated,service_role;
REVOKE ALL ON FUNCTION public.waves_company_member_assign(uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.waves_company_member_assign(uuid,uuid,text) TO authenticated,service_role;
REVOKE ALL ON FUNCTION public.waves_company_member_add(uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.waves_company_member_add(uuid,uuid,jsonb) TO authenticated,service_role;
REVOKE ALL ON FUNCTION public.waves_company_entry_values(text,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.waves_company_entry_values(text,uuid,jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.waves_company_entry_create(uuid,uuid,uuid,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.waves_company_entry_create(uuid,uuid,uuid,text,jsonb) TO authenticated,service_role;
REVOKE ALL ON FUNCTION public.waves_company_entry_update(uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.waves_company_entry_update(uuid,jsonb) TO authenticated,service_role;
REVOKE ALL ON FUNCTION public.waves_company_entry_void(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.waves_company_entry_void(uuid,text) TO authenticated,service_role;
REVOKE ALL ON FUNCTION public.waves_company_entry_transition(uuid,text,text,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.waves_company_entry_transition(uuid,text,text,integer) TO authenticated,service_role;
REVOKE ALL ON FUNCTION public.waves_company_member_rate_set(uuid,uuid,bigint) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.waves_company_member_rate_set(uuid,uuid,bigint) TO authenticated,service_role;
REVOKE ALL ON FUNCTION public.waves_company_mileage_rate_set(uuid,uuid,bigint) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.waves_company_mileage_rate_set(uuid,uuid,bigint) TO authenticated,service_role;
REVOKE ALL ON FUNCTION public.waves_company_review_guard() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.waves_company_review_guard() TO service_role;
REVOKE ALL ON FUNCTION public.waves_company_phase3_entry_guard() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.waves_company_phase3_entry_guard() TO service_role;
REVOKE ALL ON FUNCTION public.waves_company_reimburse(uuid,uuid,uuid,jsonb,jsonb,date,date,bigint,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.waves_company_reimburse(uuid,uuid,uuid,jsonb,jsonb,date,date,bigint,text) TO authenticated,service_role;
REVOKE ALL ON FUNCTION public.waves_profiles_share_group(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.waves_profiles_share_group(uuid,uuid) TO service_role;
REVOKE ALL ON FUNCTION public.waves_shares_a_group_with(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.waves_shares_a_group_with(uuid) TO authenticated,service_role;
REVOKE ALL ON FUNCTION public.waves_person_profile(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.waves_person_profile(text) TO authenticated,service_role;
REVOKE ALL ON FUNCTION public.waves_member_link_candidates(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.waves_member_link_candidates(uuid) TO authenticated,service_role;
REVOKE ALL ON FUNCTION public.waves_guard_membership_columns() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.waves_guard_membership_columns() TO service_role;
REVOKE ALL ON FUNCTION public.waves_add_ghost_member(uuid,text,uuid,text,text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.waves_add_ghost_member(uuid,text,uuid,text,text,uuid) TO authenticated,service_role;
REVOKE ALL ON FUNCTION public.waves_set_member_role(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.waves_set_member_role(uuid,text) TO authenticated,service_role;
REVOKE ALL ON FUNCTION public.waves_remove_member(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.waves_remove_member(uuid) TO authenticated,service_role;
REVOKE ALL ON FUNCTION public.waves_guard_invite_insert() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.waves_guard_invite_insert() TO service_role;
REVOKE ALL ON FUNCTION public.waves_join_via_invite(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.waves_join_via_invite(uuid,uuid) TO service_role;
REVOKE ALL ON FUNCTION public.waves_request_member_claim(uuid,uuid,uuid,text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.waves_request_member_claim(uuid,uuid,uuid,text,uuid) TO service_role;
REVOKE ALL ON FUNCTION public.waves_company_past_people(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.waves_company_past_people(uuid) TO authenticated,service_role;
REVOKE ALL ON FUNCTION public.waves_company_add_past_people(uuid,uuid[]) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.waves_company_add_past_people(uuid,uuid[]) TO authenticated,service_role;
REVOKE ALL ON FUNCTION public.waves_company_phase4_member_guard() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.waves_company_phase4_member_guard() TO service_role;
REVOKE ALL ON FUNCTION public.waves_company_phase4_entry_guard() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.waves_company_phase4_entry_guard() TO service_role;
REVOKE ALL ON FUNCTION public.waves_company_phase4_photo_guard() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.waves_company_phase4_photo_guard() TO service_role;
REVOKE ALL ON FUNCTION public.waves_company_pool_post(uuid,uuid,uuid,text,bigint,uuid,date,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.waves_company_pool_post(uuid,uuid,uuid,text,bigint,uuid,date,text) TO authenticated,service_role;
REVOKE ALL ON FUNCTION public.waves_company_pool_balance(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.waves_company_pool_balance(uuid,uuid) TO authenticated,service_role;
REVOKE ALL ON FUNCTION public.waves_company_project_report(uuid,date,date) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.waves_company_project_report(uuid,date,date) TO authenticated,service_role;
REVOKE ALL ON FUNCTION public.waves_company_wage_pay(uuid,uuid,date,date,date,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.waves_company_wage_pay(uuid,uuid,date,date,date,jsonb) TO authenticated,service_role;
REVOKE ALL ON FUNCTION public.waves_company_entry_lock(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.waves_company_entry_lock(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.waves_attach_company_entry_image(uuid,text,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.waves_attach_company_entry_image(uuid,text,uuid,text) TO authenticated,service_role;
REVOKE ALL ON FUNCTION public.waves_remove_company_entry_image(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.waves_remove_company_entry_image(uuid) TO authenticated,service_role;
REVOKE ALL ON FUNCTION public.waves_company_evidence_changed(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.waves_company_evidence_changed(uuid,uuid) TO service_role;
REVOKE ALL ON FUNCTION public.waves_company_storage_write(uuid,uuid,text,bigint,text,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.waves_company_storage_write(uuid,uuid,text,bigint,text,boolean) TO service_role;
REVOKE ALL ON FUNCTION public.waves_company_cancel_upload(uuid,text,uuid,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.waves_company_cancel_upload(uuid,text,uuid,boolean) TO service_role;
REVOKE ALL ON FUNCTION public.waves_decide_member_claim(uuid,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.waves_decide_member_claim(uuid,boolean) TO authenticated,service_role;

DROP POLICY invites_insert ON public.invites;
CREATE POLICY invites_insert ON public.invites FOR INSERT TO authenticated WITH CHECK(
 public.is_group_member(group_id) AND (NOT public.waves_is_company(group_id) OR public.is_group_admin(group_id)
 OR EXISTS(SELECT 1 FROM public.group_members WHERE id=public.waves_my_member_id(group_id) AND role::text='manager' AND left_at IS NULL AND removed_at IS NULL)));
