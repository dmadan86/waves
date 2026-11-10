-- Company leave policies + balances.
-- The owner defines leave types (Casual, Sick, Earned ...) with a monthly accrual, carry forward (+ cap),
-- an annual cap, "paid" and "allow overdraw". A request may name a type; approving it deducts from the
-- person's balance. The balance is DERIVED (never stored): waves_company_leave_balance below implements
-- exactly packages/core/src/company/leaveBalance.ts (read that file for the rules; tests pin both).
-- Reads: every live member sees the types (RLS). Writes: RPC only; the owner edits types.

CREATE TABLE public.company_leave_types (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 group_id uuid NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
 name text NOT NULL CHECK(length(name) BETWEEN 1 AND 40),
 -- Copied onto each request (casual/sick/other) so the older wage rule and screens keep working.
 kind text NOT NULL DEFAULT 'other' CHECK(kind IN ('casual','sick','other')),
 accrual_days_per_month numeric(4,2) NOT NULL DEFAULT 1 CHECK(accrual_days_per_month BETWEEN 0 AND 5),
 carry_forward boolean NOT NULL DEFAULT true,
 carry_forward_cap numeric(6,2) CHECK(carry_forward_cap IS NULL OR carry_forward_cap >= 0),
 annual_cap numeric(6,2) CHECK(annual_cap IS NULL OR annual_cap >= 0),
 -- A paid type counts as a paid day in the wage-days prefill (replaces the company-wide switch for requests of this type).
 paid boolean NOT NULL DEFAULT false,
 -- Off by default: approving a request that would make the balance negative is refused.
 allow_overdraw boolean NOT NULL DEFAULT false,
 active boolean NOT NULL DEFAULT true,
 -- First day the type earns (UTC date it was created).
 starts_on date NOT NULL DEFAULT ((now() AT TIME ZONE 'UTC')::date),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 deleted_at timestamptz, updated_seq bigint NOT NULL DEFAULT 0,
 UNIQUE(id,group_id)
);
CREATE INDEX company_leave_types_sync_idx ON public.company_leave_types(group_id,updated_seq);
CREATE UNIQUE INDEX company_leave_types_name_idx ON public.company_leave_types(group_id,lower(name)) WHERE deleted_at IS NULL;

ALTER TABLE public.company_leave ADD COLUMN leave_type_id uuid,
 ADD CONSTRAINT company_leave_type_fk FOREIGN KEY(leave_type_id,group_id) REFERENCES public.company_leave_types(id,group_id);

CREATE TRIGGER company_leave_types_stamp BEFORE INSERT OR UPDATE ON public.company_leave_types FOR EACH ROW EXECUTE FUNCTION public.waves_stamp_seq();
CREATE TRIGGER aa_company_block_guard BEFORE INSERT OR UPDATE OR DELETE ON public.company_leave_types FOR EACH ROW EXECUTE FUNCTION public.waves_company_block_guard();
ALTER TABLE public.company_leave_types ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.company_leave_types FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.company_leave_types TO authenticated;
GRANT ALL ON public.company_leave_types TO service_role;
-- A linked assistant is held to its one company, like every other company table.
CREATE POLICY company_agent_gate ON public.company_leave_types AS RESTRICTIVE FOR ALL TO authenticated USING (public.waves_agent_client_id() IS NULL OR public.waves_company_agent_allowed(group_id));
CREATE TRIGGER aa_company_agent_guard BEFORE INSERT OR UPDATE OR DELETE ON public.company_leave_types FOR EACH ROW EXECUTE FUNCTION public.waves_company_agent_write_guard();
CREATE POLICY company_leave_types_select ON public.company_leave_types FOR SELECT TO authenticated USING(public.waves_company_member_ok(group_id));

-- ── Defaults: Casual 1/month (carries forward), Sick 1/month (resets each year) ─────────────────────
-- "paid" starts from the company's existing paid-leave switch so wages do not change on rollout.
CREATE FUNCTION public.waves_company_leave_types_seed(p_group_id uuid) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM public.company_leave_types WHERE group_id=p_group_id) THEN RETURN; END IF;
 INSERT INTO public.company_leave_types(group_id,name,kind,accrual_days_per_month,carry_forward,paid)
 SELECT g.id,v.name,v.kind,1,v.carry,g.company_paid_leave FROM public.groups g,
  (VALUES ('Casual','casual',true),('Sick','sick',false)) AS v(name,kind,carry) WHERE g.id=p_group_id;
END $$;

CREATE FUNCTION public.waves_company_leave_types_seed_trg() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
BEGIN
 PERFORM public.waves_company_leave_types_seed(NEW.id);
 RETURN NEW;
END $$;
CREATE TRIGGER groups_seed_leave_types AFTER INSERT OR UPDATE OF type ON public.groups
 FOR EACH ROW WHEN (NEW.type::text='company') EXECUTE FUNCTION public.waves_company_leave_types_seed_trg();

SELECT public.waves_company_leave_types_seed(id) FROM public.groups WHERE type::text='company' AND deleted_at IS NULL;

-- ── Balance (internal; mirrors leaveBalance.ts) ─────────────────────────────────────────────────────
-- Months are year*12+month-1. Accrual starts at the later of the type's first month and the person's
-- first month (joined day 1-15 earns that month, later joiners start next month). Leave counts in the
-- year it starts; leave starting after the as-of month is ignored; p_exclude leaves one request out.
CREATE FUNCTION public.waves_company_leave_balance(p_group_id uuid,p_member_id uuid,p_type_id uuid,p_as_of date,p_exclude uuid DEFAULT NULL) RETURNS numeric
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
DECLARE t public.company_leave_types; v_join date; v_first int; v_last int; fy int; ly int; y int;
 m_from int; m_to int; acc numeric; used numeric; closing numeric:=0; carried numeric:=0; v_out numeric:=0;
BEGIN
 SELECT * INTO t FROM public.company_leave_types WHERE id=p_type_id AND group_id=p_group_id;
 IF NOT FOUND THEN RETURN NULL; END IF;
 SELECT coalesce((SELECT joined_on FROM public.company_member_dates WHERE group_id=p_group_id AND member_id=p_member_id AND deleted_at IS NULL),
  (SELECT (created_at AT TIME ZONE 'UTC')::date FROM public.group_members WHERE id=p_member_id AND group_id=p_group_id)) INTO v_join;
 IF v_join IS NULL THEN RETURN NULL; END IF;
 v_first:=greatest(extract(year FROM t.starts_on)::int*12+extract(month FROM t.starts_on)::int-1,
  extract(year FROM v_join)::int*12+extract(month FROM v_join)::int-1+CASE WHEN extract(day FROM v_join)>15 THEN 1 ELSE 0 END);
 v_last:=extract(year FROM p_as_of)::int*12+extract(month FROM p_as_of)::int-1;
 fy:=v_first/12; ly:=extract(year FROM p_as_of)::int;
 FOR y IN fy..ly LOOP
  m_from:=greatest(v_first,y*12); m_to:=least(v_last,y*12+11);
  acc:=CASE WHEN m_to>=m_from THEN t.accrual_days_per_month*(m_to-m_from+1) ELSE 0 END;
  IF t.annual_cap IS NOT NULL THEN acc:=least(acc,t.annual_cap); END IF;
  SELECT coalesce(sum(CASE WHEN half_day THEN 0.5 ELSE end_day-start_day+1 END),0) INTO used FROM public.company_leave
   WHERE group_id=p_group_id AND member_id=p_member_id AND leave_type_id=p_type_id AND status='approved' AND deleted_at IS NULL
   AND id IS DISTINCT FROM p_exclude
   AND extract(year FROM start_day)::int*12+extract(month FROM start_day)::int-1<=v_last
   AND greatest(fy,extract(year FROM start_day)::int)=y;
  closing:=carried+acc-used; v_out:=closing;
  carried:=CASE WHEN NOT t.carry_forward THEN 0 WHEN closing>0 THEN least(closing,coalesce(t.carry_forward_cap,closing)) ELSE closing END;
 END LOOP;
 RETURN v_out;
END $$;

-- Refuse a request that would make the balance negative (unless the type allows overdraw).
-- The caller has locked the person's member row, so two approvals cannot both see the old balance.
CREATE FUNCTION public.waves_company_leave_check(p_group_id uuid,p_member_id uuid,p_type_id uuid,p_start date,p_end date,p_half boolean,p_exclude uuid) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
DECLARE t public.company_leave_types; v_bal numeric; v_days numeric:=CASE WHEN p_half THEN 0.5 ELSE p_end-p_start+1 END;
BEGIN
 IF p_type_id IS NULL THEN RETURN; END IF; -- "Unspecified" leave is never deducted
 SELECT * INTO t FROM public.company_leave_types WHERE id=p_type_id AND group_id=p_group_id;
 IF NOT FOUND OR t.allow_overdraw THEN RETURN; END IF;
 v_bal:=public.waves_company_leave_balance(p_group_id,p_member_id,p_type_id,greatest(p_start,current_date),p_exclude);
 IF v_bal IS NULL OR v_bal-v_days<0 THEN RAISE EXCEPTION 'INSUFFICIENT_BALANCE: % days left', coalesce(v_bal,0) USING ERRCODE='check_violation'; END IF;
END $$;

-- ── Types (owner) ───────────────────────────────────────────────────────────────────────────────────
CREATE FUNCTION public.waves_company_leave_type_set(p_group_id uuid,p_id uuid,p_name text,p_accrual numeric,p_carry boolean,p_carry_cap numeric,p_annual_cap numeric,p_paid boolean,p_allow_overdraw boolean,p_active boolean) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
DECLARE v_name text:=btrim(coalesce(p_name,'')); r public.company_leave_types;
BEGIN
 PERFORM public.waves_company_actor(p_group_id);
 IF NOT public.is_group_admin(p_group_id) THEN RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE='insufficient_privilege'; END IF;
 IF v_name='' OR length(v_name)>40 THEN RAISE EXCEPTION 'INVALID_DATA: name'; END IF;
 IF p_accrual IS NULL OR p_accrual<0 OR p_accrual>5 OR p_accrual*4<>trunc(p_accrual*4) THEN RAISE EXCEPTION 'INVALID_DATA: accrual'; END IF;
 IF p_carry IS NULL OR p_paid IS NULL OR p_allow_overdraw IS NULL OR p_active IS NULL THEN RAISE EXCEPTION 'INVALID_DATA: setting'; END IF;
 IF p_carry_cap<0 OR p_carry_cap>366 OR p_annual_cap<0 OR p_annual_cap>366 THEN RAISE EXCEPTION 'INVALID_DATA: cap'; END IF;
 IF EXISTS(SELECT 1 FROM public.company_leave_types WHERE group_id=p_group_id AND lower(name)=lower(v_name) AND deleted_at IS NULL AND id<>p_id) THEN RAISE EXCEPTION 'INVALID_DATA: name taken'; END IF;
 SELECT * INTO r FROM public.company_leave_types WHERE id=p_id FOR UPDATE;
 IF FOUND THEN
  IF r.group_id<>p_group_id THEN RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE='insufficient_privilege'; END IF;
  UPDATE public.company_leave_types SET name=v_name,accrual_days_per_month=p_accrual,carry_forward=p_carry,carry_forward_cap=CASE WHEN p_carry THEN p_carry_cap END,
   annual_cap=p_annual_cap,paid=p_paid,allow_overdraw=p_allow_overdraw,active=p_active,deleted_at=NULL,updated_at=now() WHERE id=p_id;
 ELSE
  INSERT INTO public.company_leave_types(id,group_id,name,accrual_days_per_month,carry_forward,carry_forward_cap,annual_cap,paid,allow_overdraw,active)
  VALUES(p_id,p_group_id,v_name,p_accrual,p_carry,CASE WHEN p_carry THEN p_carry_cap END,p_annual_cap,p_paid,p_allow_overdraw,p_active);
 END IF;
END $$;

CREATE FUNCTION public.waves_company_leave_type_remove(p_group_id uuid,p_id uuid) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
BEGIN
 PERFORM public.waves_company_actor(p_group_id);
 IF NOT public.is_group_admin(p_group_id) THEN RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE='insufficient_privilege'; END IF;
 UPDATE public.company_leave_types SET deleted_at=now(),updated_at=now() WHERE id=p_id AND group_id=p_group_id AND deleted_at IS NULL;
END $$;

-- ── Leave: request / record gains a type ────────────────────────────────────────────────────────────
-- Same rules as before (see 20261114140000_company_calendar). New: p_leave_type_id (optional; the type's kind
-- is stored as the request kind) and a balance check when the row is recorded as approved at once.
DROP FUNCTION public.waves_company_leave_set(uuid,uuid,uuid,date,date,boolean,text,text);
CREATE FUNCTION public.waves_company_leave_set(p_group_id uuid,p_id uuid,p_member_id uuid,p_start date,p_end date,p_half boolean,p_kind text,p_reason text,p_leave_type_id uuid DEFAULT NULL) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
DECLARE v_me uuid; v_reason text:=nullif(btrim(coalesce(p_reason,'')),''); v_boss boolean; v_role text; v_kind text:=p_kind; v_status text; r public.company_leave; t public.company_leave_types;
BEGIN
 v_me:=public.waves_company_actor(p_group_id);
 v_boss:=public.is_group_admin(p_group_id) OR public.waves_company_team(p_group_id,p_member_id);
 IF p_member_id IS DISTINCT FROM v_me AND NOT v_boss THEN RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE='insufficient_privilege'; END IF;
 SELECT * INTO r FROM public.company_leave WHERE id=p_id FOR UPDATE;
 IF FOUND THEN
  IF r.group_id=p_group_id AND r.created_by=v_me AND r.member_id=p_member_id THEN RETURN; END IF; -- a retried request
  RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE='insufficient_privilege';
 END IF;
 IF p_leave_type_id IS NOT NULL THEN
  SELECT * INTO t FROM public.company_leave_types WHERE id=p_leave_type_id AND group_id=p_group_id AND deleted_at IS NULL AND active;
  IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_DATA: leave type'; END IF;
  v_kind:=t.kind;
 END IF;
 IF v_kind IS NULL OR v_kind NOT IN ('casual','sick','other') THEN RAISE EXCEPTION 'INVALID_DATA: kind'; END IF;
 IF length(coalesce(v_reason,''))>200 THEN RAISE EXCEPTION 'INVALID_DATA: reason'; END IF;
 IF p_start IS NULL OR p_end IS NULL OR p_end<p_start OR p_end-p_start>59 OR p_start<current_date-60 OR p_end>current_date+365 THEN RAISE EXCEPTION 'INVALID_DATA: day'; END IF;
 IF coalesce(p_half,false) AND p_start<>p_end THEN RAISE EXCEPTION 'INVALID_DATA: half day'; END IF;
 SELECT role::text INTO v_role FROM public.group_members WHERE id=p_member_id AND group_id=p_group_id AND left_at IS NULL AND removed_at IS NULL AND merged_into_member_id IS NULL;
 IF v_role IS NULL OR (v_role='admin' AND p_member_id<>v_me) THEN RAISE EXCEPTION 'UNKNOWN_MEMBER' USING ERRCODE='insufficient_privilege'; END IF;
 IF EXISTS(SELECT 1 FROM public.company_leave WHERE group_id=p_group_id AND member_id=p_member_id AND deleted_at IS NULL AND status IN ('pending','approved') AND start_day<=p_end AND end_day>=p_start) THEN RAISE EXCEPTION 'INVALID_DATA: overlap'; END IF;
 v_status:=CASE WHEN p_member_id=v_me AND v_role<>'admin' THEN 'pending' ELSE 'approved' END;
 IF v_status='approved' THEN
  PERFORM 1 FROM public.group_members WHERE id=p_member_id FOR UPDATE; -- serialise balance checks per person
  PERFORM public.waves_company_leave_check(p_group_id,p_member_id,p_leave_type_id,p_start,p_end,coalesce(p_half,false),NULL);
 END IF;
 INSERT INTO public.company_leave(id,group_id,member_id,start_day,end_day,half_day,kind,reason,status,decided_by,created_by,leave_type_id)
 VALUES(p_id,p_group_id,p_member_id,p_start,p_end,coalesce(p_half,false),v_kind,v_reason,v_status,
  CASE WHEN v_status='pending' THEN NULL ELSE v_me END,v_me,p_leave_type_id);
END $$;

-- Approve / reject: unchanged rules (owner, or the requester's own manager, never the requester).
-- New: an approval that would overdraw the type is refused unless the type allows overdraw.
CREATE OR REPLACE FUNCTION public.waves_company_leave_decide(p_group_id uuid,p_id uuid,p_approve boolean,p_note text) RETURNS void
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
 IF p_approve THEN
  PERFORM 1 FROM public.group_members WHERE id=r.member_id FOR UPDATE; -- serialise concurrent approvals for this person
  PERFORM public.waves_company_leave_check(p_group_id,r.member_id,r.leave_type_id,r.start_day,r.end_day,r.half_day,r.id);
 END IF;
 UPDATE public.company_leave SET status=v_to,decided_by=v_me,decision_note=v_note,updated_at=now() WHERE id=r.id;
END $$;

REVOKE ALL ON FUNCTION
 public.waves_company_leave_types_seed(uuid),public.waves_company_leave_types_seed_trg(),
 public.waves_company_leave_balance(uuid,uuid,uuid,date,uuid),
 public.waves_company_leave_check(uuid,uuid,uuid,date,date,boolean,uuid),
 public.waves_company_leave_type_set(uuid,uuid,text,numeric,boolean,numeric,numeric,boolean,boolean,boolean),
 public.waves_company_leave_type_remove(uuid,uuid),
 public.waves_company_leave_set(uuid,uuid,uuid,date,date,boolean,text,text,uuid),
 public.waves_company_leave_decide(uuid,uuid,boolean,text)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION
 public.waves_company_leave_types_seed(uuid),public.waves_company_leave_balance(uuid,uuid,uuid,date,uuid),
 public.waves_company_leave_check(uuid,uuid,uuid,date,date,boolean,uuid)
 TO service_role;
GRANT EXECUTE ON FUNCTION
 public.waves_company_leave_type_set(uuid,uuid,text,numeric,boolean,numeric,numeric,boolean,boolean,boolean),
 public.waves_company_leave_type_remove(uuid,uuid),
 public.waves_company_leave_set(uuid,uuid,uuid,date,date,boolean,text,text,uuid),
 public.waves_company_leave_decide(uuid,uuid,boolean,text)
 TO authenticated,service_role;
