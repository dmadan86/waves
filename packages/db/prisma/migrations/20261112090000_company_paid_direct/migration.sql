-- Company paid directly: expenses the company itself pays (materials, rent, repairs...), no employee.
-- Nullable member_id + paid_by_company; owners see all, a manager only what they recorded.
ALTER TABLE public.company_entries ALTER COLUMN member_id DROP NOT NULL,
 ADD COLUMN paid_by_company boolean NOT NULL DEFAULT false,
 ADD CONSTRAINT company_paid_shape CHECK(paid_by_company=(member_id IS NULL) AND (NOT paid_by_company OR
  (entry_kind='expense' AND calc_mode='typed' AND amount>0 AND direction IS NULL AND status='approved' AND distance_km IS NULL
   AND reimbursement_id IS NULL AND reimbursement_details IS NULL AND wage_run_id IS NULL)));
CREATE INDEX company_entries_paid_idx ON public.company_entries(group_id,created_by,updated_seq) WHERE paid_by_company;
CREATE INDEX company_entries_paid_month_idx ON public.company_entries(group_id,occurred_on,id) WHERE paid_by_company AND deleted_at IS NULL;

-- Owners read every company-paid entry; a manager only the ones they recorded; employees none.
CREATE OR REPLACE FUNCTION public.waves_company_paid_visible(p_group_id uuid,p_created_by uuid) RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
 SELECT EXISTS(SELECT 1 FROM public.group_members me JOIN public.groups g ON g.id=me.group_id
 WHERE me.group_id=p_group_id AND me.profile_id=public.waves_current_profile_id() AND me.left_at IS NULL AND me.removed_at IS NULL
 AND me.merged_into_member_id IS NULL AND g.type='company' AND g.deleted_at IS NULL
 AND (me.role::text='admin' OR (me.role::text='manager' AND me.id=p_created_by)));
$$;
REVOKE ALL ON FUNCTION public.waves_company_paid_visible(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.waves_company_paid_visible(uuid,uuid) TO authenticated,service_role;
CREATE OR REPLACE FUNCTION public.waves_can_read_company_entry(p_entry_id uuid) RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
 SELECT EXISTS(SELECT 1 FROM public.company_entries e WHERE e.id=p_entry_id
 AND CASE WHEN e.paid_by_company THEN public.waves_company_paid_visible(e.group_id,e.created_by) ELSE public.waves_company_detail(e.group_id,e.member_id) END);
$$;
DROP POLICY company_entries_select ON public.company_entries;
CREATE POLICY company_entries_select ON public.company_entries FOR SELECT TO authenticated
 USING(CASE WHEN paid_by_company THEN public.waves_company_paid_visible(group_id,created_by) ELSE public.waves_company_detail(group_id,member_id) END);

-- The payer mode and recorder never change after creation (void and record again).
CREATE OR REPLACE FUNCTION public.waves_company_paid_guard() RETURNS trigger
 LANGUAGE plpgsql SET search_path TO 'public','pg_temp' AS $$
BEGIN
 IF NEW.paid_by_company IS DISTINCT FROM OLD.paid_by_company
  OR (OLD.paid_by_company AND (NEW.member_id IS DISTINCT FROM OLD.member_id OR NEW.created_by IS DISTINCT FROM OLD.created_by))
 THEN RAISE EXCEPTION 'ENTRY_SCOPE_IMMUTABLE'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.waves_company_paid_guard() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER company_paid_guard BEFORE UPDATE ON public.company_entries FOR EACH ROW EXECUTE FUNCTION public.waves_company_paid_guard();

CREATE OR REPLACE FUNCTION public.waves_company_entry_scope_guard() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
BEGIN
 IF NOT public.waves_is_company(NEW.group_id) OR EXISTS (
  SELECT 1 FROM unnest(ARRAY[NEW.member_id,NEW.created_by,NEW.updated_by]) AS actor(id)
  WHERE actor.id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.group_members m WHERE m.id=actor.id AND m.group_id=NEW.group_id)
 ) THEN RAISE EXCEPTION 'UNKNOWN_MEMBER: company entry scope mismatch' USING ERRCODE = 'foreign_key_violation'; END IF;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.waves_company_entry_values(p_kind text, p_member uuid, p_data jsonb)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
DECLARE v_mode text := COALESCE(p_data->>'calcMode', CASE WHEN p_kind = 'allowance' THEN 'days_rate' ELSE 'typed' END);
 v_days numeric(8,2); v_rate bigint; v_amount bigint; v_direction text;
BEGIN
 IF p_member IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.group_members m WHERE m.id = p_member
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

CREATE OR REPLACE FUNCTION public.waves_company_review_guard() RETURNS trigger
 LANGUAGE plpgsql  SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $fn$
BEGIN
 IF NEW.deleted_at IS NULL AND NOT EXISTS(SELECT 1 FROM public.groups WHERE id=NEW.group_id AND deleted_at IS NULL) THEN RAISE EXCEPTION 'GROUP_DELETED'; END IF;
 IF NEW.paid_by_company OR NEW.entry_kind IN ('allocation','pool_return','pool_adjustment','pool_request','wage_payment') OR (NEW.entry_kind IN ('advance','reimbursement') AND EXISTS(SELECT 1 FROM public.group_members WHERE id=NEW.created_by AND role::text='manager')) THEN NEW.status:='approved'; RETURN NEW; END IF;
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

CREATE OR REPLACE FUNCTION public.waves_company_phase3_entry_guard() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
DECLARE rule jsonb; actual numeric; start_on date; end_on date; cover public.company_entries%ROWTYPE;
BEGIN
 IF TG_OP='UPDATE' AND public.waves_company_bookkeeping_update(OLD,NEW) THEN RETURN NEW; END IF;
 IF TG_OP='DELETE' THEN
  IF (OLD.reimbursement_id IS NOT NULL OR OLD.reimbursement_details IS NOT NULL) AND EXISTS(SELECT 1 FROM public.groups WHERE id=OLD.group_id) THEN RAISE EXCEPTION 'ENTRY_REIMBURSED: covered entries are frozen' USING ERRCODE='check_violation'; END IF;
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
 IF NEW.deleted_at IS NULL AND NOT NEW.paid_by_company AND NEW.entry_kind IN ('expense','allowance') AND NEW.status IN ('submitted','approved','reimbursed') THEN
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

CREATE OR REPLACE FUNCTION public.waves_company_entry_create(p_group_id uuid, p_entry_id uuid, p_member_id uuid, p_entry_kind text, p_data jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_me uuid; v_admin boolean; r public.company_entries%ROWTYPE; d jsonb; v_currency character(3); funding uuid; project uuid; payload_hash text; v_paid boolean := false;
BEGIN
 v_me := public.waves_company_actor(p_group_id); v_admin := public.is_group_admin(p_group_id);
 PERFORM 1 FROM public.groups WHERE id=p_group_id FOR UPDATE;
 IF p_entry_kind NOT IN ('expense','allowance','advance','wages','reimbursement') THEN RAISE EXCEPTION 'INVALID_KIND'; END IF;
 IF jsonb_typeof(p_data) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'INVALID_DATA' USING ERRCODE='check_violation'; END IF;
 IF p_data ? 'paidByCompany' THEN
  IF jsonb_typeof(p_data->'paidByCompany') IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'INVALID_DATA' USING ERRCODE='check_violation'; END IF;
  v_paid := (p_data->>'paidByCompany')::boolean;
 END IF;
 IF v_paid THEN
  -- Owners, or a manager (paid from their cash pool). Employees never record company-paid entries.
  IF p_member_id IS NOT NULL OR p_entry_kind<>'expense' OR p_data ? 'fundingManagerId' THEN RAISE EXCEPTION 'INVALID_DATA' USING ERRCODE='check_violation'; END IF;
  IF NOT v_admin AND NOT EXISTS(SELECT 1 FROM public.group_members WHERE id=v_me AND role::text='manager') THEN RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE='insufficient_privilege'; END IF;
 ELSIF p_member_id IS NULL THEN RAISE EXCEPTION 'INVALID_DATA' USING ERRCODE='check_violation';
 ELSIF NOT v_admin AND public.waves_company_team(p_group_id,p_member_id) THEN
  IF p_entry_kind NOT IN ('expense','allowance','advance','reimbursement') THEN RAISE EXCEPTION 'NOT_ALLOWED'; END IF;
 ELSIF NOT v_admin AND NOT public.waves_company_team(p_group_id,p_member_id) AND (p_member_id IS DISTINCT FROM v_me OR p_entry_kind NOT IN ('expense','allowance')) THEN
  RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE='insufficient_privilege';
 END IF;
 funding:=CASE WHEN v_paid THEN CASE WHEN v_admin THEN NULL ELSE v_me END WHEN NOT v_admin AND p_entry_kind IN ('advance','reimbursement') THEN v_me ELSE (p_data->>'fundingManagerId')::uuid END;
 project:=(p_data->>'projectId')::uuid;
 payload_hash:=encode(sha256(convert_to(CASE WHEN v_paid THEN jsonb_build_array(p_group_id,'company_paid',p_entry_kind,p_data-'paidByCompany') ELSE jsonb_build_array(p_group_id,p_member_id,p_entry_kind,p_data-'paidByCompany') END::text,'UTF8')),'hex');
 -- Serialize same-id creates, including retries from different devices.
 PERFORM pg_advisory_xact_lock(hashtextextended(p_entry_id::text, 0));
 SELECT * INTO r FROM public.company_entries WHERE id = p_entry_id;
 IF FOUND THEN
  IF r.group_id = p_group_id AND public.waves_can_read_company_entry(r.id) THEN
   IF r.request_hash IS NOT DISTINCT FROM payload_hash THEN RETURN r.id; END IF;
   RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT';
  END IF;
  RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE = 'insufficient_privilege';
 END IF;
 IF NOT v_paid AND NOT v_admin AND NOT public.waves_company_team(p_group_id,p_member_id) AND (p_member_id IS DISTINCT FROM v_me OR p_entry_kind NOT IN ('expense','allowance')) THEN
  RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE = 'insufficient_privilege';
 END IF;
 IF NOT v_paid AND NOT EXISTS (SELECT 1 FROM public.group_members WHERE id = p_member_id AND group_id = p_group_id AND left_at IS NULL) THEN
  RAISE EXCEPTION 'UNKNOWN_MEMBER' USING ERRCODE = 'insufficient_privilege';
 END IF;
 SELECT default_currency INTO v_currency FROM public.groups WHERE id = p_group_id FOR SHARE;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_member_id::text,3));
 d := public.waves_company_entry_values_v3(p_entry_kind,p_member_id,p_data-ARRAY['projectId','fundingManagerId','paidByCompany']);
 IF v_paid AND (d->>'calcMode'<>'typed' OR d->>'direction' IS NOT NULL OR (d->>'amount')::bigint<=0 OR d->>'distanceKm' IS NOT NULL) THEN RAISE EXCEPTION 'INVALID_DATA' USING ERRCODE='check_violation'; END IF;
 INSERT INTO public.company_entries(paid_by_company,id,group_id,member_id,entry_kind,category,amount,currency,calc_mode,days,rate_minor,occurred_on,direction,note,created_by,updated_by,vendor,gstin,invoice_no,gst_rate_bps,gst_amount_minor,distance_km,from_text,to_text,project_id,funding_manager_id,request_hash)
 VALUES(v_paid,p_entry_id,p_group_id,p_member_id,p_entry_kind,d->>'category',(d->>'amount')::bigint,v_currency,d->>'calcMode',(d->>'days')::numeric,(d->>'rateMinor')::bigint,(d->>'occurredOn')::date,d->>'direction',d->>'note',v_me,v_me,d->>'vendor',d->>'gstin',d->>'invoiceNo',(d->>'gstRateBps')::integer,(d->>'gstAmountMinor')::bigint,(d->>'distanceKm')::numeric,d->>'fromText',d->>'toText',project,funding,payload_hash);
 RETURN p_entry_id;
END $function$;

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
 IF r.entry_kind IN ('allocation','pool_return','pool_adjustment','pool_request','wage_payment') THEN RAISE EXCEPTION 'ENTRY_FROZEN'; END IF;
 IF r.entry_kind='advance' AND EXISTS(SELECT 1 FROM public.company_entries w WHERE w.group_id=r.group_id AND w.member_id=r.member_id AND w.entry_kind='wage_payment' AND w.deleted_at IS NULL AND w.recovery_minor>0 AND w.reimbursement_id IS NULL AND w.period_end>=r.occurred_on) THEN RAISE EXCEPTION 'ENTRY_FROZEN: advance already recovered through wages'; END IF;
 IF r.id IS NULL OR r.deleted_at IS NOT NULL OR (CASE WHEN r.paid_by_company THEN NOT public.waves_company_paid_visible(r.group_id,r.created_by) ELSE (NOT public.is_group_admin(r.group_id) AND NOT public.waves_company_team(r.group_id,r.member_id) AND
  (r.member_id <> v_me OR r.created_by <> v_me OR r.entry_kind NOT IN ('expense','allowance'))) END) THEN
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
 IF r.entry_kind IN ('allocation','pool_return','pool_adjustment','pool_request','wage_payment') THEN RAISE EXCEPTION 'ENTRY_FROZEN'; END IF;
 IF r.entry_kind='advance' AND EXISTS(SELECT 1 FROM public.company_entries w WHERE w.group_id=r.group_id AND w.member_id=r.member_id AND w.entry_kind='wage_payment' AND w.deleted_at IS NULL AND w.recovery_minor>0 AND w.reimbursement_id IS NULL AND w.period_end>=r.occurred_on) THEN RAISE EXCEPTION 'ENTRY_FROZEN: advance already recovered through wages'; END IF;
 IF r.id IS NULL OR (CASE WHEN r.paid_by_company THEN NOT public.waves_company_paid_visible(r.group_id,r.created_by) ELSE (NOT public.is_group_admin(r.group_id) AND NOT public.waves_company_team(r.group_id,r.member_id) AND
  (r.member_id <> v_me OR r.created_by <> v_me OR r.entry_kind NOT IN ('expense','allowance'))) END) THEN
  RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE = 'insufficient_privilege';
 END IF;
 IF r.reimbursement_id IS NOT NULL OR r.reimbursement_details IS NOT NULL THEN RAISE EXCEPTION 'ENTRY_REIMBURSED: covered entries are frozen' USING ERRCODE='check_violation'; END IF;
 IF r.deleted_at IS NOT NULL THEN RETURN; END IF;
 UPDATE public.company_entries SET deleted_at=now(),void_reason=p_reason,version=version+1,updated_by=v_me,updated_at=now() WHERE id=p_entry_id;
END $function$;

CREATE OR REPLACE FUNCTION public.waves_company_pool_balance(p_group_id uuid,p_manager_id uuid) RETURNS jsonb
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
DECLARE actor uuid; a numeric; r numeric; j numeric; d numeric; b numeric; w numeric; s numeric; c numeric; q numeric;
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
 coalesce(sum(amount) FILTER(WHERE entry_kind='reimbursement' AND direction='employee_to_company' AND funding_manager_id=p_manager_id),0),
 coalesce(sum(amount) FILTER(WHERE entry_kind='expense' AND paid_by_company AND funding_manager_id=p_manager_id),0)
 INTO a,r,j,d,b,w,s,c,q FROM public.company_entries WHERE group_id=p_group_id AND deleted_at IS NULL AND status IN ('approved','reimbursed');
 RETURN jsonb_build_object('allocated',a::text,'returned',r::text,'adjusted',j::text,'advances',d::text,'reimbursed',b::text,'wages',w::text,'ownSpend',s::text,'cashReturned',c::text,'companySpend',q::text,'balance',(a+j-r-d-b-w-s-q+c)::text);
END $$;

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
   AND m.left_at IS NULL AND ((e.paid_by_company AND m.role::text='manager' AND m.id=e.created_by) OR m.id=e.member_id OR m.role::text='admin' OR (m.role::text='manager' AND EXISTS(SELECT 1 FROM public.group_members t WHERE t.id=e.member_id AND t.manager_id=m.id AND t.role::text='member'))) AND m.removed_at IS NULL AND m.merged_into_member_id IS NULL
 ) THEN RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE='insufficient_privilege'; END IF;
 IF e.wage_run_id IS NOT NULL OR e.reimbursement_id IS NOT NULL OR e.reimbursement_details IS NOT NULL OR e.entry_kind IN ('allocation','pool_return','pool_adjustment','pool_request') THEN RAISE EXCEPTION 'ENTRY_REIMBURSED'; END IF;
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
   AND ((e.paid_by_company AND m.role::text='manager' AND m.id=e.created_by) OR m.id=e.member_id OR m.role::text='admin' OR (m.role::text='manager' AND EXISTS(SELECT 1 FROM public.group_members t WHERE t.id=e.member_id AND t.manager_id=m.id AND t.role::text='member'))) AND m.removed_at IS NULL AND m.merged_into_member_id IS NULL AND g.deleted_at IS NULL
 ) THEN RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE='insufficient_privilege'; END IF;
 IF e.wage_run_id IS NOT NULL OR e.reimbursement_id IS NOT NULL OR e.reimbursement_details IS NOT NULL OR e.entry_kind IN ('allocation','pool_return','pool_adjustment','pool_request') THEN RAISE EXCEPTION 'ENTRY_REIMBURSED'; END IF;
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
