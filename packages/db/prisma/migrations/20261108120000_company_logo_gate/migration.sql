-- Company logos use group photos, but only active company admins may set them, regardless of plan.
CREATE OR REPLACE FUNCTION public.waves_can_upload_group_photo(p_group_id uuid DEFAULT NULL::uuid) RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_profile uuid := public.waves_current_profile_id();
BEGIN
  IF v_profile IS NULL THEN
    RETURN false;
  END IF;

  IF p_group_id IS NULL THEN
    RETURN public.waves_profile_is_paid(v_profile);
  END IF;

  -- Only a member may ask about their group.
  IF NOT EXISTS (
    SELECT 1 FROM public.group_members gm
     WHERE gm.group_id = p_group_id
       AND gm.profile_id = v_profile
       AND gm.left_at IS NULL
  ) THEN
    RETURN false;
  END IF;

  IF EXISTS (SELECT 1 FROM public.groups WHERE id = p_group_id AND type = 'company') THEN
    RETURN public.is_group_admin(p_group_id);
  END IF;

  RETURN EXISTS (
    SELECT 1 FROM public.group_members gm
     WHERE gm.group_id = p_group_id
       AND gm.left_at IS NULL
       AND gm.profile_id IS NOT NULL
       AND public.waves_profile_is_paid(gm.profile_id)
  ) OR EXISTS (
    SELECT 1 FROM public.group_passes gp
     WHERE gp.group_id = p_group_id
       AND gp.expires_at > now()
  );
END
$$;

REVOKE ALL ON FUNCTION public.waves_can_upload_group_photo(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.waves_can_upload_group_photo(uuid) TO authenticated, service_role;

-- Clearing a photo is never gated above, so without this an employee could remove the
-- logo. Only an admin changes photo_path of a company group (set, replace or clear).
CREATE OR REPLACE FUNCTION public.waves_company_logo_admin_only() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
BEGIN
  IF NEW.type = 'company'
     AND public.waves_current_profile_id() IS NOT NULL
     AND NOT public.is_group_admin(NEW.id) THEN
    RAISE EXCEPTION 'NOT_AN_ADMIN: only an admin changes the company logo'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END
$$;

REVOKE ALL ON FUNCTION public.waves_company_logo_admin_only() FROM PUBLIC;

DROP TRIGGER IF EXISTS waves_company_logo_admin_only ON public.groups;
CREATE TRIGGER waves_company_logo_admin_only
  BEFORE UPDATE OF photo_path ON public.groups
  FOR EACH ROW
  WHEN (OLD.photo_path IS DISTINCT FROM NEW.photo_path)
  EXECUTE FUNCTION public.waves_company_logo_admin_only();
