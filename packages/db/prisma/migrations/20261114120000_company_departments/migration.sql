-- Company departments: a short owner-managed list on the company, and an optional department per employee.
-- The list is a jsonb array of {id,name} on groups (like company_tags); the person's choice is
-- group_members.department_id, riding the same pull and privacy policy as employee_id.
ALTER TABLE public.groups ADD COLUMN company_departments jsonb NOT NULL DEFAULT '[]';
ALTER TABLE public.group_members ADD COLUMN department_id uuid;

CREATE FUNCTION public.waves_company_departments_valid(p_list jsonb) RETURNS boolean
 LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
DECLARE d jsonb;
BEGIN
 IF jsonb_typeof(p_list) IS DISTINCT FROM 'array' OR jsonb_array_length(p_list)>30 THEN RETURN false; END IF;
 FOR d IN SELECT value FROM jsonb_array_elements(p_list) LOOP
  IF jsonb_typeof(d) IS DISTINCT FROM 'object'
   OR jsonb_typeof(d->'id') IS DISTINCT FROM 'string' OR (d->>'id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
   OR jsonb_typeof(d->'name') IS DISTINCT FROM 'string' OR length(btrim(d->>'name')) NOT BETWEEN 1 AND 40 OR (d->>'name')<>btrim(d->>'name')
   OR EXISTS(SELECT 1 FROM jsonb_object_keys(d) k WHERE k NOT IN ('id','name')) THEN RETURN false; END IF;
 END LOOP;
 RETURN NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_list) e GROUP BY lower(e->>'id') HAVING count(*)>1)
  AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_list) e GROUP BY lower(e->>'name') HAVING count(*)>1);
END $$;
ALTER TABLE public.groups ADD CONSTRAINT groups_company_departments_valid CHECK(public.waves_company_departments_valid(company_departments));

-- Direct writes (self-update / ghost-insert policies) may not touch either column; only the RPCs below.
CREATE FUNCTION public.waves_company_departments_guard() RETURNS trigger
 LANGUAGE plpgsql SET search_path TO 'public','pg_temp' AS $$
BEGIN
 IF current_user IN ('anon','authenticated') AND
  ((TG_OP='INSERT' AND NEW.company_departments<>'[]'::jsonb) OR (TG_OP='UPDATE' AND NEW.company_departments IS DISTINCT FROM OLD.company_departments)) THEN
  RAISE EXCEPTION 'FORBIDDEN_COLUMN: use company department RPCs' USING ERRCODE='insufficient_privilege';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER company_departments_guard BEFORE INSERT OR UPDATE ON public.groups FOR EACH ROW EXECUTE FUNCTION public.waves_company_departments_guard();

CREATE FUNCTION public.waves_guard_member_department() RETURNS trigger
 LANGUAGE plpgsql SET search_path TO 'public','pg_temp' AS $$
BEGIN
 IF current_user IN ('anon','authenticated') AND
  ((TG_OP='INSERT' AND NEW.department_id IS NOT NULL) OR (TG_OP='UPDATE' AND NEW.department_id IS DISTINCT FROM OLD.department_id)) THEN
  RAISE EXCEPTION 'FORBIDDEN_COLUMN: use company department RPCs' USING ERRCODE='insufficient_privilege';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER group_members_guard_department BEFORE INSERT OR UPDATE ON public.group_members FOR EACH ROW EXECUTE FUNCTION public.waves_guard_member_department();

-- Owner replaces the whole list; anyone left pointing at a removed department is cleared.
CREATE FUNCTION public.waves_company_departments_set(p_group_id uuid,p_departments jsonb) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
BEGIN
 PERFORM public.waves_company_actor(p_group_id);
 IF NOT public.is_group_admin(p_group_id) THEN RAISE EXCEPTION 'ADMIN_ONLY' USING ERRCODE='insufficient_privilege'; END IF;
 IF NOT public.waves_company_departments_valid(p_departments) THEN RAISE EXCEPTION 'INVALID_DATA: departments' USING ERRCODE='check_violation'; END IF;
 UPDATE public.groups SET company_departments=p_departments,updated_at=now() WHERE id=p_group_id AND deleted_at IS NULL;
 IF NOT FOUND THEN RAISE EXCEPTION 'GROUP_DELETED' USING ERRCODE='check_violation'; END IF;
 UPDATE public.group_members SET department_id=NULL,updated_at=now() WHERE group_id=p_group_id AND department_id IS NOT NULL
  AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_departments) e WHERE (e->>'id')::uuid=group_members.department_id);
END $$;

-- Owner, or the employee's own manager. Null clears.
CREATE FUNCTION public.waves_company_department_set(p_group_id uuid,p_member_id uuid,p_department_id uuid) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
BEGIN
 PERFORM public.waves_company_actor(p_group_id);
 IF NOT public.is_group_admin(p_group_id) AND NOT public.waves_company_team(p_group_id,p_member_id) THEN RAISE EXCEPTION 'ADMIN_ONLY' USING ERRCODE='insufficient_privilege'; END IF;
 IF p_department_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.groups g,jsonb_array_elements(g.company_departments) e WHERE g.id=p_group_id AND (e->>'id')::uuid=p_department_id) THEN
  RAISE EXCEPTION 'INVALID_DATA: department' USING ERRCODE='check_violation'; END IF;
 UPDATE public.group_members SET department_id=p_department_id,updated_at=now() WHERE id=p_member_id AND group_id=p_group_id AND left_at IS NULL AND removed_at IS NULL;
 IF NOT FOUND THEN RAISE EXCEPTION 'UNKNOWN_MEMBER' USING ERRCODE='insufficient_privilege'; END IF;
END $$;

REVOKE ALL ON FUNCTION public.waves_company_departments_valid(jsonb),public.waves_company_departments_guard(),public.waves_guard_member_department(),public.waves_company_departments_set(uuid,jsonb),public.waves_company_department_set(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.waves_company_departments_valid(jsonb),public.waves_company_departments_set(uuid,jsonb),public.waves_company_department_set(uuid,uuid,uuid) TO authenticated,service_role;
