-- The group you open every day, sorted wherever the ledger happened to put it.
--
-- Both places Waves lists groups sort by what the *money* is doing: the
-- dashboard's preview and the All-groups screen put the debts first and the
-- settled ones below. That is the right default and it is not the only truth.
-- The flatshare somebody opens twice a day is usually settled, so it falls to
-- the bottom of the screen it is most often reached from — and the dashboard
-- shows only the first handful before "All groups ›", so a quiet group can be
-- pushed off the home screen entirely by a trip that ended in March.
--
-- So: a pin. One effect and no others — a pinned group sorts to the top and
-- stays there. Deliberately not a star, a favourite or a filter: there is no
-- Favourites tab to open, no collection to curate, nothing to keep in step.
-- Ordering is the whole feature, which is why it can be a single boolean fact
-- per person per group and needs no column anywhere else.

-- ──────────────────────────────────── why this is not a column on `groups` ──
--
-- The obvious place to put a flag about a group is on the group, and it is the
-- wrong place for this one. `public.groups` is shared: every member reads the
-- same row, and `groups_stamp_seq` broadcasts any change to all of their
-- mirrors. A pin written there would mean one person tidying their own home
-- screen reordered everybody else's — and it would be refused anyway, because
-- `waves_guard_group_columns` (20260910090000) is an allowlist and a column
-- added later is refused by default until somebody names it there.
--
-- That refusal would be correct. A pin is not a property of the group; it is
-- one person's opinion about it. So it lives in its own owner-scoped table,
-- seq-stamped exactly like `captures`, `category_tags`, `personal_records` and
-- `pack_installs`, and rides the personal sync scope those already established
-- rather than inventing a second kind of ownership. Nothing about `groups`
-- changes here, and `waves_guard_group_columns` is deliberately untouched.

ALTER TABLE public.profiles ADD COLUMN group_pins_seq bigint DEFAULT 0 NOT NULL;

CREATE TABLE public.group_pins (
    id uuid NOT NULL,
    owner_user_id uuid NOT NULL,
    group_id uuid NOT NULL,
    updated_seq bigint DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone
);

COMMENT ON TABLE public.group_pins IS 'One person''s pin on one group: it sorts to the top of their own group lists. Personal — the other members never see it, and it changes nothing about the group.';

ALTER TABLE ONLY public.group_pins ADD CONSTRAINT group_pins_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.group_pins
    ADD CONSTRAINT group_pins_owner_user_id_fkey FOREIGN KEY (owner_user_id)
    REFERENCES public.profiles(id) ON UPDATE CASCADE ON DELETE CASCADE;

-- ──────────────────────────────── and why `group_id` carries no foreign key ──
--
-- `pack_installs` references `packs`, and the symmetric thing here would be a
-- reference to `groups`. It is left off on purpose, and the reason is the
-- offline queue rather than tidiness.
--
-- A pin rides a *personal* scope (`<user>:group_pins`); a group's creation rides
-- the *group's* scope. `nextBatch` blocks per scope, so the two are independent
-- by design, and a group made offline and pinned in the same breath can reach
-- the server with the pin first — the create is the heavier mutation and one
-- backoff is all it takes. With a foreign key that pin is refused for a group
-- that is about to exist, and a refusal in this app is not a quiet no-op: it
-- stops that scope, puts a red mark on the sync banner, and asks a person to
-- decide about it. Refusing somebody's tidying-up because their group had not
-- finished uploading would be a worse bug than the one the constraint prevents.
--
-- What the missing key costs is a pin row that can outlive the group it names —
-- after a group is deleted outright, or if a pin ever arrives for a group id
-- that never lands. That costs a few bytes and nothing else: every reader joins
-- pins against the groups it already has, so a pin naming a group the reader
-- cannot see is invisible rather than wrong. A dangling preference is a far
-- cheaper failure than a refused one.

-- One live pin per person per group. The client derives the row id from
-- (owner, group), so two devices pinning the same group offline write the *same*
-- id and the second is an upsert of the first. This index is what makes that a
-- guarantee rather than a convention, and what stops a second row appearing if
-- some future writer forgets to derive it. Partial on `deleted_at IS NULL`, so
-- unpinning and pinning again re-uses the row instead of colliding with its own
-- tombstone.
CREATE UNIQUE INDEX group_pins_owner_group_idx ON public.group_pins
  USING btree (owner_user_id, group_id) WHERE (deleted_at IS NULL);

-- The pull's index: every read is "this owner's rows above this cursor".
CREATE INDEX group_pins_owner_user_id_updated_seq_idx ON public.group_pins
  USING btree (owner_user_id, updated_seq);

-- ────────────────────────────────────────────────────────── the seq stamp ──
--
-- Its own counter on `profiles`, like every other personal table. Sharing one
-- would mean pinning a group advanced the cursor the personal ledger reads
-- from, and a device that had pinned but not yet pulled would skip records it
-- had never seen. A counter per scope is what keeps the cursors independent.
CREATE FUNCTION public.waves_next_group_pin_seq(p_owner uuid) RETURNS bigint
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_seq bigint;
BEGIN
  UPDATE public.profiles
     SET group_pins_seq = group_pins_seq + 1
   WHERE id = p_owner
   RETURNING group_pins_seq INTO v_seq;
  RETURN COALESCE(v_seq, 0);
END
$$;

REVOKE ALL ON FUNCTION public.waves_next_group_pin_seq(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.waves_next_group_pin_seq(uuid) TO service_role;

CREATE FUNCTION public.waves_stamp_group_pin_seq() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
BEGIN
  NEW.updated_seq := public.waves_next_group_pin_seq(NEW.owner_user_id);
  RETURN NEW;
END
$$;

REVOKE ALL ON FUNCTION public.waves_stamp_group_pin_seq() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.waves_stamp_group_pin_seq() TO service_role;

-- Stamped on UPDATE as well as INSERT, which is what makes unpinning reach the
-- person's other devices: the tombstone is an UPDATE, and an UPDATE that did not
-- bump the seq would sit under every cursor and never be pulled.
CREATE TRIGGER group_pins_stamp_seq BEFORE INSERT OR UPDATE ON public.group_pins
  FOR EACH ROW EXECUTE FUNCTION public.waves_stamp_group_pin_seq();

-- ──────────────────────────────────────────────────────────── who may read ──
--
-- Your pins are yours. The policy is `owner_user_id = waves_current_profile_id()`
-- on both sides, so a member of the same group cannot read — let alone write —
-- what somebody else has pinned. This is the boundary, not the edge function:
-- `/sync` writes these rows as the *caller*, so RLS is what actually holds if
-- anybody PATCHes PostgREST directly. It is the same seam `pack_installs` and
-- `category_tags` use, and there is deliberately no SECURITY DEFINER RPC here —
-- a definer function exists to let somebody do what their own grants would not
-- allow (ADR-013), and writing a row you already own is not that.
ALTER TABLE public.group_pins ENABLE ROW LEVEL SECURITY;

CREATE POLICY group_pins_own ON public.group_pins TO authenticated
  USING ((owner_user_id = public.waves_current_profile_id()))
  WITH CHECK ((owner_user_id = public.waves_current_profile_id()));

-- No DELETE for `authenticated`: unpinning is a soft delete, like every other
-- personal row, so the tombstone can reach the person's other devices. A hard
-- delete would simply vanish from the pull, and the second phone would keep
-- showing the pin forever.
GRANT SELECT, INSERT, UPDATE ON TABLE public.group_pins TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.group_pins TO service_role;
