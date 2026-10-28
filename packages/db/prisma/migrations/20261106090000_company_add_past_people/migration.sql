-- Reuse membership-provided contacts only across companies the caller administers.
CREATE FUNCTION public.waves_company_past_people(p_target_group uuid)
RETURNS TABLE(source_group_id uuid, source_group_name text, source_member_id uuid,
              profile_id uuid, display_name text, phone text, email text, is_placeholder boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_caller uuid := public.waves_current_profile_id();
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.groups g JOIN public.group_members me ON me.group_id = g.id
    WHERE g.id = p_target_group AND g.type = 'company' AND g.deleted_at IS NULL
      AND me.profile_id = v_caller AND me.role = 'admin'
      AND me.left_at IS NULL AND me.removed_at IS NULL AND me.merged_into_member_id IS NULL
  ) THEN
    RAISE EXCEPTION 'ADMIN_ONLY' USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN QUERY
  SELECT g.id, g.name, m.id, m.profile_id,
         CASE WHEN m.profile_id IS NULL THEN m.ghost_name ELSE p.display_name END,
         m.invite_phone, m.invite_email, m.profile_id IS NULL
  FROM public.groups g
  JOIN public.group_members m ON m.group_id = g.id
  LEFT JOIN public.profiles p ON p.id = m.profile_id
  WHERE g.id <> p_target_group AND g.type = 'company' AND g.deleted_at IS NULL
    AND m.left_at IS NULL AND m.removed_at IS NULL AND m.merged_into_member_id IS NULL
    AND (m.profile_id IS NULL OR (m.profile_id <> v_caller AND NOT public.waves_is_guest(m.profile_id)))
    AND EXISTS (
      SELECT 1 FROM public.group_members me
      WHERE me.group_id = g.id AND me.profile_id = v_caller AND me.role = 'admin'
        AND me.left_at IS NULL AND me.removed_at IS NULL AND me.merged_into_member_id IS NULL
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.group_members target
      WHERE target.group_id = p_target_group
        AND target.left_at IS NULL AND target.removed_at IS NULL AND target.merged_into_member_id IS NULL
        AND (target.profile_id = m.profile_id OR target.invite_phone = m.invite_phone
             OR target.invite_email = m.invite_email)
    )
  ORDER BY g.name, CASE WHEN m.profile_id IS NULL THEN m.ghost_name ELSE p.display_name END, m.id
  LIMIT 500;
END
$$;
REVOKE ALL ON FUNCTION public.waves_company_past_people(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.waves_company_past_people(uuid) TO authenticated, service_role;

CREATE FUNCTION public.waves_company_add_past_people(p_target_group uuid, p_source_member_ids uuid[])
RETURNS TABLE(source_member_id uuid, member_id uuid)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_caller uuid := public.waves_current_profile_id();
  v_id uuid;
  v_source record;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.groups g JOIN public.group_members me ON me.group_id = g.id
    WHERE g.id = p_target_group AND g.type = 'company' AND g.deleted_at IS NULL
      AND me.profile_id = v_caller AND me.role = 'admin'
      AND me.left_at IS NULL AND me.removed_at IS NULL AND me.merged_into_member_id IS NULL
  ) THEN
    RAISE EXCEPTION 'ADMIN_ONLY' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF cardinality(p_source_member_ids) > 100 THEN
    RAISE EXCEPTION 'TOO_MANY_PEOPLE' USING ERRCODE = 'check_violation';
  END IF;

  FOREACH v_id IN ARRAY coalesce(p_source_member_ids, ARRAY[]::uuid[]) LOOP
    SELECT m.profile_id, m.invite_email, m.invite_phone,
           CASE WHEN m.profile_id IS NULL THEN m.ghost_name ELSE p.display_name END AS name
    INTO v_source
    FROM public.group_members m
    JOIN public.groups g ON g.id = m.group_id
    LEFT JOIN public.profiles p ON p.id = m.profile_id
    WHERE m.id = v_id AND g.type = 'company' AND g.deleted_at IS NULL
      AND m.left_at IS NULL AND m.removed_at IS NULL AND m.merged_into_member_id IS NULL
      AND EXISTS (
        SELECT 1 FROM public.group_members me
        WHERE me.group_id = g.id AND me.profile_id = v_caller AND me.role = 'admin'
          AND me.left_at IS NULL AND me.removed_at IS NULL AND me.merged_into_member_id IS NULL
      );
    IF NOT FOUND THEN
      -- Missing and inaccessible ids deliberately have the same answer. Any
      -- failure aborts the statement, including earlier additions in this batch.
      RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = 'insufficient_privilege';
    END IF;
    source_member_id := v_id;
    member_id := public.waves_add_ghost_member(
      p_target_group, v_source.name, NULL, v_source.invite_email,
      CASE WHEN v_source.invite_phone LIKE '+%' THEN v_source.invite_phone ELSE NULL END,
      v_source.profile_id
    );
    RETURN NEXT;
  END LOOP;
END
$$;
REVOKE ALL ON FUNCTION public.waves_company_add_past_people(uuid, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.waves_company_add_past_people(uuid, uuid[]) TO authenticated, service_role;
