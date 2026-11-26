-- A saved UPI ID (or any payment handle / name / photo) never reached the other
-- members' settle screens.
--
-- The sync pull reads each member's profile embedded in their group_members
-- row, and only re-sends a group_members row when its `updated_seq` moved.
-- Saving a profile touched `profiles` alone, so no member row moved, the
-- cursor never refetched, and co-members kept the old (empty) handle until
-- something unrelated edited the membership.
--
-- Fix at the root: when the shown profile columns change, touch the person's
-- membership rows with a no-op write. `group_members_stamp_seq` (BEFORE UPDATE)
-- then stamps a fresh `updated_seq`, the next pull carries the row and its
-- embedded profile, and nothing else about the membership changes (the
-- activity trigger only logs joins, leaves and role changes).

CREATE OR REPLACE FUNCTION public.waves_profile_touch_memberships() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
BEGIN
  UPDATE public.group_members
     SET profile_id = profile_id
   WHERE profile_id = NEW.id
     AND left_at IS NULL;
  RETURN NEW;
END
$$;

REVOKE ALL ON FUNCTION public.waves_profile_touch_memberships() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.waves_profile_touch_memberships() TO service_role;

DROP TRIGGER IF EXISTS profiles_touch_memberships ON public.profiles;
CREATE TRIGGER profiles_touch_memberships
    AFTER UPDATE OF display_name, avatar_url, default_vpa, payment_rail, payment_handle ON public.profiles
    FOR EACH ROW
    WHEN (OLD.display_name IS DISTINCT FROM NEW.display_name
       OR OLD.avatar_url IS DISTINCT FROM NEW.avatar_url
       OR OLD.default_vpa IS DISTINCT FROM NEW.default_vpa
       OR OLD.payment_rail IS DISTINCT FROM NEW.payment_rail
       OR OLD.payment_handle IS DISTINCT FROM NEW.payment_handle)
    EXECUTE FUNCTION public.waves_profile_touch_memberships();
