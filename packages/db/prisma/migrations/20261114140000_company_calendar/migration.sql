-- Company calendar: holidays, leave (request + approval), events, optional birthday/joining dates, and two
-- wage-rule switches. Money dates, work tasks and attendance on the calendar are derived from existing tables.
-- Reads follow the Company walls (owner all, manager their team, employee own; holidays for every live member).
-- Writes are RPC-only (offline queue -> sync). Every table carries the moderation block guard.

ALTER TABLE public.groups
 ADD COLUMN company_paid_holidays boolean NOT NULL DEFAULT true,
 ADD COLUMN company_paid_leave boolean NOT NULL DEFAULT false;

-- Non-throwing: is the caller a live member of this company?
CREATE FUNCTION public.waves_company_member_ok(p_group_id uuid) RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
 SELECT EXISTS(SELECT 1 FROM public.group_members me JOIN public.groups g ON g.id=me.group_id
 WHERE me.group_id=p_group_id AND g.type='company' AND g.deleted_at IS NULL
 AND me.profile_id=public.waves_current_profile_id() AND me.left_at IS NULL AND me.removed_at IS NULL AND me.merged_into_member_id IS NULL);
$$;

CREATE TABLE public.company_holidays (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 group_id uuid NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
 start_day date NOT NULL, end_day date NOT NULL,
 name text NOT NULL CHECK(length(name) BETWEEN 1 AND 80),
 created_by uuid NOT NULL REFERENCES public.group_members(id),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 deleted_at timestamptz, updated_seq bigint NOT NULL DEFAULT 0,
 CHECK(end_day>=start_day AND end_day-start_day<=30)
);
CREATE INDEX company_holidays_sync_idx ON public.company_holidays(group_id,updated_seq);

CREATE TABLE public.company_leave (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 group_id uuid NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
 member_id uuid NOT NULL REFERENCES public.group_members(id) ON DELETE CASCADE,
 start_day date NOT NULL, end_day date NOT NULL,
 half_day boolean NOT NULL DEFAULT false,
 kind text NOT NULL CHECK(kind IN ('casual','sick','other')),
 reason text CHECK(reason IS NULL OR length(reason) BETWEEN 1 AND 200),
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
 decided_by uuid REFERENCES public.group_members(id),
 decision_note text CHECK(decision_note IS NULL OR length(decision_note) BETWEEN 1 AND 200),
 created_by uuid NOT NULL REFERENCES public.group_members(id),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 deleted_at timestamptz, updated_seq bigint NOT NULL DEFAULT 0,
 CHECK(end_day>=start_day AND end_day-start_day<=59),
 CHECK(NOT half_day OR start_day=end_day)
);
CREATE INDEX company_leave_sync_idx ON public.company_leave(group_id,updated_seq);
CREATE INDEX company_leave_member_idx ON public.company_leave(group_id,member_id,start_day);

CREATE TABLE public.company_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 group_id uuid NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
 title text NOT NULL CHECK(length(title) BETWEEN 1 AND 100),
 day date NOT NULL,
 at_time text CHECK(at_time IS NULL OR at_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
 project_id uuid,
 people uuid[] NOT NULL DEFAULT '{}', -- empty = the whole company
 created_by uuid NOT NULL REFERENCES public.group_members(id),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 deleted_at timestamptz, updated_seq bigint NOT NULL DEFAULT 0,
 FOREIGN KEY(project_id,group_id) REFERENCES public.company_projects(id,group_id)
);
CREATE INDEX company_events_sync_idx ON public.company_events(group_id,updated_seq);

-- Birthday (day + month, never the year) and joining date; one row per person.
CREATE TABLE public.company_member_dates (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 group_id uuid NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
 member_id uuid NOT NULL REFERENCES public.group_members(id) ON DELETE CASCADE,
 birth_day smallint CHECK(birth_day BETWEEN 1 AND 31),
 birth_month smallint CHECK(birth_month BETWEEN 1 AND 12),
 joined_on date,
 show_birthday boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 deleted_at timestamptz, updated_seq bigint NOT NULL DEFAULT 0,
 UNIQUE(group_id,member_id),
 CHECK((birth_day IS NULL)=(birth_month IS NULL))
);
CREATE INDEX company_member_dates_sync_idx ON public.company_member_dates(group_id,updated_seq);

-- Events: owner all; creator; a manager when their team (or they) are involved; an employee when named. Empty list = everyone.
CREATE FUNCTION public.waves_company_event_visible(p_group_id uuid,p_people uuid[],p_created_by uuid) RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
 SELECT EXISTS(SELECT 1 FROM public.group_members me JOIN public.groups g ON g.id=me.group_id
 WHERE me.group_id=p_group_id AND g.type='company' AND g.deleted_at IS NULL
 AND me.profile_id=public.waves_current_profile_id() AND me.left_at IS NULL AND me.removed_at IS NULL AND me.merged_into_member_id IS NULL
 AND (me.role::text='admin' OR me.id=p_created_by OR cardinality(p_people)=0 OR me.id=ANY(p_people)
  OR (me.role::text='manager' AND EXISTS(SELECT 1 FROM public.group_members t WHERE t.group_id=p_group_id AND t.manager_id=me.id AND t.role::text='member' AND t.id=ANY(p_people)))));
$$;

-- Dates: owner/manager/self as for any personal row; everyone else only a LIVE person's row that opted in to show the birthday.
CREATE FUNCTION public.waves_company_dates_visible(p_group_id uuid,p_member_id uuid,p_show boolean) RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
 SELECT public.waves_company_detail(p_group_id,p_member_id)
 OR (p_show AND public.waves_company_member_ok(p_group_id) AND EXISTS(SELECT 1 FROM public.group_members t
  WHERE t.id=p_member_id AND t.group_id=p_group_id AND t.left_at IS NULL AND t.removed_at IS NULL AND t.merged_into_member_id IS NULL));
$$;

DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['company_holidays','company_leave','company_events','company_member_dates'] LOOP
  EXECUTE format('CREATE TRIGGER %I BEFORE INSERT OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.waves_stamp_seq()',t||'_stamp',t);
  EXECUTE format('CREATE TRIGGER aa_company_block_guard BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.waves_company_block_guard()',t);
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated',t);
  EXECUTE format('GRANT SELECT ON public.%I TO authenticated',t);
  EXECUTE format('GRANT ALL ON public.%I TO service_role',t);
 END LOOP;
END $$;
CREATE POLICY company_holidays_select ON public.company_holidays FOR SELECT TO authenticated USING(public.waves_company_member_ok(group_id));
CREATE POLICY company_leave_select ON public.company_leave FOR SELECT TO authenticated USING(public.waves_company_detail(group_id,member_id));
CREATE POLICY company_events_select ON public.company_events FOR SELECT TO authenticated USING(public.waves_company_event_visible(group_id,people,created_by));
CREATE POLICY company_member_dates_select ON public.company_member_dates FOR SELECT TO authenticated USING(public.waves_company_dates_visible(group_id,member_id,show_birthday AND birth_month IS NOT NULL));

-- ── Settings ────────────────────────────────────────────────────────────────
CREATE FUNCTION public.waves_company_calendar_settings_set(p_group_id uuid,p_paid_holidays boolean,p_paid_leave boolean) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
BEGIN
 PERFORM public.waves_company_actor(p_group_id);
 IF NOT public.is_group_admin(p_group_id) THEN RAISE EXCEPTION 'ADMIN_ONLY' USING ERRCODE='insufficient_privilege'; END IF;
 IF p_paid_holidays IS NULL OR p_paid_leave IS NULL THEN RAISE EXCEPTION 'INVALID_DATA: setting'; END IF;
 UPDATE public.groups SET company_paid_holidays=p_paid_holidays,company_paid_leave=p_paid_leave,updated_at=now() WHERE id=p_group_id AND deleted_at IS NULL;
END $$;

-- ── Holidays (owner) ────────────────────────────────────────────────────────
CREATE FUNCTION public.waves_company_holiday_set(p_group_id uuid,p_id uuid,p_start date,p_end date,p_name text) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
DECLARE v_me uuid; v_name text:=btrim(coalesce(p_name,'')); r public.company_holidays;
BEGIN
 v_me:=public.waves_company_actor(p_group_id);
 IF NOT public.is_group_admin(p_group_id) THEN RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE='insufficient_privilege'; END IF;
 IF v_name='' OR length(v_name)>80 THEN RAISE EXCEPTION 'INVALID_DATA: name'; END IF;
 IF p_start IS NULL OR p_end IS NULL OR p_end<p_start OR p_end-p_start>30 OR p_start<current_date-400 OR p_end>current_date+730 THEN RAISE EXCEPTION 'INVALID_DATA: day'; END IF;
 SELECT * INTO r FROM public.company_holidays WHERE id=p_id FOR UPDATE;
 IF FOUND THEN
  IF r.group_id<>p_group_id THEN RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE='insufficient_privilege'; END IF;
  UPDATE public.company_holidays SET start_day=p_start,end_day=p_end,name=v_name,deleted_at=NULL,updated_at=now() WHERE id=p_id;
 ELSE
  INSERT INTO public.company_holidays(id,group_id,start_day,end_day,name,created_by) VALUES(p_id,p_group_id,p_start,p_end,v_name,v_me);
 END IF;
END $$;

CREATE FUNCTION public.waves_company_holiday_remove(p_group_id uuid,p_id uuid) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
BEGIN
 PERFORM public.waves_company_actor(p_group_id);
 IF NOT public.is_group_admin(p_group_id) THEN RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE='insufficient_privilege'; END IF;
 UPDATE public.company_holidays SET deleted_at=now(),updated_at=now() WHERE id=p_id AND group_id=p_group_id AND deleted_at IS NULL;
END $$;

-- ── Leave ───────────────────────────────────────────────────────────────────
-- A person asks for their own leave (pending). The owner, or the person's manager, records it directly (approved).
CREATE FUNCTION public.waves_company_leave_set(p_group_id uuid,p_id uuid,p_member_id uuid,p_start date,p_end date,p_half boolean,p_kind text,p_reason text) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
DECLARE v_me uuid; v_reason text:=nullif(btrim(coalesce(p_reason,'')),''); v_boss boolean; v_role text; r public.company_leave;
BEGIN
 v_me:=public.waves_company_actor(p_group_id);
 v_boss:=public.is_group_admin(p_group_id) OR public.waves_company_team(p_group_id,p_member_id);
 IF p_member_id IS DISTINCT FROM v_me AND NOT v_boss THEN RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE='insufficient_privilege'; END IF;
 SELECT * INTO r FROM public.company_leave WHERE id=p_id FOR UPDATE;
 IF FOUND THEN
  IF r.group_id=p_group_id AND r.created_by=v_me AND r.member_id=p_member_id THEN RETURN; END IF; -- a retried request
  RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE='insufficient_privilege';
 END IF;
 IF p_kind IS NULL OR p_kind NOT IN ('casual','sick','other') THEN RAISE EXCEPTION 'INVALID_DATA: kind'; END IF;
 IF length(coalesce(v_reason,''))>200 THEN RAISE EXCEPTION 'INVALID_DATA: reason'; END IF;
 IF p_start IS NULL OR p_end IS NULL OR p_end<p_start OR p_end-p_start>59 OR p_start<current_date-60 OR p_end>current_date+365 THEN RAISE EXCEPTION 'INVALID_DATA: day'; END IF;
 IF coalesce(p_half,false) AND p_start<>p_end THEN RAISE EXCEPTION 'INVALID_DATA: half day'; END IF;
 SELECT role::text INTO v_role FROM public.group_members WHERE id=p_member_id AND group_id=p_group_id AND left_at IS NULL AND removed_at IS NULL AND merged_into_member_id IS NULL;
 IF v_role IS NULL OR (v_role='admin' AND p_member_id<>v_me) THEN RAISE EXCEPTION 'UNKNOWN_MEMBER' USING ERRCODE='insufficient_privilege'; END IF;
 IF EXISTS(SELECT 1 FROM public.company_leave WHERE group_id=p_group_id AND member_id=p_member_id AND deleted_at IS NULL AND status IN ('pending','approved') AND start_day<=p_end AND end_day>=p_start) THEN RAISE EXCEPTION 'INVALID_DATA: overlap'; END IF;
 INSERT INTO public.company_leave(id,group_id,member_id,start_day,end_day,half_day,kind,reason,status,decided_by,created_by)
 VALUES(p_id,p_group_id,p_member_id,p_start,p_end,coalesce(p_half,false),p_kind,v_reason,
  CASE WHEN p_member_id=v_me AND v_role<>'admin' THEN 'pending' ELSE 'approved' END,
  CASE WHEN p_member_id=v_me AND v_role<>'admin' THEN NULL ELSE v_me END,v_me);
END $$;

-- Approve / reject: the owner, or the requester's own manager (never the requester).
CREATE FUNCTION public.waves_company_leave_decide(p_group_id uuid,p_id uuid,p_approve boolean,p_note text) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
DECLARE v_me uuid; r public.company_leave; v_note text:=nullif(btrim(coalesce(p_note,'')),''); v_to text;
BEGIN
 v_me:=public.waves_company_actor(p_group_id);
 IF p_approve IS NULL THEN RAISE EXCEPTION 'INVALID_DATA: decision'; END IF;
 v_to:=CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END;
 IF length(coalesce(v_note,''))>200 THEN RAISE EXCEPTION 'INVALID_DATA: note'; END IF;
 SELECT * INTO r FROM public.company_leave WHERE id=p_id AND group_id=p_group_id AND deleted_at IS NULL FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE='insufficient_privilege'; END IF;
 IF r.member_id=v_me OR NOT (public.is_group_admin(p_group_id) OR public.waves_company_team(p_group_id,r.member_id)) THEN RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE='insufficient_privilege'; END IF;
 IF r.status=v_to THEN RETURN; END IF; -- a retried decision
 IF r.status<>'pending' THEN RAISE EXCEPTION 'INVALID_DATA: already decided'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.group_members WHERE id=r.member_id AND left_at IS NULL AND removed_at IS NULL AND merged_into_member_id IS NULL) THEN RAISE EXCEPTION 'UNKNOWN_MEMBER' USING ERRCODE='insufficient_privilege'; END IF;
 UPDATE public.company_leave SET status=v_to,decided_by=v_me,decision_note=v_note,updated_at=now() WHERE id=r.id;
END $$;

-- The requester withdraws a pending request; the owner or the person's manager removes any.
CREATE FUNCTION public.waves_company_leave_remove(p_group_id uuid,p_id uuid) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
DECLARE v_me uuid; r public.company_leave;
BEGIN
 v_me:=public.waves_company_actor(p_group_id);
 SELECT * INTO r FROM public.company_leave WHERE id=p_id AND group_id=p_group_id AND deleted_at IS NULL FOR UPDATE;
 IF NOT FOUND THEN RETURN; END IF;
 IF NOT (public.is_group_admin(p_group_id) OR public.waves_company_team(p_group_id,r.member_id) OR (r.member_id=v_me AND r.status='pending')) THEN RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE='insufficient_privilege'; END IF;
 UPDATE public.company_leave SET deleted_at=now(),updated_at=now() WHERE id=r.id;
END $$;

-- ── Events (owner; a manager for their own team) ────────────────────────────
CREATE FUNCTION public.waves_company_event_set(p_group_id uuid,p_id uuid,p_title text,p_day date,p_time text,p_project_id uuid,p_people uuid[]) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
DECLARE v_me uuid; v_title text:=btrim(coalesce(p_title,'')); v_time text:=nullif(btrim(coalesce(p_time,'')),''); v_people uuid[]:=coalesce(p_people,'{}'); r public.company_events; p uuid;
BEGIN
 v_me:=public.waves_company_actor(p_group_id);
 IF NOT public.is_group_admin(p_group_id) AND NOT EXISTS(SELECT 1 FROM public.group_members WHERE id=v_me AND role::text='manager') THEN RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE='insufficient_privilege'; END IF;
 IF v_title='' OR length(v_title)>100 THEN RAISE EXCEPTION 'INVALID_DATA: title'; END IF;
 IF v_time IS NOT NULL AND v_time !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' THEN RAISE EXCEPTION 'INVALID_DATA: time'; END IF;
 IF p_day IS NULL OR p_day<current_date-400 OR p_day>current_date+730 THEN RAISE EXCEPTION 'INVALID_DATA: day'; END IF;
 IF cardinality(v_people)>200 THEN RAISE EXCEPTION 'INVALID_DATA: people'; END IF;
 IF p_project_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.company_projects WHERE id=p_project_id AND group_id=p_group_id AND deleted_at IS NULL) THEN RAISE EXCEPTION 'INVALID_DATA: site'; END IF;
 SELECT array_agg(DISTINCT x) INTO v_people FROM unnest(v_people) x;
 v_people:=coalesce(v_people,'{}');
 FOREACH p IN ARRAY v_people LOOP
  IF NOT EXISTS(SELECT 1 FROM public.group_members WHERE id=p AND group_id=p_group_id AND left_at IS NULL AND removed_at IS NULL AND merged_into_member_id IS NULL AND profile_id IS NOT NULL) THEN RAISE EXCEPTION 'UNKNOWN_MEMBER' USING ERRCODE='insufficient_privilege'; END IF;
  IF NOT public.is_group_admin(p_group_id) AND p<>v_me AND NOT public.waves_company_team(p_group_id,p) THEN RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE='insufficient_privilege'; END IF;
 END LOOP;
 IF NOT public.is_group_admin(p_group_id) AND cardinality(v_people)=0 THEN RAISE EXCEPTION 'INVALID_DATA: people'; END IF;
 SELECT * INTO r FROM public.company_events WHERE id=p_id FOR UPDATE;
 IF FOUND THEN
  IF r.group_id<>p_group_id OR (NOT public.is_group_admin(p_group_id) AND r.created_by<>v_me) THEN RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE='insufficient_privilege'; END IF;
  UPDATE public.company_events SET title=v_title,day=p_day,at_time=v_time,project_id=p_project_id,people=v_people,deleted_at=NULL,updated_at=now() WHERE id=p_id;
 ELSE
  INSERT INTO public.company_events(id,group_id,title,day,at_time,project_id,people,created_by) VALUES(p_id,p_group_id,v_title,p_day,v_time,p_project_id,v_people,v_me);
 END IF;
END $$;

CREATE FUNCTION public.waves_company_event_remove(p_group_id uuid,p_id uuid) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
DECLARE v_me uuid; r public.company_events;
BEGIN
 v_me:=public.waves_company_actor(p_group_id);
 SELECT * INTO r FROM public.company_events WHERE id=p_id AND group_id=p_group_id AND deleted_at IS NULL FOR UPDATE;
 IF NOT FOUND THEN RETURN; END IF;
 IF NOT public.is_group_admin(p_group_id) AND r.created_by<>v_me THEN RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE='insufficient_privilege'; END IF;
 UPDATE public.company_events SET deleted_at=now(),updated_at=now() WHERE id=r.id;
END $$;

-- ── Birthday / joining date ─────────────────────────────────────────────────
-- Self sets all three; owner/manager set the dates for their people but never the "show my birthday" choice.
CREATE FUNCTION public.waves_company_dates_set(p_group_id uuid,p_member_id uuid,p_birth_day int,p_birth_month int,p_joined_on date,p_show boolean) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
DECLARE v_me uuid; r public.company_member_dates; v_show boolean;
BEGIN
 v_me:=public.waves_company_actor(p_group_id);
 IF p_member_id IS DISTINCT FROM v_me AND NOT (public.is_group_admin(p_group_id) OR public.waves_company_team(p_group_id,p_member_id)) THEN RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE='insufficient_privilege'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.group_members WHERE id=p_member_id AND group_id=p_group_id AND left_at IS NULL AND removed_at IS NULL AND merged_into_member_id IS NULL) THEN RAISE EXCEPTION 'UNKNOWN_MEMBER' USING ERRCODE='insufficient_privilege'; END IF;
 IF (p_birth_day IS NULL)<>(p_birth_month IS NULL) THEN RAISE EXCEPTION 'INVALID_DATA: birthday'; END IF;
 IF p_birth_day IS NOT NULL THEN
  IF p_birth_month NOT BETWEEN 1 AND 12 OR p_birth_day NOT BETWEEN 1 AND 31 THEN RAISE EXCEPTION 'INVALID_DATA: birthday'; END IF;
  BEGIN PERFORM make_date(2000,p_birth_month,p_birth_day); EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'INVALID_DATA: birthday'; END; -- 2000 is a leap year: 29 Feb is allowed
 END IF;
 IF p_joined_on IS NOT NULL AND (p_joined_on>current_date OR p_joined_on<DATE '1980-01-01') THEN RAISE EXCEPTION 'INVALID_DATA: joined'; END IF;
 SELECT * INTO r FROM public.company_member_dates WHERE group_id=p_group_id AND member_id=p_member_id FOR UPDATE;
 v_show:=CASE WHEN p_member_id=v_me THEN coalesce(p_show,false) ELSE coalesce(r.show_birthday AND r.deleted_at IS NULL,false) END;
 IF p_birth_day IS NULL AND p_joined_on IS NULL THEN
  IF FOUND THEN UPDATE public.company_member_dates SET birth_day=NULL,birth_month=NULL,joined_on=NULL,show_birthday=v_show,deleted_at=now(),updated_at=now() WHERE id=r.id; END IF;
  RETURN;
 END IF;
 IF FOUND THEN
  UPDATE public.company_member_dates SET birth_day=p_birth_day,birth_month=p_birth_month,joined_on=p_joined_on,show_birthday=v_show,deleted_at=NULL,updated_at=now() WHERE id=r.id;
 ELSE
  INSERT INTO public.company_member_dates(group_id,member_id,birth_day,birth_month,joined_on,show_birthday) VALUES(p_group_id,p_member_id,p_birth_day,p_birth_month,p_joined_on,v_show);
 END IF;
END $$;

-- A new manager's next pull must carry the person's rows: re-stamp on reassignment.
CREATE FUNCTION public.waves_company_calendar_restamp_on_assign() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
BEGIN
 -- Leaving also clears the manager link; a suspended company must not turn that into a refused departure.
 IF NEW.left_at IS NOT NULL OR public.waves_company_is_blocked(NEW.group_id) THEN RETURN NEW; END IF;
 UPDATE public.company_leave SET updated_at=now() WHERE member_id=NEW.id;
 UPDATE public.company_member_dates SET updated_at=now() WHERE member_id=NEW.id;
 UPDATE public.company_events SET updated_at=now() WHERE group_id=NEW.group_id AND NEW.id=ANY(people);
 RETURN NEW;
END $$;
CREATE TRIGGER group_members_restamp_calendar AFTER UPDATE OF manager_id ON public.group_members
 FOR EACH ROW WHEN (OLD.manager_id IS DISTINCT FROM NEW.manager_id) EXECUTE FUNCTION public.waves_company_calendar_restamp_on_assign();

REVOKE ALL ON FUNCTION
 public.waves_company_member_ok(uuid),public.waves_company_event_visible(uuid,uuid[],uuid),public.waves_company_dates_visible(uuid,uuid,boolean),
 public.waves_company_calendar_settings_set(uuid,boolean,boolean),
 public.waves_company_holiday_set(uuid,uuid,date,date,text),public.waves_company_holiday_remove(uuid,uuid),
 public.waves_company_leave_set(uuid,uuid,uuid,date,date,boolean,text,text),public.waves_company_leave_decide(uuid,uuid,boolean,text),public.waves_company_leave_remove(uuid,uuid),
 public.waves_company_event_set(uuid,uuid,text,date,text,uuid,uuid[]),public.waves_company_event_remove(uuid,uuid),
 public.waves_company_dates_set(uuid,uuid,int,int,date,boolean),public.waves_company_calendar_restamp_on_assign()
 FROM PUBLIC,anon,authenticated;
-- RLS policies call the three predicates as the caller, so authenticated needs EXECUTE on those only.
GRANT EXECUTE ON FUNCTION public.waves_company_member_ok(uuid),public.waves_company_event_visible(uuid,uuid[],uuid),public.waves_company_dates_visible(uuid,uuid,boolean) TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION
 public.waves_company_calendar_settings_set(uuid,boolean,boolean),
 public.waves_company_holiday_set(uuid,uuid,date,date,text),public.waves_company_holiday_remove(uuid,uuid),
 public.waves_company_leave_set(uuid,uuid,uuid,date,date,boolean,text,text),public.waves_company_leave_decide(uuid,uuid,boolean,text),public.waves_company_leave_remove(uuid,uuid),
 public.waves_company_event_set(uuid,uuid,text,date,text,uuid,uuid[]),public.waves_company_event_remove(uuid,uuid),
 public.waves_company_dates_set(uuid,uuid,int,int,date,boolean)
 TO authenticated,service_role;
