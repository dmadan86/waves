-- Working capital and company-wide spending caps ride the policy rules: two new rule types,
-- `capital` (an auditable top-up or take-out: who, when, how much) and `company_cap`
-- (an amount per period). Only the policy validator learns them. The entry guard still
-- blocks nothing for them: caps warn in the app, the server never refuses an entry over one.
-- The rule limit goes 100 -> 500 because every top-up is its own record.
-- Based on 20261109090000_company_tags_and_ranks, the live definition. Not applied to prod.
CREATE OR REPLACE FUNCTION public.waves_company_policies_set(p_group_id uuid,p_policies jsonb,p_expected_revision integer) RETURNS void
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
 IF EXISTS(SELECT 1 FROM jsonb_object_keys(p_policies) k WHERE k NOT IN ('version','rules')) OR jsonb_array_length(p_policies->'rules')>500 THEN RAISE EXCEPTION 'INVALID_POLICIES' USING ERRCODE='check_violation'; END IF;
 FOR r IN SELECT value FROM jsonb_array_elements(p_policies->'rules') LOOP
  IF jsonb_typeof(r) IS DISTINCT FROM 'object' OR jsonb_typeof(r->'id') IS DISTINCT FROM 'string' OR coalesce(length(r->>'id'),0) NOT BETWEEN 1 AND 120
   OR jsonb_typeof(r->'limitMinor') IS DISTINCT FROM 'string' OR coalesce(r->>'limitMinor','') !~ '^[0-9]{1,19}$'
   OR (r->>'limitMinor')::numeric>9223372036854775807 OR coalesce(r->>'effect','') NOT IN ('warn','block')
   OR coalesce(r->>'type','') NOT IN ('receipt_above','period_limit','capital','company_cap') THEN RAISE EXCEPTION 'INVALID_POLICIES' USING ERRCODE='check_violation'; END IF;
  IF r->>'type'='capital' THEN
   IF r->>'effect'<>'warn' OR coalesce(r->>'direction','') NOT IN ('in','out') OR jsonb_typeof(r->'at') IS DISTINCT FROM 'string' OR length(r->>'at')>40
    OR (r ? 'by' AND jsonb_typeof(r->'by') NOT IN ('string','null'))
    OR EXISTS(SELECT 1 FROM jsonb_object_keys(r) k WHERE k NOT IN ('id','type','limitMinor','effect','direction','by','at')) THEN RAISE EXCEPTION 'INVALID_POLICIES' USING ERRCODE='check_violation'; END IF;
  ELSIF r->>'type'='company_cap' THEN
   IF r->>'effect'<>'warn' OR coalesce(r->>'period','') NOT IN ('days','week','month','year')
    OR (r->>'period'='days' AND (jsonb_typeof(r->'days') IS DISTINCT FROM 'number' OR (r->>'days') !~ '^[0-9]{1,4}$' OR (r->>'days')::int<1))
    OR (r->>'period'<>'days' AND r ? 'days')
    OR EXISTS(SELECT 1 FROM jsonb_object_keys(r) k WHERE k NOT IN ('id','type','limitMinor','effect','period','days')) THEN RAISE EXCEPTION 'INVALID_POLICIES' USING ERRCODE='check_violation'; END IF;
  ELSIF r->>'type'='receipt_above' THEN
   IF r->>'effect'<>'warn' OR EXISTS(SELECT 1 FROM jsonb_object_keys(r) k WHERE k NOT IN ('id','type','limitMinor','effect')) THEN RAISE EXCEPTION 'INVALID_POLICIES' USING ERRCODE='check_violation'; END IF;
  ELSE
   IF coalesce(r->>'target','') !~ '^[a-z0-9][a-z0-9_-]{0,39}$' OR coalesce(r->>'period','') NOT IN ('day','month')
    OR EXISTS(SELECT 1 FROM jsonb_object_keys(r) k WHERE k NOT IN ('id','type','limitMinor','effect','target','period')) THEN RAISE EXCEPTION 'INVALID_POLICIES' USING ERRCODE='check_violation'; END IF;
  END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_policies->'rules') AS rules(value) GROUP BY rules.value->>'id' HAVING count(*)>1) THEN RAISE EXCEPTION 'INVALID_POLICIES' USING ERRCODE='check_violation'; END IF;
 UPDATE public.groups SET company_policies=p_policies,company_policy_revision=revision+1,updated_at=now() WHERE id=p_group_id;
END $$;

REVOKE ALL ON FUNCTION public.waves_company_policies_set(uuid,jsonb,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.waves_company_policies_set(uuid,jsonb,integer) TO authenticated,service_role;
