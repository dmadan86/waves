-- An agent writing to somebody's ledger, bounded and on the record.
--
-- The MCP server (`apps/agent-mcp`) lets an AI agent act as a signed-in person:
-- it holds that person's JWT and calls the same RPCs the app calls, so RLS
-- already decides what it may touch. RLS answers "whose data" and answers it
-- well. It does not answer either of the two questions an agent raises that a
-- human tapping buttons does not:
--
--   * **How much.** A person mistypes an amount once and sees it. A model
--     mistypes it and retries, and the ledger is a shared record of what other
--     people owe. There is no ceiling anywhere today: not in the MCP server,
--     not in the edge function, not in the RPCs.
--   * **Who did it.** Every write an agent makes is indistinguishable from one
--     the person made by hand. There is no way to look at a group and ask what
--     was done on your behalf while you were not looking, and no way to decide
--     you would rather it had not been.
--
-- Both answers hang off one fact: an access token minted for a third-party
-- client through Supabase's OAuth 2.1 server carries a `client_id` claim, and
-- one minted for the app itself does not. That claim is in the verified JWT, so
-- the database can read it directly and nothing in between can forge it. The
-- app's own writes are untouched by everything here — no claim, no ceiling, no
-- audit row — which is why this can land before the OAuth server is turned on
-- and simply do nothing until it is.

-- ─────────────────────────────────────────────────── who is doing the writing ──

-- The OAuth client id from the caller's own token, or NULL for the app itself.
--
-- Read from the request's verified claims — the same settings
-- `waves_current_profile_id` reads `sub` from — so it is not something a caller
-- can set. It is deliberately a function rather than an argument: passing the
-- client id in would make it a claim by the caller about the caller, which is
-- the one thing it must not be.
--
-- Not `auth.jwt()`: that lives in Supabase's own schema, and this has to work
-- on a plain Postgres too (the CI test database has a stub `auth`, and the
-- self-host stack has no GoTrue schema at all). The settings are set by
-- PostgREST, not by GoTrue, so reading them directly is both more portable and
-- exactly as trustworthy.
CREATE OR REPLACE FUNCTION public.waves_agent_client_id() RETURNS text
    LANGUAGE sql STABLE
    SET search_path TO 'public', 'pg_temp'
    AS $$
  SELECT nullif(
    btrim(
      coalesce(
        current_setting('request.jwt.claim.client_id', true),
        (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'client_id'),
        ''
      )
    ),
    ''
  );
$$;

REVOKE ALL ON FUNCTION public.waves_agent_client_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.waves_agent_client_id() TO authenticated, service_role;

-- ──────────────────────────────────────────────────────────── the record ──

CREATE TABLE IF NOT EXISTS public.agent_writes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    profile_id uuid NOT NULL,
    -- The OAuth client, e.g. a desktop assistant. Kept verbatim so a person can
    -- tell one agent from another when deciding which to stop trusting.
    client_id text NOT NULL,
    -- What was done, in the app's words rather than the table's: expense.add,
    -- expense.edit, expense.delete, settlement.record.
    action text NOT NULL,
    group_id uuid,
    object_id uuid,
    -- Minor units, and nullable: not every agent action moves an amount.
    amount_minor bigint,
    currency character(3),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT agent_writes_pkey PRIMARY KEY (id),
    CONSTRAINT agent_writes_action_shape CHECK ((action ~ '^[a-z][a-z_]*\.[a-z][a-z_]*$')),
    CONSTRAINT agent_writes_amount_nonneg CHECK ((amount_minor IS NULL) OR (amount_minor >= 0)),
    CONSTRAINT agent_writes_profile_id_fkey FOREIGN KEY (profile_id)
      REFERENCES public.profiles(id) ON UPDATE CASCADE ON DELETE CASCADE
);

-- The daily ceiling asks "how much has this person's agents written today",
-- which is this index exactly.
CREATE INDEX IF NOT EXISTS agent_writes_profile_created_idx
  ON public.agent_writes (profile_id, created_at DESC);

ALTER TABLE public.agent_writes ENABLE ROW LEVEL SECURITY;

-- A person reads what was done in their name and nothing else. There is no
-- INSERT policy on purpose: rows are written only by the SECURITY DEFINER
-- function below, so an agent cannot forge its own audit trail — or, more to
-- the point, cannot write a row claiming a different client_id than its token
-- carries.
DROP POLICY IF EXISTS agent_writes_own_read ON public.agent_writes;
CREATE POLICY agent_writes_own_read ON public.agent_writes
  FOR SELECT TO authenticated
  USING (profile_id = public.waves_current_profile_id());

-- ───────────────────────────────────────────────────────────── the ceiling ──

-- Two knobs, both admin-editable at runtime like every other limit in this app
-- (`app_config`, first used for the receipt cap). Minor units: 5,000,000 paise
-- is ₹50,000 for one expense, and 20,000,000 is ₹200,000 in a day.
--
-- These are starting values, not a considered policy. They exist so that the
-- answer to "what stops a loop" is a number somebody can raise deliberately
-- rather than "nothing".
INSERT INTO public.app_config (key, value, description) VALUES
  ('agent_expense_cap_minor', 5000000,
   'Largest single expense an OAuth agent may write, in minor units. The app itself is not affected.'),
  ('agent_daily_cap_minor', 20000000,
   'Total an OAuth agent may write for one person in 24 hours, in minor units.')
ON CONFLICT (key) DO NOTHING;

-- Refuse an agent write that is too large, or that takes the day past its
-- total. Silent for the app itself.
--
-- SECURITY DEFINER because it reads `app_config` and the whole audit table,
-- neither of which a person may read in full — and because the answer must not
-- depend on what the caller can see.
CREATE OR REPLACE FUNCTION public.waves_assert_agent_cap(p_amount_minor bigint)
RETURNS void
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_client   text := public.waves_agent_client_id();
  v_profile  uuid := public.waves_current_profile_id();
  v_per_call bigint;
  v_per_day  bigint;
  v_today    bigint;
BEGIN
  -- Not an agent: the app, doing what the person asked with their thumb on the
  -- screen. Nothing here applies to it.
  IF v_client IS NULL OR v_profile IS NULL OR p_amount_minor IS NULL THEN
    RETURN;
  END IF;

  SELECT value INTO v_per_call FROM public.app_config WHERE key = 'agent_expense_cap_minor';
  SELECT value INTO v_per_day  FROM public.app_config WHERE key = 'agent_daily_cap_minor';
  -- A missing knob must not read as "no limit". If somebody deletes the row,
  -- the conservative reading is the one that refuses.
  v_per_call := coalesce(v_per_call, 5000000);
  v_per_day  := coalesce(v_per_day, 20000000);

  IF p_amount_minor > v_per_call THEN
    RAISE EXCEPTION 'AGENT_CAP_SINGLE: an assistant cannot write an expense this large (% > %)',
      p_amount_minor, v_per_call
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT coalesce(sum(amount_minor), 0) INTO v_today
    FROM public.agent_writes
   WHERE profile_id = v_profile
     AND created_at > now() - interval '24 hours';

  IF v_today + p_amount_minor > v_per_day THEN
    RAISE EXCEPTION 'AGENT_CAP_DAILY: this would take today past what an assistant may write (% + % > %)',
      v_today, p_amount_minor, v_per_day
      USING ERRCODE = 'check_violation';
  END IF;
END
$$;

REVOKE ALL ON FUNCTION public.waves_assert_agent_cap(bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.waves_assert_agent_cap(bigint) TO authenticated, service_role;

-- ────────────────────────────────────────────────────────── writing it down ──

-- Record that an agent did something. A no-op for the app, so callers do not
-- have to ask which they are.
--
-- Returns the row id, or NULL when there was nothing to record.
CREATE OR REPLACE FUNCTION public.waves_record_agent_write(
  p_action       text,
  p_group_id     uuid DEFAULT NULL,
  p_object_id    uuid DEFAULT NULL,
  p_amount_minor bigint DEFAULT NULL,
  p_currency     character DEFAULT NULL
) RETURNS uuid
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_client  text := public.waves_agent_client_id();
  v_profile uuid := public.waves_current_profile_id();
  v_id      uuid;
BEGIN
  IF v_client IS NULL OR v_profile IS NULL THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.agent_writes
    (profile_id, client_id, action, group_id, object_id, amount_minor, currency)
  VALUES
    (v_profile, v_client, p_action, p_group_id, p_object_id, p_amount_minor, p_currency)
  RETURNING id INTO v_id;

  RETURN v_id;
END
$$;

REVOKE ALL ON FUNCTION public.waves_record_agent_write(text, uuid, uuid, bigint, character) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.waves_record_agent_write(text, uuid, uuid, bigint, character)
  TO authenticated, service_role;

-- What was done in my name, newest first — the answer to "what has it been
-- doing", and the list somebody reads before deciding to revoke a client.
CREATE OR REPLACE FUNCTION public.waves_my_agent_writes(p_limit integer DEFAULT 50)
RETURNS TABLE(
  id uuid,
  client_id text,
  action text,
  group_id uuid,
  object_id uuid,
  amount_minor bigint,
  currency character,
  created_at timestamp with time zone
)
    LANGUAGE sql STABLE
    SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  SELECT w.id, w.client_id, w.action, w.group_id, w.object_id,
         w.amount_minor, w.currency, w.created_at
    FROM public.agent_writes w
   WHERE w.profile_id = public.waves_current_profile_id()
   ORDER BY w.created_at DESC
   LIMIT least(greatest(coalesce(p_limit, 50), 1), 200);
$$;

REVOKE ALL ON FUNCTION public.waves_my_agent_writes(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.waves_my_agent_writes(integer) TO authenticated;
