-- waves_merge_ghosts: the merged person keeps a chosen phone and email, too.
--
-- The merge screen's confirm sheet ("Keep which details?") now asks which name,
-- which phone number and which email the merged person keeps. The name was
-- always the RPC's to keep (`ghost_merges.display_name`, per viewer); the
-- contact lives on the memberships themselves (`group_members.invite_phone`,
-- `group_members.invite_email`), which is what every screen reads a guest's
-- number and address from. So the chosen contact is written onto every ghost
-- membership the merge folds, and the merged person reads as one number
-- everywhere rather than whichever row a screen happened to look at first.
--
-- That is not a new power. Any active member of a group may already UPDATE a
-- guest's row there (policy `group_members_update`), and the column guard
-- leaves the invite columns alone; the write below is restricted to exactly
-- those rows — ghosts, in groups the caller is still an active member of.
--
-- The two new parameters, each:
--   * NULL (the default) — leave every membership's value as it is. An older
--     app build calling with two arguments gets exactly the old behaviour.
--   * ''                 — "no phone" / "no email": cleared on every membership.
--   * anything else      — kept on every membership, after validation:
--       phone: non-digits other than '+' stripped (as `waves_add_ghost_member`
--              does), then it must already be one of the merged members'
--              numbers or be a valid E.164 number. A number with no country
--              code is refused (PHONE_NEEDS_COUNTRY_CODE) rather than guessed;
--              the app reads a bare national number in the caller's region
--              before it ever gets here.
--       email: trimmed and lowercased, then the same shape the column's CHECK
--              holds it to (EMAIL_NOT_VALID).
--
-- Compatibility: the two-argument signature is dropped and replaced by one
-- function whose extra parameters default to NULL. Postgres resolves a
-- two-argument call to it through the defaults, and PostgREST matches an RPC by
-- the named arguments it is sent ({p_member_ids, p_name} fits this function,
-- with the defaults filling the rest). Keeping the old signature beside it
-- would make that two-argument call ambiguous between the two, so there is
-- exactly one waves_merge_ghosts afterwards. The authenticated surface is the
-- same size: one function out, one in, same name.

DROP FUNCTION IF EXISTS public.waves_merge_ghosts(uuid[], text);

CREATE FUNCTION public.waves_merge_ghosts(
  p_member_ids uuid[],
  p_name text,
  p_phone text DEFAULT NULL,
  p_email text DEFAULT NULL
) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_profile_id uuid := public.waves_current_profile_id();
  v_name       text := nullif(btrim(coalesce(p_name, '')), '');
  -- NULL = leave alone; '' = clear; else the normalised value to keep.
  v_phone      text := CASE WHEN p_phone IS NULL THEN NULL
                            ELSE regexp_replace(p_phone, '[^0-9+]', '', 'g') END;
  v_email      text := CASE WHEN p_email IS NULL THEN NULL
                            ELSE lower(btrim(p_email)) END;
  v_canonical  uuid;
  v_count      int;
  v_bad        int;
BEGIN
  IF v_profile_id IS NULL THEN
    RAISE EXCEPTION 'NOT_SIGNED_IN'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Serialise this owner's merges for the rest of the transaction, so the
  -- canonical lookup below and the write that follows it are atomic against a
  -- concurrent merge that shares a member. Released on commit/rollback.
  PERFORM pg_advisory_xact_lock(hashtext('waves_merge_ghosts:' || v_profile_id::text)::bigint);

  IF v_name IS NULL THEN
    RAISE EXCEPTION 'NAME_REQUIRED: the merged person needs a name'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Distinct, non-null members actually asked for.
  SELECT count(DISTINCT t.id) INTO v_count
    FROM unnest(p_member_ids) AS t(id)
   WHERE t.id IS NOT NULL;

  IF v_count < 2 THEN
    RAISE EXCEPTION 'TOO_FEW: pick at least two people to merge'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Every id must be a ghost the caller shares a group with. Anything that is
  -- not — a real person, a member of a group the caller is not in, or an id that
  -- does not exist — makes the whole merge fail rather than merging a subset.
  SELECT count(*) INTO v_bad
    FROM unnest(p_member_ids) AS want(id)
   WHERE want.id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
         FROM public.group_members target
         JOIN public.group_members mine
           ON mine.group_id = target.group_id
          AND mine.profile_id = v_profile_id
          AND mine.left_at IS NULL
        WHERE target.id = want.id
          AND target.profile_id IS NULL
     );

  IF v_bad > 0 THEN
    RAISE EXCEPTION 'NOT_MERGEABLE: every person must be a guest you share a group with'
      USING ERRCODE = 'check_violation';
  END IF;

  -- The members explicitly picked this time.
  CREATE TEMP TABLE _sel ON COMMIT DROP AS
    SELECT DISTINCT m AS member_id
      FROM unnest(p_member_ids) AS m
     WHERE m IS NOT NULL;

  -- The contact to keep, checked before anything is written so a refusal
  -- leaves the merge unrecorded. A number one of the picked people already
  -- carries is accepted as it is; anything else must be valid E.164.
  IF v_phone IS NOT NULL AND v_phone <> '' AND NOT EXISTS (
    SELECT 1 FROM public.group_members gm
     WHERE gm.id IN (SELECT member_id FROM _sel)
       AND gm.invite_phone = v_phone
  ) THEN
    IF v_phone !~ '^\+' THEN
      RAISE EXCEPTION 'PHONE_NEEDS_COUNTRY_CODE: % has no country code', v_phone
        USING ERRCODE = 'check_violation';
    END IF;
    IF v_phone !~ '^\+[1-9][0-9]{7,14}$' THEN
      RAISE EXCEPTION 'PHONE_NOT_VALID: % is not a phone number', v_phone
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  IF v_email IS NOT NULL AND v_email <> ''
     AND v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN
    RAISE EXCEPTION 'EMAIL_NOT_VALID: that is not an email address'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Any existing merge groups that overlap the selection: reusing the lowest of
  -- their person_ids (uuid has no min() aggregate, so order and take one) keeps a
  -- repeated merge stable rather than churning. No overlap leaves it NULL.
  SELECT gm.person_id INTO v_canonical
    FROM public.ghost_merges gm
   WHERE gm.owner = v_profile_id
     AND gm.member_id IN (SELECT member_id FROM _sel)
   ORDER BY gm.person_id
   LIMIT 1;

  -- No overlap with a prior merge: this is a brand-new person.
  IF v_canonical IS NULL THEN
    v_canonical := gen_random_uuid();
  END IF;

  -- The full union: the picked members plus every member already sharing a
  -- person_id with any of them, so a transitive merge folds into one identity.
  CREATE TEMP TABLE _all ON COMMIT DROP AS
    SELECT member_id FROM _sel
    UNION
    SELECT gm.member_id
      FROM public.ghost_merges gm
     WHERE gm.owner = v_profile_id
       AND gm.person_id IN (
         SELECT gm2.person_id
           FROM public.ghost_merges gm2
          WHERE gm2.owner = v_profile_id
            AND gm2.member_id IN (SELECT member_id FROM _sel)
       );

  INSERT INTO public.ghost_merges (owner, member_id, person_id, display_name)
  SELECT v_profile_id, u.member_id, v_canonical, v_name
    FROM _all AS u
  ON CONFLICT (owner, member_id)
  DO UPDATE SET person_id    = EXCLUDED.person_id,
                display_name = EXCLUDED.display_name
  -- Keep created_at, and only write (firing the sync trigger) on a real change,
  -- so an identical re-merge stamps no new updated_seq.
  WHERE ghost_merges.person_id   IS DISTINCT FROM EXCLUDED.person_id
     OR ghost_merges.display_name IS DISTINCT FROM EXCLUDED.display_name;

  -- The kept contact, onto every membership the merged person now spans that
  -- the caller could edit by hand anyway: still a ghost (a member folded by an
  -- earlier merge may have been claimed since — their account's contact is
  -- theirs), in a group the caller is still an active member of. Only rows
  -- that actually change are written, so the sync stamp moves only for them.
  IF v_phone IS NOT NULL OR v_email IS NOT NULL THEN
    UPDATE public.group_members target
       SET invite_phone = CASE WHEN v_phone IS NULL THEN target.invite_phone
                               ELSE nullif(v_phone, '') END,
           invite_email = CASE WHEN v_email IS NULL THEN target.invite_email
                               ELSE nullif(v_email, '') END
     WHERE target.id IN (SELECT member_id FROM _all)
       AND target.profile_id IS NULL
       AND EXISTS (
         SELECT 1 FROM public.group_members mine
          WHERE mine.group_id = target.group_id
            AND mine.profile_id = v_profile_id
            AND mine.left_at IS NULL
       )
       AND (
         (v_phone IS NOT NULL AND target.invite_phone IS DISTINCT FROM nullif(v_phone, ''))
         OR (v_email IS NOT NULL AND target.invite_email IS DISTINCT FROM nullif(v_email, ''))
       );
  END IF;

  RETURN v_canonical;
END
$$;

REVOKE ALL ON FUNCTION public.waves_merge_ghosts(uuid[], text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.waves_merge_ghosts(uuid[], text, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.waves_merge_ghosts(uuid[], text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.waves_merge_ghosts(uuid[], text, text, text) TO service_role;
