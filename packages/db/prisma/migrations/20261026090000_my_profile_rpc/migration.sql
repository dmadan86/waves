-- The owner's own profile, all columns. Clients read their address and
-- notification prefs through this so the column lock in
-- 20261026100000_private_profile_columns can land later without breaking them.
CREATE OR REPLACE FUNCTION public.waves_my_profile() RETURNS SETOF public.profiles
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT * FROM public.profiles WHERE id = public.waves_current_profile_id();
$$;
REVOKE ALL ON FUNCTION public.waves_my_profile() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.waves_my_profile() TO authenticated;
