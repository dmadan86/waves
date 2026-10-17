-- When did I last nudge each person in this group?
--
-- The Remind sheet wants to say "Already reminded today" before the tap, not
-- after it. `waves_nudge_to_settle` stays the one writer and the one judge (the
-- reminders trigger refuses a second nudge inside a day); this is a read-only
-- view of the same rows so the client can show the limit up front.
--
-- Caller model: SECURITY INVOKER. The caller's own RLS applies
-- (`reminders_select` = is_group_member), so a non-member gets no rows; the
-- function narrows further to the nudges the caller sent. Not reachable by anon.

CREATE OR REPLACE FUNCTION public.waves_my_nudge_times(p_group_id uuid)
RETURNS TABLE (to_member_id uuid, last_nudged_at timestamptz)
    LANGUAGE sql STABLE SECURITY INVOKER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  SELECT r.to_member_id, r.last_nudged_at
    FROM public.reminders r
    JOIN public.group_members gm ON gm.id = r.from_member_id
   WHERE r.group_id = p_group_id
     AND r.last_nudged_at IS NOT NULL
     AND gm.profile_id = public.waves_current_profile_id();
$$;

REVOKE ALL ON FUNCTION public.waves_my_nudge_times(p_group_id uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.waves_my_nudge_times(p_group_id uuid) TO authenticated, service_role;
