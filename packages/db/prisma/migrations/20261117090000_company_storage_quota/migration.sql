-- Company storage quota: free default for every company, one shared helper for all reserve RPCs.
INSERT INTO public.app_config(key,value,description,updated_at)
VALUES('company_free_storage_bytes',262144000,'Image bytes a company may store before the owner must add a storage pack (default 250 MB).',now())
ON CONFLICT(key) DO NOTHING;

CREATE FUNCTION public.waves_company_free_storage_bytes() RETURNS bigint
 LANGUAGE sql STABLE SET search_path TO 'public','pg_temp' AS $fn$
 SELECT coalesce((SELECT value FROM public.app_config WHERE key='company_free_storage_bytes'),262144000)::bigint;
$fn$;

-- Effective quota: the company's own figure (admin override or storage pack) else the free default.
CREATE FUNCTION public.waves_company_storage_quota(p_group_id uuid) RETURNS bigint
 LANGUAGE sql STABLE SET search_path TO 'public','pg_temp' AS $fn$
 SELECT coalesce((SELECT storage_quota_bytes FROM public.company_plans WHERE group_id=p_group_id),
  public.waves_company_free_storage_bytes());
$fn$;
REVOKE ALL ON FUNCTION public.waves_company_free_storage_bytes(),public.waves_company_storage_quota(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.waves_company_free_storage_bytes(),public.waves_company_storage_quota(uuid) TO service_role;

-- Nobody starts over the cap: companies already above the default keep what they use plus 10%.
UPDATE public.company_plans cp SET storage_quota_bytes=greatest(coalesce(cp.storage_quota_bytes,0),u.q)
FROM (SELECT company_group_id g,ceil(sum(bytes)*1.1)::bigint q FROM public.storage_objects WHERE company_group_id IS NOT NULL
 GROUP BY company_group_id HAVING sum(bytes)>public.waves_company_free_storage_bytes()) u WHERE cp.group_id=u.g;

-- Point the three company reserve RPCs at the helper (rewrite in place so no body is copied here).
DO $do$
DECLARE f text; def text; fixed text;
BEGIN
 FOREACH f IN ARRAY ARRAY['waves_company_storage_write_entry',
  'waves_company_vendor_storage_write','waves_company_task_storage_write'] LOOP
  def:=pg_get_functiondef(f::regproc);
  fixed:=replace(def,'SELECT storage_quota_bytes INTO quota FROM public.company_plans WHERE group_id=e.group_id;','quota:=public.waves_company_storage_quota(e.group_id);');
  fixed:=replace(fixed,'IF quota IS NOT NULL AND used+p_bytes>quota','IF used+p_bytes>quota');
  IF fixed=def OR position('waves_company_storage_quota' IN fixed)=0 THEN RAISE EXCEPTION 'quota rewrite failed for %',f; END IF;
  EXECUTE fixed;
 END LOOP;
END $do$;

CREATE OR REPLACE FUNCTION public.waves_company_plan(p_group_id uuid) RETURNS TABLE(plan text,storage_quota_bytes bigint)
 LANGUAGE plpgsql  SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $fn$
BEGIN
 PERFORM public.waves_company_actor(p_group_id);
 IF NOT EXISTS(SELECT 1 FROM public.groups WHERE id=p_group_id AND deleted_at IS NULL) THEN RAISE EXCEPTION 'NOT_A_MEMBER'; END IF;
 RETURN QUERY SELECT coalesce((SELECT cp.plan FROM public.company_plans cp WHERE cp.group_id=p_group_id),'free'),public.waves_company_storage_quota(p_group_id);
END
$fn$;

CREATE OR REPLACE FUNCTION public.waves_company_storage_usage(p_group_id uuid) RETURNS TABLE(used_bytes bigint,reserved_bytes bigint,quota_bytes bigint)
 LANGUAGE plpgsql  SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $fn$
DECLARE v_me uuid;
BEGIN
 v_me:=public.waves_company_actor(p_group_id);
 IF NOT EXISTS(SELECT 1 FROM public.groups WHERE id=p_group_id AND deleted_at IS NULL) THEN RAISE EXCEPTION 'NOT_A_MEMBER' USING ERRCODE='insufficient_privilege'; END IF;
 -- Owners and managers see the meter (managers get the 80% banner).
 IF NOT public.is_group_admin(p_group_id) AND NOT public.waves_company_manager_ok(p_group_id,v_me) THEN RAISE EXCEPTION 'ADMIN_ONLY' USING ERRCODE='insufficient_privilege'; END IF;
 RETURN QUERY SELECT coalesce(sum(o.bytes) FILTER(WHERE NOT o.pending),0)::bigint,
 coalesce(sum(o.bytes) FILTER(WHERE o.pending),0)::bigint,
 public.waves_company_storage_quota(p_group_id)
 FROM public.storage_objects o WHERE o.company_group_id=p_group_id;
END
$fn$;

-- Admin console: read a company's figures and set its quota (NULL goes back to the free default).
CREATE FUNCTION public.waves_admin_company_storage(p_group_id uuid) RETURNS jsonb
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $fn$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.groups WHERE id=p_group_id AND type='company') THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
 RETURN jsonb_build_object(
  'used_bytes',(SELECT coalesce(sum(bytes),0)::bigint FROM public.storage_objects WHERE company_group_id=p_group_id),
  'quota_bytes',public.waves_company_storage_quota(p_group_id),
  'override_bytes',(SELECT storage_quota_bytes FROM public.company_plans WHERE group_id=p_group_id));
END $fn$;

CREATE FUNCTION public.waves_admin_company_storage_set(p_group_id uuid,p_bytes bigint) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $fn$
BEGIN
 IF p_bytes IS NOT NULL AND p_bytes<0 THEN RAISE EXCEPTION 'INVALID_DATA' USING ERRCODE='check_violation'; END IF;
 UPDATE public.company_plans SET storage_quota_bytes=p_bytes WHERE group_id=p_group_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
END $fn$;
REVOKE ALL ON FUNCTION public.waves_admin_company_storage(uuid),public.waves_admin_company_storage_set(uuid,bigint) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.waves_admin_company_storage(uuid),public.waves_admin_company_storage_set(uuid,bigint) TO service_role;

-- Trigger function from task_number: not callable by app roles (definer-grant-tightening).
REVOKE ALL ON FUNCTION public.waves_company_task_seq() FROM PUBLIC,anon,authenticated;
