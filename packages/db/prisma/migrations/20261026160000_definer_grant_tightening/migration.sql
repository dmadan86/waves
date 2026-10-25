-- Triggers run without caller EXECUTE privileges; remove direct client access.
DO $$
DECLARE
  v_function record;
BEGIN
  FOR v_function IN
    SELECT n.nspname, p.proname,
           pg_get_function_identity_arguments(p.oid) AS identity_arguments
    FROM pg_proc AS p
    JOIN pg_namespace AS n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prorettype = 'trigger'::regtype
  LOOP
    EXECUTE format(
      'REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated',
      format('%I.%I(%s)', v_function.nspname, v_function.proname,
             v_function.identity_arguments)
    );
  END LOOP;
END;
$$;

-- Internal helpers: only other definer functions or the service role call these.
-- (waves_scans_used_this_month and waves_assert_expense_caller stay: guarded / pinned by tests.)
REVOKE EXECUTE ON FUNCTION public.waves_profiles_share_group(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.waves_group_is_paid(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.waves_voice_stt_free_seconds() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.waves_member_group_id(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.waves_spend_person_lookup() FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.waves_profiles_share_group(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.waves_group_is_paid(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.waves_voice_stt_free_seconds() TO service_role;
GRANT EXECUTE ON FUNCTION public.waves_member_group_id(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.waves_spend_person_lookup() TO service_role;

-- User JWTs can only look up themselves; service/internal callers keep the argument.
CREATE OR REPLACE FUNCTION public.waves_my_member_id_for(p_group_id uuid, p_profile_id uuid) RETURNS uuid
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  SELECT id FROM public.group_members
   WHERE group_id = p_group_id
     AND profile_id = CASE
       WHEN COALESCE(NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '') IN ('anon', 'authenticated')
         THEN public.waves_current_profile_id()
       ELSE p_profile_id
     END
     AND left_at IS NULL
   LIMIT 1;
$$;

REVOKE EXECUTE ON FUNCTION public.waves_my_member_id_for(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.waves_my_member_id_for(uuid, uuid) TO authenticated, service_role;
