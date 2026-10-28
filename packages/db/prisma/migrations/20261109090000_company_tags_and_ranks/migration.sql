-- Shared company tags. Categories validate syntax only, including offline keys.
DO $$ DECLARE c record; BEGIN
 FOR c IN SELECT conname FROM pg_constraint WHERE conrelid='public.company_entries'::regclass
 AND contype='c' AND pg_get_constraintdef(oid) LIKE '%category%'
 AND pg_get_constraintdef(oid) LIKE '%office%' AND pg_get_constraintdef(oid) NOT LIKE '%calc_mode%' LOOP
 EXECUTE format('ALTER TABLE public.company_entries DROP CONSTRAINT %I',c.conname);
 END LOOP;
END $$;
ALTER TABLE public.company_entries ADD CONSTRAINT company_entries_category_key CHECK(category IS NULL OR category ~ '^[a-z0-9][a-z0-9_-]{0,39}$');
ALTER TABLE public.groups
 ADD COLUMN company_tags jsonb NOT NULL DEFAULT '[]',
 ADD COLUMN company_industry text CHECK(company_industry IN ('construction','transport','field_sales'));

CREATE FUNCTION public.waves_company_tags_valid(p_tags jsonb) RETURNS boolean
 LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
DECLARE t jsonb;
BEGIN
 IF jsonb_typeof(p_tags) IS DISTINCT FROM 'array' THEN RETURN false; END IF;
 IF jsonb_array_length(p_tags)>50 THEN RETURN false; END IF;
 FOR t IN SELECT value FROM jsonb_array_elements(p_tags) LOOP
  IF jsonb_typeof(t) IS DISTINCT FROM 'object' THEN RETURN false; END IF;
  IF jsonb_typeof(t->'key') IS DISTINCT FROM 'string' OR coalesce(t->>'key','') !~ '^[a-z0-9][a-z0-9_-]{0,39}$'
   OR jsonb_typeof(t->'label') IS DISTINCT FROM 'string' OR length(btrim(t->>'label')) NOT BETWEEN 1 AND 40
   OR length(t->>'label')>40 THEN RETURN false; END IF;
  IF t ? 'unit' AND (jsonb_typeof(t->'unit') IS DISTINCT FROM 'string' OR length(t->>'unit') NOT BETWEEN 1 AND 16) THEN RETURN false; END IF;
  IF t ? 'hidden' AND jsonb_typeof(t->'hidden') IS DISTINCT FROM 'boolean' THEN RETURN false; END IF;
  IF t ? 'addedBy' AND (jsonb_typeof(t->'addedBy') IS DISTINCT FROM 'string' OR (t->>'addedBy') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') THEN RETURN false; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_object_keys(t) k WHERE k NOT IN ('key','label','unit','hidden','addedBy')) THEN RETURN false; END IF;
 END LOOP;
 RETURN NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_tags) e GROUP BY e->>'key' HAVING count(*)>1);
END $$;
ALTER TABLE public.groups ADD CONSTRAINT groups_company_tags_valid CHECK(public.waves_company_tags_valid(company_tags));

-- Invoker sibling preserves the phase-3 settings trigger and its protections.
CREATE FUNCTION public.waves_company_tags_guard() RETURNS trigger
 LANGUAGE plpgsql SET search_path TO 'public','pg_temp' AS $$
BEGIN
 IF current_user IN ('anon','authenticated') THEN
  IF TG_OP='INSERT' THEN
   IF NEW.company_tags<>'[]'::jsonb OR NEW.company_industry IS NOT NULL THEN
    RAISE EXCEPTION 'FORBIDDEN_COLUMN: use company tag RPCs' USING ERRCODE='insufficient_privilege'; END IF;
  ELSIF (NEW.company_tags,NEW.company_industry) IS DISTINCT FROM (OLD.company_tags,OLD.company_industry) THEN
   RAISE EXCEPTION 'FORBIDDEN_COLUMN: use company tag RPCs' USING ERRCODE='insufficient_privilege';
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER company_tags_guard BEFORE INSERT OR UPDATE ON public.groups FOR EACH ROW EXECUTE FUNCTION public.waves_company_tags_guard();

CREATE FUNCTION public.waves_company_tag_add(p_group_id uuid,p_key text,p_label text,p_unit text DEFAULT NULL) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
DECLARE actor uuid; tags jsonb; tag jsonb;
BEGIN
 actor:=public.waves_company_actor(p_group_id);
 SELECT company_tags INTO tags FROM public.groups WHERE id=p_group_id AND deleted_at IS NULL FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'GROUP_DELETED' USING ERRCODE='check_violation'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(tags) t WHERE t->>'key'=p_key OR lower(t->>'label')=lower(p_label)) OR jsonb_array_length(tags)>=50 THEN RETURN; END IF;
 tag:=jsonb_build_object('key',p_key,'label',p_label,'addedBy',actor);
 IF p_unit IS NOT NULL THEN tag:=tag||jsonb_build_object('unit',p_unit); END IF;
 IF NOT public.waves_company_tags_valid(jsonb_build_array(tag)) THEN RAISE EXCEPTION 'INVALID_TAGS' USING ERRCODE='check_violation'; END IF;
 UPDATE public.groups SET company_tags=tags||jsonb_build_array(tag),updated_at=now() WHERE id=p_group_id;
END $$;
CREATE FUNCTION public.waves_company_tags_set(p_group_id uuid,p_tags jsonb,p_industry text) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
DECLARE tags jsonb;
BEGIN
 PERFORM public.waves_company_actor(p_group_id);
 IF NOT public.is_group_admin(p_group_id) THEN RAISE EXCEPTION 'ADMIN_ONLY' USING ERRCODE='insufficient_privilege'; END IF;
 SELECT company_tags INTO tags FROM public.groups WHERE id=p_group_id AND deleted_at IS NULL FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'GROUP_DELETED' USING ERRCODE='check_violation'; END IF;
 IF NOT public.waves_company_tags_valid(p_tags) OR (p_industry IS NOT NULL AND p_industry NOT IN ('construction','transport','field_sales')) THEN
  RAISE EXCEPTION 'INVALID_TAGS' USING ERRCODE='check_violation'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(tags) old WHERE NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_tags) fresh WHERE fresh->>'key'=old->>'key')) THEN
  RAISE EXCEPTION 'INVALID_TAGS: stored keys must be retained' USING ERRCODE='check_violation'; END IF;
 UPDATE public.groups SET company_tags=p_tags,company_industry=p_industry,updated_at=now() WHERE id=p_group_id;
END $$;
-- Based on stacked phase-3 migration 20261108090000, not the live phase-2 definition.
-- The phase-3 entry guard already compares category to target without a builtin list.
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
 IF EXISTS(SELECT 1 FROM jsonb_object_keys(p_policies) k WHERE k NOT IN ('version','rules')) OR jsonb_array_length(p_policies->'rules')>100 THEN RAISE EXCEPTION 'INVALID_POLICIES' USING ERRCODE='check_violation'; END IF;
 FOR r IN SELECT value FROM jsonb_array_elements(p_policies->'rules') LOOP
  IF jsonb_typeof(r) IS DISTINCT FROM 'object' OR jsonb_typeof(r->'id') IS DISTINCT FROM 'string' OR coalesce(length(r->>'id'),0) NOT BETWEEN 1 AND 120
   OR jsonb_typeof(r->'limitMinor') IS DISTINCT FROM 'string' OR coalesce(r->>'limitMinor','') !~ '^[0-9]{1,19}$'
   OR (r->>'limitMinor')::numeric>9223372036854775807 OR coalesce(r->>'effect','') NOT IN ('warn','block')
   OR coalesce(r->>'type','') NOT IN ('receipt_above','period_limit') THEN RAISE EXCEPTION 'INVALID_POLICIES' USING ERRCODE='check_violation'; END IF;
  IF r->>'type'='receipt_above' THEN
   IF r->>'effect'<>'warn' OR EXISTS(SELECT 1 FROM jsonb_object_keys(r) k WHERE k NOT IN ('id','type','limitMinor','effect')) THEN RAISE EXCEPTION 'INVALID_POLICIES' USING ERRCODE='check_violation'; END IF;
  ELSE
   IF coalesce(r->>'target','') !~ '^[a-z0-9][a-z0-9_-]{0,39}$' OR coalesce(r->>'period','') NOT IN ('day','month')
    OR EXISTS(SELECT 1 FROM jsonb_object_keys(r) k WHERE k NOT IN ('id','type','limitMinor','effect','target','period')) THEN RAISE EXCEPTION 'INVALID_POLICIES' USING ERRCODE='check_violation'; END IF;
  END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_policies->'rules') AS rules(value) GROUP BY rules.value->>'id' HAVING count(*)>1) THEN RAISE EXCEPTION 'INVALID_POLICIES' USING ERRCODE='check_violation'; END IF;
 UPDATE public.groups SET company_policies=p_policies,company_policy_revision=revision+1,updated_at=now() WHERE id=p_group_id;
END $$;

REVOKE ALL ON FUNCTION public.waves_company_tag_add(uuid,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.waves_company_tag_add(uuid,text,text,text) TO authenticated,service_role;
REVOKE ALL ON FUNCTION public.waves_company_tags_set(uuid,jsonb,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.waves_company_tags_set(uuid,jsonb,text) TO authenticated,service_role;
REVOKE ALL ON FUNCTION public.waves_company_policies_set(uuid,jsonb,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.waves_company_policies_set(uuid,jsonb,integer) TO authenticated,service_role;
REVOKE ALL ON FUNCTION public.waves_company_tags_valid(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.waves_company_tags_valid(jsonb) TO authenticated,service_role;
REVOKE ALL ON FUNCTION public.waves_company_tags_guard() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.waves_company_tags_guard() TO service_role;
