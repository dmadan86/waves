-- Category and source packs: a shelf of vocabulary somebody can install.
--
-- The app's ten spend categories and fifteen income sources are deliberately
-- general — nothing shaped to one country's instruments or one person's trade.
-- A pack is how a landlord, a freelancer, or somebody tracking a chit fund gets
-- the words they actually use without those words being shipped to everybody.
--
-- A pack is DATA, not code: labels, icons from a curated set, tints from six.
-- There is nothing to execute, so the trust boundary here is not a sandbox — it
-- is the RLS below. `packs` is readable only where `status = 'published'` and
-- writable only by `service_role`, so a pack reaches a phone because we
-- published it, never because somebody inserted a row.
--
-- Installing writes ordinary rows into the person's own `category_tags`, through
-- the same mutation the tag editor uses. So an install works offline, needs no
-- privileged step, and leaves behind categories that are the person's own — which
-- is why an uninstall (and a takedown) can leave them exactly where they are.

-- ─────────────────────────────────────────────────────────────── packs ──

CREATE TABLE public.packs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    slug text NOT NULL,
    title text NOT NULL,
    summary text NOT NULL,
    -- Every entry, validated by `parsePack` in @waves/core before it is written
    -- and again on the client after it is read. The column is opaque here on
    -- purpose: this table is a shelf, and the shape of what sits on it belongs
    -- to the one function both sides share.
    entries jsonb DEFAULT '[]'::jsonb NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    install_count integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT packs_status_known CHECK ((status = ANY (ARRAY['draft'::text, 'published'::text, 'unlisted'::text]))),
    CONSTRAINT packs_version_positive CHECK ((version > 0)),
    CONSTRAINT packs_entries_is_array CHECK ((jsonb_typeof(entries) = 'array'::text))
);

COMMENT ON TABLE public.packs IS 'An installable set of categories or income sources. Data, never code; published by us, read by anyone signed in.';
COMMENT ON COLUMN public.packs.status IS 'draft = ours alone; published = installable; unlisted = withdrawn, but anyone who already installed it keeps their categories.';

ALTER TABLE ONLY public.packs ADD CONSTRAINT packs_pkey PRIMARY KEY (id);
CREATE UNIQUE INDEX packs_slug_idx ON public.packs USING btree (slug);
CREATE INDEX packs_status_idx ON public.packs USING btree (status, updated_at DESC);

ALTER TABLE public.packs ENABLE ROW LEVEL SECURITY;

-- The whole trust boundary. Reading is limited to what we have published;
-- writing is not granted to `authenticated` at all, so there is no policy that
-- could be got around — the privilege simply is not there.
CREATE POLICY packs_read_published ON public.packs FOR SELECT TO authenticated
  USING ((status = 'published'::text));

GRANT SELECT ON TABLE public.packs TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.packs TO service_role;

-- ───────────────────────────────────────────────────────── installs ──

-- Whose catalog holds which pack. Owner-scoped and seq-stamped exactly like
-- `captures` and `category_tags`, so an install rides the personal sync scope
-- that already exists rather than inventing a second kind of ownership.
ALTER TABLE public.profiles ADD COLUMN pack_installs_seq bigint DEFAULT 0 NOT NULL;

CREATE TABLE public.pack_installs (
    id uuid NOT NULL,
    owner_user_id uuid NOT NULL,
    pack_id uuid NOT NULL,
    -- Which version was installed, so a later one can offer what is new.
    version integer DEFAULT 1 NOT NULL,
    updated_seq bigint DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone
);

COMMENT ON TABLE public.pack_installs IS 'A pack somebody has installed. Removing the row uninstalls the pack; the categories it added stay, because by then they are the person''s own.';

ALTER TABLE ONLY public.pack_installs ADD CONSTRAINT pack_installs_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.pack_installs
    ADD CONSTRAINT pack_installs_owner_user_id_fkey FOREIGN KEY (owner_user_id)
    REFERENCES public.profiles(id) ON UPDATE CASCADE ON DELETE CASCADE;
-- A pack we delete outright takes its install rows with it. The tags it wrote
-- are untouched: `category_tags.pack_id` goes to NULL and the categories remain.
ALTER TABLE ONLY public.pack_installs
    ADD CONSTRAINT pack_installs_pack_id_fkey FOREIGN KEY (pack_id)
    REFERENCES public.packs(id) ON UPDATE CASCADE ON DELETE CASCADE;

CREATE UNIQUE INDEX pack_installs_owner_pack_idx ON public.pack_installs
  USING btree (owner_user_id, pack_id) WHERE (deleted_at IS NULL);
CREATE INDEX pack_installs_owner_user_id_updated_seq_idx ON public.pack_installs
  USING btree (owner_user_id, updated_seq);

CREATE FUNCTION public.waves_next_pack_install_seq(p_owner uuid) RETURNS bigint
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_seq bigint;
BEGIN
  UPDATE public.profiles
     SET pack_installs_seq = pack_installs_seq + 1
   WHERE id = p_owner
   RETURNING pack_installs_seq INTO v_seq;
  RETURN COALESCE(v_seq, 0);
END
$$;

REVOKE ALL ON FUNCTION public.waves_next_pack_install_seq(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.waves_next_pack_install_seq(uuid) TO service_role;

CREATE FUNCTION public.waves_stamp_pack_install_seq() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
BEGIN
  NEW.updated_seq := public.waves_next_pack_install_seq(NEW.owner_user_id);
  RETURN NEW;
END
$$;

REVOKE ALL ON FUNCTION public.waves_stamp_pack_install_seq() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.waves_stamp_pack_install_seq() TO service_role;

CREATE TRIGGER pack_installs_stamp_seq BEFORE INSERT OR UPDATE ON public.pack_installs
  FOR EACH ROW EXECUTE FUNCTION public.waves_stamp_pack_install_seq();

ALTER TABLE public.pack_installs ENABLE ROW LEVEL SECURITY;

CREATE POLICY pack_installs_own ON public.pack_installs TO authenticated
  USING ((owner_user_id = public.waves_current_profile_id()))
  WITH CHECK ((owner_user_id = public.waves_current_profile_id()));

-- No DELETE for `authenticated`: uninstalling is a soft delete, like every other
-- personal row, so the tombstone can reach the person's other devices.
GRANT SELECT, INSERT, UPDATE ON TABLE public.pack_installs TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.pack_installs TO service_role;

-- ─────────────────────────────────────────────────── tags learn two things ──

-- Which picker a tag belongs in. The default is what every row written before
-- today already was, so this changes nothing that exists.
ALTER TABLE public.category_tags ADD COLUMN axis text DEFAULT 'expense'::text NOT NULL;
ALTER TABLE public.category_tags
  ADD CONSTRAINT category_tags_axis_known CHECK ((axis = ANY (ARRAY['expense'::text, 'income'::text])));

-- Where a tag came from. Provenance the catalog can show, never a dependency:
-- `ON DELETE SET NULL` means deleting the pack leaves the categories standing.
ALTER TABLE public.category_tags ADD COLUMN pack_id uuid;
ALTER TABLE ONLY public.category_tags
    ADD CONSTRAINT category_tags_pack_id_fkey FOREIGN KEY (pack_id)
    REFERENCES public.packs(id) ON UPDATE CASCADE ON DELETE SET NULL;

COMMENT ON COLUMN public.category_tags.axis IS 'Which picker this tag appears in: a spending category or an income source.';
COMMENT ON COLUMN public.category_tags.pack_id IS 'The pack that first wrote this tag, for provenance. The tag outlives the pack.';

-- ──────────────────────────────────────────────────────── asking for one ──

-- The other half of "we author them, others ask". A request is a sentence, not
-- a submission: there is no authoring surface here and nothing a request can put
-- in front of another user.
CREATE TABLE public.pack_requests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    requester_id uuid NOT NULL,
    body text NOT NULL,
    status text DEFAULT 'open'::text NOT NULL,
    decided_by uuid,
    decided_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT pack_requests_status_known CHECK ((status = ANY (ARRAY['open'::text, 'done'::text, 'declined'::text]))),
    -- The same shape `member_claims` uses: an undecided row carries no decision.
    CONSTRAINT pack_requests_decided_shape CHECK (((status = 'open'::text) = (decided_at IS NULL))),
    CONSTRAINT pack_requests_body_length CHECK ((char_length(body) BETWEEN 1 AND 500))
);

COMMENT ON TABLE public.pack_requests IS 'Somebody asking for a pack that does not exist yet. Read and decided in the admin console.';

ALTER TABLE ONLY public.pack_requests ADD CONSTRAINT pack_requests_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.pack_requests
    ADD CONSTRAINT pack_requests_requester_id_fkey FOREIGN KEY (requester_id)
    REFERENCES public.profiles(id) ON UPDATE CASCADE ON DELETE CASCADE;
CREATE INDEX pack_requests_status_created_at_idx ON public.pack_requests
  USING btree (status, created_at DESC);

ALTER TABLE public.pack_requests ENABLE ROW LEVEL SECURITY;

-- Write your own, read your own. No update: a request once sent is not something
-- to quietly rewrite, and the decision on it is ours to make.
CREATE POLICY pack_requests_own ON public.pack_requests FOR SELECT TO authenticated
  USING ((requester_id = public.waves_current_profile_id()));
CREATE POLICY pack_requests_insert_own ON public.pack_requests FOR INSERT TO authenticated
  WITH CHECK ((requester_id = public.waves_current_profile_id()));

GRANT SELECT, INSERT ON TABLE public.pack_requests TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.pack_requests TO service_role;
