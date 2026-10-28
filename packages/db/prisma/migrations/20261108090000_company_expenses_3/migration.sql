-- Phase 3: invoice metadata, mileage, prospective blocking policies and atomic clearing.
-- No stored policy flags, receipt holds, or duplicate reimbursement timestamps.
ALTER TABLE public.groups
 ADD COLUMN company_policies jsonb NOT NULL DEFAULT '{"version":1,"rules":[]}',
 ADD COLUMN company_policy_revision integer NOT NULL DEFAULT 0 CHECK(company_policy_revision >= 0),
 ADD COLUMN company_default_mileage_rate_minor bigint CHECK(company_default_mileage_rate_minor >= 0);
ALTER TABLE public.group_members ADD COLUMN mileage_rate_minor bigint CHECK(mileage_rate_minor >= 0);
ALTER TABLE public.company_entries
 ADD COLUMN vendor text CHECK(length(vendor)<=120),
 ADD COLUMN gstin varchar(15),
 ADD COLUMN invoice_no text CHECK(length(invoice_no)<=80),
 ADD COLUMN gst_rate_bps integer CHECK(gst_rate_bps BETWEEN 0 AND 10000),
 ADD COLUMN gst_amount_minor bigint CHECK(gst_amount_minor BETWEEN 0 AND amount),
 ADD COLUMN distance_km numeric(8,2),
 ADD COLUMN from_text text CHECK(length(from_text)<=120),
 ADD COLUMN to_text text CHECK(length(to_text)<=120),
 ADD COLUMN reimbursement_id uuid REFERENCES public.company_entries(id),
 ADD COLUMN reimbursement_details jsonb;
-- Discover the two unnamed Phase 1 mode constraints by definition, not guessed names.
DO $$ DECLARE c record; BEGIN
 FOR c IN SELECT conname FROM pg_constraint WHERE conrelid='public.company_entries'::regclass
 AND contype='c' AND (pg_get_constraintdef(oid) LIKE '%calc_mode%typed%'
 OR pg_get_constraintdef(oid) LIKE '%days IS NULL%rate_minor IS NULL%') LOOP
 EXECUTE format('ALTER TABLE public.company_entries DROP CONSTRAINT %I',c.conname);
 END LOOP;
END $$;
ALTER TABLE public.company_entries
 ADD CONSTRAINT company_entries_calc_mode_v3 CHECK(calc_mode IN ('typed','days_rate','fixed_weekly','distance_rate')),
 ADD CONSTRAINT company_entries_rate_shape_v3 CHECK(
 (calc_mode='days_rate' AND distance_km IS NULL) OR
 (calc_mode='distance_rate' AND entry_kind='expense' AND category IS NOT NULL AND category IN ('fuel','transport')
  AND days IS NULL AND distance_km>0 AND distance_km IS NOT NULL AND rate_minor>=0 AND rate_minor IS NOT NULL) OR
 (calc_mode IN ('typed','fixed_weekly') AND days IS NULL AND rate_minor IS NULL AND distance_km IS NULL)),
 ADD CONSTRAINT company_entries_route_shape CHECK(calc_mode='distance_rate' OR (from_text IS NULL AND to_text IS NULL)),
 ADD CONSTRAINT company_entries_no_self_reimbursement CHECK(reimbursement_id IS DISTINCT FROM id);
CREATE INDEX company_entries_unlinked_period_idx ON public.company_entries(group_id,member_id,occurred_on)
 WHERE deleted_at IS NULL AND reimbursement_id IS NULL;

-- GST base-36 Luhn mod-36 checksum. State codes: 01..38, 97, 99.
CREATE FUNCTION public.waves_company_gstin_valid(p_gstin text) RETURNS boolean
 LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
DECLARE alphabet constant text:='0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'; total integer:=0; n integer; i integer;
BEGIN
 IF p_gstin IS NULL THEN RETURN true; END IF;
 IF p_gstin !~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$' THEN RETURN false; END IF;
 IF NOT (left(p_gstin,2)::integer BETWEEN 1 AND 38 OR left(p_gstin,2) IN ('97','99')) THEN RETURN false; END IF;
 FOR i IN 1..14 LOOP
  n:=(strpos(alphabet,substr(p_gstin,i,1))-1)*CASE WHEN i%2=0 THEN 2 ELSE 1 END;
  total:=total+(n/36)+(n%36);
 END LOOP;
 RETURN substr(p_gstin,15,1)=substr(alphabet,((36-total%36)%36)+1,1);
END $$;
ALTER TABLE public.company_entries ADD CONSTRAINT company_entries_gstin_valid CHECK(public.waves_company_gstin_valid(gstin));

-- Invoker guards cover direct table writes without changing live guard functions.
CREATE FUNCTION public.waves_company_phase3_settings_guard() RETURNS trigger
 LANGUAGE plpgsql SET search_path TO 'public','pg_temp' AS $$
BEGIN
 IF current_user IN ('anon','authenticated') THEN
  IF TG_TABLE_NAME='groups' THEN
   IF TG_OP='INSERT' THEN
    IF NEW.company_policies<>'{"version":1,"rules":[]}'::jsonb OR NEW.company_policy_revision<>0 OR NEW.company_default_mileage_rate_minor IS NOT NULL THEN
     RAISE EXCEPTION 'FORBIDDEN_COLUMN: use company settings RPCs' USING ERRCODE='insufficient_privilege'; END IF;
   ELSIF (NEW.company_policies,NEW.company_policy_revision,NEW.company_default_mileage_rate_minor)
    IS DISTINCT FROM (OLD.company_policies,OLD.company_policy_revision,OLD.company_default_mileage_rate_minor) THEN
    RAISE EXCEPTION 'FORBIDDEN_COLUMN: use company settings RPCs' USING ERRCODE='insufficient_privilege'; END IF;
  ELSE
   IF TG_OP='INSERT' THEN
    IF NEW.mileage_rate_minor IS NOT NULL THEN RAISE EXCEPTION 'FORBIDDEN_COLUMN: use company mileage rate RPC' USING ERRCODE='insufficient_privilege'; END IF;
   ELSIF NEW.mileage_rate_minor IS DISTINCT FROM OLD.mileage_rate_minor THEN
    RAISE EXCEPTION 'FORBIDDEN_COLUMN: use company mileage rate RPC' USING ERRCODE='insufficient_privilege'; END IF;
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER company_phase3_settings_guard BEFORE INSERT OR UPDATE ON public.groups FOR EACH ROW EXECUTE FUNCTION public.waves_company_phase3_settings_guard();
CREATE TRIGGER company_phase3_member_guard BEFORE INSERT OR UPDATE ON public.group_members FOR EACH ROW EXECUTE FUNCTION public.waves_company_phase3_settings_guard();

CREATE FUNCTION public.waves_company_policies_set(p_group_id uuid,p_policies jsonb,p_expected_revision integer) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
DECLARE r jsonb; revision integer;
BEGIN
 PERFORM public.waves_company_actor(p_group_id);
 IF NOT public.is_group_admin(p_group_id) THEN RAISE EXCEPTION 'ADMIN_ONLY' USING ERRCODE='insufficient_privilege'; END IF;
 SELECT company_policy_revision INTO revision FROM public.groups WHERE id=p_group_id AND deleted_at IS NULL FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'GROUP_DELETED' USING ERRCODE='check_violation'; END IF;
 IF p_expected_revision IS NULL OR revision<>p_expected_revision THEN RAISE EXCEPTION 'VERSION_CONFLICT: policies changed; refresh before saving' USING ERRCODE='check_violation'; END IF;
 IF jsonb_typeof(p_policies) IS DISTINCT FROM 'object' OR p_policies->'version' IS DISTINCT FROM '1'::jsonb
 OR jsonb_typeof(p_policies->'rules') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'INVALID_POLICIES' USING ERRCODE='check_violation'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_object_keys(p_policies) k WHERE k NOT IN ('version','rules')) OR jsonb_array_length(p_policies->'rules')>100 THEN RAISE EXCEPTION 'INVALID_POLICIES' USING ERRCODE='check_violation'; END IF;
 FOR r IN SELECT value FROM jsonb_array_elements(p_policies->'rules') LOOP
  IF jsonb_typeof(r) IS DISTINCT FROM 'object' OR jsonb_typeof(r->'id') IS DISTINCT FROM 'string' OR coalesce(length(r->>'id'),0) NOT BETWEEN 1 AND 120
   OR jsonb_typeof(r->'limitMinor') IS DISTINCT FROM 'string' OR coalesce(r->>'limitMinor','') !~ '^[0-9]{1,19}$'
   OR (r->>'limitMinor')::numeric>9223372036854775807 OR coalesce(r->>'effect','') NOT IN ('warn','block')
   OR coalesce(r->>'type','') NOT IN ('receipt_above','period_limit') THEN RAISE EXCEPTION 'INVALID_POLICIES' USING ERRCODE='check_violation'; END IF;
  IF r->>'type'='receipt_above' THEN
   IF r->>'effect'<>'warn' OR EXISTS(SELECT 1 FROM jsonb_object_keys(r) k WHERE k NOT IN ('id','type','limitMinor','effect')) THEN RAISE EXCEPTION 'INVALID_POLICIES' USING ERRCODE='check_violation'; END IF;
  ELSE
   IF coalesce(r->>'target','') NOT IN ('fuel','transport','travel','food','office','other','allowance') OR coalesce(r->>'period','') NOT IN ('day','month')
    OR EXISTS(SELECT 1 FROM jsonb_object_keys(r) k WHERE k NOT IN ('id','type','limitMinor','effect','target','period')) THEN RAISE EXCEPTION 'INVALID_POLICIES' USING ERRCODE='check_violation'; END IF;
  END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_policies->'rules') AS rules(value) GROUP BY rules.value->>'id' HAVING count(*)>1) THEN RAISE EXCEPTION 'INVALID_POLICIES' USING ERRCODE='check_violation'; END IF;
 UPDATE public.groups SET company_policies=p_policies,company_policy_revision=revision+1,updated_at=now() WHERE id=p_group_id;
END $$;

CREATE FUNCTION public.waves_company_mileage_rate_set(p_group_id uuid,p_member_id uuid,p_rate_minor bigint) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
BEGIN
 PERFORM public.waves_company_actor(p_group_id);
 IF NOT public.is_group_admin(p_group_id) THEN RAISE EXCEPTION 'ADMIN_ONLY' USING ERRCODE='insufficient_privilege'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.groups WHERE id=p_group_id AND deleted_at IS NULL) THEN RAISE EXCEPTION 'GROUP_DELETED' USING ERRCODE='check_violation'; END IF;
 IF p_rate_minor<0 THEN RAISE EXCEPTION 'INVALID_RATE: mileage rate must be nonnegative' USING ERRCODE='check_violation'; END IF;
 IF p_member_id IS NULL THEN
  UPDATE public.groups SET company_default_mileage_rate_minor=p_rate_minor,updated_at=now() WHERE id=p_group_id;
 ELSE
  UPDATE public.group_members SET mileage_rate_minor=p_rate_minor,updated_at=now() WHERE id=p_member_id AND group_id=p_group_id AND left_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'UNKNOWN_MEMBER' USING ERRCODE='insufficient_privilege'; END IF;
 END IF;
END $$;

-- Lock order: employee advisory lock BEFORE any entry row lock, as in reimburse.
-- The unlocked lookup only discovers scope; never authorize from that snapshot.
CREATE FUNCTION public.waves_company_entry_lock(p_entry_id uuid)
 RETURNS public.company_entries LANGUAGE plpgsql SECURITY DEFINER
 SET search_path TO 'public','pg_temp' AS $$
DECLARE scope public.company_entries%ROWTYPE; locked public.company_entries%ROWTYPE;
BEGIN
 SELECT * INTO scope FROM public.company_entries WHERE id=p_entry_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE='insufficient_privilege'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(scope.member_id::text,3));
 SELECT * INTO locked FROM public.company_entries WHERE id=p_entry_id FOR UPDATE;
 IF NOT FOUND OR locked.member_id IS DISTINCT FROM scope.member_id OR locked.group_id IS DISTINCT FROM scope.group_id THEN
  RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE='insufficient_privilege';
 END IF;
 RETURN locked;
END $$;
REVOKE ALL ON FUNCTION public.waves_company_entry_lock(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.waves_company_entry_lock(uuid) TO service_role;

-- Runs after the existing review guard, so policies inspect the final submitted/approved state.
CREATE FUNCTION public.waves_company_phase3_entry_guard() RETURNS trigger
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
  IF cover.id IS NULL OR cover.group_id<>NEW.group_id OR cover.member_id<>NEW.member_id OR cover.entry_kind<>'reimbursement' OR cover.reimbursement_details IS NULL
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
CREATE TRIGGER company_zz_phase3_entry_guard BEFORE INSERT OR UPDATE OR DELETE ON public.company_entries FOR EACH ROW EXECUTE FUNCTION public.waves_company_phase3_entry_guard();
CREATE FUNCTION public.waves_company_phase3_photo_guard() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
BEGIN
 -- Attachment RPCs hold the employee and entry locks before reaching this row trigger.
 IF EXISTS(SELECT 1 FROM public.company_entries WHERE id=coalesce(NEW.entry_id,OLD.entry_id) AND (reimbursement_id IS NOT NULL OR reimbursement_details IS NOT NULL)) THEN
  RAISE EXCEPTION 'ENTRY_REIMBURSED: covered entries are frozen' USING ERRCODE='check_violation'; END IF;
 RETURN coalesce(NEW,OLD);
END $$;
CREATE TRIGGER company_phase3_photo_guard BEFORE INSERT OR UPDATE OR DELETE ON public.company_entry_attachments FOR EACH ROW EXECUTE FUNCTION public.waves_company_phase3_photo_guard();

ALTER TABLE public.company_entries DROP CONSTRAINT company_entries_amount_check,
 ADD CONSTRAINT company_entries_amount_check CHECK(amount>0 OR (amount=0 AND
 (calc_mode IN ('days_rate','distance_rate') OR reimbursement_details IS NOT NULL)));
CREATE FUNCTION public.waves_company_reimburse(
 p_group_id uuid,p_reimbursement_id uuid,p_member_id uuid,p_claims jsonb,p_adjustments jsonb,
 p_cutoff date,p_paid_on date,p_expected_amount_minor bigint,p_note text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
DECLARE actor uuid; existing public.company_entries%ROWTYPE; r public.company_entries%ROWTYPE; item jsonb;
 claims jsonb; ids uuid[]; claim_ids uuid[]; adjustment_ids uuid[]; selected_ids uuid[]; changed_ids uuid[]:='{}'; skipped_ids uuid[];
 claims_minor numeric:=0; credits_minor numeric:=0; payout numeric; request_hash text; currency character(3);
BEGIN
 actor:=public.waves_company_actor(p_group_id);
 IF NOT public.is_group_admin(p_group_id) THEN RAISE EXCEPTION 'ADMIN_ONLY' USING ERRCODE='insufficient_privilege'; END IF;
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
 INSERT INTO public.company_entries(id,group_id,member_id,entry_kind,amount,currency,occurred_on,direction,status,note,created_by,updated_by,reimbursement_details)
 VALUES(p_reimbursement_id,p_group_id,p_member_id,'reimbursement',payout::bigint,currency,p_paid_on,'company_to_employee','approved',p_note,actor,actor,
 jsonb_build_object('requestHash',request_hash,'cutoff',p_cutoff,'claimIds',to_jsonb(claim_ids),'adjustmentIds',to_jsonb(adjustment_ids),'skippedIds',to_jsonb(skipped_ids),'claimsMinor',claims_minor::text,'creditsMinor',credits_minor::text,'payoutMinor',payout::text));
 UPDATE public.company_entries SET reimbursement_id=p_reimbursement_id,
 status=CASE WHEN id=ANY(claim_ids) THEN 'reimbursed' ELSE status END,version=version+1,updated_by=actor,updated_at=now() WHERE id=ANY(ids);
 PERFORM set_config('waves.company_reimburse','',true);
 RETURN p_reimbursement_id;
END $$;

-- All helpers are private; only the three new application RPCs are callable.
REVOKE ALL ON FUNCTION public.waves_company_gstin_valid(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.waves_company_gstin_valid(text) TO service_role;
REVOKE ALL ON FUNCTION public.waves_company_phase3_settings_guard() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.waves_company_phase3_settings_guard() TO service_role;
REVOKE ALL ON FUNCTION public.waves_company_phase3_entry_guard() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.waves_company_phase3_entry_guard() TO service_role;
REVOKE ALL ON FUNCTION public.waves_company_phase3_photo_guard() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.waves_company_phase3_photo_guard() TO service_role;
REVOKE ALL ON FUNCTION public.waves_company_policies_set(uuid,jsonb,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.waves_company_policies_set(uuid,jsonb,integer) TO authenticated,service_role;
REVOKE ALL ON FUNCTION public.waves_company_mileage_rate_set(uuid,uuid,bigint) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.waves_company_mileage_rate_set(uuid,uuid,bigint) TO authenticated,service_role;
REVOKE ALL ON FUNCTION public.waves_company_reimburse(uuid,uuid,uuid,jsonb,jsonb,date,date,bigint,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.waves_company_reimburse(uuid,uuid,uuid,jsonb,jsonb,date,date,bigint,text) TO authenticated,service_role;

-- A private validator extends the unchanged legacy financial normalizer.
CREATE FUNCTION public.waves_company_entry_values_v3(p_kind text,p_member uuid,p_data jsonb)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
DECLARE d jsonb; base jsonb; mode text; distance numeric; rate bigint; amount bigint; gstin_value text; k text;
BEGIN
 IF jsonb_typeof(p_data) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'INVALID_DATA' USING ERRCODE='check_violation'; END IF;
 FOR k IN SELECT jsonb_object_keys(p_data) LOOP
  IF k NOT IN ('amount','category','days','rateMinor','calcMode','occurredOn','note','direction','vendor','gstin','invoiceNo','gstRateBps','gstAmountMinor','distanceKm','fromText','toText') THEN RAISE EXCEPTION 'INVALID_DATA' USING ERRCODE='check_violation'; END IF;
 END LOOP;
 FOREACH k IN ARRAY ARRAY['vendor','gstin','invoiceNo','fromText','toText','category','calcMode','occurredOn','note','direction'] LOOP
  IF p_data ? k AND jsonb_typeof(p_data->k) NOT IN ('string','null') THEN RAISE EXCEPTION 'INVALID_DATA' USING ERRCODE='check_violation'; END IF;
 END LOOP;
 -- RPC inputs and merged stored values use exact decimal strings.
 -- Reject precision loss before casting
 -- to numeric(8,2), whose assignment would otherwise silently round.
 FOREACH k IN ARRAY ARRAY['amount','rateMinor','gstAmountMinor'] LOOP
  IF p_data ? k AND jsonb_typeof(p_data->k) NOT IN ('string','null') THEN RAISE EXCEPTION 'INVALID_DATA' USING ERRCODE='check_violation'; END IF;
  IF p_data->>k IS NOT NULL AND ((p_data->>k) !~ '^[0-9]{1,19}$' OR (p_data->>k)::numeric>9223372036854775807) THEN RAISE EXCEPTION 'INVALID_DATA' USING ERRCODE='check_violation'; END IF;
 END LOOP;
 FOREACH k IN ARRAY ARRAY['distanceKm','days'] LOOP
  IF p_data ? k AND jsonb_typeof(p_data->k) NOT IN ('string','null') THEN RAISE EXCEPTION 'INVALID_DATA' USING ERRCODE='check_violation'; END IF;
  IF p_data->>k IS NOT NULL AND (p_data->>k) !~ '^[0-9]{1,6}(\.[0-9]{1,2})?$' THEN RAISE EXCEPTION 'INVALID_DISTANCE: use at most two decimal places' USING ERRCODE='check_violation'; END IF;
 END LOOP;
 IF p_data ? 'gstRateBps' AND jsonb_typeof(p_data->'gstRateBps') NOT IN ('number','null') THEN RAISE EXCEPTION 'INVALID_DATA' USING ERRCODE='check_violation'; END IF;
 IF p_data->>'gstRateBps' IS NOT NULL AND ((p_data->>'gstRateBps') !~ '^[0-9]{1,5}$' OR (p_data->>'gstRateBps')::integer>10000) THEN RAISE EXCEPTION 'INVALID_GST: GST rate must be 0 to 10000 basis points' USING ERRCODE='check_violation'; END IF;
 mode:=coalesce(p_data->>'calcMode',CASE WHEN p_kind='allowance' THEN 'days_rate' ELSE 'typed' END);
 base:=p_data-ARRAY['vendor','gstin','invoiceNo','gstRateBps','gstAmountMinor','distanceKm','fromText','toText'];
 IF mode='distance_rate' THEN
  distance:=(p_data->>'distanceKm')::numeric; rate:=(p_data->>'rateMinor')::bigint;
  IF p_kind<>'expense' OR coalesce(p_data->>'category','') NOT IN ('fuel','transport') OR distance IS NULL OR distance<=0 OR rate IS NULL OR rate<0 OR p_data->>'days' IS NOT NULL THEN
   RAISE EXCEPTION 'INVALID_DISTANCE: mileage requires fuel/transport, positive distance and a resolved rate' USING ERRCODE='check_violation'; END IF;
  amount:=trunc((distance*100*rate+50)/100)::bigint;
  base:=base||jsonb_build_object('calcMode','typed','rateMinor',NULL,'amount',amount::text);
 ELSIF p_data->>'distanceKm' IS NOT NULL OR p_data->>'fromText' IS NOT NULL OR p_data->>'toText' IS NOT NULL THEN
  RAISE EXCEPTION 'INVALID_DISTANCE: route fields require distance_rate' USING ERRCODE='check_violation';
 END IF;
 d:=public.waves_company_entry_values(p_kind,p_member,base);
 IF mode='distance_rate' THEN d:=d||jsonb_build_object('calcMode',mode,'distanceKm',distance,'rateMinor',rate,'amount',amount); END IF;
 gstin_value:=upper(btrim(p_data->>'gstin'));
 IF NOT public.waves_company_gstin_valid(gstin_value) THEN RAISE EXCEPTION 'INVALID_GSTIN: invalid format, state code or checksum' USING ERRCODE='check_violation'; END IF;
 RETURN d||jsonb_build_object('vendor',p_data->>'vendor','gstin',gstin_value,'invoiceNo',p_data->>'invoiceNo',
 'gstRateBps',(p_data->>'gstRateBps')::integer,'gstAmountMinor',(p_data->>'gstAmountMinor')::bigint,
 'distanceKm',CASE WHEN mode='distance_rate' THEN distance END,'fromText',p_data->>'fromText','toText',p_data->>'toText');
END $$;
REVOKE ALL ON FUNCTION public.waves_company_entry_values_v3(text,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.waves_company_entry_values_v3(text,uuid,jsonb) TO service_role;
-- The legacy financial normalizer is also an internal helper, not an API.
REVOKE ALL ON FUNCTION public.waves_company_entry_values(text,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.waves_company_entry_values(text,uuid,jsonb) TO service_role;

-- Based on the supplied read-only production definition. Existing authorization and mutation semantics retained.
CREATE OR REPLACE FUNCTION public.waves_company_entry_create(p_group_id uuid, p_entry_id uuid, p_member_id uuid, p_entry_kind text, p_data jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_me uuid; v_admin boolean; r public.company_entries%ROWTYPE; d jsonb; v_currency character(3);
BEGIN
 v_me := public.waves_company_actor(p_group_id); v_admin := public.is_group_admin(p_group_id);
 -- Serialize same-id creates, including retries from different devices.
 PERFORM pg_advisory_xact_lock(hashtextextended(p_entry_id::text, 0));
 SELECT * INTO r FROM public.company_entries WHERE id = p_entry_id;
 IF FOUND THEN
  IF r.group_id = p_group_id AND (v_admin OR r.member_id = v_me) THEN RETURN r.id; END IF;
  RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE = 'insufficient_privilege';
 END IF;
 IF NOT v_admin AND (p_member_id IS DISTINCT FROM v_me OR p_entry_kind NOT IN ('expense','allowance')) THEN
  RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE = 'insufficient_privilege';
 END IF;
 IF NOT EXISTS (SELECT 1 FROM public.group_members WHERE id = p_member_id AND group_id = p_group_id AND left_at IS NULL) THEN
  RAISE EXCEPTION 'UNKNOWN_MEMBER' USING ERRCODE = 'insufficient_privilege';
 END IF;
 SELECT default_currency INTO v_currency FROM public.groups WHERE id = p_group_id FOR SHARE;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_member_id::text,3));
 d := public.waves_company_entry_values_v3(p_entry_kind,p_member_id,p_data);
 INSERT INTO public.company_entries(id,group_id,member_id,entry_kind,category,amount,currency,calc_mode,days,rate_minor,occurred_on,direction,note,created_by,updated_by,vendor,gstin,invoice_no,gst_rate_bps,gst_amount_minor,distance_km,from_text,to_text)
 VALUES(p_entry_id,p_group_id,p_member_id,p_entry_kind,d->>'category',(d->>'amount')::bigint,v_currency,d->>'calcMode',(d->>'days')::numeric,(d->>'rateMinor')::bigint,(d->>'occurredOn')::date,d->>'direction',d->>'note',v_me,v_me,d->>'vendor',d->>'gstin',d->>'invoiceNo',(d->>'gstRateBps')::integer,(d->>'gstAmountMinor')::bigint,(d->>'distanceKm')::numeric,d->>'fromText',d->>'toText');
 RETURN p_entry_id;
END $function$;

-- Based on the supplied read-only production definition. Existing authorization and mutation semantics retained.
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
 IF r.id IS NULL OR r.deleted_at IS NOT NULL OR (NOT public.is_group_admin(r.group_id) AND
  (r.member_id <> v_me OR r.created_by <> v_me OR r.entry_kind NOT IN ('expense','allowance'))) THEN
  RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE = 'insufficient_privilege';
 END IF;
 IF r.reimbursement_id IS NOT NULL OR r.reimbursement_details IS NOT NULL THEN RAISE EXCEPTION 'ENTRY_REIMBURSED: covered entries are frozen' USING ERRCODE='check_violation'; END IF;
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

-- Based on the supplied read-only production definition. Existing authorization and mutation semantics retained.
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
 IF r.id IS NULL OR (NOT public.is_group_admin(r.group_id) AND
  (r.member_id <> v_me OR r.created_by <> v_me OR r.entry_kind NOT IN ('expense','allowance'))) THEN
  RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE = 'insufficient_privilege';
 END IF;
 IF r.reimbursement_id IS NOT NULL OR r.reimbursement_details IS NOT NULL THEN RAISE EXCEPTION 'ENTRY_REIMBURSED: covered entries are frozen' USING ERRCODE='check_violation'; END IF;
 IF r.deleted_at IS NOT NULL THEN RETURN; END IF;
 UPDATE public.company_entries SET deleted_at=now(),void_reason=p_reason,version=version+1,updated_by=v_me,updated_at=now() WHERE id=p_entry_id;
END $function$;

-- Based on the supplied read-only production definition. Existing authorization and mutation semantics retained.
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
 IF NOT public.is_group_admin(r.group_id) THEN RAISE EXCEPTION 'ADMIN_ONLY' USING ERRCODE='insufficient_privilege'; END IF;
 IF r.reimbursement_id IS NOT NULL OR r.reimbursement_details IS NOT NULL THEN RAISE EXCEPTION 'ENTRY_REIMBURSED: covered entries are frozen' USING ERRCODE='check_violation'; END IF;
 IF r.deleted_at IS NOT NULL OR r.status<>'submitted' OR p_to IS NULL OR p_to NOT IN ('approved','rejected') THEN RAISE EXCEPTION 'INVALID_TRANSITION' USING ERRCODE='check_violation'; END IF;
 IF p_expected_version IS NULL OR p_expected_version<>r.version THEN RAISE EXCEPTION 'VERSION_CONFLICT: entry changed; refresh before review' USING ERRCODE='check_violation'; END IF;
 IF p_to='rejected' AND (p_note IS NULL OR p_note !~ '[^[:space:]]') THEN RAISE EXCEPTION 'REVIEW_NOTE_REQUIRED: explain the rejection' USING ERRCODE='check_violation'; END IF;
 UPDATE public.company_entries SET status=p_to,review_note=nullif(btrim(p_note),''),reviewed_by=actor,
 reviewed_at=now(),version=version+1,updated_by=actor,updated_at=now() WHERE id=p_entry_id;
END
$function$;

-- Copied from latest repo definition: 20261105090000_company_expenses_2 (not fetched live).
CREATE OR REPLACE FUNCTION public.waves_attach_company_entry_image(p_entry_id uuid,p_storage_path text,p_attachment_id uuid,p_preview text DEFAULT NULL) RETURNS uuid
 LANGUAGE plpgsql  SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $fn$
DECLARE e public.company_entries%ROWTYPE; a public.company_entry_attachments%ROWTYPE; actor uuid; o public.storage_objects%ROWTYPE;
BEGIN
 e:=public.waves_company_entry_lock(p_entry_id);
 actor:=public.waves_company_actor(e.group_id);
 IF e.deleted_at IS NOT NULL OR NOT public.waves_can_read_company_entry(e.id) THEN RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE='insufficient_privilege'; END IF;
 IF e.reimbursement_id IS NOT NULL OR e.reimbursement_details IS NOT NULL THEN RAISE EXCEPTION 'ENTRY_REIMBURSED: covered entries are frozen' USING ERRCODE='check_violation'; END IF;
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

-- Copied from latest repo definition: 20261105090000_company_expenses_2 (not fetched live).
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
 IF NOT public.waves_can_read_company_entry(a.entry_id) OR (a.uploader_member_id<>actor AND NOT public.is_group_admin(a.group_id)) THEN RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE='insufficient_privilege'; END IF;
 IF EXISTS(SELECT 1 FROM public.company_entries WHERE id=a.entry_id AND (reimbursement_id IS NOT NULL OR reimbursement_details IS NOT NULL)) THEN RAISE EXCEPTION 'ENTRY_REIMBURSED: covered entries are frozen' USING ERRCODE='check_violation'; END IF;
 IF a.deleted_at IS NOT NULL THEN RETURN; END IF;
 UPDATE public.company_entry_attachments SET deleted_at=now(),updated_at=now() WHERE id=a.id;
 DELETE FROM public.storage_objects WHERE logical_bucket='company-entry-images' AND path IN(a.storage_path,a.storage_path||'.thumb.jpg');
 PERFORM public.waves_company_evidence_changed(a.entry_id,actor);
END
$fn$;
REVOKE ALL ON FUNCTION public.waves_company_entry_create(uuid,uuid,uuid,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.waves_company_entry_create(uuid,uuid,uuid,text,jsonb) TO authenticated,service_role;
REVOKE ALL ON FUNCTION public.waves_company_entry_update(uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.waves_company_entry_update(uuid,jsonb) TO authenticated,service_role;
REVOKE ALL ON FUNCTION public.waves_company_entry_void(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.waves_company_entry_void(uuid,text) TO authenticated,service_role;
REVOKE ALL ON FUNCTION public.waves_company_entry_transition(uuid,text,text,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.waves_company_entry_transition(uuid,text,text,integer) TO authenticated,service_role;
REVOKE ALL ON FUNCTION public.waves_attach_company_entry_image(uuid,text,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.waves_attach_company_entry_image(uuid,text,uuid,text) TO authenticated,service_role;
REVOKE ALL ON FUNCTION public.waves_remove_company_entry_image(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.waves_remove_company_entry_image(uuid) TO authenticated,service_role;

-- Retain Phase 2 behaviour with employee-before-entry locking.
CREATE OR REPLACE FUNCTION public.waves_company_evidence_changed(p_entry_id uuid,p_actor uuid) RETURNS void
 LANGUAGE plpgsql  SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $fn$
BEGIN
 PERFORM public.waves_company_entry_lock(p_entry_id);
 UPDATE public.company_entries e SET version=version+1,updated_at=now(),updated_by=p_actor,
 status=CASE WHEN g.company_approvals_enabled THEN 'submitted' WHEN e.status='rejected' THEN 'approved' ELSE e.status END,
 review_note=CASE WHEN g.company_approvals_enabled OR e.status='rejected' THEN NULL ELSE e.review_note END,
 reviewed_by=CASE WHEN g.company_approvals_enabled OR e.status='rejected' THEN NULL ELSE e.reviewed_by END,
 reviewed_at=CASE WHEN g.company_approvals_enabled OR e.status='rejected' THEN NULL ELSE e.reviewed_at END
 FROM public.groups g WHERE e.id=p_entry_id AND g.id=e.group_id AND e.deleted_at IS NULL;
END
$fn$;

-- Retain Phase 2 behaviour with employee-before-entry locking.
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
   AND m.left_at IS NULL AND (m.id=e.member_id OR m.role='admin')
 ) THEN RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE='insufficient_privilege'; END IF;
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

-- Retain Phase 2 behaviour with employee-before-entry locking.
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
   AND (m.id=e.member_id OR m.role='admin') AND g.deleted_at IS NULL
 ) THEN RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE='insufficient_privilege'; END IF;
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

-- Retain Phase 2 behaviour with employee-before-entry locking.
CREATE OR REPLACE FUNCTION public.waves_company_expire_unattached() RETURNS integer
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $fn$
DECLARE e uuid; n integer:=0; removed integer;
BEGIN
 FOR e IN SELECT DISTINCT ce.id FROM public.company_entries ce JOIN public.storage_objects o
 ON o.company_group_id=ce.group_id AND split_part(o.path,'/',1)=ce.id::text
 WHERE o.logical_bucket='company-entry-images' AND NOT o.pending AND o.updated_at<now()-interval '1 day'
 AND NOT EXISTS(SELECT 1 FROM public.company_entry_attachments a WHERE a.entry_id=ce.id AND
 (o.path=a.storage_path OR o.path=a.storage_path||'.thumb.jpg')) LIMIT 200 LOOP
  PERFORM public.waves_company_entry_lock(e);
  DELETE FROM public.storage_objects o WHERE o.logical_bucket='company-entry-images'
  AND split_part(o.path,'/',1)=e::text AND NOT o.pending AND o.updated_at<now()-interval '1 day'
  AND NOT EXISTS(SELECT 1 FROM public.company_entry_attachments a WHERE a.entry_id=e AND
   (o.path=a.storage_path OR o.path=a.storage_path||'.thumb.jpg'));
  GET DIAGNOSTICS removed=ROW_COUNT; n:=n+removed;
 END LOOP;
 RETURN n;
END $fn$;
