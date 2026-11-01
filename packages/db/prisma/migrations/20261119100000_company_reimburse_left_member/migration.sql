-- Latest baseline: 20261110090000_company_managers_pools. Only change: members who left (employment ended) may still be paid their approved claims; vendors excluded.
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
 IF NOT EXISTS(SELECT 1 FROM public.group_members WHERE id=p_member_id AND group_id=p_group_id AND role::text<>'vendor') THEN RAISE EXCEPTION 'UNKNOWN_MEMBER' USING ERRCODE='insufficient_privilege'; END IF;
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
 credits_minor:=credits_minor-(SELECT coalesce(sum(recovery_minor),0) FROM public.company_entries WHERE group_id=p_group_id AND member_id=p_member_id AND entry_kind='wage_payment' AND deleted_at IS NULL AND reimbursement_id IS NULL AND period_end<=p_cutoff);
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
 UPDATE public.company_entries SET reimbursement_id=p_reimbursement_id,version=version+1,updated_by=actor,updated_at=now()
 WHERE group_id=p_group_id AND member_id=p_member_id AND entry_kind='wage_payment' AND deleted_at IS NULL AND reimbursement_id IS NULL AND recovery_minor>0 AND period_end<=p_cutoff;
 UPDATE public.company_entries SET reimbursement_id=p_reimbursement_id,
 status=CASE WHEN id=ANY(claim_ids) THEN 'reimbursed' ELSE status END,version=version+1,updated_by=actor,updated_at=now() WHERE id=ANY(ids);
 PERFORM set_config('waves.company_reimburse','',true);
 RETURN p_reimbursement_id;
END $function$;

REVOKE ALL ON FUNCTION public.waves_company_reimburse(uuid,uuid,uuid,jsonb,jsonb,date,date,bigint,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.waves_company_reimburse(uuid,uuid,uuid,jsonb,jsonb,date,date,bigint,text) TO authenticated,service_role;
