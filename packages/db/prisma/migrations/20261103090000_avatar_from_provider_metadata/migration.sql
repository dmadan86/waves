-- A provider photo reaches profiles.avatar_url on every path, not only sign-up.
--
-- waves_handle_new_user() copied the photo at INSERT, but an email sign-up has
-- none yet; linking Google later fires waves_handle_user_named(), which only
-- offered the NAME. The profile kept avatar_url NULL, so the owner saw their
-- photo on Profile (session metadata) while every group showed initials.
--
-- Only http(s) URLs, and only over NULL: a photo the user uploaded or chose is
-- never overwritten, and "Remove photo" now writes '' (not NULL) so a removal
-- is not refilled from provider metadata.

CREATE OR REPLACE FUNCTION public.waves_metadata_avatar(p_meta jsonb)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT u
    FROM unnest(ARRAY[p_meta ->> 'avatar_url', p_meta ->> 'picture']) WITH ORDINALITY AS c(u, n)
   WHERE u ~* '^https?://'
   ORDER BY n
   LIMIT 1
$$;

REVOKE ALL ON FUNCTION public.waves_metadata_avatar(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.waves_metadata_avatar(jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.waves_handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  INSERT INTO public.profiles (id, display_name, avatar_url, locale)
  VALUES (
    NEW.id,
    COALESCE(
      NULLIF(NEW.raw_user_meta_data ->> 'display_name', ''),
      NULLIF(NEW.raw_user_meta_data ->> 'full_name', ''),
      NULLIF(NEW.raw_user_meta_data ->> 'name', ''),
      -- ADR-006: anonymous guests get an account too, just an unnamed one.
      'Guest'
    ),
    public.waves_metadata_avatar(NEW.raw_user_meta_data),
    COALESCE(NULLIF(NEW.raw_user_meta_data ->> 'locale', ''), 'en')
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END
$function$;

REVOKE ALL ON FUNCTION public.waves_handle_new_user() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.waves_handle_new_user() TO service_role;

CREATE OR REPLACE FUNCTION public.waves_avatar_over_null(p_user uuid, p_meta jsonb)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_url  text := public.waves_metadata_avatar(p_meta);
  v_rows integer;
BEGIN
  IF v_url IS NULL THEN
    RETURN FALSE;
  END IF;
  UPDATE public.profiles
     SET avatar_url = v_url
   WHERE id = p_user
     AND avatar_url IS NULL;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows > 0;
END
$function$;

REVOKE ALL ON FUNCTION public.waves_avatar_over_null(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.waves_avatar_over_null(uuid, jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.waves_handle_user_named()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  -- An account nobody has claimed keeps the placeholder: "Guest" is the honest
  -- word for an anonymous session, and this is only about the accounts where it
  -- has stopped being true. A guest who upgrades passes here twice — once when
  -- the metadata arrives and is refused, and again when the confirmation clears
  -- `is_anonymous`, which is why that column is in the trigger's UPDATE OF list.
  IF NEW.is_anonymous THEN
    RETURN NEW;
  END IF;

  PERFORM public.waves_name_over_placeholder(NEW.id, NEW.raw_user_meta_data);
  PERFORM public.waves_avatar_over_null(NEW.id, NEW.raw_user_meta_data);
  RETURN NEW;
END
$function$;

REVOKE ALL ON FUNCTION public.waves_handle_user_named() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.waves_handle_user_named() TO service_role;

-- One-off: profiles that never got the photo their account already carries.
-- Dynamic SQL behind the same stub-schema guard the name migration uses.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'auth' AND table_name = 'users' AND column_name = 'is_anonymous'
  ) THEN
    RAISE NOTICE 'no real auth.users - avatar backfill skipped';
    RETURN;
  END IF;
  EXECUTE $q$
    UPDATE public.profiles p
       SET avatar_url = public.waves_metadata_avatar(u.raw_user_meta_data)
      FROM auth.users u
     WHERE u.id = p.id
       AND p.avatar_url IS NULL
       AND NOT COALESCE(u.is_anonymous, FALSE)
       AND public.waves_metadata_avatar(u.raw_user_meta_data) IS NOT NULL
  $q$;
END
$$;
