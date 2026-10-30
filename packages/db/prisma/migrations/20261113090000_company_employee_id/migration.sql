-- Company: an optional free-text employee ID (e.g. EMP-014) on each member row.
-- Stored beside manager_id / daily_rate_minor, so it rides the same group_members pull and the same
-- restrictive privacy policy: owners, the employee's own manager and the employee read it; nobody else.
ALTER TABLE public.group_members
 ADD COLUMN employee_id text
 CONSTRAINT company_member_employee_id_shape CHECK(employee_id IS NULL OR (employee_id=btrim(employee_id) AND length(employee_id) BETWEEN 1 AND 32));
-- Unique per company among people still in it (case-insensitive); a leaver's ID can be reused.
CREATE UNIQUE INDEX company_member_employee_id_uniq ON public.group_members(group_id,lower(employee_id))
 WHERE employee_id IS NOT NULL AND left_at IS NULL AND removed_at IS NULL AND merged_into_member_id IS NULL;

-- Direct updates (the self-update policy!) may not touch it; only the RPC below (owner-run, so current_user differs).
CREATE FUNCTION public.waves_guard_employee_id() RETURNS trigger
 LANGUAGE plpgsql SET search_path TO 'public','pg_temp' AS $$
BEGIN
 IF current_user IN ('anon','authenticated') AND NEW.employee_id IS DISTINCT FROM OLD.employee_id THEN
  RAISE EXCEPTION 'FORBIDDEN_COLUMN: use company employee id RPC' USING ERRCODE='insufficient_privilege';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER group_members_guard_employee_id BEFORE UPDATE ON public.group_members FOR EACH ROW EXECUTE FUNCTION public.waves_guard_employee_id();
-- A direct INSERT (ghost policy) may not set one either.
CREATE FUNCTION public.waves_guard_employee_id_ins() RETURNS trigger
 LANGUAGE plpgsql SET search_path TO 'public','pg_temp' AS $$
BEGIN
 IF current_user IN ('anon','authenticated') AND NEW.employee_id IS NOT NULL THEN
  RAISE EXCEPTION 'FORBIDDEN_COLUMN: use company employee id RPC' USING ERRCODE='insufficient_privilege';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER group_members_guard_employee_id_ins BEFORE INSERT ON public.group_members FOR EACH ROW EXECUTE FUNCTION public.waves_guard_employee_id_ins();

-- Owner, or the employee's own manager. Blank clears.
CREATE FUNCTION public.waves_company_employee_id_set(p_group_id uuid,p_member_id uuid,p_employee_id text) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
DECLARE v text:=nullif(btrim(coalesce(p_employee_id,'')),'');
BEGIN
 PERFORM public.waves_company_actor(p_group_id);
 IF NOT public.is_group_admin(p_group_id) AND NOT public.waves_company_team(p_group_id,p_member_id) THEN RAISE EXCEPTION 'ADMIN_ONLY' USING ERRCODE='insufficient_privilege'; END IF;
 IF v IS NOT NULL AND length(v)>32 THEN RAISE EXCEPTION 'INVALID_DATA: employee id too long'; END IF;
 UPDATE public.group_members SET employee_id=v,updated_at=now() WHERE id=p_member_id AND group_id=p_group_id AND left_at IS NULL AND removed_at IS NULL;
 IF NOT FOUND THEN RAISE EXCEPTION 'UNKNOWN_MEMBER' USING ERRCODE='insufficient_privilege'; END IF;
END $$;

-- Lets the app warn before saving: is this ID already used by someone else still in the company?
-- Owner or a manager only (it reveals that an ID exists, never whose).
CREATE FUNCTION public.waves_company_employee_id_taken(p_group_id uuid,p_employee_id text,p_except_member uuid) RETURNS boolean
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.group_members WHERE id=public.waves_company_actor(p_group_id) AND role::text IN ('admin','manager')) THEN RAISE EXCEPTION 'ADMIN_ONLY' USING ERRCODE='insufficient_privilege'; END IF;
 RETURN EXISTS(SELECT 1 FROM public.group_members WHERE group_id=p_group_id AND lower(employee_id)=lower(btrim(p_employee_id))
  AND left_at IS NULL AND removed_at IS NULL AND merged_into_member_id IS NULL AND id IS DISTINCT FROM p_except_member);
END $$;

REVOKE ALL ON FUNCTION public.waves_company_employee_id_set(uuid,uuid,text),public.waves_company_employee_id_taken(uuid,text,uuid),public.waves_guard_employee_id(),public.waves_guard_employee_id_ins() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.waves_company_employee_id_set(uuid,uuid,text),public.waves_company_employee_id_taken(uuid,text,uuid) TO authenticated,service_role;
