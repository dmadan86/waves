-- Muting one group.
--
-- The "involves me" switch on the notifications screen is all or nothing: it
-- silences every group at once. A busy flatshare and a trip that matters are
-- not the same, so a person can now mute one group and keep hearing from the
-- rest — the WhatsApp gesture for a chat that talks too much.
--
-- A mute is a pin's twin (20260912193000_group_pins), and deliberately so.
-- It is one person's opinion about a group, not a property of it: written on
-- `groups` or `group_members` it would ride those rows' seq to every other
-- member's phone, and the group would learn who had muted it. So it gets its
-- own owner-scoped table, seq-stamped like pins, riding a seventh personal sync
-- scope (`<user>:group_mutes`), readable and writable only by its owner. Every
-- reason that file gives for the shape — no foreign key to `groups`, a derived
-- row id, soft deletes — holds here unchanged, for the same offline-queue
-- reasons.
--
-- What a mute does lives in `waves_claim_push_notifications`, below: pushes
-- about that group are suppressed at claim time. The notification rows are
-- still written, so the in-app inbox is untouched.

ALTER TABLE public.profiles ADD COLUMN group_mutes_seq bigint DEFAULT 0 NOT NULL;

CREATE TABLE public.group_mutes (
    id uuid NOT NULL,
    owner_user_id uuid NOT NULL,
    group_id uuid NOT NULL,
    updated_seq bigint DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone
);

COMMENT ON TABLE public.group_mutes IS 'One person''s mute on one group: pushes about it are not sent to them. Personal — the other members never see it, and it changes nothing about the group.';

ALTER TABLE ONLY public.group_mutes ADD CONSTRAINT group_mutes_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.group_mutes
    ADD CONSTRAINT group_mutes_owner_user_id_fkey FOREIGN KEY (owner_user_id)
    REFERENCES public.profiles(id) ON UPDATE CASCADE ON DELETE CASCADE;

-- One live mute per person per group; the client derives the id from (owner,
-- group), and this makes that a guarantee. Partial, so unmute-then-mute re-uses
-- the row rather than colliding with its own tombstone.
CREATE UNIQUE INDEX group_mutes_owner_group_idx ON public.group_mutes
  USING btree (owner_user_id, group_id) WHERE (deleted_at IS NULL);

-- The pull's index, and the claim's: both ask "this owner's rows".
CREATE INDEX group_mutes_owner_user_id_updated_seq_idx ON public.group_mutes
  USING btree (owner_user_id, updated_seq);

-- Its own counter on `profiles`, so muting never moves another scope's cursor.
CREATE FUNCTION public.waves_next_group_mute_seq(p_owner uuid) RETURNS bigint
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_seq bigint;
BEGIN
  UPDATE public.profiles
     SET group_mutes_seq = group_mutes_seq + 1
   WHERE id = p_owner
   RETURNING group_mutes_seq INTO v_seq;
  RETURN COALESCE(v_seq, 0);
END
$$;

REVOKE ALL ON FUNCTION public.waves_next_group_mute_seq(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.waves_next_group_mute_seq(uuid) TO service_role;

CREATE FUNCTION public.waves_stamp_group_mute_seq() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
BEGIN
  NEW.updated_seq := public.waves_next_group_mute_seq(NEW.owner_user_id);
  RETURN NEW;
END
$$;

REVOKE ALL ON FUNCTION public.waves_stamp_group_mute_seq() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.waves_stamp_group_mute_seq() TO service_role;

-- On UPDATE too, so an unmute (a tombstone) reaches the owner's other devices.
CREATE TRIGGER group_mutes_stamp_seq BEFORE INSERT OR UPDATE ON public.group_mutes
  FOR EACH ROW EXECUTE FUNCTION public.waves_stamp_group_mute_seq();

-- Your mutes are yours: nobody else in the group can read or write them.
ALTER TABLE public.group_mutes ENABLE ROW LEVEL SECURITY;

CREATE POLICY group_mutes_own ON public.group_mutes TO authenticated
  USING ((owner_user_id = public.waves_current_profile_id()))
  WITH CHECK ((owner_user_id = public.waves_current_profile_id()));

-- No DELETE for `authenticated`: unmuting is a soft delete, so it syncs.
GRANT SELECT, INSERT, UPDATE ON TABLE public.group_mutes TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.group_mutes TO service_role;

-- ─────────────────────────────────────── the claim, now reading mutes ──
--
-- Unchanged from 20260908120000 except for the block marked "a group this
-- person has muted".
CREATE OR REPLACE FUNCTION public.waves_claim_push_notifications(p_limit integer DEFAULT 200)
RETURNS TABLE(id uuid, kind text, title text, body text, deep_link text, payload jsonb, locale text, tokens text[])
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_ids UUID[];
BEGIN
  -- `FOR UPDATE SKIP LOCKED` is what lets two runs overlap harmlessly: the
  -- second finds the rows locked and moves on rather than sending them
  -- again. A first try (`push_status IS NULL`) and a retry (`failed`, under
  -- 3 attempts, backoff elapsed) are the same claim, differing only in which
  -- half of the WHERE let the row through.
  WITH picked AS (
    SELECT n.id
    FROM public.notifications n
    WHERE (
            n.push_status IS NULL
         OR (n.push_status = 'failed'
             AND n.push_attempts < 3
             AND n.push_next_retry_at IS NOT NULL
             AND n.push_next_retry_at <= now())
          )
      -- Anything older than this was missed while the fanout was down, and a
      -- buzz about a two-day-old reminder is worse than silence.
      AND n.created_at > now() - interval '2 days'
    ORDER BY n.created_at
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  ),
  claimed AS (
    UPDATE public.notifications n
       SET push_status = 'queued'
      FROM picked
     WHERE n.id = picked.id
    RETURNING n.id
  )
  SELECT COALESCE(array_agg(claimed.id), '{}') INTO v_ids FROM claimed;

  -- ── new: the four switches on the notifications screen ──────────────────
  --
  -- Absent key means on: `DEFAULT_NOTIFICATION_PREFS` has all four true, and a
  -- profile written before a switch existed must not be read as having turned
  -- it off. A kind with no mapping, and a kind mapped to NULL, both fall
  -- through untouched.
  UPDATE public.notifications n
     SET push_status = 'suppressed',
         push_next_retry_at = NULL
   WHERE n.id = ANY(v_ids)
     AND public.waves_pref_key_for_kind(n.kind) IS NOT NULL
     AND NOT COALESCE(
           (SELECT (p.notification_prefs ->> public.waves_pref_key_for_kind(n.kind))::boolean
              FROM public.profiles p WHERE p.id = n.profile_id),
           TRUE
         );

  -- ── new: a group this person has muted ─────────────────────────────────
  --
  -- A live row in `group_mutes` for (recipient, the notification's group)
  -- silences the push, whatever the kind: muting a group means "stop buzzing me
  -- about this group", like muting a chat. The row in `notifications` stays —
  -- the inbox still lists it — which is the same line the switches above draw.
  -- A notification with no group (a new-device login, the digests) is never
  -- touched by a mute.
  UPDATE public.notifications n
     SET push_status = 'suppressed',
         push_next_retry_at = NULL
   WHERE n.id = ANY(v_ids)
     AND n.push_status = 'queued'
     AND n.group_id IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM public.group_mutes m
        WHERE m.owner_user_id = n.profile_id
          AND m.group_id = n.group_id
          AND m.deleted_at IS NULL
     );

  -- A separate statement: Postgres will not apply two updates to the same
  -- row inside one statement, so folding this into the CTE above would
  -- silently do nothing.
  --
  -- No device is a decision, not a failure — closed out terminally
  -- (`push_next_retry_at` cleared, not just `push_status`) rather than left
  -- retryable, or it would sit in the claim's way on every future run.
  -- `push_attempts` is left alone: a new token showing up later is a
  -- different signal than time passing, and not this branch's business.
  UPDATE public.notifications n
     SET push_status = 'failed',
         push_next_retry_at = NULL
   WHERE n.id = ANY(v_ids)
     AND n.push_status = 'queued'
     AND NOT EXISTS (
       SELECT 1 FROM public.push_tokens t
       WHERE t.profile_id = n.profile_id AND t.revoked_at IS NULL
     );

  RETURN QUERY
  SELECT n.id, n.kind, n.title, n.body, n.deep_link, n.payload,
         COALESCE(p.locale, 'en'),
         ARRAY_AGG(t.expo_push_token)
  FROM public.notifications n
  LEFT JOIN public.profiles p ON p.id = n.profile_id
  JOIN public.push_tokens t
    ON t.profile_id = n.profile_id AND t.revoked_at IS NULL
  WHERE n.id = ANY(v_ids) AND n.push_status = 'queued'
  GROUP BY n.id, n.kind, n.title, n.body, n.deep_link, n.payload, p.locale;
END
$$;

REVOKE ALL ON FUNCTION public.waves_claim_push_notifications(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.waves_claim_push_notifications(integer) TO service_role;

