-- Company add-ons: wages split across sites, a second owner's approval.
-- Latest definitions copied from 20261110090000_company_managers_pools; only the marked lines are new.
CREATE TABLE public.company_wage_splits (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), group_id uuid NOT NULL,
 entry_id uuid NOT NULL, project_id uuid NOT NULL,
 amount_minor bigint NOT NULL CHECK(amount_minor>0),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 deleted_at timestamptz, updated_seq bigint NOT NULL DEFAULT 0,
 UNIQUE(entry_id,project_id),
 FOREIGN KEY(entry_id,group_id) REFERENCES public.company_entries(id,group_id) ON DELETE CASCADE,
 FOREIGN KEY(project_id,group_id) REFERENCES public.company_projects(id,group_id)
);
CREATE INDEX company_wage_splits_sync_idx ON public.company_wage_splits(group_id,updated_seq);
CREATE INDEX company_wage_splits_project_idx ON public.company_wage_splits(project_id);
CREATE TRIGGER company_wage_splits_stamp BEFORE INSERT OR UPDATE ON public.company_wage_splits FOR EACH ROW EXECUTE FUNCTION public.waves_stamp_seq();
ALTER TABLE public.company_wage_splits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.company_wage_splits FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.company_wage_splits TO authenticated;
GRANT ALL ON public.company_wage_splits TO service_role;
-- A split line is exactly as private as the payment it divides.
CREATE POLICY company_wage_splits_select ON public.company_wage_splits FOR SELECT TO authenticated USING(public.waves_can_read_company_entry(entry_id));

ALTER TABLE public.groups
 ADD COLUMN company_second_approval boolean NOT NULL DEFAULT false,
 ADD COLUMN company_second_approval_threshold_minor bigint CHECK(company_second_approval_threshold_minor IS NULL OR company_second_approval_threshold_minor>=0);

CREATE FUNCTION public.waves_company_second_owner_required(r public.company_entries) RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
 SELECT EXISTS(SELECT 1 FROM public.groups g WHERE g.id=r.group_id AND g.company_approvals_enabled AND g.company_second_approval
  AND (SELECT count(*) FROM public.group_members o WHERE o.group_id=g.id AND o.role::text='admin' AND o.profile_id IS NOT NULL AND o.left_at IS NULL AND o.removed_at IS NULL AND o.merged_into_member_id IS NULL)>1
  AND (EXISTS(SELECT 1 FROM public.group_members c WHERE c.id=r.created_by AND c.group_id=r.group_id AND c.role::text='admin' AND c.left_at IS NULL AND c.removed_at IS NULL)
   OR (g.company_second_approval_threshold_minor IS NOT NULL AND r.amount>=g.company_second_approval_threshold_minor)));
$$;
REVOKE ALL ON FUNCTION public.waves_company_second_owner_required(public.company_entries) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.waves_company_second_owner_required(public.company_entries) TO service_role;

CREATE FUNCTION public.waves_company_second_approval_set(p_group_id uuid,p_enabled boolean,p_threshold_minor bigint) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
BEGIN
 PERFORM public.waves_company_actor(p_group_id);
 IF NOT public.is_group_admin(p_group_id) THEN RAISE EXCEPTION 'ADMIN_ONLY' USING ERRCODE='insufficient_privilege'; END IF;
 PERFORM 1 FROM public.groups WHERE id=p_group_id FOR UPDATE;
 IF p_enabled IS NULL OR p_threshold_minor<0 THEN RAISE EXCEPTION 'INVALID_DATA'; END IF;
 IF p_enabled AND (SELECT count(*) FROM public.group_members o WHERE o.group_id=p_group_id AND o.role::text='admin' AND o.profile_id IS NOT NULL AND o.left_at IS NULL AND o.removed_at IS NULL AND o.merged_into_member_id IS NULL)<2 THEN RAISE EXCEPTION 'NEEDS_SECOND_OWNER'; END IF;
 UPDATE public.groups SET company_second_approval=p_enabled,company_second_approval_threshold_minor=CASE WHEN p_enabled THEN p_threshold_minor END,updated_at=now() WHERE id=p_group_id AND deleted_at IS NULL;
END $$;
REVOKE ALL ON FUNCTION public.waves_company_second_approval_set(uuid,boolean,bigint) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.waves_company_second_approval_set(uuid,boolean,bigint) TO authenticated,service_role;

CREATE OR REPLACE FUNCTION public.waves_company_member_assign(p_member_id uuid,p_manager_id uuid,p_reason text) RETURNS void
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
 -- History follows the current team: re-stamp it so the new manager's next pull receives it.
 UPDATE public.company_entry_attachments a SET updated_at=now() FROM public.company_entries e WHERE a.entry_id=e.id AND e.member_id=p_member_id;
 -- The new manager's next pull also needs the person's sites, the sites' definitions and any split wage lines.
 UPDATE public.company_project_members SET updated_at=now() WHERE member_id=p_member_id;
 UPDATE public.company_wage_splits s SET updated_at=now() FROM public.company_entries e WHERE s.entry_id=e.id AND e.member_id=p_member_id;
 UPDATE public.company_projects p SET updated_at=now() WHERE p.deleted_at IS NULL AND (p.id IN (SELECT project_id FROM public.company_project_members WHERE member_id=p_member_id AND deleted_at IS NULL) OR p.id IN (SELECT s2.project_id FROM public.company_wage_splits s2 JOIN public.company_entries e2 ON e2.id=s2.entry_id WHERE e2.member_id=p_member_id));
 PERFORM set_config('waves.company_restamp',p_member_id::text,true);
 UPDATE public.company_entries SET updated_at=updated_at WHERE member_id=p_member_id;
 PERFORM set_config('waves.company_restamp','',true);
END $$;

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
 -- Second owner: a flagged claim is approved only by an owner who did not raise it.
 IF p_to='approved' AND public.waves_company_second_owner_required(r) AND (NOT public.is_group_admin(r.group_id) OR actor IS NOT DISTINCT FROM r.created_by) THEN RAISE EXCEPTION 'SECOND_OWNER_REQUIRED: another owner must approve this' USING ERRCODE='insufficient_privilege'; END IF;
 IF r.reimbursement_id IS NOT NULL OR r.reimbursement_details IS NOT NULL THEN RAISE EXCEPTION 'ENTRY_REIMBURSED: covered entries are frozen' USING ERRCODE='check_violation'; END IF;
 IF r.deleted_at IS NOT NULL OR r.status<>'submitted' OR p_to IS NULL OR p_to NOT IN ('approved','rejected') THEN RAISE EXCEPTION 'INVALID_TRANSITION' USING ERRCODE='check_violation'; END IF;
 IF p_expected_version IS NULL OR p_expected_version<>r.version THEN RAISE EXCEPTION 'VERSION_CONFLICT: entry changed; refresh before review' USING ERRCODE='check_violation'; END IF;
 IF p_to='rejected' AND (p_note IS NULL OR p_note !~ '[^[:space:]]') THEN RAISE EXCEPTION 'REVIEW_NOTE_REQUIRED: explain the rejection' USING ERRCODE='check_violation'; END IF;
 UPDATE public.company_entries SET status=p_to,review_note=nullif(btrim(p_note),''),reviewed_by=actor,
 reviewed_at=now(),version=version+1,updated_by=actor,updated_at=now() WHERE id=p_entry_id;
END
$function$;

CREATE OR REPLACE FUNCTION public.waves_company_project_report(p_group_id uuid,p_from date,p_to date) RETURNS jsonb
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
DECLARE projects jsonb; pools jsonb;
BEGIN
 PERFORM public.waves_company_actor(p_group_id);
 IF NOT public.is_group_admin(p_group_id) THEN RAISE EXCEPTION 'ADMIN_ONLY' USING ERRCODE='insufficient_privilege'; END IF;
 IF p_from IS NULL OR p_to IS NULL OR p_from>p_to THEN RAISE EXCEPTION 'INVALID_PERIOD'; END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'budget',b.budget_minor::text,'allocated',a.allocated::text,'spent',a.spent::text,'remaining',(b.budget_minor-a.spent)::text) ORDER BY p.id),'[]') INTO projects
 FROM public.company_projects p LEFT JOIN public.company_project_budgets b ON b.project_id=p.id
 CROSS JOIN LATERAL (SELECT coalesce(sum(CASE WHEN e.entry_kind='pool_return' THEN -e.amount ELSE e.amount END) FILTER(WHERE e.entry_kind IN ('allocation','pool_return','pool_adjustment','pool_request')),0) allocated,
 coalesce(sum(CASE WHEN e.entry_kind='wage_payment' THEN e.gross_minor-e.claims_minor ELSE e.amount END) FILTER(WHERE e.entry_kind IN ('expense','allowance','wages','wage_payment')),0)
  + (SELECT coalesce(sum(s.amount_minor),0) FROM public.company_wage_splits s JOIN public.company_entries w ON w.id=s.entry_id WHERE s.project_id=p.id AND s.deleted_at IS NULL AND w.deleted_at IS NULL AND w.status IN ('approved','reimbursed') AND w.occurred_on BETWEEN p_from AND p_to) spent
 FROM public.company_entries e WHERE e.project_id=p.id AND e.deleted_at IS NULL AND e.status IN ('approved','reimbursed') AND e.occurred_on BETWEEN p_from AND p_to) a
 WHERE p.group_id=p_group_id AND p.deleted_at IS NULL;
 SELECT coalesce(jsonb_agg(jsonb_build_object('managerId',m.id,'name',coalesce(p.display_name,m.ghost_name),'balance',public.waves_company_pool_balance(p_group_id,m.id)->>'balance') ORDER BY m.id),'[]') INTO pools FROM public.group_members m LEFT JOIN public.profiles p ON p.id=m.profile_id WHERE m.group_id=p_group_id AND m.role::text='manager' AND m.left_at IS NULL AND m.removed_at IS NULL;
 RETURN jsonb_build_object('projects',projects,'pools',pools);
END $$;

CREATE OR REPLACE FUNCTION public.waves_company_wage_pay(p_group_id uuid,p_run_id uuid,p_period_start date,p_period_end date,p_paid_on date,p_lines jsonb) RETURNS uuid
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
DECLARE actor uuid; owner boolean; h text; old public.company_wage_runs%ROWTYPE; line jsonb; claim jsonb; r public.company_entries%ROWTYPE;
 splits jsonb; split jsonb; split_sum numeric; split_project uuid; employee uuid; payment uuid; funding uuid; project uuid; mode text; q numeric; rate bigint; base numeric; claims numeric; outstanding numeric; recovery numeric; gross numeric; net numeric; cur character(3); money_key text; lock_id uuid;
BEGIN
 actor:=public.waves_company_actor(p_group_id);
 -- The company row serializes wage, reimbursement, project, membership and entry writers.
 PERFORM pg_advisory_xact_lock(hashtextextended(p_group_id::text,4)); PERFORM 1 FROM public.groups WHERE id=p_group_id FOR UPDATE;
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
  IF jsonb_typeof(line) IS DISTINCT FROM 'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(line) k WHERE k NOT IN ('paymentEntryId','memberId','projectId','fundingManagerId','calcMode','days','rateMinor','fixedMinor','claimIds','splits','expectedGrossMinor','expectedRecoveryMinor','expectedNetMinor','note')) THEN RAISE EXCEPTION 'INVALID_DATA'; END IF;
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
  SELECT greatest(0,coalesce(sum(CASE WHEN entry_kind='advance' AND status='approved' AND reimbursement_id IS NULL AND occurred_on<=p_period_end THEN amount WHEN entry_kind='wage_payment' AND period_end<p_period_start AND reimbursement_id IS NULL THEN -recovery_minor WHEN entry_kind='reimbursement' AND direction='employee_to_company' AND status='approved' AND reimbursement_id IS NULL AND reimbursement_details IS NULL AND occurred_on<=p_period_end THEN -amount ELSE 0 END),0)) INTO outstanding FROM public.company_entries WHERE group_id=p_group_id AND member_id=employee AND deleted_at IS NULL;
  -- Splits divide the wage base (not the folded claims, which keep their own site) across sites.
  splits:=coalesce(line->'splits','[]'::jsonb); split_sum:=0;
  IF jsonb_typeof(splits) IS DISTINCT FROM 'array' OR jsonb_array_length(splits)>20 THEN RAISE EXCEPTION 'INVALID_SPLITS'; END IF;
  IF jsonb_array_length(splits)>0 AND project IS NOT NULL THEN RAISE EXCEPTION 'INVALID_SPLITS'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(splits) s GROUP BY s->>'projectId' HAVING count(*)>1) THEN RAISE EXCEPTION 'INVALID_SPLITS'; END IF;
  FOR split IN SELECT value FROM jsonb_array_elements(splits) LOOP
   IF jsonb_typeof(split) IS DISTINCT FROM 'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(split) k WHERE k NOT IN ('projectId','amountMinor')) OR jsonb_typeof(split->'amountMinor') IS DISTINCT FROM 'string' OR (split->>'amountMinor')!~'^[1-9][0-9]{0,18}$' OR (split->>'amountMinor')::numeric>9223372036854775807 THEN RAISE EXCEPTION 'INVALID_SPLITS'; END IF;
   split_project:=(split->>'projectId')::uuid;
   IF NOT EXISTS(SELECT 1 FROM public.company_projects WHERE id=split_project AND group_id=p_group_id AND archived_at IS NULL AND deleted_at IS NULL) THEN RAISE EXCEPTION 'INVALID_PROJECT'; END IF;
   split_sum:=split_sum+(split->>'amountMinor')::numeric;
  END LOOP;
  IF jsonb_array_length(splits)>0 AND split_sum<>base THEN RAISE EXCEPTION 'SPLIT_MISMATCH'; END IF;
  gross:=base+claims; recovery:=least(outstanding,gross); net:=gross-recovery;
  IF (line->>'expectedGrossMinor')::numeric IS DISTINCT FROM gross OR (line->>'expectedRecoveryMinor')::numeric IS DISTINCT FROM recovery OR (line->>'expectedNetMinor')::numeric IS DISTINCT FROM net THEN RAISE EXCEPTION 'AMOUNT_MISMATCH'; END IF;
  INSERT INTO public.company_entries(id,group_id,member_id,entry_kind,amount,currency,calc_mode,days,rate_minor,occurred_on,note,created_by,updated_by,project_id,funding_manager_id,wage_run_id,gross_minor,claims_minor,recovery_minor,period_start,period_end)
  VALUES(payment,p_group_id,employee,'wage_payment',net::bigint,cur,mode,q,rate,p_paid_on,line->>'note',actor,actor,project,funding,p_run_id,gross::bigint,claims::bigint,recovery::bigint,p_period_start,p_period_end);
  INSERT INTO public.company_wage_splits(group_id,entry_id,project_id,amount_minor)
  SELECT p_group_id,payment,(s->>'projectId')::uuid,(s->>'amountMinor')::bigint FROM jsonb_array_elements(splits) s;
  PERFORM set_config('waves.company_reimburse',payment::text,true);
  UPDATE public.company_entries SET reimbursement_id=payment,status='reimbursed',version=version+1,updated_at=now(),updated_by=actor WHERE id IN (SELECT (value->>'entryId')::uuid FROM jsonb_array_elements(line->'claimIds'));
  PERFORM set_config('waves.company_reimburse','',true);
 END LOOP;
 RETURN p_run_id;
END $$;
