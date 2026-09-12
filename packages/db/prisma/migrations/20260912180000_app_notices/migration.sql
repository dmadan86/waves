-- ═══════════════════════ Something the operator needs to say, to everybody ═══
--
-- `app_releases` already lets the operator say two things to a running app: a
-- newer build exists, and this build may no longer run. There has never been a
-- way to say anything else — "the database is down between 2 and 4 on Sunday",
-- "sync is slow and we know", "Waves is now available in the UAE" — and the
-- absence showed up as a support inbox full of people reporting an outage we
-- were already three hours into fixing.
--
-- This is that channel. One table, three kinds, and a very short list of things
-- a row is allowed to do.
--
-- ── The rule the table is built around ──────────────────────────────────────
--
-- **Nothing in here may stop somebody adding an expense.** Waves is offline
-- first: the ledger is a local mirror, writes go to a durable queue, and the
-- queue drains when a server comes back. A maintenance window is that state
-- deliberately rather than accidentally, and the app must be exactly as usable
-- inside one as it is in a train tunnel.
--
-- So there is no column here that could turn writes off. No `read_only`, no
-- `block`, no `severity` high enough to mean one. The table's whole vocabulary
-- is *a kind, a window, a scope, and some words*. The one thing in this
-- database that can gate the app is `app_releases.minimum_version`, it lives
-- somewhere else, it is guarded by its own CHECK, and it stays the only one.
--
-- ── Who may read it ─────────────────────────────────────────────────────────
--
-- Everybody, signed in or not — the same shape as `app_releases` and for the
-- same reason. Somebody staring at a sign-in screen that will not complete is
-- exactly the person who needs to be told the server is down; telling them to
-- authenticate first so they can learn why they cannot authenticate is a joke
-- the app should not make.
--
-- Writes are service role only, as ever: RLS on, one SELECT policy, no write
-- policy, and the grants revoked from `anon` and `authenticated` rather than
-- left to rest on the policy alone — the lesson of
-- `20260908140000_revoke_app_releases_writes`, whose whole point was that a
-- redundant grant is not a harmless one.
--
-- ── Why the text is JSONB and not a column ──────────────────────────────────
--
-- An operator writes at 2am, in one language. The app ships in four. The way
-- out is that a notice is *structured* rather than prose: `kind` plus two
-- timestamps is enough for the app to compose a complete, correctly-formatted
-- sentence in English, Tamil, Hindi or Arabic with no operator text at all.
--
-- `body` is therefore optional, and when it is used it is a map keyed by
-- language — `{"en": "...", "ta": "..."}` — so an operator who does have a
-- translation can ship it and one who does not still reaches everybody with the
-- structured half. The app falls back to English and *tells the reader which
-- language they are looking at*, which is the difference between a considered
-- fallback and an untranslated wall of text.
--
-- ── The clock ───────────────────────────────────────────────────────────────
--
-- Two windows, and they are not the same window:
--
--   * `starts_at` / `ends_at` — the thing being described. When the servers are
--     actually down.
--   * `visible_from` / `visible_until` — when the app should be saying it. A
--     maintenance notice is announced a day ahead, which is `visible_from`
--     yesterday and `starts_at` tomorrow.
--
-- Conflating them is how you get either an outage announced as it begins, or a
-- banner that is still apologising a week later.

-- Whether a `body` is a map of language to sentence and nothing else.
--
-- An object, not an array and not a scalar: the client reads it as a map and a
-- different shape resolves to no text at all. Every language one of the four
-- the app ships, so a typo'd key is a refusal rather than a sentence nobody
-- ever sees. Every sentence at most 500 characters, matching `MAX_TEXT` in
-- @waves/core — past that the client truncates, and a banner is not where a
-- release note goes.
CREATE OR REPLACE FUNCTION public.waves_notice_body_ok(body jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT jsonb_typeof(body) = 'object'
     AND NOT EXISTS (
       SELECT 1 FROM jsonb_each(body) AS entry(lang, value)
       WHERE jsonb_typeof(entry.value) <> 'string'
          OR entry.lang NOT IN ('en', 'ta', 'hi', 'ar')
          OR length(entry.value #>> '{}') > 500
     );
$$;

-- ISO-3166 alpha-2, upper case, or nothing. Its own function for the same
-- reason as the body's: a CHECK may not contain a subquery, and walking an
-- array without one means `array_to_string`, whose volatility depends on the
-- element type's output function and is therefore not something to bet a
-- migration on.
CREATE OR REPLACE FUNCTION public.waves_notice_countries_ok(countries text[])
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  -- `AS entry(country)` names the column explicitly rather than leaning on the
  -- alias doubling as one: a bare alias reference to a single-column set can be
  -- read as a composite, and this repo has been bitten by exactly that before.
  SELECT countries IS NULL OR NOT EXISTS (
    SELECT 1 FROM unnest(countries) AS entry(country) WHERE entry.country !~ '^[A-Z]{2}$'
  );
$$;

-- ─────────────────────────────────────────────────────────── the table ──

CREATE TABLE public.app_notices (
  id            uuid        NOT NULL DEFAULT gen_random_uuid(),
  kind          text        NOT NULL,
  -- The window being described. Both null for a notice that is not about a
  -- period of time at all.
  starts_at     timestamptz,
  ends_at       timestamptz,
  -- When the app should be showing it. Defaults to "from now, forever", which
  -- is the right default for an incident typed during one.
  visible_from  timestamptz NOT NULL DEFAULT now(),
  visible_until timestamptz,
  -- NULL or empty means everybody. An explicit list is honoured exactly.
  platforms     text[],
  countries     text[],
  -- Optional operator prose, keyed by language. See the header.
  body          jsonb       NOT NULL DEFAULT '{}'::jsonb,
  -- Why this row exists, for whoever finds it open three weeks later. Never
  -- shown to anybody using the app.
  note          text        NOT NULL DEFAULT '',
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT app_notices_pkey PRIMARY KEY (id),

  -- A closed set, matching `NoticeKind` in @waves/core. The app drops a kind it
  -- does not recognise rather than guessing at a severity it has no wording
  -- for, so a fourth value added here without a client release is silence.
  CONSTRAINT app_notices_kind_known
    CHECK (kind = ANY (ARRAY['maintenance'::text, 'incident'::text, 'notice'::text])),

  -- Maintenance is a window by definition. Without one there is nothing to say
  -- beyond "something, sometime", which is what `notice` is for.
  CONSTRAINT app_notices_maintenance_has_a_window
    CHECK (kind <> 'maintenance' OR (starts_at IS NOT NULL AND ends_at IS NOT NULL)),

  CONSTRAINT app_notices_window_ordered
    CHECK (starts_at IS NULL OR ends_at IS NULL OR ends_at > starts_at),
  CONSTRAINT app_notices_visibility_ordered
    CHECK (visible_until IS NULL OR visible_until > visible_from),

  -- Announced before it is over, or it is announced to nobody.
  CONSTRAINT app_notices_visible_before_it_ends
    CHECK (ends_at IS NULL OR visible_from < ends_at),

  CONSTRAINT app_notices_platforms_known
    CHECK (platforms IS NULL OR platforms <@ ARRAY['ios'::text, 'android'::text, 'web'::text]),
  CONSTRAINT app_notices_countries_shape CHECK (public.waves_notice_countries_ok(countries)),

  -- An object whose every value is a string in a language we ship, bounded at
  -- the length the client truncates to. A CHECK may not contain a subquery, so
  -- the walk lives in an immutable function and the constraint calls it.
  CONSTRAINT app_notices_body_shape CHECK (public.waves_notice_body_ok(body))
);

COMMENT ON TABLE public.app_notices IS
  'Operator messages to every running app: maintenance, incidents, announcements. Public read, service-role write. Nothing here may block the ledger — only app_releases.minimum_version gates.';
COMMENT ON COLUMN public.app_notices.starts_at IS
  'When the thing described begins. Not when to start showing it — that is visible_from.';
COMMENT ON COLUMN public.app_notices.body IS
  'Optional operator prose keyed by language: {"en": "...", "ta": "..."}. The app composes the structured half itself in all four languages.';

-- The only query the app makes: everything still worth showing, newest first.
-- Not partial on `visible_until > now()`, tempting as that is — `now()` is not
-- immutable, so Postgres refuses it in an index predicate, and the partial
-- index could not be written in schema.prisma either, which is the shape the
-- drift check compares against.
CREATE INDEX app_notices_live_idx
  ON public.app_notices (visible_from DESC);

-- ──────────────────────────────────────────────────── who may touch it ──

ALTER TABLE public.app_notices ENABLE ROW LEVEL SECURITY;

-- Signed out included, deliberately. See the header.
CREATE POLICY "app_notices are readable by everyone"
  ON public.app_notices FOR SELECT TO anon, authenticated USING (true);

-- No write policy at all, so RLS refuses every write from a client role. The
-- grants are then revoked as well rather than trusted to the policy's absence:
-- an UPDATE policy added later for some good reason would otherwise turn this
-- into a message board any signed-in account could post to, and the person
-- adding that policy would have no reason to go looking for a stale grant.
REVOKE ALL ON TABLE public.app_notices FROM anon, authenticated;
GRANT SELECT ON TABLE public.app_notices TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.app_notices TO service_role;

-- `updated_at` maintained here rather than trusted to the console, so a row
-- edited by hand in a SQL session during an incident still stamps itself.
CREATE OR REPLACE FUNCTION public.waves_app_notices_touch()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER app_notices_touch
  BEFORE UPDATE ON public.app_notices
  FOR EACH ROW EXECUTE FUNCTION public.waves_app_notices_touch();
