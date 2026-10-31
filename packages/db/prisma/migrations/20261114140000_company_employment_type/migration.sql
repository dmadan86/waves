-- Company employment type per employee: Full-time / Part-time / Contractor (null = not set).
-- Same shape as department_id: a column on group_members, writable only through the RPC below.
-- aa_company_block_guard (waves_company_block_member_guard) already covers group_members, and
-- employment_type is not in its allow-list, so a blocked company cannot change it.
ALTER TABLE public.group_members ADD COLUMN employment_type text;
ALTER TABLE public.group_members ADD CONSTRAINT group_members_employment_type_valid
 CHECK (employment_type IS NULL OR employment_type IN ('full_time','part_time','contractor'));

CREATE FUNCTION public.waves_guard_member_employment_type() RETURNS trigger
 LANGUAGE plpgsql SET search_path TO 'public','pg_temp' AS $$
BEGIN
 IF current_user IN ('anon','authenticated') AND
  ((TG_OP='INSERT' AND NEW.employment_type IS NOT NULL) OR (TG_OP='UPDATE' AND NEW.employment_type IS DISTINCT FROM OLD.employment_type)) THEN
  RAISE EXCEPTION 'FORBIDDEN_COLUMN: use waves_company_employment_type_set' USING ERRCODE='insufficient_privilege';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER group_members_guard_employment_type BEFORE INSERT OR UPDATE ON public.group_members FOR EACH ROW EXECUTE FUNCTION public.waves_guard_member_employment_type();

-- Owner, or the employee's own manager. Null clears.
CREATE FUNCTION public.waves_company_employment_type_set(p_group_id uuid,p_member_id uuid,p_type text) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
BEGIN
 PERFORM public.waves_company_actor(p_group_id);
 IF NOT public.is_group_admin(p_group_id) AND NOT public.waves_company_team(p_group_id,p_member_id) THEN RAISE EXCEPTION 'ADMIN_ONLY' USING ERRCODE='insufficient_privilege'; END IF;
 IF p_type IS NOT NULL AND p_type NOT IN ('full_time','part_time','contractor') THEN RAISE EXCEPTION 'INVALID_DATA: employment type' USING ERRCODE='check_violation'; END IF;
 UPDATE public.group_members SET employment_type=p_type,updated_at=now() WHERE id=p_member_id AND group_id=p_group_id AND removed_at IS NULL;
 IF NOT FOUND THEN RAISE EXCEPTION 'UNKNOWN_MEMBER' USING ERRCODE='insufficient_privilege'; END IF;
END $$;

REVOKE ALL ON FUNCTION public.waves_guard_member_employment_type(),public.waves_company_employment_type_set(uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.waves_company_employment_type_set(uuid,uuid,text) TO authenticated,service_role;
