-- ═══════════════ Taking a number or an address off an account, and the week after ══
--
-- Somebody can now remove the phone number or the email on their account
-- (`contact-unlink`). Two rules come with that, and both live here, in the
-- database, rather than in the app or only in the edge function:
--
--   1. **Seven days, both ways.** A contact can be taken off only once it has
--      been on the account for seven days (its `*_confirmed_at`), and after it
--      is taken off, no new one on that channel can go on for seven days. A
--      stolen, unlocked phone is the case this is for: without the first half,
--      whoever holds it adds their own number and removes the owner's in one
--      sitting; without the second, they remove the owner's and add their own
--      straight after. A week is long enough for the owner to notice and get the
--      account back, and short enough that somebody honestly changing numbers is
--      not stuck.
--   2. **Never the last way in.** An account with no confirmed email, no
--      confirmed phone and no Google or Apple identity cannot be signed back
--      into by anybody, including its owner — every group, expense and balance
--      in it is stranded. The unlink is refused rather than allowed to do that.
--
-- Why SQL for the write itself: GoTrue's admin `updateUserById` ignores an empty
-- string, so there is no way through the API to *clear* a phone or an email. And
-- the check and the write have to be one transaction with the row locked, or two
-- unlinks racing — the phone from one device, the email from another — each see
-- the other channel still there and together leave nothing.
--
-- Phone-based discovery (`waves_find_person`, `waves_person_profile`) reads the
-- number straight off `auth.users`, and keeps no copy of its own, so clearing it
-- there is also what stops an unlinked number finding this account.

-- ─────────────────────────────────────── when each channel was last cleared ──

-- One row per account and channel, holding the *latest* unlink: a second unlink
-- on the same channel moves the date forward rather than adding a row. Read by
-- the relink guard below, and by the app, which shows "you can add a new one
-- from <date>" off the caller's own row.
CREATE TABLE public.contact_unlinks (
  user_id     uuid        NOT NULL,
  channel     text        NOT NULL,
  unlinked_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT contact_unlinks_pkey PRIMARY KEY (user_id, channel),
  CONSTRAINT contact_unlinks_channel_check CHECK (channel IN ('phone', 'email'))
);

COMMENT ON TABLE public.contact_unlinks IS
  'The latest time each account took a phone or email off itself. A new one on that channel waits seven days.';

-- Read-your-own and nothing else. Written only by `waves_unlink_contact`, as the
-- definer: a client able to insert here could lock itself out of adding a number
-- (harmless), and one able to delete here could lift its own cooldown (not).
ALTER TABLE public.contact_unlinks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.contact_unlinks FROM PUBLIC, anon, authenticated;

-- `waves_current_profile_id()` rather than `auth.uid()`, like every other policy
-- in this schema: it reads the same JWT `sub`, and it exists on the bare
-- Postgres CI migrates, where `auth.uid()` does not.
CREATE POLICY contact_unlinks_own ON public.contact_unlinks FOR SELECT TO authenticated
  USING (user_id = public.waves_current_profile_id());

GRANT SELECT ON TABLE public.contact_unlinks TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.contact_unlinks TO service_role;

-- ────────────────────────────────────────────────── when a channel reopens ──

-- The moment a new contact may go on this channel again, or NULL when it
-- already may. One definition of the window, used by the guard trigger and asked
-- for by `phone-verify` *before* it spends anybody's Firebase proof or daily
-- allowance on an attach the trigger would only refuse.
CREATE FUNCTION public.waves_contact_relink_open_at(p_user uuid, p_channel text)
RETURNS timestamptz
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT cu.unlinked_at + interval '7 days'
    FROM public.contact_unlinks cu
   WHERE cu.user_id = p_user
     AND cu.channel = p_channel
     AND cu.unlinked_at + interval '7 days' > now();
$$;

COMMENT ON FUNCTION public.waves_contact_relink_open_at(uuid, text) IS
  'When a new phone/email may be linked again after an unlink, or NULL if it already may.';

REVOKE ALL ON FUNCTION public.waves_contact_relink_open_at(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.waves_contact_relink_open_at(uuid, text) TO service_role;

-- ──────────────────────────────────────────────────────────── the unlink ──

-- Checks both rules and, only if both pass, clears the channel — all under a
-- row lock on the account, so a concurrent unlink of the other channel waits
-- and then re-reads what this one left behind.
--
-- A refusal is an answer, not an error, so it comes back as data:
--
--   {"unlinked": true}
--   {"refused": "NOT_LINKED"}
--   {"refused": "TOO_SOON", "unlock_at": "<timestamptz>"}
--   {"refused": "LAST_SIGN_IN"}
--
-- and only a bad argument or a database without `auth` raises. The edge
-- function maps each refusal to its 409; nothing else calls this — it takes the
-- account as an argument, so it is service_role only, and the caller's id comes
-- from their verified JWT in the function, never from the request body.
--
-- What "linked" means is the value *and* its confirmation: a channel whose
-- `*_confirmed_at` is empty was never proved, is not a way in, and has no date
-- the seven days could run from.
--
-- What is cleared, per channel:
--   * the value and its confirmation on `auth.users` — which is also what drops
--     it from discovery;
--   * any change to it in flight (`phone_change` / `email_change` and their
--     tokens), so a half-finished change cannot land the old flow afterwards;
--   * for email, the confirmation and recovery tokens — a reset link already
--     sitting in the old inbox must not still open the account;
--   * GoTrue's `auth.identities` row for the channel, and the channel's entry in
--     `raw_app_meta_data.providers`, which GoTrue would otherwise keep reporting.
--
-- plpgsql, so a body naming `auth.*` columns compiles on bare Postgres where
-- there are none; it refuses to run there rather than answering something.
CREATE FUNCTION public.waves_unlink_contact(p_user uuid, p_channel text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_value          text;
  v_confirmed_at   timestamptz;
  v_other_ok       boolean;
  v_oauth          boolean := false;
  v_unlock_at      timestamptz;
  v_providers      jsonb;
BEGIN
  IF p_user IS NULL THEN
    RAISE EXCEPTION 'waves_unlink_contact needs a user';
  END IF;
  IF p_channel IS NULL OR p_channel NOT IN ('phone', 'email') THEN
    RAISE EXCEPTION 'UNKNOWN_CHANNEL: unlink a phone or an email';
  END IF;
  IF to_regclass('auth.users') IS NULL THEN
    RAISE EXCEPTION 'waves_unlink_contact needs auth.users';
  END IF;

  -- The lock is the point: see the header.
  IF p_channel = 'phone' THEN
    SELECT nullif(btrim(coalesce(u.phone, '')), ''),
           u.phone_confirmed_at,
           (nullif(btrim(coalesce(u.email, '')), '') IS NOT NULL
             AND u.email_confirmed_at IS NOT NULL)
      INTO v_value, v_confirmed_at, v_other_ok
      FROM auth.users u
     WHERE u.id = p_user
       FOR UPDATE;
  ELSE
    SELECT nullif(btrim(coalesce(u.email, '')), ''),
           u.email_confirmed_at,
           (nullif(btrim(coalesce(u.phone, '')), '') IS NOT NULL
             AND u.phone_confirmed_at IS NOT NULL)
      INTO v_value, v_confirmed_at, v_other_ok
      FROM auth.users u
     WHERE u.id = p_user
       FOR UPDATE;
  END IF;

  IF NOT FOUND OR v_value IS NULL OR v_confirmed_at IS NULL THEN
    RETURN jsonb_build_object('refused', 'NOT_LINKED');
  END IF;

  -- Rule one, first half: on the account for a week before it can come off.
  v_unlock_at := v_confirmed_at + interval '7 days';
  IF v_unlock_at > now() THEN
    RETURN jsonb_build_object('refused', 'TOO_SOON', 'unlock_at', v_unlock_at);
  END IF;

  -- Rule two: something must still open the account afterwards. Google and
  -- Apple are the social sign-ins this app offers; an identity for either is a
  -- way in on its own, whatever happens to the email beside it.
  IF to_regclass('auth.identities') IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1 FROM auth.identities i
       WHERE i.user_id = p_user
         AND i.provider IN ('google', 'apple')
    ) INTO v_oauth;
  END IF;

  IF NOT (v_other_ok OR v_oauth) THEN
    RETURN jsonb_build_object('refused', 'LAST_SIGN_IN');
  END IF;

  -- The write. NULL rather than '' for the value: GoTrue's unique indexes on
  -- phone and email are over non-null values, and '' would be one more account
  -- "holding" the empty number.
  IF p_channel = 'phone' THEN
    UPDATE auth.users
       SET phone                = NULL,
           phone_confirmed_at   = NULL,
           phone_change         = '',
           phone_change_token   = '',
           phone_change_sent_at = NULL
     WHERE id = p_user;
  ELSE
    UPDATE auth.users
       SET email                       = NULL,
           email_confirmed_at          = NULL,
           email_change                = '',
           email_change_token_new      = '',
           email_change_token_current  = '',
           email_change_confirm_status = 0,
           email_change_sent_at        = NULL,
           confirmation_token          = '',
           confirmation_sent_at        = NULL,
           recovery_token              = '',
           recovery_sent_at            = NULL
     WHERE id = p_user;
  END IF;

  IF to_regclass('auth.identities') IS NOT NULL THEN
    DELETE FROM auth.identities WHERE user_id = p_user AND provider = p_channel;
  END IF;

  -- Newer GoTrue keeps the live tokens in their own table too; the columns above
  -- are the older home for the same thing. Both go.
  IF to_regclass('auth.one_time_tokens') IS NOT NULL THEN
    IF p_channel = 'phone' THEN
      EXECUTE $q$DELETE FROM auth.one_time_tokens
                 WHERE user_id = $1 AND token_type::text = 'phone_change_token'$q$
        USING p_user;
    ELSE
      EXECUTE $q$DELETE FROM auth.one_time_tokens
                 WHERE user_id = $1
                   AND token_type::text IN ('confirmation_token', 'recovery_token',
                                            'email_change_token_new', 'email_change_token_current')$q$
        USING p_user;
    END IF;
  END IF;

  -- `providers` is what GoTrue reports as the ways this account signs in; left
  -- alone it would go on listing the channel just removed.
  SELECT u.raw_app_meta_data -> 'providers' INTO v_providers FROM auth.users u WHERE u.id = p_user;
  IF v_providers IS NOT NULL AND jsonb_typeof(v_providers) = 'array' THEN
    SELECT coalesce(jsonb_agg(e.value), '[]'::jsonb)
      INTO v_providers
      FROM jsonb_array_elements(v_providers) AS e(value)
     WHERE e.value <> to_jsonb(p_channel);

    UPDATE auth.users u
       SET raw_app_meta_data = CASE
             WHEN u.raw_app_meta_data ->> 'provider' = p_channel AND jsonb_array_length(v_providers) > 0
               THEN jsonb_set(jsonb_set(u.raw_app_meta_data, '{providers}', v_providers),
                              '{provider}', v_providers -> 0)
             ELSE jsonb_set(u.raw_app_meta_data, '{providers}', v_providers)
           END
     WHERE u.id = p_user;
  END IF;

  -- Rule one, second half, starts now.
  INSERT INTO public.contact_unlinks (user_id, channel, unlinked_at)
  VALUES (p_user, p_channel, now())
  ON CONFLICT (user_id, channel) DO UPDATE SET unlinked_at = excluded.unlinked_at;

  RETURN jsonb_build_object('unlinked', true);
END;
$$;

COMMENT ON FUNCTION public.waves_unlink_contact(uuid, text) IS
  'Takes the phone or email off an account: refused inside 7 days of linking, and when it is the last way in.';

REVOKE ALL ON FUNCTION public.waves_unlink_contact(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.waves_unlink_contact(uuid, text) TO service_role;

-- ──────────────────────────────────────────── nothing new for seven days ──

-- The second half of rule one, enforced on the table every path writes through:
-- `phone-verify`'s admin attach, GoTrue's own phone change, GoTrue's email
-- change. A check in each of those callers would be three checks and one missed;
-- a trigger on `auth.users` is one check nobody can route around.
--
-- Fires only when a channel is being *given* a value it did not have: a
-- non-empty `phone`/`email` different from the old one, or a non-empty pending
-- `phone_change`/`email_change` (refused at the request, rather than after the
-- person has gone and fetched a code). Everything else GoTrue writes on every
-- sign-in — `last_sign_in_at`, metadata, tokens — goes past untouched, and so
-- does the unlink itself, which only ever sets these to NULL or ''.
--
-- One carve-out, and it is about lockout rather than convenience: an email that
-- GoTrue copies onto the account from the person's own Google or Apple identity.
-- Refusing that would fail a social sign-in outright — the one way in the
-- account may have left — to protect an address they have already proved.
--
-- Raises `CONTACT_RELINK_COOLDOWN` (P0001). GoTrue reports it as a generic
-- database error; `phone-verify` asks `waves_contact_relink_open_at` up front
-- so the person is told what is actually going on.
CREATE FUNCTION public.waves_contact_relink_guard()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_new_phone  text := nullif(btrim(coalesce(NEW.phone, '')), '');
  v_new_email  text := nullif(btrim(coalesce(NEW.email, '')), '');
  v_new_pchg   text := nullif(btrim(coalesce(NEW.phone_change, '')), '');
  v_new_echg   text := nullif(btrim(coalesce(NEW.email_change, '')), '');
  v_open_at    timestamptz;
BEGIN
  IF (v_new_phone IS NOT NULL AND v_new_phone IS DISTINCT FROM nullif(btrim(coalesce(OLD.phone, '')), ''))
     OR (v_new_pchg IS NOT NULL AND v_new_pchg IS DISTINCT FROM nullif(btrim(coalesce(OLD.phone_change, '')), ''))
  THEN
    v_open_at := public.waves_contact_relink_open_at(NEW.id, 'phone');
    IF v_open_at IS NOT NULL THEN
      RAISE EXCEPTION 'CONTACT_RELINK_COOLDOWN: a new phone can be added from %', v_open_at
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  IF (v_new_email IS NOT NULL AND lower(v_new_email) IS DISTINCT FROM lower(nullif(btrim(coalesce(OLD.email, '')), '')))
     OR (v_new_echg IS NOT NULL AND lower(v_new_echg) IS DISTINCT FROM lower(nullif(btrim(coalesce(OLD.email_change, '')), '')))
  THEN
    v_open_at := public.waves_contact_relink_open_at(NEW.id, 'email');
    IF v_open_at IS NOT NULL
       AND NOT (
         v_new_echg IS NULL
         AND to_regclass('auth.identities') IS NOT NULL
         AND EXISTS (
           SELECT 1 FROM auth.identities i
            WHERE i.user_id = NEW.id
              AND i.provider IN ('google', 'apple')
              AND lower(i.identity_data ->> 'email') = lower(v_new_email)
         )
       )
    THEN
      RAISE EXCEPTION 'CONTACT_RELINK_COOLDOWN: a new email can be added from %', v_open_at
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  RETURN NEW;
END
$$;

-- Invoked by the trigger as the definer, never called. Stated per
-- `scripts/check-definer-grants.mjs`, the same ACL `waves_handle_new_user` has.
REVOKE ALL ON FUNCTION public.waves_contact_relink_guard() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.waves_contact_relink_guard() TO service_role;

-- Guarded on `auth.users` existing: CI and the drift check migrate a bare
-- Postgres with no `auth` schema, where this is correctly a no-op. The WHEN
-- clause keeps the function from even being entered on the ordinary sign-in
-- writes that touch none of the four columns.
DO $$
BEGIN
  IF to_regclass('auth.users') IS NULL THEN
    RAISE NOTICE 'no auth.users (bare Postgres) — contact relink guard skipped';
    RETURN;
  END IF;

  -- A test database can carry a stub `auth.users` left by a suite, with only
  -- the few columns that suite needed. The WHEN clause below names four
  -- columns, and CREATE TRIGGER fails outright on a missing one; GoTrue's real
  -- table has all four, so anything short of that is a stub and is skipped.
  IF (SELECT count(*) FROM information_schema.columns
       WHERE table_schema = 'auth' AND table_name = 'users'
         AND column_name IN ('phone', 'email', 'phone_change', 'email_change')) < 4 THEN
    RAISE NOTICE 'auth.users is a stub without the contact columns — contact relink guard skipped';
    RETURN;
  END IF;

  DROP TRIGGER IF EXISTS waves_contact_relink_guard ON auth.users;

  CREATE TRIGGER waves_contact_relink_guard
    BEFORE UPDATE ON auth.users
    FOR EACH ROW
    WHEN (NEW.phone IS DISTINCT FROM OLD.phone
       OR NEW.email IS DISTINCT FROM OLD.email
       OR NEW.phone_change IS DISTINCT FROM OLD.phone_change
       OR NEW.email_change IS DISTINCT FROM OLD.email_change)
    EXECUTE FUNCTION public.waves_contact_relink_guard();
END
$$;
