-- The developer API (A65): third-party software acting for a person.
--
-- Waves has had exactly two kinds of caller until now — the app, and the
-- operator console. Both are trusted code we ship. A developer API adds a third
-- that is neither: somebody else's program, holding a credential a person gave
-- it, asking for that person's money. The whole design question is how to let
-- that in without inventing a second authorisation model beside the one that
-- already works.
--
-- The answer is that a token is an *identity plus a ceiling*, never an
-- authority of its own. Resolving a token yields a profile id and a scope list,
-- and from that point on every read and every write happens as that person,
-- through the same RLS policies, the same RPCs and the same edge functions the
-- phone uses (ADR-013). A token cannot reach a row its owner could not; scopes
-- can only take away. That is why there are no new policies over `groups` or
-- `expenses` in this migration: there is nothing to add.
--
-- Four tables and the functions that guard them:
--
--   `api_apps`                — a registered OAuth client, owned by a developer.
--   `api_tokens`              — personal access tokens AND OAuth access/refresh
--                               tokens, one table because they are the same
--                               thing: a hashed secret, a person, a scope list.
--   `api_authorization_codes` — the short-lived middle of the OAuth dance.
--   (`app_config` gains the ceilings; `rate_limit_rules` still overrides.)
--
-- Nothing here stores a secret in the clear. The API server holds an HMAC key
-- and mints tokens that carry their own id; the database keeps only a SHA-256
-- of the presented string, and the two are checked together — a forged token
-- fails the HMAC, and a replayed database id fails the hash. Neither half is
-- sufficient on its own, which is the point.
--
-- The API server has no service-role key. It authenticates a token by calling
-- `waves_api_authorize_call` **as the person the token names**, so even a bug
-- that let an attacker choose a token id could only ever reach their own row.

-- ─────────────────────────────────────────────── the scope vocabulary ──
--
-- Immutable and in SQL rather than only in TypeScript, because the grant is
-- checked in the same statement that issues the token: a scope the catalogue
-- has never heard of must be refused at the point of writing, not noticed later
-- by a reader that happens to validate.

CREATE OR REPLACE FUNCTION public.waves_api_known_scopes() RETURNS text[]
    LANGUAGE sql IMMUTABLE
    SET search_path TO 'public', 'pg_temp'
    AS $fn$
  SELECT ARRAY[
    'identity.read', 'identity.write',
    'groups.read', 'groups.write',
    'expenses.read', 'expenses.write',
    'settlements.read', 'settlements.write',
    'friends.read',
    'categories.read', 'categories.write',
    'offline_access'
  ]::text[]
$fn$;

REVOKE ALL ON FUNCTION public.waves_api_known_scopes() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.waves_api_known_scopes() TO authenticated, service_role;

/*
 * True when every scope named is one the catalogue knows, the list is not
 * empty, and nothing repeats. Used by a CHECK constraint, so it has to be
 * IMMUTABLE — which is also why the catalogue above is a literal rather than a
 * table read.
 */
CREATE OR REPLACE FUNCTION public.waves_api_scopes_ok(p_scopes text[]) RETURNS boolean
    LANGUAGE sql IMMUTABLE
    SET search_path TO 'public', 'pg_temp'
    AS $fn$
  SELECT p_scopes IS NOT NULL
     AND cardinality(p_scopes) BETWEEN 1 AND 24
     AND p_scopes <@ public.waves_api_known_scopes()
     AND cardinality(p_scopes) = (SELECT count(DISTINCT s) FROM unnest(p_scopes) s)
$fn$;

REVOKE ALL ON FUNCTION public.waves_api_scopes_ok(p_scopes text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.waves_api_scopes_ok(p_scopes text[]) TO authenticated, service_role;

/*
 * The redirect-URI shape an OAuth client may register.
 *
 * This is the confused-deputy guard's first half: the second half is exact
 * string matching at /oauth/authorize, which is what stops app A's code being
 * delivered to app B's address. What this adds is that no registered value can
 * be a wildcard, carry a fragment, or use a scheme that turns a redirect into
 * script execution — `javascript:` and `data:` have no dot in the scheme, so
 * the private-use branch below cannot match them (RFC 8252 wants reverse-DNS
 * anyway). Plain http is allowed only for loopback, which is a developer's own
 * machine and cannot be intercepted on the way.
 */
CREATE OR REPLACE FUNCTION public.waves_api_redirects_ok(p_uris text[]) RETURNS boolean
    LANGUAGE sql IMMUTABLE
    SET search_path TO 'public', 'pg_temp'
    AS $fn$
  SELECT p_uris IS NOT NULL
     AND cardinality(p_uris) BETWEEN 1 AND 10
     AND NOT EXISTS (
       SELECT 1
         FROM unnest(p_uris) AS u
        WHERE length(u) > 400
           OR u ~ '[[:space:]#*]'
           -- No userinfo in the authority. `https://apps.example.com@evil.com/cb`
           -- is a valid URL pointing at evil.com, and it reads to whoever is
           -- reviewing the registration as the developer's own domain.
           OR NOT (
                u ~ '^https://[A-Za-z0-9.-]+(:[0-9]{1,5})?(/[A-Za-z0-9._~%!$&''()+,;=:@/?-]*)?$'
             OR u ~ '^http://(localhost|127\.0\.0\.1|\[::1\])(:[0-9]{1,5})?(/[A-Za-z0-9._~%!$&''()+,;=:@/?-]*)?$'
             OR u ~ '^[a-z][a-z0-9+-]*(\.[a-z0-9+-]+)+:/[A-Za-z0-9._~%!$&''()+,;=:@/?-]*$'
              )
     )
$fn$;

REVOKE ALL ON FUNCTION public.waves_api_redirects_ok(p_uris text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.waves_api_redirects_ok(p_uris text[]) TO authenticated, service_role;

-- ───────────────────────────────────────────────── registered clients ──

CREATE TABLE IF NOT EXISTS public.api_apps (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    owner_profile_id uuid NOT NULL,
    name text NOT NULL,
    description text DEFAULT ''::text NOT NULL,
    website_url text,
    client_id text NOT NULL,
    -- NULL means a public client: it holds no secret, so PKCE is the only thing
    -- standing between an intercepted code and a token. A mobile app cannot keep
    -- a secret and pretending otherwise is worse than admitting it.
    client_secret_hash text,
    redirect_uris text[] NOT NULL,
    scopes text[] NOT NULL,
    disabled_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT api_apps_pkey PRIMARY KEY (id),
    CONSTRAINT api_apps_client_id_key UNIQUE (client_id),
    CONSTRAINT api_apps_name_shape CHECK ((char_length(btrim(name)) BETWEEN 1 AND 80)),
    CONSTRAINT api_apps_description_len CHECK ((char_length(description) <= 400)),
    CONSTRAINT api_apps_client_id_shape CHECK ((client_id ~ '^wavs_app_[0-9a-f]{32}$')),
    CONSTRAINT api_apps_secret_shape CHECK (((client_secret_hash IS NULL) OR (client_secret_hash ~ '^[0-9a-f]{64}$'))),
    CONSTRAINT api_apps_redirects_ok CHECK (public.waves_api_redirects_ok(redirect_uris)),
    CONSTRAINT api_apps_scopes_ok CHECK (public.waves_api_scopes_ok(scopes)),
    -- Postgres refuses a regex repetition count above 255, so the length lives
    -- in its own check rather than in the pattern.
    CONSTRAINT api_apps_website_shape CHECK (((website_url IS NULL) OR ((char_length(website_url) <= 300) AND (website_url ~ '^https://[^[:space:]]+$')))),
    CONSTRAINT api_apps_owner_profile_id_fkey FOREIGN KEY (owner_profile_id)
      REFERENCES public.profiles(id) ON UPDATE CASCADE ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS api_apps_owner_idx ON public.api_apps (owner_profile_id, created_at DESC);

COMMENT ON TABLE public.api_apps IS
  'A third-party OAuth client registered by a Waves developer (A65). The client secret is stored only as a SHA-256; a NULL means a public client that must use PKCE.';

-- ─────────────────────────────────────────────────────────── the tokens ──

CREATE TABLE IF NOT EXISTS public.api_tokens (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    profile_id uuid NOT NULL,
    -- NULL for a personal access token: nobody is acting on anyone's behalf, a
    -- developer is holding their own key.
    app_id uuid,
    kind text NOT NULL,
    name text,
    token_hash text NOT NULL,
    token_prefix text NOT NULL,
    scopes text[] NOT NULL,
    -- The refresh token an access token was minted from, so rotating the one
    -- kills the other in the same statement rather than leaving a live access
    -- token behind a refresh token the user has just revoked.
    parent_id uuid,
    expires_at timestamp with time zone,
    last_used_at timestamp with time zone,
    revoked_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT api_tokens_pkey PRIMARY KEY (id),
    CONSTRAINT api_tokens_token_hash_key UNIQUE (token_hash),
    CONSTRAINT api_tokens_kind_check CHECK ((kind = ANY (ARRAY['personal'::text, 'access'::text, 'refresh'::text]))),
    CONSTRAINT api_tokens_hash_shape CHECK ((token_hash ~ '^[0-9a-f]{64}$')),
    CONSTRAINT api_tokens_prefix_shape CHECK ((token_prefix ~ '^wavs_(pat|at|rt)_[A-Za-z0-9_-]{4,16}$')),
    CONSTRAINT api_tokens_name_len CHECK (((name IS NULL) OR (char_length(btrim(name)) BETWEEN 1 AND 80))),
    CONSTRAINT api_tokens_scopes_ok CHECK (public.waves_api_scopes_ok(scopes)),
    -- A personal token belongs to no app; an OAuth token always names one.
    CONSTRAINT api_tokens_app_matches_kind CHECK ((((kind = 'personal'::text) AND (app_id IS NULL)) OR ((kind <> 'personal'::text) AND (app_id IS NOT NULL)))),
    CONSTRAINT api_tokens_profile_id_fkey FOREIGN KEY (profile_id)
      REFERENCES public.profiles(id) ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT api_tokens_app_id_fkey FOREIGN KEY (app_id)
      REFERENCES public.api_apps(id) ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT api_tokens_parent_id_fkey FOREIGN KEY (parent_id)
      REFERENCES public.api_tokens(id) ON UPDATE CASCADE ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS api_tokens_profile_idx ON public.api_tokens (profile_id, created_at DESC);
CREATE INDEX IF NOT EXISTS api_tokens_app_idx ON public.api_tokens (app_id, profile_id);

COMMENT ON TABLE public.api_tokens IS
  'Personal access tokens and OAuth access/refresh tokens (A65). Only a SHA-256 of the presented string is stored; the plaintext is shown once, at issue, and never again.';

-- ──────────────────────────────────────────── the OAuth code, in flight ──

CREATE TABLE IF NOT EXISTS public.api_authorization_codes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    app_id uuid NOT NULL,
    profile_id uuid NOT NULL,
    code_hash text NOT NULL,
    redirect_uri text NOT NULL,
    scopes text[] NOT NULL,
    -- S256 only. A `plain` challenge is a challenge in name; an attacker who can
    -- read the authorization request can read the verifier out of it.
    code_challenge text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    consumed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT api_authorization_codes_pkey PRIMARY KEY (id),
    CONSTRAINT api_authorization_codes_code_hash_key UNIQUE (code_hash),
    CONSTRAINT api_authorization_codes_hash_shape CHECK ((code_hash ~ '^[0-9a-f]{64}$')),
    CONSTRAINT api_authorization_codes_challenge_shape CHECK ((code_challenge ~ '^[A-Za-z0-9_-]{43}$')),
    CONSTRAINT api_authorization_codes_scopes_ok CHECK (public.waves_api_scopes_ok(scopes)),
    CONSTRAINT api_authorization_codes_app_id_fkey FOREIGN KEY (app_id)
      REFERENCES public.api_apps(id) ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT api_authorization_codes_profile_id_fkey FOREIGN KEY (profile_id)
      REFERENCES public.profiles(id) ON UPDATE CASCADE ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS api_authorization_codes_expiry_idx
  ON public.api_authorization_codes (expires_at);

COMMENT ON TABLE public.api_authorization_codes IS
  'The single-use OAuth authorization code (A65). Consumption is an UPDATE guarded on consumed_at IS NULL, so a replayed code loses the race rather than minting a second token.';

-- ────────────────────────────────────────────────── who may read what ──
--
-- A developer sees their own apps and their own tokens, and nothing else. The
-- codes table is nobody's: it is written and consumed only by the definer
-- functions below, and a client that could read it could steal an in-flight
-- authorization. Writes to `api_apps` and `api_tokens` have no policy either —
-- the shape rules (scope subsets, ceilings, one client secret at a time) live in
-- the functions, and a policy that let a client INSERT directly would be a
-- second, weaker copy of them.

ALTER TABLE public.api_apps ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.api_apps FROM PUBLIC;
REVOKE ALL ON TABLE public.api_apps FROM anon, authenticated;
GRANT SELECT ON TABLE public.api_apps TO authenticated;
GRANT ALL ON TABLE public.api_apps TO service_role;

DROP POLICY IF EXISTS api_apps_own_read ON public.api_apps;
CREATE POLICY api_apps_own_read ON public.api_apps
  FOR SELECT TO authenticated
  USING (owner_profile_id = public.waves_current_profile_id());

ALTER TABLE public.api_tokens ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.api_tokens FROM PUBLIC;
REVOKE ALL ON TABLE public.api_tokens FROM anon, authenticated;
GRANT SELECT ON TABLE public.api_tokens TO authenticated;
GRANT ALL ON TABLE public.api_tokens TO service_role;

-- The hash is in the row and a person may read their own rows. That is fine:
-- the hash is not the token, and the person reading it is the one who was shown
-- the token in the first place.
DROP POLICY IF EXISTS api_tokens_own_read ON public.api_tokens;
CREATE POLICY api_tokens_own_read ON public.api_tokens
  FOR SELECT TO authenticated
  USING (profile_id = public.waves_current_profile_id());

ALTER TABLE public.api_authorization_codes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.api_authorization_codes FROM PUBLIC;
REVOKE ALL ON TABLE public.api_authorization_codes FROM anon, authenticated;
GRANT ALL ON TABLE public.api_authorization_codes TO service_role;

-- ──────────────────────────────────────────────────────── the ceilings ──
--
-- Numbers, so the console can turn them (`app_config` is the integer knob table
-- the admin `/config` page edits). A missing row must not read as "no limit":
-- every reader below COALESCEs to the same conservative default.

INSERT INTO public.app_config (key, value, description) VALUES
  ('api_tokens_max_per_user', 20,
   'How many live personal access tokens one developer may hold (A65).'),
  ('api_apps_max_per_user', 10,
   'How many OAuth applications one developer may register (A65).'),
  ('api_token_max_days', 365,
   'The longest life a personal access token may be given, in days (A65).'),
  ('api_rate_limit_per_minute', 300,
   'Requests per minute per developer API token (A65). A rate_limit_rules row for the api-token bucket overrides this.'),
  ('api_rate_limit_per_minute_user', 900,
   'Requests per minute summed across every token one person holds (A65). This is what makes minting a second token not a way around the first limit.')
ON CONFLICT (key) DO NOTHING;

-- ─────────────────────────────────────────── registering an application ──

CREATE OR REPLACE FUNCTION public.waves_api_register_app(
  p_app_id uuid,
  p_name text,
  p_description text,
  p_website_url text,
  p_redirect_uris text[],
  p_scopes text[],
  p_client_id text,
  p_client_secret_hash text
) RETURNS uuid
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $fn$
DECLARE
  v_me    uuid := public.waves_current_profile_id();
  v_cap   integer;
  v_count integer;
  v_id    uuid;
BEGIN
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'NOT_SIGNED_IN: sign in to register an application'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- No replay branch. Returning an existing row for a repeated id would mean a
  -- second call with different redirect URIs reported success and changed
  -- nothing, which is a worse failure than a refusal — and registering an
  -- application is a deliberate act behind a confirmation, not a write that
  -- retries itself. The unique index is the guard; this only names the refusal.
  IF p_app_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.api_apps WHERE id = p_app_id) THEN
    RAISE EXCEPTION 'APP_ID_TAKEN: that application id is already in use'
      USING ERRCODE = 'unique_violation';
  END IF;

  v_cap := COALESCE((SELECT value FROM public.app_config WHERE key = 'api_apps_max_per_user'), 10);
  SELECT count(*) INTO v_count FROM public.api_apps WHERE owner_profile_id = v_me;
  IF v_count >= v_cap THEN
    RAISE EXCEPTION 'APP_LIMIT: you already have % applications (the limit is %)', v_count, v_cap
      USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO public.api_apps (
    id, owner_profile_id, name, description, website_url,
    client_id, client_secret_hash, redirect_uris, scopes
  ) VALUES (
    COALESCE(p_app_id, gen_random_uuid()), v_me, btrim(p_name), COALESCE(btrim(p_description), ''),
    NULLIF(btrim(COALESCE(p_website_url, '')), ''),
    p_client_id, p_client_secret_hash, p_redirect_uris, p_scopes
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END
$fn$;

REVOKE ALL ON FUNCTION public.waves_api_register_app(p_app_id uuid, p_name text, p_description text, p_website_url text, p_redirect_uris text[], p_scopes text[], p_client_id text, p_client_secret_hash text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.waves_api_register_app(p_app_id uuid, p_name text, p_description text, p_website_url text, p_redirect_uris text[], p_scopes text[], p_client_id text, p_client_secret_hash text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.waves_api_update_app(
  p_app_id uuid,
  p_name text,
  p_description text,
  p_website_url text,
  p_redirect_uris text[],
  p_scopes text[],
  p_client_secret_hash text,
  p_disabled boolean
) RETURNS void
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $fn$
DECLARE
  v_me uuid := public.waves_current_profile_id();
BEGIN
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'NOT_SIGNED_IN: sign in first' USING ERRCODE = 'insufficient_privilege';
  END IF;

  UPDATE public.api_apps SET
    name               = COALESCE(btrim(p_name), name),
    description        = COALESCE(btrim(p_description), description),
    website_url        = CASE WHEN p_website_url IS NULL THEN website_url
                              ELSE NULLIF(btrim(p_website_url), '') END,
    redirect_uris      = COALESCE(p_redirect_uris, redirect_uris),
    scopes             = COALESCE(p_scopes, scopes),
    -- NULL leaves the secret alone: "do not rotate" and "make this a public
    -- client" are different intentions and must not share a value.
    client_secret_hash = COALESCE(p_client_secret_hash, client_secret_hash),
    disabled_at        = CASE WHEN p_disabled IS NULL THEN disabled_at
                              WHEN p_disabled THEN COALESCE(disabled_at, now())
                              ELSE NULL END,
    updated_at         = now()
  WHERE id = p_app_id AND owner_profile_id = v_me;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NO_SUCH_APP: no application of yours has that id'
      USING ERRCODE = 'no_data_found';
  END IF;
END
$fn$;

REVOKE ALL ON FUNCTION public.waves_api_update_app(p_app_id uuid, p_name text, p_description text, p_website_url text, p_redirect_uris text[], p_scopes text[], p_client_secret_hash text, p_disabled boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.waves_api_update_app(p_app_id uuid, p_name text, p_description text, p_website_url text, p_redirect_uris text[], p_scopes text[], p_client_secret_hash text, p_disabled boolean) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.waves_api_delete_app(p_app_id uuid) RETURNS void
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $fn$
DECLARE
  v_me uuid := public.waves_current_profile_id();
BEGIN
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'NOT_SIGNED_IN: sign in first' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Every token minted for the app goes with it (ON DELETE CASCADE) — including
  -- the revoked ones `waves_api_revoke_token` deliberately keeps for the record.
  -- That is the honest cost of "delete", and it is why `disabled_at` exists:
  -- disabling stops the application working for everybody immediately while
  -- leaving the history of who connected it intact.
  DELETE FROM public.api_apps WHERE id = p_app_id AND owner_profile_id = v_me;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NO_SUCH_APP: no application of yours has that id'
      USING ERRCODE = 'no_data_found';
  END IF;
END
$fn$;

REVOKE ALL ON FUNCTION public.waves_api_delete_app(p_app_id uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.waves_api_delete_app(p_app_id uuid) TO authenticated, service_role;

-- ────────────────────────────────────────────── personal access tokens ──

CREATE OR REPLACE FUNCTION public.waves_api_create_token(
  p_token_id uuid,
  p_name text,
  p_token_hash text,
  p_token_prefix text,
  p_scopes text[],
  p_days integer
) RETURNS jsonb
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $fn$
DECLARE
  v_me      uuid := public.waves_current_profile_id();
  v_cap     integer;
  v_maxdays integer;
  v_count   integer;
  v_expires timestamp with time zone;
BEGIN
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'NOT_SIGNED_IN: sign in to make a token'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- A token id is minted by the API server together with the secret it signs,
  -- so a collision is a replayed request. Returning the existing row would be
  -- wrong here in a way it is not elsewhere: the caller cannot be shown the
  -- secret again, so the honest answer is that this id is spent.
  IF EXISTS (SELECT 1 FROM public.api_tokens WHERE id = p_token_id) THEN
    RAISE EXCEPTION 'TOKEN_ID_TAKEN: that token id has already been used'
      USING ERRCODE = 'unique_violation';
  END IF;

  v_cap := COALESCE((SELECT value FROM public.app_config WHERE key = 'api_tokens_max_per_user'), 20);
  SELECT count(*) INTO v_count
    FROM public.api_tokens
   WHERE profile_id = v_me AND kind = 'personal' AND revoked_at IS NULL
     AND (expires_at IS NULL OR expires_at > now());
  IF v_count >= v_cap THEN
    RAISE EXCEPTION 'TOKEN_LIMIT: you already have % live tokens (the limit is %)', v_count, v_cap
      USING ERRCODE = 'check_violation';
  END IF;

  v_maxdays := COALESCE((SELECT value FROM public.app_config WHERE key = 'api_token_max_days'), 365);
  IF p_days IS NULL THEN
    -- A token with no expiry is a credential nobody ever has to think about
    -- again, which is exactly how they end up in a public repository. The
    -- ceiling applies whether or not the caller asked for one.
    v_expires := now() + make_interval(days => v_maxdays);
  ELSIF p_days < 1 OR p_days > v_maxdays THEN
    RAISE EXCEPTION 'TOKEN_TTL: a token lasts between 1 and % days', v_maxdays
      USING ERRCODE = 'check_violation';
  ELSE
    v_expires := now() + make_interval(days => p_days);
  END IF;

  INSERT INTO public.api_tokens (
    id, profile_id, app_id, kind, name, token_hash, token_prefix, scopes, expires_at
  ) VALUES (
    p_token_id, v_me, NULL, 'personal', NULLIF(btrim(COALESCE(p_name, '')), ''),
    p_token_hash, p_token_prefix, p_scopes, v_expires
  );

  RETURN jsonb_build_object('id', p_token_id, 'expiresAt', v_expires);
END
$fn$;

REVOKE ALL ON FUNCTION public.waves_api_create_token(p_token_id uuid, p_name text, p_token_hash text, p_token_prefix text, p_scopes text[], p_days integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.waves_api_create_token(p_token_id uuid, p_name text, p_token_hash text, p_token_prefix text, p_scopes text[], p_days integer) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.waves_api_revoke_token(p_token_id uuid) RETURNS boolean
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $fn$
DECLARE
  v_me uuid := public.waves_current_profile_id();
BEGIN
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'NOT_SIGNED_IN: sign in first' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- The row stays, so "this key was live until Tuesday" is still answerable —
  -- a revoked token that vanished the moment it was revoked would take the
  -- answer with it. Thirty days later the sweeper takes the OAuth ones, which
  -- is long enough for the investigation that ever asks and short enough that
  -- an hourly rotation does not fill the table; a personal token's row is kept
  -- until its owner deletes their account.
  UPDATE public.api_tokens SET revoked_at = now()
   WHERE id = p_token_id AND profile_id = v_me AND revoked_at IS NULL;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  -- Revoking a refresh token takes its access tokens with it: leaving them live
  -- would mean "revoked" lasted until whatever hour the access token had left.
  UPDATE public.api_tokens SET revoked_at = now()
   WHERE parent_id = p_token_id AND profile_id = v_me AND revoked_at IS NULL;

  RETURN true;
END
$fn$;

REVOKE ALL ON FUNCTION public.waves_api_revoke_token(p_token_id uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.waves_api_revoke_token(p_token_id uuid) TO authenticated, service_role;

/*
 * Withdraw an application's access entirely — every token it holds for this
 * person, in one statement. This is the button that matters on the "apps you
 * have connected" list, and it is deliberately not the same as deleting the
 * app: the person revoking is usually not the developer who owns it.
 */
CREATE OR REPLACE FUNCTION public.waves_api_revoke_app_access(p_app_id uuid) RETURNS integer
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $fn$
DECLARE
  v_me uuid := public.waves_current_profile_id();
  v_n  integer;
BEGIN
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'NOT_SIGNED_IN: sign in first' USING ERRCODE = 'insufficient_privilege';
  END IF;

  WITH revoked AS (
    UPDATE public.api_tokens SET revoked_at = now()
     WHERE app_id = p_app_id AND profile_id = v_me AND revoked_at IS NULL
     RETURNING 1
  )
  SELECT count(*) INTO v_n FROM revoked;

  RETURN v_n;
END
$fn$;

REVOKE ALL ON FUNCTION public.waves_api_revoke_app_access(p_app_id uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.waves_api_revoke_app_access(p_app_id uuid) TO authenticated, service_role;

-- ─────────────────────────────────────────────────── the hot path ──
--
-- One call per API request. It answers three questions at once — is this token
-- still good, does it carry the scope this route needs, and has this caller had
-- enough for now — because they are asked together and any gap between them is
-- a window.
--
-- It runs as the person the token names, which is the whole security argument:
-- the API server holds no service-role key, so a bug that let a caller choose
-- `p_token_id` freely could still only ever reach a row of their own. The hash
-- is checked as well as the id, so knowing an id is not knowing a token.

CREATE OR REPLACE FUNCTION public.waves_api_authorize_call(
  p_token_id uuid,
  p_token_hash text,
  p_scope text
) RETURNS jsonb
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $fn$
DECLARE
  v_me        uuid := public.waves_current_profile_id();
  v_token     public.api_tokens%ROWTYPE;
  v_app       public.api_apps%ROWTYPE;
  v_effective text[];
  v_per_token integer;
  v_per_user  integer;
  v_token_gate jsonb;
  v_user_gate  jsonb;
BEGIN
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'NOT_SIGNED_IN: the token names nobody'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT * INTO v_token
    FROM public.api_tokens
   WHERE id = p_token_id AND profile_id = v_me AND token_hash = p_token_hash;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'INVALID_TOKEN: that token is not one of yours'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF v_token.revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'TOKEN_REVOKED: that token has been revoked'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF v_token.expires_at IS NOT NULL AND v_token.expires_at <= now() THEN
    RAISE EXCEPTION 'TOKEN_EXPIRED: that token has expired'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF v_token.kind = 'refresh' THEN
    RAISE EXCEPTION 'WRONG_TOKEN_KIND: a refresh token cannot call the API'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- A disabled application stops working for everyone at once, without anybody
  -- having to walk its users' tokens.
  IF v_token.app_id IS NOT NULL THEN
    SELECT * INTO v_app FROM public.api_apps WHERE id = v_token.app_id;
    IF NOT FOUND OR v_app.disabled_at IS NOT NULL THEN
      RAISE EXCEPTION 'APP_DISABLED: the application this token belongs to is switched off'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;

  -- The database is authoritative about scope, not the token string, and an
  -- application's *current* registration is authoritative over what it was
  -- granted. Narrowing an app's scopes therefore takes effect on the next call
  -- rather than the next token: an app that no longer asks for `expenses.write`
  -- must stop being able to write expenses immediately, or "we removed that
  -- permission" is a sentence with a year of tokens behind it.
  v_effective := v_token.scopes;
  IF v_app.id IS NOT NULL THEN
    SELECT COALESCE(array_agg(s ORDER BY s), '{}'::text[]) INTO v_effective
      FROM unnest(v_token.scopes) s
     WHERE s = ANY (v_app.scopes);
  END IF;

  -- An application narrowed until nothing is left has been switched off in every
  -- sense that matters, so its tokens stop authenticating rather than merely
  -- failing every scoped route. Otherwise a token with no permissions at all
  -- would still pass the routes that ask for none, and "we removed its access"
  -- would be a sentence with an exception nobody mentioned.
  IF v_app.id IS NOT NULL AND cardinality(v_effective) = 0 THEN
    RAISE EXCEPTION 'INSUFFICIENT_SCOPE: this application no longer has any permission on your account'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF p_scope IS NOT NULL AND NOT (p_scope = ANY (v_effective)) THEN
    RAISE EXCEPTION 'INSUFFICIENT_SCOPE: this token does not carry %', p_scope
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  v_per_token := COALESCE((SELECT value FROM public.app_config WHERE key = 'api_rate_limit_per_minute'), 300);
  v_per_user  := COALESCE((SELECT value FROM public.app_config WHERE key = 'api_rate_limit_per_minute_user'), 900);

  -- Two buckets, and the second one is the point: a caller who has spent their
  -- token's minute can mint another token in a second, so the per-person budget
  -- is what actually bounds them. Its subject comes from the session, never from
  -- an argument, so it cannot be aimed at somebody else.
  v_token_gate := public.waves_rate_limit('apitoken:' || v_token.id::text, 'api-token', v_per_token, 60);
  v_user_gate  := public.waves_rate_limit('apiuser:'  || v_me::text,       'api-user',  v_per_user,  60);

  IF NOT (v_token_gate->>'allowed')::boolean OR NOT (v_user_gate->>'allowed')::boolean THEN
    RETURN jsonb_build_object(
      'allowed',    false,
      'profileId',  v_me,
      'scopes',     to_jsonb(v_effective),
      'limit',      LEAST((v_token_gate->>'limit')::integer, (v_user_gate->>'limit')::integer),
      'remaining',  0,
      'retryAfter', GREATEST((v_token_gate->>'retryAfter')::integer, (v_user_gate->>'retryAfter')::integer),
      'resetAt',    GREATEST((v_token_gate->>'resetAt')::timestamptz, (v_user_gate->>'resetAt')::timestamptz)
    );
  END IF;

  -- Once a minute is enough resolution for "last used" and spares the row an
  -- update on every single call.
  IF v_token.last_used_at IS NULL OR v_token.last_used_at < now() - interval '1 minute' THEN
    UPDATE public.api_tokens SET last_used_at = now() WHERE id = v_token.id;
  END IF;

  RETURN jsonb_build_object(
    'allowed',    true,
    'profileId',  v_me,
    'appId',      v_token.app_id,
    'scopes',     to_jsonb(v_effective),
    'limit',      LEAST((v_token_gate->>'limit')::integer, (v_user_gate->>'limit')::integer),
    'remaining',  LEAST((v_token_gate->>'remaining')::integer, (v_user_gate->>'remaining')::integer),
    'retryAfter', 0,
    'resetAt',    GREATEST((v_token_gate->>'resetAt')::timestamptz, (v_user_gate->>'resetAt')::timestamptz)
  );
END
$fn$;

REVOKE ALL ON FUNCTION public.waves_api_authorize_call(p_token_id uuid, p_token_hash text, p_scope text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.waves_api_authorize_call(p_token_id uuid, p_token_hash text, p_scope text) TO authenticated, service_role;

-- ──────────────────────────────────────────────────── the OAuth dance ──

/*
 * What the consent screen is allowed to say about an application.
 *
 * Callable by any signed-in person, because the person consenting is not the
 * developer who registered it. It returns the name and the owner's display name
 * and nothing else — never the client secret hash, never the owner's address —
 * and it refuses outright if the redirect the client asked for is not one the
 * app registered. That refusal is the confused-deputy guard: a consent screen
 * that rendered an unregistered redirect would be teaching the user to approve
 * a delivery to somewhere the developer never named.
 */
CREATE OR REPLACE FUNCTION public.waves_api_consent_preview(
  p_client_id text,
  p_redirect_uri text,
  p_scopes text[]
) RETURNS jsonb
    LANGUAGE plpgsql STABLE
    SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $fn$
DECLARE
  v_me   uuid := public.waves_current_profile_id();
  v_app  public.api_apps%ROWTYPE;
  v_owner text;
BEGIN
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'NOT_SIGNED_IN: sign in to decide this'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT * INTO v_app FROM public.api_apps WHERE client_id = p_client_id;
  IF NOT FOUND OR v_app.disabled_at IS NOT NULL THEN
    RAISE EXCEPTION 'UNKNOWN_CLIENT: no application has that client id'
      USING ERRCODE = 'no_data_found';
  END IF;

  IF NOT (p_redirect_uri = ANY (v_app.redirect_uris)) THEN
    RAISE EXCEPTION 'BAD_REDIRECT: that redirect address is not registered for this application'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NOT (p_scopes <@ v_app.scopes) THEN
    RAISE EXCEPTION 'SCOPE_NOT_ALLOWED: this application may not ask for that'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT display_name INTO v_owner FROM public.profiles WHERE id = v_app.owner_profile_id;

  RETURN jsonb_build_object(
    'appId',      v_app.id,
    'name',       v_app.name,
    'description', v_app.description,
    'websiteUrl', v_app.website_url,
    'ownerName',  v_owner,
    'scopes',     to_jsonb(p_scopes)
  );
END
$fn$;

REVOKE ALL ON FUNCTION public.waves_api_consent_preview(p_client_id text, p_redirect_uri text, p_scopes text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.waves_api_consent_preview(p_client_id text, p_redirect_uri text, p_scopes text[]) TO authenticated, service_role;

/*
 * The user has said yes. Mint the code row.
 *
 * The redirect and the scopes are re-checked here rather than trusted from the
 * screen that displayed them: the browser between the two is the attacker's
 * ground, and a consent that was rendered honestly can still be submitted with
 * a different redirect attached.
 */
CREATE OR REPLACE FUNCTION public.waves_api_issue_code(
  p_code_id uuid,
  p_code_hash text,
  p_client_id text,
  p_redirect_uri text,
  p_scopes text[],
  p_code_challenge text,
  p_ttl_seconds integer
) RETURNS jsonb
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $fn$
DECLARE
  v_me      uuid := public.waves_current_profile_id();
  v_app     public.api_apps%ROWTYPE;
  v_ttl     integer := LEAST(GREATEST(COALESCE(p_ttl_seconds, 300), 30), 600);
  v_expires timestamp with time zone;
BEGIN
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'NOT_SIGNED_IN: sign in to approve this'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT * INTO v_app FROM public.api_apps WHERE client_id = p_client_id;
  IF NOT FOUND OR v_app.disabled_at IS NOT NULL THEN
    RAISE EXCEPTION 'UNKNOWN_CLIENT: no application has that client id'
      USING ERRCODE = 'no_data_found';
  END IF;
  IF NOT (p_redirect_uri = ANY (v_app.redirect_uris)) THEN
    RAISE EXCEPTION 'BAD_REDIRECT: that redirect address is not registered for this application'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NOT (p_scopes <@ v_app.scopes) THEN
    RAISE EXCEPTION 'SCOPE_NOT_ALLOWED: this application may not ask for that'
      USING ERRCODE = 'check_violation';
  END IF;

  v_expires := now() + make_interval(secs => v_ttl);

  INSERT INTO public.api_authorization_codes (
    id, app_id, profile_id, code_hash, redirect_uri, scopes, code_challenge, expires_at
  ) VALUES (
    p_code_id, v_app.id, v_me, p_code_hash, p_redirect_uri, p_scopes, p_code_challenge, v_expires
  );

  RETURN jsonb_build_object('id', p_code_id, 'expiresAt', v_expires);
END
$fn$;

REVOKE ALL ON FUNCTION public.waves_api_issue_code(p_code_id uuid, p_code_hash text, p_client_id text, p_redirect_uri text, p_scopes text[], p_code_challenge text, p_ttl_seconds integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.waves_api_issue_code(p_code_id uuid, p_code_hash text, p_client_id text, p_redirect_uri text, p_scopes text[], p_code_challenge text, p_ttl_seconds integer) TO authenticated, service_role;

/*
 * Trade the code for tokens.
 *
 * Everything that makes this safe is in one statement: the UPDATE that marks
 * the code consumed is guarded on `consumed_at IS NULL`, so two requests racing
 * with the same code produce exactly one winner and the loser is told the code
 * is spent. The PKCE verifier is hashed and compared here rather than in the
 * caller, so the check cannot drift out of step with the consumption it guards.
 *
 * A confidential client must also present its secret. A public one is
 * authenticated by PKCE and the registered redirect alone, which is the most
 * that is true of software installed on somebody's phone.
 */
CREATE OR REPLACE FUNCTION public.waves_api_consume_code(
  p_code_id uuid,
  p_code_hash text,
  p_client_id text,
  p_client_secret_hash text,
  p_redirect_uri text,
  p_code_verifier text,
  p_access_token_id uuid,
  p_access_hash text,
  p_access_prefix text,
  p_refresh_token_id uuid,
  p_refresh_hash text,
  p_refresh_prefix text,
  p_access_ttl_seconds integer,
  p_refresh_ttl_days integer
) RETURNS jsonb
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $fn$
DECLARE
  v_me         uuid := public.waves_current_profile_id();
  v_app        public.api_apps%ROWTYPE;
  v_code       public.api_authorization_codes%ROWTYPE;
  v_challenge  text;
  v_access_exp timestamp with time zone;
  v_refresh_id uuid := NULL;
  v_refresh_days integer;
BEGIN
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'NOT_SIGNED_IN: the code names nobody'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT * INTO v_app FROM public.api_apps WHERE client_id = p_client_id;
  IF NOT FOUND OR v_app.disabled_at IS NOT NULL THEN
    RAISE EXCEPTION 'UNKNOWN_CLIENT: no application has that client id'
      USING ERRCODE = 'no_data_found';
  END IF;
  IF v_app.client_secret_hash IS NOT NULL
     AND (p_client_secret_hash IS NULL OR p_client_secret_hash <> v_app.client_secret_hash) THEN
    RAISE EXCEPTION 'BAD_CLIENT_SECRET: that client secret is wrong'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Single use. The guard is the WHERE clause, not a read followed by a write:
  -- two clients replaying the same code both run this, and only one row moves.
  UPDATE public.api_authorization_codes SET consumed_at = now()
   WHERE id = p_code_id
     AND code_hash = p_code_hash
     AND profile_id = v_me
     AND app_id = v_app.id
     AND consumed_at IS NULL
     AND expires_at > now()
   RETURNING * INTO v_code;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'INVALID_GRANT: that code is spent, expired or not for this client'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF v_code.redirect_uri <> p_redirect_uri THEN
    RAISE EXCEPTION 'INVALID_GRANT: the redirect address does not match the one the code was issued for'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- S256: base64url of the SHA-256 of the verifier, unpadded.
  v_challenge := translate(
    encode(extensions.digest(COALESCE(p_code_verifier, ''), 'sha256'), 'base64'),
    '+/', '-_'
  );
  v_challenge := replace(replace(v_challenge, '=', ''), E'\n', '');
  IF v_challenge <> v_code.code_challenge THEN
    RAISE EXCEPTION 'INVALID_GRANT: the code verifier does not match the challenge'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- The same ceiling personal tokens obey. A knob that bounded a developer's own
  -- key but not the one a stranger's app holds would be the wrong way round.
  v_refresh_days := LEAST(
    GREATEST(COALESCE(p_refresh_ttl_days, 90), 1),
    COALESCE((SELECT value FROM public.app_config WHERE key = 'api_token_max_days'), 365)
  );

  v_access_exp := now() + make_interval(secs => LEAST(GREATEST(COALESCE(p_access_ttl_seconds, 3600), 300), 86400));

  IF 'offline_access' = ANY (v_code.scopes) AND p_refresh_token_id IS NOT NULL THEN
    INSERT INTO public.api_tokens (
      id, profile_id, app_id, kind, token_hash, token_prefix, scopes, expires_at
    ) VALUES (
      p_refresh_token_id, v_me, v_app.id, 'refresh', p_refresh_hash, p_refresh_prefix,
      v_code.scopes, now() + make_interval(days => v_refresh_days)
    );
    v_refresh_id := p_refresh_token_id;
  END IF;

  INSERT INTO public.api_tokens (
    id, profile_id, app_id, kind, token_hash, token_prefix, scopes, parent_id, expires_at
  ) VALUES (
    p_access_token_id, v_me, v_app.id, 'access', p_access_hash, p_access_prefix,
    v_code.scopes, v_refresh_id, v_access_exp
  );

  RETURN jsonb_build_object(
    'accessTokenId',  p_access_token_id,
    'refreshTokenId', v_refresh_id,
    'expiresAt',      v_access_exp,
    'scopes',         to_jsonb(v_code.scopes)
  );
END
$fn$;

REVOKE ALL ON FUNCTION public.waves_api_consume_code(p_code_id uuid, p_code_hash text, p_client_id text, p_client_secret_hash text, p_redirect_uri text, p_code_verifier text, p_access_token_id uuid, p_access_hash text, p_access_prefix text, p_refresh_token_id uuid, p_refresh_hash text, p_refresh_prefix text, p_access_ttl_seconds integer, p_refresh_ttl_days integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.waves_api_consume_code(p_code_id uuid, p_code_hash text, p_client_id text, p_client_secret_hash text, p_redirect_uri text, p_code_verifier text, p_access_token_id uuid, p_access_hash text, p_access_prefix text, p_refresh_token_id uuid, p_refresh_hash text, p_refresh_prefix text, p_access_ttl_seconds integer, p_refresh_ttl_days integer) TO authenticated, service_role;

/*
 * Rotate a refresh token.
 *
 * The old one dies in the same statement the new one is born in, so a refresh
 * token is single-use like the code was. That is what makes a stolen refresh
 * token detectable rather than permanent: the thief and the owner cannot both
 * keep using it, and whoever loses the race is told the grant is invalid.
 */
CREATE OR REPLACE FUNCTION public.waves_api_rotate_refresh(
  p_refresh_token_id uuid,
  p_refresh_hash text,
  p_client_id text,
  p_client_secret_hash text,
  p_new_access_id uuid,
  p_new_access_hash text,
  p_new_access_prefix text,
  p_new_refresh_id uuid,
  p_new_refresh_hash text,
  p_new_refresh_prefix text,
  p_access_ttl_seconds integer,
  p_refresh_ttl_days integer
) RETURNS jsonb
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $fn$
DECLARE
  v_me         uuid := public.waves_current_profile_id();
  v_app        public.api_apps%ROWTYPE;
  v_old        public.api_tokens%ROWTYPE;
  v_access_exp timestamp with time zone;
  v_refresh_days integer;
BEGIN
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'NOT_SIGNED_IN: the token names nobody'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT * INTO v_app FROM public.api_apps WHERE client_id = p_client_id;
  IF NOT FOUND OR v_app.disabled_at IS NOT NULL THEN
    RAISE EXCEPTION 'UNKNOWN_CLIENT: no application has that client id'
      USING ERRCODE = 'no_data_found';
  END IF;
  IF v_app.client_secret_hash IS NOT NULL
     AND (p_client_secret_hash IS NULL OR p_client_secret_hash <> v_app.client_secret_hash) THEN
    RAISE EXCEPTION 'BAD_CLIENT_SECRET: that client secret is wrong'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  UPDATE public.api_tokens SET revoked_at = now()
   WHERE id = p_refresh_token_id
     AND profile_id = v_me
     AND app_id = v_app.id
     AND kind = 'refresh'
     AND token_hash = p_refresh_hash
     AND revoked_at IS NULL
     AND (expires_at IS NULL OR expires_at > now())
   RETURNING * INTO v_old;

  IF NOT FOUND THEN
    -- Reuse detection (RFC 6749 §10.4). A refresh token presented after it has
    -- already been rotated means two parties hold it, and one of them is a
    -- thief; there is no way to tell which from here. So the whole grant for
    -- this application goes — the honest, safe answer is that both have to ask
    -- the person again. Without this the thief who rotates first keeps a working
    -- pair forever and the victim is merely signed out, which is the worse of
    -- the two outcomes to choose.
    --
    -- It RETURNS rather than RAISEs, and that is not a style choice. A RAISE
    -- aborts the statement it is in, and the revoke above is part of that same
    -- statement, so raising would roll back the disconnection and leave the
    -- comment above describing something that did not happen. `waves_rate_limit`
    -- returns `allowed: false` for the same reason: a refusal that has to
    -- persist a write cannot be an exception.
    -- `revoked_at IS NOT NULL` is what separates the two ways the UPDATE above
    -- can miss. A token that was rotated away or withdrawn and is now being
    -- presented again is reuse; one that simply got old while nobody used it is
    -- a client that went to sleep, and disconnecting every device it has —
    -- while telling its owner the token "was already used" — would be an
    -- accusation of theft against somebody who did nothing. Genuine late reuse
    -- is still caught: a token rotated away and expired since still carries the
    -- revoked stamp.
    IF EXISTS (
      SELECT 1 FROM public.api_tokens
       WHERE id = p_refresh_token_id
         AND profile_id = v_me
         AND app_id = v_app.id
         AND kind = 'refresh'
         AND token_hash = p_refresh_hash
         AND revoked_at IS NOT NULL
    ) THEN
      UPDATE public.api_tokens SET revoked_at = now()
       WHERE profile_id = v_me AND app_id = v_app.id AND revoked_at IS NULL;
      RETURN jsonb_build_object(
        'ok', false,
        'error', 'INVALID_GRANT',
        'disconnected', true,
        'message', 'that refresh token was already used, so this application has been disconnected'
      );
    END IF;

    RAISE EXCEPTION 'INVALID_GRANT: that refresh token is spent, expired or not for this client'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Its access token goes too. Rotation that left the old access token alive
  -- would mean a stolen pair kept working for another hour after the theft was
  -- detected.
  UPDATE public.api_tokens SET revoked_at = now()
   WHERE parent_id = v_old.id AND revoked_at IS NULL;

  -- The same ceiling personal tokens obey. A knob that bounded a developer's own
  -- key but not the one a stranger's app holds would be the wrong way round.
  v_refresh_days := LEAST(
    GREATEST(COALESCE(p_refresh_ttl_days, 90), 1),
    COALESCE((SELECT value FROM public.app_config WHERE key = 'api_token_max_days'), 365)
  );

  v_access_exp := now() + make_interval(secs => LEAST(GREATEST(COALESCE(p_access_ttl_seconds, 3600), 300), 86400));

  INSERT INTO public.api_tokens (
    id, profile_id, app_id, kind, token_hash, token_prefix, scopes, expires_at
  ) VALUES (
    p_new_refresh_id, v_me, v_app.id, 'refresh', p_new_refresh_hash, p_new_refresh_prefix,
    v_old.scopes, now() + make_interval(days => v_refresh_days)
  );

  INSERT INTO public.api_tokens (
    id, profile_id, app_id, kind, token_hash, token_prefix, scopes, parent_id, expires_at
  ) VALUES (
    p_new_access_id, v_me, v_app.id, 'access', p_new_access_hash, p_new_access_prefix,
    v_old.scopes, p_new_refresh_id, v_access_exp
  );


  -- Rotation writes two rows every hour a client stays connected, so something
  -- has to take the dead ones away. Doing it here, for this person only and
  -- straight down an index, means there is no scheduled job to forget to
  -- schedule — a mistake this repo has already made once with the push fan-out.
  DELETE FROM public.api_tokens
   WHERE profile_id = v_me
     AND kind <> 'personal'
     AND (
       (revoked_at IS NOT NULL AND revoked_at < now() - interval '30 days')
       OR (expires_at IS NOT NULL AND expires_at < now() - interval '30 days')
     );

  RETURN jsonb_build_object(
    'ok',             true,
    'accessTokenId',  p_new_access_id,
    'refreshTokenId', p_new_refresh_id,
    'expiresAt',      v_access_exp,
    'scopes',         to_jsonb(v_old.scopes)
  );
END
$fn$;

REVOKE ALL ON FUNCTION public.waves_api_rotate_refresh(p_refresh_token_id uuid, p_refresh_hash text, p_client_id text, p_client_secret_hash text, p_new_access_id uuid, p_new_access_hash text, p_new_access_prefix text, p_new_refresh_id uuid, p_new_refresh_hash text, p_new_refresh_prefix text, p_access_ttl_seconds integer, p_refresh_ttl_days integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.waves_api_rotate_refresh(p_refresh_token_id uuid, p_refresh_hash text, p_client_id text, p_client_secret_hash text, p_new_access_id uuid, p_new_access_hash text, p_new_access_prefix text, p_new_refresh_id uuid, p_new_refresh_hash text, p_new_refresh_prefix text, p_access_ttl_seconds integer, p_refresh_ttl_days integer) TO authenticated, service_role;

-- ────────────────────────────────────────────────── what a person sees ──

/*
 * The applications this person has connected, and when each was last used.
 * Grouped in SQL rather than in the browser so the page cannot accidentally
 * list one row per token and call it three apps.
 */
CREATE OR REPLACE FUNCTION public.waves_api_connected_apps()
RETURNS TABLE(
  app_id uuid,
  name text,
  description text,
  website_url text,
  scopes text[],
  /*
   * "A request from this application would be allowed." It is the complete set
   * of ways `waves_api_authorize_call` can refuse before it looks at the scope:
   * revoked and expired tokens are already filtered out of the rows below, and
   * the two that are left are an empty intersection with the current
   * registration and a switched-off application. Either way the app still holds
   * live token rows and every one of them is refused, so "connected" with no
   * qualifier would be a lie — and the row has to stay, because this screen is
   * the only place the person can clear it.
   */
  active boolean,
  connected_at timestamp with time zone,
  last_used_at timestamp with time zone
)
    LANGUAGE sql STABLE
    SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $fn$
  SELECT a.id, a.name, a.description, a.website_url,
         -- COALESCE, not the bare aggregate: array_agg over no rows is NULL, and
         -- the column is declared text[]. A screen mapping over it would throw
         -- exactly where somebody is trying to remove something.
         COALESCE(granted.scopes, '{}'::text[]),
         COALESCE(cardinality(granted.scopes), 0) > 0 AND a.disabled_at IS NULL,
         min(t.created_at),
         max(t.last_used_at)
    FROM public.api_tokens t
    JOIN public.api_apps a ON a.id = t.app_id
    -- Intersected with the registration, exactly as the hot path does. This is
    -- the screen whose whole job is to tell somebody what an application can do,
    -- so it must not be the one place that claims more than a request would get.
    CROSS JOIN LATERAL (
      SELECT array_agg(DISTINCT s ORDER BY s) AS scopes
        FROM public.api_tokens t2, unnest(t2.scopes) s
       WHERE t2.app_id = a.id
         AND t2.profile_id = public.waves_current_profile_id()
         AND t2.revoked_at IS NULL
         AND (t2.expires_at IS NULL OR t2.expires_at > now())
         AND s = ANY (a.scopes)
    ) granted
   WHERE t.profile_id = public.waves_current_profile_id()
     AND t.revoked_at IS NULL
     AND (t.expires_at IS NULL OR t.expires_at > now())
   GROUP BY a.id, a.name, a.description, a.website_url, granted.scopes
   ORDER BY min(t.created_at) DESC
$fn$;

REVOKE ALL ON FUNCTION public.waves_api_connected_apps() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.waves_api_connected_apps() TO authenticated, service_role;

-- ───────────────────────────────────────────────────────── the sweeper ──
--
-- Consumed and expired codes are litter, not history: the code is a five-minute
-- credential and the token it produced is the record. Kept for a day so an
-- investigation into a failed exchange has something to look at, and dead OAuth
-- tokens for thirty, which is long enough to answer "what was connected last
-- month" and short enough that the table does not grow without end.
--
-- Nothing schedules this. It is safe to leave unscheduled — the rotation path
-- prunes the rows that actually accumulate — so it is a `pg_cron` line an
-- operator adds rather than a dependency this migration creates.

CREATE OR REPLACE FUNCTION public.waves_api_sweep() RETURNS integer
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $fn$
DECLARE
  v_codes  integer;
  v_tokens integer;
BEGIN
  WITH gone AS (
    DELETE FROM public.api_authorization_codes
     WHERE expires_at < now() - interval '1 day'
     RETURNING 1
  )
  SELECT count(*) INTO v_codes FROM gone;

  -- The rotation path prunes as it goes, but only for people who are still
  -- using the API. This catches the ones who connected an application once,
  -- disconnected it, and never came back.
  WITH gone AS (
    DELETE FROM public.api_tokens
     WHERE kind <> 'personal'
       AND (
         (revoked_at IS NOT NULL AND revoked_at < now() - interval '30 days')
         OR (expires_at IS NOT NULL AND expires_at < now() - interval '30 days')
       )
     RETURNING 1
  )
  SELECT count(*) INTO v_tokens FROM gone;

  RETURN v_codes + v_tokens;
END
$fn$;

REVOKE ALL ON FUNCTION public.waves_api_sweep() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.waves_api_sweep() TO service_role;
