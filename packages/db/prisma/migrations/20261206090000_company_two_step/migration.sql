-- Company two-step login (design: Option B, our own TOTP + Firebase App Check).
--
-- A company owner or manager may require two-step login (groups.require_two_step, default false everywhere). From then
-- on every path into that company's data — RLS, SECURITY DEFINER RPCs, writes — asks waves_two_step_ok(group): is this
-- GoTrue session marked as verified (two_step_sessions), or, for an AI assistant / developer-API token, was the link or
-- token made from a verified session? Personal groups and companies that do not require it are untouched: the gate is
-- true unless the group requires it. Marks are written only by the service role (edge functions two-step-trust,
-- two-step-verify, two-step-authenticator). Turning a company ON is refused while the `company_two_step` flag is off.

-- ───────────────────────────────────────────────────────────── tables ──

ALTER TABLE public.groups ADD COLUMN require_two_step boolean NOT NULL DEFAULT false;
-- A copy on every member row, so the per-row membership helpers can skip the gate for a company that does not require
-- it without looking anything else up (kept in step by the triggers at the end of this migration).
ALTER TABLE public.group_members ADD COLUMN company_two_step boolean NOT NULL DEFAULT false;

-- Code secrets, AES-256-GCM encrypted by the edge functions (TWO_STEP_KEY); the database never sees them in clear.
CREATE TABLE public.two_step_secrets (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE ON UPDATE CASCADE,
 kind text NOT NULL CHECK (kind IN ('phone','authenticator')),
 device_id text CHECK (device_id IS NULL OR length(device_id) BETWEEN 1 AND 200),
 secret_enc text NOT NULL CHECK (length(secret_enc) BETWEEN 20 AND 400),
 active boolean NOT NULL DEFAULT false,
 -- Highest time step accepted; a code at or below it is a replay.
 last_step bigint NOT NULL DEFAULT 0,
 created_at timestamptz NOT NULL DEFAULT now(),
 activated_at timestamptz
);
CREATE UNIQUE INDEX two_step_secrets_one_phone ON public.two_step_secrets(profile_id) WHERE kind = 'phone' AND active;
CREATE UNIQUE INDEX two_step_secrets_one_authenticator ON public.two_step_secrets(profile_id) WHERE kind = 'authenticator' AND active;
CREATE INDEX two_step_secrets_profile_idx ON public.two_step_secrets(profile_id);

-- Wrong-code counter per person, row-locked by every attempt so verification is serialised.
CREATE TABLE public.two_step_lockouts (
 profile_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE ON UPDATE CASCADE,
 failures integer NOT NULL DEFAULT 0,
 locked_until timestamptz
);

-- A verified GoTrue session (the signed `session_id` claim). Gone with the profile; a dead session fails liveness.
CREATE TABLE public.two_step_sessions (
 session_id uuid NOT NULL,
 profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE ON UPDATE CASCADE,
 kind text NOT NULL CHECK (kind IN ('phone','web')),
 device_id text,
 verified_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (session_id, profile_id)
);
CREATE INDEX two_step_sessions_profile_idx ON public.two_step_sessions(profile_id);

-- A new phone for somebody who already has a phone or authenticator: an owner/manager may approve it.
CREATE TABLE public.two_step_device_requests (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE ON UPDATE CASCADE,
 session_id uuid NOT NULL,
 device_id text NOT NULL CHECK (length(device_id) BETWEEN 1 AND 200),
 platform text CHECK (platform IS NULL OR length(platform) <= 20),
 status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','declined','used')),
 decided_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
 decided_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX two_step_device_requests_open ON public.two_step_device_requests(profile_id, device_id)
 WHERE status IN ('pending','approved');

ALTER TABLE public.two_step_secrets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.two_step_lockouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.two_step_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.two_step_device_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.two_step_secrets, public.two_step_lockouts, public.two_step_sessions, public.two_step_device_requests
 FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.two_step_secrets, public.two_step_lockouts, public.two_step_sessions, public.two_step_device_requests
 TO service_role;

-- Decision 5: assistants and API tokens reach a two-step company only when made/approved from a verified session.
ALTER TABLE public.company_agent_links ADD COLUMN two_step_verified_at timestamptz;
ALTER TABLE public.api_tokens ADD COLUMN two_step_verified_at timestamptz;
ALTER TABLE public.api_authorization_codes ADD COLUMN two_step_verified_at timestamptz;

INSERT INTO public.feature_flags (key, description, enabled, rollout_percent)
VALUES ('company_two_step', 'Company owners can require two-step login (shows the toggle; the database refuses ON while off)', false, 0)
ON CONFLICT (key) DO NOTHING;

-- ──────────────────────────────────────────────────────────── the gate ──

-- The GoTrue session id from the verified JWT, or NULL when absent or not a uuid (fail closed: NULL never matches a mark).
CREATE FUNCTION public.waves_jwt_session_id() RETURNS uuid
 LANGUAGE sql STABLE SET search_path TO 'public','pg_temp' AS $$
 SELECT CASE WHEN s ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN s::uuid END
 FROM (SELECT nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'session_id' AS s) c
$$;

-- The developer-API token behind this request (claim minted by apps/api only), or NULL.
CREATE FUNCTION public.waves_api_token_id() RETURNS uuid
 LANGUAGE sql STABLE SET search_path TO 'public','pg_temp' AS $$
 SELECT CASE WHEN s ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN s::uuid END
 FROM (SELECT nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'waves_token_id' AS s) c
$$;

-- A mark counts only while its GoTrue session is still live: a signed-out or revoked session's JWT stops reading a
-- two-step company at once, not when it expires. (waves_two_step_ok calls this once per statement per company.)
CREATE FUNCTION public.waves_two_step_session_ok() RETURNS boolean
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
DECLARE v_sid uuid := public.waves_jwt_session_id(); v_live boolean;
BEGIN
 IF v_sid IS NULL OR NOT EXISTS (SELECT 1 FROM public.two_step_sessions s
   WHERE s.session_id = v_sid AND s.profile_id = public.waves_current_profile_id()) THEN RETURN false; END IF;
 IF to_regclass('auth.sessions') IS NULL THEN RETURN true; END IF;
 EXECUTE 'SELECT EXISTS (SELECT 1 FROM auth.sessions WHERE id = $1)' INTO v_live USING v_sid;
 RETURN v_live;
END $$;

-- True unless the group is a company that requires two-step and this caller has not passed it. A request with no caller
-- profile (service role, cron) passes here; every membership helper already refuses a caller without a profile.
-- It runs inside per-row RLS, so for a requiring company the answer is remembered for the rest of the statement
-- (keyed on statement_timestamp() and the exact JWT claims, so it never outlives the statement or the caller).
CREATE FUNCTION public.waves_two_step_ok(p_group_id uuid) RETURNS boolean
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
DECLARE v_key text; v_stamp text; v_hit text; v_me uuid; v_client text; v_token uuid; v_ok boolean;
BEGIN
 IF NOT EXISTS (SELECT 1 FROM public.groups WHERE id = p_group_id AND require_two_step AND type = 'company') THEN RETURN true; END IF;
 v_key := 'waves.two_step_' || replace(p_group_id::text, '-', '');
 v_stamp := statement_timestamp()::text || '|' || coalesce(current_setting('request.jwt.claims', true), '');
 v_hit := current_setting(v_key, true);
 IF v_hit IS NOT NULL AND length(v_hit) > 1 AND substr(v_hit, 2) = v_stamp THEN RETURN left(v_hit, 1) = 't'; END IF;
 v_me := public.waves_current_profile_id();
 IF v_me IS NULL THEN
  v_ok := true;
 ELSE
  v_client := public.waves_agent_client_id();
  v_token := public.waves_api_token_id();
  IF v_client IS NOT NULL THEN
   v_ok := EXISTS (SELECT 1 FROM public.company_agent_links l WHERE l.profile_id = v_me AND l.client_id = v_client
    AND l.group_id = p_group_id AND l.revoked_at IS NULL AND l.two_step_verified_at IS NOT NULL);
  ELSIF v_token IS NOT NULL THEN
   v_ok := EXISTS (SELECT 1 FROM public.api_tokens t WHERE t.id = v_token AND t.profile_id = v_me
    AND t.revoked_at IS NULL AND t.two_step_verified_at IS NOT NULL);
  ELSE
   v_ok := public.waves_two_step_session_ok();
  END IF;
 END IF;
 PERFORM set_config(v_key, CASE WHEN v_ok THEN 't' ELSE 'f' END || v_stamp, true);
 RETURN v_ok;
END $$;

CREATE FUNCTION public.waves_two_step_assert(p_group_id uuid) RETURNS void
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
BEGIN
 IF NOT public.waves_two_step_ok(p_group_id) THEN
  RAISE EXCEPTION 'TWO_STEP_REQUIRED: verify two-step to keep working in this company' USING ERRCODE = 'insufficient_privilege';
 END IF;
END $$;

REVOKE ALL ON FUNCTION public.waves_jwt_session_id(), public.waves_api_token_id(), public.waves_two_step_session_ok(),
 public.waves_two_step_ok(uuid), public.waves_two_step_assert(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.waves_jwt_session_id(), public.waves_api_token_id(), public.waves_two_step_session_ok(),
 public.waves_two_step_ok(uuid), public.waves_two_step_assert(uuid) TO authenticated, service_role;

-- ──────────────────────────────────── every helper and predicate that grants company access ──
CREATE OR REPLACE FUNCTION public.is_group_member(p_group_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.group_members gm
    WHERE gm.group_id = p_group_id
      AND gm.profile_id = public.waves_current_profile_id()
      AND gm.left_at IS NULL
      AND (NOT gm.company_two_step OR public.waves_two_step_ok(p_group_id))
  )
$function$;

CREATE OR REPLACE FUNCTION public.is_group_admin(p_group_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.group_members gm
    WHERE gm.group_id = p_group_id
      AND gm.profile_id = public.waves_current_profile_id()
      AND gm.left_at IS NULL
      AND gm.role = 'admin'
      AND (NOT gm.company_two_step OR public.waves_two_step_ok(p_group_id))
  )
$function$;

CREATE OR REPLACE FUNCTION public.waves_my_member_id(p_group_id uuid)
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT gm.id
  FROM public.group_members gm
  WHERE gm.group_id = p_group_id
    AND gm.profile_id = public.waves_current_profile_id()
    AND gm.left_at IS NULL
    AND (NOT gm.company_two_step OR public.waves_two_step_ok(p_group_id))
  LIMIT 1
$function$;

CREATE OR REPLACE FUNCTION public.waves_my_member_id_for(p_group_id uuid, p_profile_id uuid)
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT id FROM public.group_members
   WHERE group_id = p_group_id
     AND profile_id = CASE
       WHEN COALESCE(NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '') IN ('anon', 'authenticated')
         THEN public.waves_current_profile_id()
       ELSE p_profile_id
     END
     AND left_at IS NULL
     AND public.waves_two_step_ok(p_group_id)
   LIMIT 1;
$function$;

CREATE OR REPLACE FUNCTION public.waves_company_member_ok(p_group_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
 SELECT (SELECT EXISTS(SELECT 1 FROM public.group_members me JOIN public.groups g ON g.id=me.group_id
 WHERE me.group_id=p_group_id AND g.type='company' AND g.deleted_at IS NULL
 AND me.profile_id=public.waves_current_profile_id() AND me.left_at IS NULL AND me.removed_at IS NULL AND me.merged_into_member_id IS NULL))
  AND public.waves_two_step_ok(p_group_id);
$function$;

CREATE OR REPLACE FUNCTION public.waves_company_detail(p_group_id uuid, p_member_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
 SELECT (SELECT EXISTS(SELECT 1 FROM public.groups g JOIN public.group_members me ON me.group_id=g.id
 JOIN public.group_members target ON target.group_id=g.id AND target.id=p_member_id
 WHERE g.id=p_group_id AND g.type='company' AND g.deleted_at IS NULL
 AND me.profile_id=public.waves_current_profile_id() AND me.left_at IS NULL AND me.removed_at IS NULL AND me.merged_into_member_id IS NULL
 AND (me.role::text='admin' OR me.id=target.id OR (me.role::text='manager' AND target.role::text='member' AND target.manager_id=me.id))))
  AND public.waves_two_step_ok(p_group_id);
$function$;

CREATE OR REPLACE FUNCTION public.waves_company_client_visible(p_group_id uuid, p_client_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
 SELECT (SELECT EXISTS(SELECT 1 FROM public.company_clients c JOIN public.group_members me ON me.group_id=c.group_id JOIN public.groups g ON g.id=c.group_id
 WHERE c.id=p_client_id AND c.group_id=p_group_id AND g.type='company' AND g.deleted_at IS NULL
 AND me.profile_id=public.waves_current_profile_id() AND me.left_at IS NULL AND me.removed_at IS NULL AND me.merged_into_member_id IS NULL
 AND (me.role::text IN ('admin','manager') OR (me.role::text='member' AND (c.owner_member_id=me.id
  OR EXISTS(SELECT 1 FROM public.company_client_assignees a WHERE a.client_id=c.id AND a.member_id=me.id AND a.deleted_at IS NULL))))))
  AND public.waves_two_step_ok(p_group_id);
$function$;

CREATE OR REPLACE FUNCTION public.waves_company_event_visible(p_group_id uuid, p_people uuid[], p_created_by uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
 SELECT (SELECT EXISTS(SELECT 1 FROM public.group_members me JOIN public.groups g ON g.id=me.group_id
 WHERE me.group_id=p_group_id AND g.type='company' AND g.deleted_at IS NULL
 AND me.profile_id=public.waves_current_profile_id() AND me.left_at IS NULL AND me.removed_at IS NULL AND me.merged_into_member_id IS NULL
 AND (me.role::text='admin' OR me.id=p_created_by OR cardinality(p_people)=0 OR me.id=ANY(p_people)
  OR (me.role::text='manager' AND EXISTS(SELECT 1 FROM public.group_members t WHERE t.group_id=p_group_id AND t.manager_id=me.id AND t.role::text='member' AND t.id=ANY(p_people))))))
  AND public.waves_two_step_ok(p_group_id);
$function$;

CREATE OR REPLACE FUNCTION public.waves_company_ticket_can(p_group_id uuid, p_assignee uuid, p_created_by uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
 SELECT (SELECT EXISTS(SELECT 1 FROM public.group_members me JOIN public.groups g ON g.id=me.group_id
 WHERE me.group_id=p_group_id AND g.type='company' AND g.deleted_at IS NULL
 AND me.profile_id=public.waves_current_profile_id() AND me.left_at IS NULL AND me.removed_at IS NULL AND me.merged_into_member_id IS NULL
 AND (me.role::text='admin'
  OR (me.role::text IN ('manager','member') AND (p_assignee=me.id OR p_created_by=me.id))
  OR (me.role::text='manager' AND EXISTS(SELECT 1 FROM public.group_members a WHERE a.id=p_assignee AND a.group_id=p_group_id AND a.role::text='member' AND a.manager_id=me.id)))))
  AND public.waves_two_step_ok(p_group_id);
$function$;

CREATE OR REPLACE FUNCTION public.waves_company_vendor_visible(p_group_id uuid, p_vendor_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
 SELECT (SELECT EXISTS(SELECT 1 FROM public.company_vendors v JOIN public.group_members me ON me.group_id=v.group_id JOIN public.groups g ON g.id=v.group_id
 WHERE v.id=p_vendor_id AND v.group_id=p_group_id AND g.type='company' AND g.deleted_at IS NULL
 AND me.profile_id=public.waves_current_profile_id() AND me.left_at IS NULL AND me.removed_at IS NULL AND me.merged_into_member_id IS NULL
 AND (me.role::text='admin' OR (me.role::text='manager' AND v.added_by=me.id) OR (me.role::text='vendor' AND v.member_id=me.id))))
  AND public.waves_two_step_ok(p_group_id);
$function$;

CREATE OR REPLACE FUNCTION public.waves_company_team(p_group_id uuid, p_member_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
 SELECT (SELECT EXISTS(SELECT 1 FROM public.group_members me JOIN public.group_members t ON t.group_id=me.group_id
 JOIN public.groups g ON g.id=me.group_id WHERE me.group_id=p_group_id AND t.id=p_member_id
 AND me.profile_id=public.waves_current_profile_id() AND me.role::text='manager'
 AND me.left_at IS NULL AND me.removed_at IS NULL AND me.merged_into_member_id IS NULL
 AND t.role::text='member' AND t.manager_id=me.id AND g.deleted_at IS NULL AND g.type='company'))
  AND public.waves_two_step_ok(p_group_id);
$function$;

CREATE OR REPLACE FUNCTION public.waves_company_paid_visible(p_group_id uuid, p_created_by uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
 SELECT (SELECT EXISTS(SELECT 1 FROM public.group_members me JOIN public.groups g ON g.id=me.group_id
 WHERE me.group_id=p_group_id AND me.profile_id=public.waves_current_profile_id() AND me.left_at IS NULL AND me.removed_at IS NULL
 AND me.merged_into_member_id IS NULL AND g.type='company' AND g.deleted_at IS NULL
 AND (me.role::text='admin' OR (me.role::text='manager' AND me.id=p_created_by))))
  AND public.waves_two_step_ok(p_group_id);
$function$;

CREATE OR REPLACE FUNCTION public.waves_company_project_visible(p_group_id uuid, p_project_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
 SELECT (SELECT EXISTS(SELECT 1 FROM public.group_members me JOIN public.groups g ON g.id=me.group_id
 WHERE me.group_id=p_group_id AND me.profile_id=public.waves_current_profile_id() AND me.left_at IS NULL AND me.removed_at IS NULL AND me.merged_into_member_id IS NULL AND g.type='company' AND g.deleted_at IS NULL
 AND (me.role::text='admin' OR EXISTS(SELECT 1 FROM public.company_project_members pm JOIN public.group_members t ON t.id=pm.member_id
 WHERE pm.project_id=p_project_id AND pm.group_id=p_group_id AND pm.deleted_at IS NULL AND
 (pm.member_id=me.id OR (me.role::text='manager' AND t.manager_id=me.id AND t.role::text='member'))))))
  AND public.waves_two_step_ok(p_group_id);
$function$;

CREATE OR REPLACE FUNCTION public.waves_company_card_role(p_group_id uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
 SELECT m.role::text FROM public.group_members m JOIN public.groups g ON g.id=m.group_id
 WHERE m.group_id=p_group_id AND g.type='company' AND g.deleted_at IS NULL
 AND m.profile_id=public.waves_current_profile_id() AND m.left_at IS NULL AND m.removed_at IS NULL AND m.merged_into_member_id IS NULL
 AND public.waves_two_step_ok(p_group_id)
 LIMIT 1;
$function$;

CREATE OR REPLACE FUNCTION public.waves_company_manager_ok(p_group_id uuid, p_member_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
 SELECT EXISTS(SELECT 1 FROM public.group_members WHERE id=p_member_id AND group_id=p_group_id AND role::text='manager' AND left_at IS NULL AND removed_at IS NULL AND merged_into_member_id IS NULL AND public.waves_two_step_ok(p_group_id)) $function$;

CREATE OR REPLACE FUNCTION public.waves_group_member_claims(p_group_id uuid)
 RETURNS TABLE(id uuid, member_id uuid, ghost_name text, requester_name text, requested_name text, created_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT c.id,
         c.member_id,
         m.ghost_name,
         p.display_name,
         c.requested_name,
         c.created_at
    FROM public.member_claims c
    JOIN public.group_members m ON m.id = c.member_id
    JOIN public.profiles p      ON p.id = c.requester_id
   WHERE c.group_id = p_group_id
     AND c.status = 'pending'
     AND EXISTS (
       SELECT 1 FROM public.group_members gm
        WHERE gm.group_id = p_group_id
          AND gm.profile_id = public.waves_current_profile_id()
          AND gm.role = 'admin'
          AND gm.left_at IS NULL
          AND public.waves_two_step_ok(p_group_id)
     )
   ORDER BY c.created_at;
$function$;

CREATE OR REPLACE FUNCTION public.waves_group_member_links(p_group_id uuid)
 RETURNS TABLE(id uuid, member_id uuid, target_id uuid, target_name text, target_avatar text, created_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT r.id, r.member_id, r.target_profile_id, p.display_name, p.avatar_url, r.created_at
    FROM public.member_link_requests r
    JOIN public.profiles p ON p.id = r.target_profile_id
   WHERE r.group_id = p_group_id
     AND r.status = 'pending'
     AND EXISTS (
       SELECT 1 FROM public.group_members gm
        WHERE gm.group_id = p_group_id
          AND gm.profile_id = public.waves_current_profile_id()
          AND gm.role = 'admin'
          AND gm.left_at IS NULL
          AND public.waves_two_step_ok(p_group_id)
     )
   ORDER BY r.created_at;
$function$;

CREATE OR REPLACE FUNCTION public.waves_member_link_candidates(p_group_id uuid)
 RETURNS TABLE(profile_id uuid, display_name text, avatar_url text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT DISTINCT ON (p.id) p.id, p.display_name, p.avatar_url
    FROM public.group_members mine
    JOIN public.group_members theirs
      ON theirs.group_id = mine.group_id
     AND theirs.profile_id IS NOT NULL
     AND theirs.left_at IS NULL
     AND theirs.profile_id <> mine.profile_id
    JOIN public.profiles p ON p.id = theirs.profile_id
   WHERE mine.profile_id = public.waves_current_profile_id()
     AND mine.left_at IS NULL
     AND (NOT public.waves_is_company(mine.group_id) OR public.waves_company_detail(mine.group_id,theirs.id))
     AND EXISTS (
       SELECT 1 FROM public.group_members gm
        WHERE gm.group_id = p_group_id
          AND gm.profile_id = public.waves_current_profile_id()
          AND gm.left_at IS NULL
          AND public.waves_two_step_ok(p_group_id)
     )
     AND NOT EXISTS (
       SELECT 1 FROM public.group_members here
        WHERE here.group_id = p_group_id
          AND here.profile_id = p.id
          AND here.left_at IS NULL
     )
     AND NOT public.waves_is_guest(p.id)
   ORDER BY p.id, p.display_name
   LIMIT 200;
$function$;

CREATE OR REPLACE FUNCTION public.waves_is_expense_party(p_expense_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.expenses e
    JOIN public.expense_versions v ON v.id = e.current_version_id
    LEFT JOIN public.expense_payers ep ON ep.expense_version_id = v.id
    JOIN public.group_members gm
      ON gm.id = ep.member_id OR gm.id = v.author_member_id
    WHERE e.id = p_expense_id
      AND gm.profile_id = public.waves_current_profile_id()
      AND gm.left_at IS NULL
      AND public.waves_two_step_ok(e.group_id)
  )
$function$;

CREATE OR REPLACE FUNCTION public.waves_is_settlement_party(p_settlement_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.settlements s
    JOIN public.group_members gm
      ON gm.id IN (s.from_member_id, s.to_member_id)
    WHERE s.id = p_settlement_id
      AND gm.profile_id = public.waves_current_profile_id()
      AND gm.left_at IS NULL
      AND public.waves_two_step_ok(s.group_id)
  )
$function$;

CREATE OR REPLACE FUNCTION public.waves_company_actor(p_group_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_me uuid;
BEGIN
 IF public.waves_current_profile_id() IS NULL THEN RAISE EXCEPTION 'NOT_SIGNED_IN' USING ERRCODE='insufficient_privilege'; END IF;
 IF NOT public.waves_company_agent_allowed(p_group_id) THEN RAISE EXCEPTION 'NOT_LINKED: this assistant is not connected to that company' USING ERRCODE='insufficient_privilege'; END IF;
 SELECT m.id INTO v_me FROM public.group_members m JOIN public.groups g ON g.id=m.group_id
 WHERE m.group_id=p_group_id AND m.profile_id=public.waves_current_profile_id() AND m.left_at IS NULL
 AND m.removed_at IS NULL AND m.merged_into_member_id IS NULL AND g.type='company' AND g.deleted_at IS NULL;
 IF v_me IS NULL THEN RAISE EXCEPTION 'NOT_A_MEMBER: live company membership required' USING ERRCODE='insufficient_privilege'; END IF;
 PERFORM public.waves_two_step_assert(p_group_id);
 RETURN v_me;
END $function$;

CREATE OR REPLACE FUNCTION public.waves_company_agent_gate(p_group_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_client text := public.waves_agent_client_id(); v_me uuid := public.waves_current_profile_id();
 l public.company_agent_links%ROWTYPE; v_role text; v_rpm integer; v_hit jsonb;
BEGIN
 IF v_client IS NULL OR v_me IS NULL OR p_group_id IS NULL THEN RAISE EXCEPTION 'NOT_LINKED: company tools are for connected assistants' USING ERRCODE='insufficient_privilege'; END IF;
 SELECT * INTO l FROM public.company_agent_links WHERE profile_id = v_me AND client_id = v_client;
 IF NOT FOUND OR l.group_id <> p_group_id OR l.revoked_at IS NOT NULL THEN
  RAISE EXCEPTION 'NOT_LINKED: this assistant is not connected to that company' USING ERRCODE='insufficient_privilege';
 END IF;
 IF NOT EXISTS (SELECT 1 FROM public.groups WHERE id = p_group_id AND type = 'company' AND company_agents_enabled AND suspended_at IS NULL AND deleted_at IS NULL) THEN
  RAISE EXCEPTION 'AGENTS_OFF: AI agents are switched off for this company' USING ERRCODE='insufficient_privilege';
 END IF;
 SELECT role::text INTO v_role FROM public.group_members
  WHERE group_id = p_group_id AND profile_id = v_me AND left_at IS NULL AND removed_at IS NULL AND merged_into_member_id IS NULL;
 IF v_role IS NULL OR v_role = 'vendor' THEN RAISE EXCEPTION 'NOT_LINKED: you are no longer part of this company' USING ERRCODE='insufficient_privilege'; END IF;
 PERFORM public.waves_two_step_assert(p_group_id);
 SELECT value INTO v_rpm FROM public.app_config WHERE key = 'agent_company_rpm';
 v_hit := public.waves_rate_limit('agentco:' || p_group_id::text || ':' || v_client, 'agent-company', coalesce(v_rpm, 120), 60);
 IF NOT coalesce((v_hit->>'allowed')::boolean, true) THEN RAISE EXCEPTION 'RATE_LIMITED: slow down' USING ERRCODE='insufficient_privilege'; END IF;
 IF l.last_used_at IS NULL OR l.last_used_at < now() - interval '1 minute' THEN
  UPDATE public.company_agent_links SET last_used_at = now() WHERE id = l.id;
 END IF;
 RETURN v_role;
END $function$;

CREATE OR REPLACE FUNCTION public.waves_company_agent_allowed(p_group_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_client text := public.waves_agent_client_id();
BEGIN
 IF v_client IS NULL THEN RETURN true; END IF;
 IF p_group_id IS NULL THEN RETURN false; END IF;
 IF NOT public.waves_is_company(p_group_id) THEN RETURN true; END IF;
 RETURN EXISTS (SELECT 1 FROM public.company_agent_links l JOIN public.groups g ON g.id = l.group_id
  WHERE l.profile_id = public.waves_current_profile_id() AND l.client_id = v_client AND l.group_id = p_group_id
  AND l.revoked_at IS NULL AND g.company_agents_enabled AND g.suspended_at IS NULL AND g.deleted_at IS NULL)
  AND public.waves_two_step_ok(p_group_id);
END $function$;

CREATE OR REPLACE FUNCTION public.waves_company_agent_link(p_group_id uuid, p_client_id text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_me uuid := public.waves_current_profile_id(); v_client text := btrim(coalesce(p_client_id,''));
BEGIN
 IF v_me IS NULL THEN RAISE EXCEPTION 'NOT_SIGNED_IN' USING ERRCODE='insufficient_privilege'; END IF;
 IF public.waves_agent_client_id() IS NOT NULL THEN RAISE EXCEPTION 'NOT_ALLOWED: an assistant cannot bind itself' USING ERRCODE='insufficient_privilege'; END IF;
 IF v_client = '' OR length(v_client) > 200 THEN RAISE EXCEPTION 'INVALID_DATA: client' USING ERRCODE='check_violation'; END IF;
 IF p_group_id IS NULL THEN
  UPDATE public.company_agent_links SET revoked_at = now() WHERE profile_id = v_me AND client_id = v_client AND revoked_at IS NULL;
  RETURN;
 END IF;
 PERFORM public.waves_company_actor(p_group_id);
 IF NOT EXISTS (SELECT 1 FROM public.groups WHERE id = p_group_id AND company_agents_enabled AND suspended_at IS NULL AND deleted_at IS NULL) THEN
  RAISE EXCEPTION 'AGENTS_OFF: the owner has not allowed AI agents in this company' USING ERRCODE='insufficient_privilege';
 END IF;
 IF EXISTS (SELECT 1 FROM public.group_members WHERE group_id = p_group_id AND profile_id = v_me AND left_at IS NULL AND role::text = 'vendor') THEN
  RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE='insufficient_privilege';
 END IF;
 -- Decision 5: a link only reaches a two-step company when it was made from a verified session.
 INSERT INTO public.company_agent_links(group_id, profile_id, client_id, two_step_verified_at)
 VALUES (p_group_id, v_me, v_client, CASE WHEN public.waves_two_step_session_ok() THEN now() END)
 ON CONFLICT (profile_id, client_id) DO UPDATE SET group_id = EXCLUDED.group_id, revoked_at = NULL, last_used_at = NULL, created_at = now(),
  two_step_verified_at = EXCLUDED.two_step_verified_at;
END $function$;

CREATE OR REPLACE FUNCTION public.waves_company_past_people(p_target_group uuid)
 RETURNS TABLE(source_group_id uuid, source_group_name text, source_member_id uuid, profile_id uuid, display_name text, phone text, email text, is_placeholder boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller uuid := public.waves_current_profile_id();
BEGIN
 IF public.waves_agent_client_id() IS NOT NULL THEN RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE='insufficient_privilege'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.groups g JOIN public.group_members me ON me.group_id = g.id
    WHERE g.id = p_target_group AND g.type = 'company' AND g.deleted_at IS NULL
      AND me.profile_id = v_caller AND public.waves_two_step_ok(me.group_id) AND me.role::text IN ('admin','manager')
      AND me.left_at IS NULL AND me.removed_at IS NULL AND me.merged_into_member_id IS NULL
  ) THEN
    RAISE EXCEPTION 'ADMIN_ONLY' USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN QUERY
  SELECT g.id, g.name, m.id, m.profile_id,
         CASE WHEN m.profile_id IS NULL THEN m.ghost_name ELSE p.display_name END,
         m.invite_phone, m.invite_email, m.profile_id IS NULL
  FROM public.groups g
  JOIN public.group_members m ON m.group_id = g.id
  LEFT JOIN public.profiles p ON p.id = m.profile_id
  WHERE g.id <> p_target_group AND g.type = 'company' AND g.deleted_at IS NULL
    AND m.left_at IS NULL AND m.removed_at IS NULL AND m.merged_into_member_id IS NULL
    AND (m.profile_id IS NULL OR (m.profile_id <> v_caller AND NOT public.waves_is_guest(m.profile_id)))
    AND EXISTS (
      SELECT 1 FROM public.group_members me
      WHERE me.group_id = g.id AND me.profile_id = v_caller AND public.waves_two_step_ok(me.group_id) AND (me.role::text='admin' OR (me.role::text='manager' AND m.manager_id=me.id AND m.role::text='member'))
        AND me.left_at IS NULL AND me.removed_at IS NULL AND me.merged_into_member_id IS NULL
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.group_members target
      WHERE target.group_id = p_target_group
        AND target.left_at IS NULL AND target.removed_at IS NULL AND target.merged_into_member_id IS NULL
        AND (target.profile_id = m.profile_id OR target.invite_phone = m.invite_phone
             OR target.invite_email = m.invite_email
             -- A placeholder with no contact is matched by name, so a retry cannot copy it twice.
             OR (m.profile_id IS NULL AND m.invite_phone IS NULL AND m.invite_email IS NULL
                 AND target.profile_id IS NULL AND target.invite_phone IS NULL AND target.invite_email IS NULL
                 AND lower(target.ghost_name) = lower(m.ghost_name)))
    )
  ORDER BY g.name, CASE WHEN m.profile_id IS NULL THEN m.ghost_name ELSE p.display_name END, m.id
  LIMIT 500;
END
$function$;

CREATE OR REPLACE FUNCTION public.waves_company_add_past_people(p_target_group uuid, p_source_member_ids uuid[])
 RETURNS TABLE(source_member_id uuid, member_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller uuid := public.waves_current_profile_id();
  v_id uuid;
  v_source record;
BEGIN
 IF public.waves_agent_client_id() IS NOT NULL THEN RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE='insufficient_privilege'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.groups g JOIN public.group_members me ON me.group_id = g.id
    WHERE g.id = p_target_group AND g.type = 'company' AND g.deleted_at IS NULL
      AND me.profile_id = v_caller AND public.waves_two_step_ok(me.group_id) AND me.role::text IN ('admin','manager')
      AND me.left_at IS NULL AND me.removed_at IS NULL AND me.merged_into_member_id IS NULL
  ) THEN
    RAISE EXCEPTION 'ADMIN_ONLY' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF cardinality(p_source_member_ids) > 100 THEN
    RAISE EXCEPTION 'TOO_MANY_PEOPLE' USING ERRCODE = 'check_violation';
  END IF;

  FOREACH v_id IN ARRAY coalesce(p_source_member_ids, ARRAY[]::uuid[]) LOOP
    SELECT m.profile_id, m.invite_email, m.invite_phone,
           CASE WHEN m.profile_id IS NULL THEN m.ghost_name ELSE p.display_name END AS name
    INTO v_source
    FROM public.group_members m
    JOIN public.groups g ON g.id = m.group_id
    LEFT JOIN public.profiles p ON p.id = m.profile_id
    WHERE m.id = v_id AND g.type = 'company' AND g.deleted_at IS NULL
      AND m.left_at IS NULL AND m.removed_at IS NULL AND m.merged_into_member_id IS NULL
      AND EXISTS (
        SELECT 1 FROM public.group_members me
        WHERE me.group_id = g.id AND me.profile_id = v_caller AND public.waves_two_step_ok(me.group_id) AND (me.role::text='admin' OR (me.role::text='manager' AND m.manager_id=me.id AND m.role::text='member'))
          AND me.left_at IS NULL AND me.removed_at IS NULL AND me.merged_into_member_id IS NULL
      );
    IF NOT FOUND THEN
      -- Missing and inaccessible ids deliberately have the same answer. Any
      -- failure aborts the statement, including earlier additions in this batch.
      RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = 'insufficient_privilege';
    END IF;
    source_member_id := v_id;
    member_id := NULL;
    IF v_source.profile_id IS NULL AND v_source.invite_phone IS NULL AND v_source.invite_email IS NULL THEN
      SELECT t.id INTO member_id FROM public.group_members t
       WHERE t.group_id = p_target_group AND t.left_at IS NULL AND t.removed_at IS NULL
         AND t.merged_into_member_id IS NULL AND t.profile_id IS NULL
         AND t.invite_phone IS NULL AND t.invite_email IS NULL
         AND lower(t.ghost_name) = lower(v_source.name)
       LIMIT 1;
    END IF;
    IF member_id IS NULL THEN
    member_id := public.waves_add_ghost_member(
      p_target_group, v_source.name, NULL, v_source.invite_email,
      CASE WHEN v_source.invite_phone LIKE '+%' THEN v_source.invite_phone ELSE NULL END,
      v_source.profile_id
    );
    END IF;
    IF NOT public.waves_company_detail(p_target_group,member_id) THEN RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE='insufficient_privilege'; END IF;
    RETURN NEXT;
  END LOOP;
END
$function$;

CREATE OR REPLACE FUNCTION public.waves_generate_my_recurring_expenses(p_today date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_profile    uuid := public.waves_current_profile_id();
  -- Never later than tomorrow in UTC: a phone's "today" may be ahead of UTC by
  -- up to 14 hours, and not a day further.
  v_now        timestamptz := LEAST(
                   COALESCE((p_today::text || ' 00:00:00+00')::timestamptz, now()),
                   now() + interval '1 day');
  g            record;
  v_one        jsonb;
  v_generated  integer := 0;
  v_replayed   integer := 0;
  v_failed     integer := 0;
BEGIN
  IF v_profile IS NULL THEN
    RAISE EXCEPTION 'NOT_SIGNED_IN' USING ERRCODE = 'insufficient_privilege';
  END IF;

  FOR g IN
    SELECT DISTINCT gm.group_id
      FROM public.group_members gm
      JOIN public.group_recurring_expenses x ON x.group_id = gm.group_id
     WHERE gm.profile_id = v_profile AND gm.left_at IS NULL AND public.waves_two_step_ok(gm.group_id)
       AND x.status = 'active' AND x.next_date <= (v_now AT TIME ZONE 'UTC')::date
  LOOP
    v_one := public.waves_generate_recurring_expenses(v_now, g.group_id);
    v_generated := v_generated + (v_one ->> 'generated')::int;
    v_replayed  := v_replayed  + (v_one ->> 'replayed')::int;
    v_failed    := v_failed    + (v_one ->> 'failed')::int;
  END LOOP;

  RETURN jsonb_build_object('generated', v_generated, 'replayed', v_replayed, 'failed', v_failed);
END
$function$;


-- ─────────────────────────────────────────────── every write, whatever path made it ──

-- Belt to the helpers' braces: no INSERT or UPDATE reaches a two-step company's rows from an unverified caller, whether
-- it came through RLS or a SECURITY DEFINER RPC with its own membership check. Nested writes (trigger depth > 1) are the
-- consequence of an outer statement that was itself checked, or of a cascade. Deletes are left to RLS and the gated
-- helpers: account erasure cascades through them.
CREATE FUNCTION public.waves_two_step_write_guard() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
DECLARE v_group uuid; v_old uuid;
BEGIN
 IF pg_trigger_depth() > 1 OR public.waves_current_profile_id() IS NULL THEN RETURN NEW; END IF;
 IF TG_TABLE_NAME = 'groups' THEN v_group := NEW.id; ELSE v_group := (to_jsonb(NEW) ->> 'group_id')::uuid; END IF;
 IF TG_OP = 'UPDATE' THEN
  IF TG_TABLE_NAME <> 'groups' THEN v_old := (to_jsonb(OLD) ->> 'group_id')::uuid; END IF;
  -- Erasing your own account anonymises your member rows; that is leaving, not reading.
  IF TG_TABLE_NAME = 'group_members' AND (to_jsonb(OLD) ->> 'profile_id')::uuid = public.waves_current_profile_id()
     AND to_jsonb(NEW) ->> 'profile_id' IS NULL THEN RETURN NEW; END IF;
 END IF;
 IF (v_group IS NOT NULL AND NOT public.waves_two_step_ok(v_group))
    OR (v_old IS NOT NULL AND v_old IS DISTINCT FROM v_group AND NOT public.waves_two_step_ok(v_old)) THEN
  RAISE EXCEPTION 'TWO_STEP_REQUIRED: verify two-step to keep working in this company' USING ERRCODE = 'insufficient_privilege';
 END IF;
 RETURN NEW;
END $$;

DO $$
DECLARE t text;
BEGIN
 FOR t IN
  SELECT c.table_name FROM information_schema.columns c JOIN information_schema.tables x
    ON x.table_schema = c.table_schema AND x.table_name = c.table_name AND x.table_type = 'BASE TABLE'
   WHERE c.table_schema = 'public' AND c.column_name = 'group_id'
     -- Written by the service role or personal to the caller (pins, mutes, inbox, diagnostics).
     AND c.table_name NOT IN ('sync_mutations','sync_refusals','usage_events','group_pins','group_mutes','notifications','agent_writes')
  UNION ALL SELECT 'groups'
 LOOP
  EXECUTE format('CREATE TRIGGER zz_two_step_write_guard BEFORE INSERT OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.waves_two_step_write_guard()', t);
 END LOOP;
END $$;

-- ─────────────────────────────────────────────── policies that check membership inline ──

ALTER POLICY member_claims_visible ON public.member_claims USING (
 requester_id = public.waves_current_profile_id() OR EXISTS (SELECT 1 FROM public.group_members gm
  WHERE gm.group_id = member_claims.group_id AND gm.profile_id = public.waves_current_profile_id()
    AND gm.role = 'admin'::"MemberRole" AND gm.left_at IS NULL AND public.waves_two_step_ok(gm.group_id)));

ALTER POLICY member_link_requests_visible ON public.member_link_requests USING (
 target_profile_id = public.waves_current_profile_id() OR requested_by = public.waves_current_profile_id()
 OR EXISTS (SELECT 1 FROM public.group_members gm
  WHERE gm.group_id = member_link_requests.group_id AND gm.profile_id = public.waves_current_profile_id()
    AND gm.role = 'admin'::"MemberRole" AND gm.left_at IS NULL AND public.waves_two_step_ok(gm.group_id)));

ALTER POLICY profiles_select ON public.profiles USING (
 id = public.waves_current_profile_id() OR EXISTS (SELECT 1 FROM public.group_members mine
  JOIN public.group_members theirs ON theirs.group_id = mine.group_id
  WHERE mine.profile_id = public.waves_current_profile_id() AND mine.left_at IS NULL AND theirs.profile_id = profiles.id
    AND public.waves_two_step_ok(mine.group_id)));

-- A company's notices (titles quote amounts and names) stay unreadable until this session verifies.
ALTER POLICY notifications_select_own ON public.notifications USING (
 profile_id = public.waves_current_profile_id() AND (group_id IS NULL OR public.waves_two_step_ok(group_id)));

ALTER POLICY company_agent_links_own_read ON public.company_agent_links USING (
 profile_id = public.waves_current_profile_id() AND public.waves_two_step_ok(group_id));

-- ─────────────────────────────────────── developer API: tokens remember a verified origin ──

-- A code is issued from the consenting person's own session; its tokens inherit what that session was.
CREATE FUNCTION public.waves_api_code_two_step() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
BEGIN
 IF TG_OP = 'INSERT' THEN
  NEW.two_step_verified_at := CASE WHEN public.waves_two_step_session_ok() THEN now() END;
 ELSIF NEW.consumed_at IS NOT NULL AND OLD.consumed_at IS NULL THEN
  -- Read back by the token insert in the same transaction (waves_api_consume_code).
  PERFORM set_config('waves.api_two_step', coalesce(OLD.two_step_verified_at::text, 'none'), true);
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER api_codes_two_step BEFORE INSERT OR UPDATE ON public.api_authorization_codes
 FOR EACH ROW EXECUTE FUNCTION public.waves_api_code_two_step();

CREATE FUNCTION public.waves_api_token_two_step() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
DECLARE v text;
BEGIN
 IF TG_OP = 'UPDATE' THEN
  -- Rotation revokes the old refresh token, then inserts its successor in the same transaction.
  IF NEW.revoked_at IS NOT NULL AND OLD.revoked_at IS NULL AND OLD.kind = 'refresh' THEN
   PERFORM set_config('waves.api_two_step', coalesce(OLD.two_step_verified_at::text, 'none'), true);
  END IF;
  RETURN NEW;
 END IF;
 IF NEW.parent_id IS NOT NULL THEN
  SELECT two_step_verified_at INTO NEW.two_step_verified_at FROM public.api_tokens WHERE id = NEW.parent_id;
 ELSIF NEW.kind = 'personal' THEN
  NEW.two_step_verified_at := CASE WHEN public.waves_two_step_session_ok() THEN now() END;
 ELSE
  v := nullif(current_setting('waves.api_two_step', true), '');
  NEW.two_step_verified_at := CASE WHEN v IS NULL OR v = 'none' THEN NULL ELSE v::timestamptz END;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER api_tokens_two_step BEFORE INSERT OR UPDATE ON public.api_tokens
 FOR EACH ROW EXECUTE FUNCTION public.waves_api_token_two_step();

REVOKE ALL ON FUNCTION public.waves_two_step_write_guard(), public.waves_api_code_two_step(), public.waves_api_token_two_step()
 FROM PUBLIC, anon, authenticated;

-- ───────────────────────────────────────────────────────── people-facing RPCs ──

-- Where this person stands. Deliberately not gated: it is how a blocked session learns what to ask for.
CREATE FUNCTION public.waves_two_step_status() RETURNS jsonb
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
DECLARE v_me uuid := public.waves_current_profile_id();
BEGIN
 IF v_me IS NULL THEN RAISE EXCEPTION 'NOT_SIGNED_IN' USING ERRCODE = 'insufficient_privilege'; END IF;
 RETURN jsonb_build_object(
  'sessionVerified', public.waves_two_step_session_ok(),
  'hasPhone', EXISTS (SELECT 1 FROM public.two_step_secrets WHERE profile_id = v_me AND kind = 'phone' AND active),
  'hasAuthenticator', EXISTS (SELECT 1 FROM public.two_step_secrets WHERE profile_id = v_me AND kind = 'authenticator' AND active),
  'pendingDevice', EXISTS (SELECT 1 FROM public.two_step_device_requests WHERE profile_id = v_me
     AND session_id = public.waves_jwt_session_id() AND status = 'pending'),
  'requiring', coalesce((SELECT jsonb_agg(jsonb_build_object('groupId', g.id, 'name', g.name) ORDER BY g.name)
     FROM public.group_members m JOIN public.groups g ON g.id = m.group_id
    WHERE m.profile_id = v_me AND m.left_at IS NULL AND m.removed_at IS NULL AND m.merged_into_member_id IS NULL
      AND g.type = 'company' AND g.require_two_step AND g.deleted_at IS NULL), '[]'::jsonb));
END $$;

-- The caller's live role in a company, without the two-step gate (the toggle/reset RPCs check the session themselves).
CREATE FUNCTION public.waves_two_step_role(p_group_id uuid) RETURNS public.group_members
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
 SELECT m.* FROM public.group_members m JOIN public.groups g ON g.id = m.group_id
  WHERE m.group_id = p_group_id AND g.type = 'company' AND g.deleted_at IS NULL
    AND m.profile_id = public.waves_current_profile_id() AND m.left_at IS NULL AND m.removed_at IS NULL
    AND m.merged_into_member_id IS NULL AND m.role::text IN ('admin','manager')
  LIMIT 1
$$;
REVOKE ALL ON FUNCTION public.waves_two_step_role(uuid) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.waves_two_step_manager_guard(p_group_id uuid) RETURNS public.group_members
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
DECLARE v_me public.group_members;
BEGIN
 IF public.waves_current_profile_id() IS NULL THEN RAISE EXCEPTION 'NOT_SIGNED_IN' USING ERRCODE = 'insufficient_privilege'; END IF;
 IF public.waves_agent_client_id() IS NOT NULL OR public.waves_api_token_id() IS NOT NULL THEN
  RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE = 'insufficient_privilege';
 END IF;
 v_me := public.waves_two_step_role(p_group_id);
 IF v_me.id IS NULL THEN RAISE EXCEPTION 'NOT_ALLOWED: owners and managers only' USING ERRCODE = 'insufficient_privilege'; END IF;
 IF NOT public.waves_two_step_session_ok() THEN
  RAISE EXCEPTION 'TWO_STEP_REQUIRED: verify two-step on this device first' USING ERRCODE = 'insufficient_privilege';
 END IF;
 RETURN v_me;
END $$;
REVOKE ALL ON FUNCTION public.waves_two_step_manager_guard(uuid) FROM PUBLIC, anon, authenticated;

-- Tell somebody about a two-step change. group_id stays NULL so the notice is readable before they verify.
CREATE FUNCTION public.waves_two_step_notify(p_profile uuid, p_kind text, p_title text, p_body text, p_dedupe text)
 RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
 SELECT public.waves_notify(p_profile, NULL, p_kind, p_title, p_body, '/settings/two-step', '{}'::jsonb, p_dedupe)
$$;
REVOKE ALL ON FUNCTION public.waves_two_step_notify(uuid,text,text,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.waves_two_step_notify(uuid,text,text,text,text) TO service_role;

CREATE FUNCTION public.waves_company_set_two_step(p_group_id uuid, p_on boolean) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
DECLARE v_me public.group_members; v_name text; r record;
BEGIN
 v_me := public.waves_two_step_manager_guard(p_group_id);
 IF p_on IS NULL THEN RAISE EXCEPTION 'INVALID_DATA' USING ERRCODE = 'check_violation'; END IF;
 IF p_on AND NOT coalesce((SELECT enabled FROM public.feature_flags WHERE key = 'company_two_step'), false) THEN
  RAISE EXCEPTION 'FEATURE_OFF: two-step login is not available yet' USING ERRCODE = 'insufficient_privilege';
 END IF;
 UPDATE public.groups SET require_two_step = p_on, updated_at = now()
  WHERE id = p_group_id AND require_two_step IS DISTINCT FROM p_on RETURNING name INTO v_name;
 IF NOT FOUND THEN RETURN; END IF;
 INSERT INTO public.activity_log (group_id, actor_member_id, verb, object_type, object_id, payload)
 VALUES (p_group_id, v_me.id, CASE WHEN p_on THEN 'two_step_on' ELSE 'two_step_off' END, 'group', p_group_id, '{}'::jsonb);
 FOR r IN SELECT DISTINCT m.profile_id FROM public.group_members m WHERE m.group_id = p_group_id AND m.profile_id IS NOT NULL
   AND m.left_at IS NULL AND m.removed_at IS NULL AND m.profile_id <> v_me.profile_id LOOP
  PERFORM public.waves_two_step_notify(r.profile_id, 'two_step_toggle',
   CASE WHEN p_on THEN v_name || ' now asks for two-step login' ELSE v_name || ' no longer asks for two-step login' END,
   CASE WHEN p_on THEN 'Update Waves and keep it on your phone: it shows your code.' ELSE 'Nothing to do.' END,
   'two_step_toggle:' || p_group_id || ':' || p_on || ':' || extract(epoch FROM now())::bigint);
 END LOOP;
END $$;

-- Who is ready, who needs to update, and which new phones wait for approval.
CREATE FUNCTION public.waves_company_two_step_overview(p_group_id uuid) RETURNS jsonb
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
DECLARE v_me public.group_members;
BEGIN
 v_me := public.waves_two_step_manager_guard(p_group_id);
 RETURN jsonb_build_object(
  'requireTwoStep', (SELECT require_two_step FROM public.groups WHERE id = p_group_id),
  'members', coalesce((SELECT jsonb_agg(jsonb_build_object('memberId', m.id, 'name', coalesce(p.display_name, 'Someone'),
     'role', m.role::text, 'canReset', public.waves_two_step_may_act_for(p_group_id, m.profile_id),
     'hasFactor', EXISTS (SELECT 1 FROM public.two_step_secrets s WHERE s.profile_id = m.profile_id AND s.active),
     'appVersion', (SELECT d.app_version FROM public.device_sessions d WHERE d.profile_id = m.profile_id AND d.revoked_at IS NULL
        ORDER BY d.last_seen_at DESC LIMIT 1)) ORDER BY p.display_name)
    FROM public.group_members m JOIN public.profiles p ON p.id = m.profile_id
   WHERE m.group_id = p_group_id AND m.left_at IS NULL AND m.removed_at IS NULL AND m.merged_into_member_id IS NULL
     AND (v_me.role::text = 'admin' OR public.waves_company_detail(p_group_id, m.id))), '[]'::jsonb),
  'pendingDevices', coalesce((SELECT jsonb_agg(jsonb_build_object('requestId', r.id, 'memberId', m.id,
     'name', coalesce(p.display_name, 'Someone'), 'platform', r.platform, 'createdAt', r.created_at) ORDER BY r.created_at)
    FROM public.two_step_device_requests r JOIN public.group_members m ON m.profile_id = r.profile_id AND m.group_id = p_group_id
    JOIN public.profiles p ON p.id = r.profile_id
   WHERE r.status = 'pending' AND r.created_at > now() - interval '7 days' AND m.left_at IS NULL AND m.removed_at IS NULL
     AND r.profile_id <> v_me.profile_id
     AND public.waves_two_step_may_act_for(p_group_id, r.profile_id)), '[]'::jsonb));
END $$;

-- Factors are per person, not per company: a reset or an approval changes this person's two-step in every company.
-- So the caller must outrank them in EVERY two-step company they are live in (an owner over anyone, a manager over
-- plain members only), and the company acted from must itself require two-step.
CREATE FUNCTION public.waves_two_step_may_act_for(p_group_id uuid, p_target uuid) RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
 SELECT EXISTS (SELECT 1 FROM public.groups WHERE id = p_group_id AND type = 'company' AND require_two_step AND deleted_at IS NULL)
  AND p_target IS DISTINCT FROM public.waves_current_profile_id()
  AND NOT EXISTS (
   SELECT 1 FROM public.group_members t JOIN public.groups g ON g.id = t.group_id
    WHERE t.profile_id = p_target AND t.left_at IS NULL AND t.removed_at IS NULL AND t.merged_into_member_id IS NULL
      AND g.type = 'company' AND g.require_two_step AND g.deleted_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM public.group_members me WHERE me.group_id = g.id
        AND me.profile_id = public.waves_current_profile_id() AND me.left_at IS NULL AND me.removed_at IS NULL
        AND me.merged_into_member_id IS NULL
        AND (me.role::text = 'admin' OR (me.role::text = 'manager' AND t.role::text = 'member'))))
$$;
REVOKE ALL ON FUNCTION public.waves_two_step_may_act_for(uuid,uuid) FROM PUBLIC, anon, authenticated;

-- Lost phone: clear someone's codes so their next phone sets up again. A manager cannot reset an owner.
CREATE FUNCTION public.waves_two_step_reset(p_group_id uuid, p_member_id uuid) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
DECLARE v_me public.group_members; v_target public.group_members; v_name text; v_who text; r record;
BEGIN
 v_me := public.waves_two_step_manager_guard(p_group_id);
 SELECT * INTO v_target FROM public.group_members WHERE id = p_member_id AND group_id = p_group_id AND profile_id IS NOT NULL
  AND left_at IS NULL AND removed_at IS NULL AND merged_into_member_id IS NULL;
 IF NOT FOUND OR NOT public.waves_two_step_may_act_for(p_group_id, v_target.profile_id) THEN
  RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE = 'insufficient_privilege';
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('two_step:' || v_target.profile_id::text, 0));
 DELETE FROM public.two_step_secrets WHERE profile_id = v_target.profile_id;
 DELETE FROM public.two_step_sessions WHERE profile_id = v_target.profile_id;
 UPDATE public.two_step_device_requests SET status = 'declined', decided_at = now(), decided_by = v_me.profile_id
  WHERE profile_id = v_target.profile_id AND status IN ('pending','approved');
 DELETE FROM public.two_step_lockouts WHERE profile_id = v_target.profile_id;
 -- Credentials minted from the old verified session must not outlive the reset.
 UPDATE public.api_tokens SET two_step_verified_at = NULL WHERE profile_id = v_target.profile_id AND two_step_verified_at IS NOT NULL;
 UPDATE public.api_authorization_codes SET two_step_verified_at = NULL WHERE profile_id = v_target.profile_id AND two_step_verified_at IS NOT NULL;
 UPDATE public.company_agent_links SET two_step_verified_at = NULL WHERE profile_id = v_target.profile_id AND two_step_verified_at IS NOT NULL;
 INSERT INTO public.activity_log (group_id, actor_member_id, verb, object_type, object_id, payload)
 VALUES (p_group_id, v_me.id, 'two_step_reset', 'member', v_target.id, '{}'::jsonb);
 SELECT name INTO v_name FROM public.groups WHERE id = p_group_id;
 SELECT display_name INTO v_who FROM public.profiles WHERE id = v_target.profile_id;
 PERFORM public.waves_two_step_notify(v_target.profile_id, 'two_step_reset', 'Your two-step login was reset',
  'An owner or manager of ' || v_name || ' reset it. Open Waves on your phone to set it up again.',
  'two_step_reset:' || v_target.profile_id || ':' || extract(epoch FROM now())::bigint);
 FOR r IN SELECT DISTINCT m.profile_id FROM public.group_members m WHERE m.group_id = p_group_id AND m.role::text = 'admin'
   AND m.profile_id IS NOT NULL AND m.left_at IS NULL AND m.removed_at IS NULL AND m.profile_id <> v_target.profile_id LOOP
  PERFORM public.waves_two_step_notify(r.profile_id, 'two_step_reset', coalesce(v_who, 'Someone') || '''s two-step login was reset',
   'In ' || v_name || '.', 'two_step_reset:' || v_target.profile_id || ':' || r.profile_id || ':' || extract(epoch FROM now())::bigint);
 END LOOP;
END $$;

-- Approve (or decline) a member's new phone. Never your own; a manager cannot approve an owner's.
CREATE FUNCTION public.waves_two_step_decide_device(p_request_id uuid, p_group_id uuid, p_approve boolean) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
DECLARE v_me public.group_members; v_req public.two_step_device_requests; v_role text; v_name text;
BEGIN
 v_me := public.waves_two_step_manager_guard(p_group_id);
 IF p_approve IS NULL THEN RAISE EXCEPTION 'INVALID_DATA' USING ERRCODE = 'check_violation'; END IF;
 SELECT * INTO v_req FROM public.two_step_device_requests WHERE id = p_request_id AND status = 'pending' FOR UPDATE;
 SELECT m.role::text INTO v_role FROM public.group_members m WHERE m.group_id = p_group_id AND m.profile_id = v_req.profile_id
  AND m.left_at IS NULL AND m.removed_at IS NULL AND m.merged_into_member_id IS NULL;
 IF v_req.id IS NULL OR v_role IS NULL OR NOT public.waves_two_step_may_act_for(p_group_id, v_req.profile_id) THEN
  RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE = 'insufficient_privilege';
 END IF;
 UPDATE public.two_step_device_requests SET status = CASE WHEN p_approve THEN 'approved' ELSE 'declined' END,
  decided_by = v_me.profile_id, decided_at = now() WHERE id = v_req.id;
 INSERT INTO public.activity_log (group_id, actor_member_id, verb, object_type, object_id, payload)
 VALUES (p_group_id, v_me.id, CASE WHEN p_approve THEN 'two_step_device_approved' ELSE 'two_step_device_declined' END,
  'two_step_device', v_req.id, '{}'::jsonb);
 SELECT name INTO v_name FROM public.groups WHERE id = p_group_id;
 PERFORM public.waves_two_step_notify(v_req.profile_id, 'two_step_new_phone',
  CASE WHEN p_approve THEN 'Your new phone was approved' ELSE 'Your new phone was not approved' END,
  CASE WHEN p_approve THEN 'Open Waves on it to keep working in ' || v_name || '.'
   ELSE 'Ask an owner of ' || v_name || ' if this was not expected.' END,
  'two_step_device:' || v_req.id);
END $$;

REVOKE ALL ON FUNCTION public.waves_two_step_status(), public.waves_company_set_two_step(uuid,boolean),
 public.waves_company_two_step_overview(uuid), public.waves_two_step_reset(uuid,uuid),
 public.waves_two_step_decide_device(uuid,uuid,boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.waves_two_step_status(), public.waves_company_set_two_step(uuid,boolean),
 public.waves_company_two_step_overview(uuid), public.waves_two_step_reset(uuid,uuid),
 public.waves_two_step_decide_device(uuid,uuid,boolean) TO authenticated, service_role;

-- ──────────────────────────────────────────── edge-function RPCs (service role only) ──

-- One code attempt, atomically: the person's lockout row is locked, so concurrent attempts run one at a time; the step
-- only moves forward (a reused or older code updates nothing); failures count to a 15-minute lock. On success the
-- session is marked (or, with p_activate, a pending authenticator becomes the active one).
CREATE FUNCTION public.waves_two_step_attempt(p_profile uuid, p_secret_id uuid, p_step bigint, p_session uuid,
 p_kind text, p_device text, p_activate boolean DEFAULT false) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
DECLARE l public.two_step_lockouts; v_ok boolean := false;
BEGIN
 IF p_profile IS NULL OR p_session IS NULL OR p_kind NOT IN ('phone','web') THEN
  RAISE EXCEPTION 'INVALID_DATA' USING ERRCODE = 'check_violation';
 END IF;
 INSERT INTO public.two_step_lockouts(profile_id) VALUES (p_profile) ON CONFLICT DO NOTHING;
 SELECT * INTO l FROM public.two_step_lockouts WHERE profile_id = p_profile FOR UPDATE;
 IF l.locked_until IS NOT NULL AND l.locked_until > now() THEN
  RETURN jsonb_build_object('ok', false, 'reason', 'LOCKED', 'until', l.locked_until);
 END IF;
 IF p_secret_id IS NOT NULL AND p_step IS NOT NULL THEN
  IF p_activate THEN
   IF EXISTS (SELECT 1 FROM public.two_step_secrets WHERE id = p_secret_id AND profile_id = p_profile
       AND kind = 'authenticator' AND NOT active AND created_at > now() - interval '15 minutes') THEN
    DELETE FROM public.two_step_secrets WHERE profile_id = p_profile AND kind = 'authenticator' AND active;
    UPDATE public.two_step_secrets SET active = true, activated_at = now(), last_step = p_step
     WHERE id = p_secret_id AND NOT active;
    v_ok := FOUND;
   END IF;
  ELSE
   UPDATE public.two_step_secrets SET last_step = p_step
    WHERE id = p_secret_id AND profile_id = p_profile AND active AND last_step < p_step;
   v_ok := FOUND;
  END IF;
 END IF;
 IF v_ok THEN
  UPDATE public.two_step_lockouts SET failures = 0, locked_until = NULL WHERE profile_id = p_profile;
  IF NOT p_activate THEN
   INSERT INTO public.two_step_sessions(session_id, profile_id, kind, device_id) VALUES (p_session, p_profile, p_kind, p_device)
   ON CONFLICT (session_id, profile_id) DO UPDATE SET verified_at = now(), kind = EXCLUDED.kind, device_id = EXCLUDED.device_id;
  END IF;
  RETURN jsonb_build_object('ok', true);
 END IF;
 UPDATE public.two_step_lockouts
    SET failures = failures + 1,
        -- Failures keep counting until a right code: 15 min after the 10th miss, doubling each 10 more, capped at 24 h.
        locked_until = CASE WHEN (failures + 1) % 10 = 0
          THEN now() + least(interval '24 hours', interval '15 minutes' * power(2, least((failures + 1) / 10 - 1, 7))) END
  WHERE profile_id = p_profile RETURNING * INTO l;
 RETURN jsonb_build_object('ok', false, 'reason', CASE WHEN l.locked_until IS NOT NULL THEN 'LOCKED' ELSE 'BAD_CODE' END);
END $$;

-- Make p_secret_enc this person's one active phone secret and mark the session. p_mode says why, re-checked here under
-- the per-person lock: 'first' (no factor at all yet), 'code' (a fresh code from an existing factor, consumed in this
-- same transaction, so it cannot be reused or detached from this issuance) or 'approved' (an owner/manager approved
-- this exact session and device). A session mark alone never replaces a phone.
CREATE FUNCTION public.waves_two_step_trust_phone(p_profile uuid, p_session uuid, p_device text, p_secret_enc text,
 p_mode text, p_secret_id uuid DEFAULT NULL, p_step bigint DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
DECLARE v_req uuid; v_new_phone boolean; r record; v_attempt jsonb;
BEGIN
 IF p_profile IS NULL OR p_session IS NULL OR p_device IS NULL OR p_secret_enc IS NULL
    OR p_mode NOT IN ('first','code','approved') THEN
  RAISE EXCEPTION 'INVALID_DATA' USING ERRCODE = 'check_violation';
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('two_step:' || p_profile::text, 0));
 IF p_mode = 'first' AND EXISTS (SELECT 1 FROM public.two_step_secrets WHERE profile_id = p_profile AND active) THEN
  RETURN jsonb_build_object('ok', false, 'reason', 'HAS_FACTOR');
 END IF;
 IF p_mode = 'code' THEN
  v_attempt := public.waves_two_step_attempt(p_profile, p_secret_id, p_step, p_session, 'phone', p_device);
  IF NOT (v_attempt ->> 'ok')::boolean THEN RETURN v_attempt; END IF;
 END IF;
 IF p_mode = 'approved' THEN
  UPDATE public.two_step_device_requests SET status = 'used' WHERE profile_id = p_profile AND session_id = p_session
   AND device_id = p_device AND status = 'approved' AND decided_at > now() - interval '1 day' RETURNING id INTO v_req;
  IF v_req IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'NOT_APPROVED'); END IF;
 END IF;
 v_new_phone := EXISTS (SELECT 1 FROM public.two_step_secrets WHERE profile_id = p_profile AND active);
 DELETE FROM public.two_step_secrets WHERE profile_id = p_profile AND kind = 'phone';
 INSERT INTO public.two_step_secrets(profile_id, kind, device_id, secret_enc, active, activated_at)
 VALUES (p_profile, 'phone', p_device, p_secret_enc, true, now());
 UPDATE public.two_step_device_requests SET status = 'used' WHERE profile_id = p_profile AND device_id = p_device AND status = 'pending';
 INSERT INTO public.two_step_sessions(session_id, profile_id, kind, device_id) VALUES (p_session, p_profile, 'phone', p_device)
 ON CONFLICT (session_id, profile_id) DO UPDATE SET verified_at = now(), kind = 'phone', device_id = EXCLUDED.device_id;
 IF v_new_phone THEN
  -- To the person: every device they have, the old phone included, gets this push.
  PERFORM public.waves_two_step_notify(p_profile, 'two_step_new_phone', 'A new phone now shows your two-step code',
   'If this was not you, ask your company owner to reset your two-step login.', 'two_step_phone:' || p_profile || ':' || p_device);
  FOR r IN SELECT DISTINCT o.profile_id FROM public.group_members me JOIN public.groups g ON g.id = me.group_id
     JOIN public.group_members o ON o.group_id = g.id AND o.role::text = 'admin' AND o.left_at IS NULL AND o.removed_at IS NULL
    WHERE me.profile_id = p_profile AND me.left_at IS NULL AND me.removed_at IS NULL AND g.require_two_step AND g.deleted_at IS NULL
      AND o.profile_id IS NOT NULL AND o.profile_id <> p_profile LOOP
   PERFORM public.waves_two_step_notify(r.profile_id, 'two_step_new_phone', 'A member set up two-step on a new phone',
    coalesce((SELECT display_name FROM public.profiles WHERE id = p_profile), 'Someone') || ' moved their code to a new phone.',
    'two_step_phone:' || p_profile || ':' || p_device || ':' || r.profile_id);
  END LOOP;
 END IF;
 RETURN jsonb_build_object('ok', true);
END $$;

-- A new phone asks to be let in: one open request per device; owners and managers of its two-step companies hear of it.
CREATE FUNCTION public.waves_two_step_request_device(p_profile uuid, p_session uuid, p_device text, p_platform text)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
DECLARE v_id uuid; v_new boolean := false; r record;
BEGIN
 SELECT id INTO v_id FROM public.two_step_device_requests WHERE profile_id = p_profile AND device_id = p_device
  AND status IN ('pending','approved') FOR UPDATE;
 IF v_id IS NULL THEN
  INSERT INTO public.two_step_device_requests(profile_id, session_id, device_id, platform)
  VALUES (p_profile, p_session, p_device, left(p_platform, 20)) RETURNING id INTO v_id;
  v_new := true;
 ELSE
  -- A fresh sign-in on the same phone re-asks; an approval only counts for the session it was given to.
  UPDATE public.two_step_device_requests SET session_id = p_session, status = 'pending', decided_by = NULL, decided_at = NULL
   WHERE id = v_id AND session_id <> p_session;
 END IF;
 IF v_new THEN
  FOR r IN SELECT DISTINCT o.profile_id FROM public.group_members me JOIN public.groups g ON g.id = me.group_id
     JOIN public.group_members o ON o.group_id = g.id AND o.left_at IS NULL AND o.removed_at IS NULL
      AND (o.role::text = 'admin' OR (o.role::text = 'manager' AND me.role::text <> 'admin'))
    WHERE me.profile_id = p_profile AND me.left_at IS NULL AND me.removed_at IS NULL AND g.require_two_step AND g.deleted_at IS NULL
      AND o.profile_id IS NOT NULL AND o.profile_id <> p_profile LOOP
   PERFORM public.waves_two_step_notify(r.profile_id, 'two_step_device_request', 'A member asks to approve a new phone',
    coalesce((SELECT display_name FROM public.profiles WHERE id = p_profile), 'Someone') || ' is signing in on a new phone.',
    'two_step_request:' || v_id || ':' || r.profile_id);
  END LOOP;
 END IF;
 RETURN v_id;
END $$;

REVOKE ALL ON FUNCTION public.waves_two_step_attempt(uuid,uuid,bigint,uuid,text,text,boolean),
 public.waves_two_step_trust_phone(uuid,uuid,text,text,text,uuid,bigint), public.waves_two_step_request_device(uuid,uuid,text,text)
 FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.waves_two_step_attempt(uuid,uuid,bigint,uuid,text,text,boolean),
 public.waves_two_step_trust_phone(uuid,uuid,text,text,text,uuid,bigint), public.waves_two_step_request_device(uuid,uuid,text,text)
 TO service_role;

-- ───────────────────────────────────────────── the member rows' copy of the company flag ──

-- Always copied from the company, whatever the writer sent, so it cannot be set by hand.
CREATE FUNCTION public.waves_member_two_step_copy() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
BEGIN
 NEW.company_two_step := coalesce((SELECT g.require_two_step FROM public.groups g WHERE g.id = NEW.group_id), false);
 RETURN NEW;
END $$;
CREATE TRIGGER a_two_step_copy BEFORE INSERT OR UPDATE ON public.group_members
 FOR EACH ROW EXECUTE FUNCTION public.waves_member_two_step_copy();

CREATE FUNCTION public.waves_group_two_step_fanout() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
BEGIN
 UPDATE public.group_members SET company_two_step = NEW.require_two_step
  WHERE group_id = NEW.id AND company_two_step IS DISTINCT FROM NEW.require_two_step;
 RETURN NEW;
END $$;
CREATE TRIGGER two_step_fanout AFTER UPDATE OF require_two_step ON public.groups
 FOR EACH ROW WHEN (NEW.require_two_step IS DISTINCT FROM OLD.require_two_step)
 EXECUTE FUNCTION public.waves_group_two_step_fanout();
REVOKE ALL ON FUNCTION public.waves_member_two_step_copy(), public.waves_group_two_step_fanout() FROM PUBLIC, anon, authenticated;

-- ───────────────────────────────────────────── marks die with their session ──

-- A device signed out or erased loses its phone mark at once.
CREATE FUNCTION public.waves_two_step_forget_device() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
BEGIN
 DELETE FROM public.two_step_sessions WHERE profile_id = NEW.profile_id AND device_id = NEW.device_id;
 RETURN NEW;
END $$;
CREATE TRIGGER two_step_forget_device AFTER UPDATE OF revoked_at ON public.device_sessions
 FOR EACH ROW WHEN (NEW.revoked_at IS NOT NULL AND OLD.revoked_at IS NULL)
 EXECUTE FUNCTION public.waves_two_step_forget_device();

-- And with the GoTrue session itself, where this role may attach a trigger to auth.sessions (hosted Supabase). Where it
-- may not, the live-session check in waves_two_step_session_ok still refuses a dead session.
CREATE FUNCTION public.waves_two_step_forget_session() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
BEGIN
 DELETE FROM public.two_step_sessions WHERE session_id = OLD.id;
 RETURN OLD;
END $$;
REVOKE ALL ON FUNCTION public.waves_two_step_forget_device(), public.waves_two_step_forget_session() FROM PUBLIC, anon, authenticated;
DO $$
BEGIN
 IF to_regclass('auth.sessions') IS NOT NULL THEN
  EXECUTE 'CREATE TRIGGER waves_two_step_forget AFTER DELETE ON auth.sessions FOR EACH ROW EXECUTE FUNCTION public.waves_two_step_forget_session()';
 END IF;
EXCEPTION WHEN insufficient_privilege THEN
 RAISE NOTICE 'two-step: no trigger on auth.sessions (not permitted); the live-session check covers it';
END $$;

CREATE OR REPLACE FUNCTION public.waves_sign_out_other_devices(p_device_id text, p_erase boolean DEFAULT false)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_profile uuid := public.waves_current_profile_id();
  v_count   int;
  v_sid     uuid;
BEGIN
  IF v_profile IS NULL THEN
    RAISE EXCEPTION 'NOT_SIGNED_IN: only a signed-in account has devices'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  UPDATE public.device_sessions
  SET revoked_at = now(),
      erase_requested = p_erase
  WHERE profile_id = v_profile
    AND device_id <> p_device_id
    AND (revoked_at IS NULL OR (p_erase AND NOT erase_requested)); -- erase can escalate an earlier plain sign-out

  GET DIAGNOSTICS v_count = ROW_COUNT;

  -- End the other GoTrue sessions too (refresh tokens cascade), keeping the
  -- one that is asking. Only when the caller's session is known: deleting
  -- "everything but an unknown session" would sign this phone out as well.
  BEGIN
    v_sid := NULLIF(current_setting('request.jwt.claims', true)::jsonb ->> 'session_id', '')::uuid;
  EXCEPTION WHEN OTHERS THEN
    v_sid := NULL;
  END;
  -- Two-step marks of every other session go with them (the device rows above drop their phone marks by trigger).
  IF v_sid IS NOT NULL THEN
    DELETE FROM public.two_step_sessions WHERE profile_id = v_profile AND session_id <> v_sid;
  END IF;
  IF NOT p_erase AND v_sid IS NOT NULL AND to_regclass('auth.sessions') IS NOT NULL THEN
    EXECUTE 'DELETE FROM auth.sessions WHERE user_id = $1 AND id <> $2' USING v_profile, v_sid;
  END IF;

  RETURN v_count;
END
$function$;

-- ───────────────────────────────────────────── pushes about a two-step company ──

CREATE OR REPLACE FUNCTION public.waves_claim_push_notifications(p_limit integer DEFAULT 200)
 RETURNS TABLE(id uuid, kind text, title text, body text, deep_link text, payload jsonb, locale text, tokens text[])
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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

  -- A company that requires two-step: the push reaches phones that may not have verified, so it says only that
  -- something happened; the inbox row keeps the detail behind the gate.
  RETURN QUERY
  SELECT n.id, n.kind,
         CASE WHEN g.require_two_step THEN 'New activity in your company' ELSE n.title END,
         CASE WHEN g.require_two_step THEN 'Open Waves to see it.' ELSE n.body END,
         CASE WHEN g.require_two_step THEN NULL ELSE n.deep_link END,
         CASE WHEN g.require_two_step THEN '{}'::jsonb ELSE n.payload END,
         COALESCE(p.locale, 'en'),
         ARRAY_AGG(t.expo_push_token)
  FROM public.notifications n
  LEFT JOIN public.profiles p ON p.id = n.profile_id
  LEFT JOIN public.groups g ON g.id = n.group_id
  JOIN public.push_tokens t
    ON t.profile_id = n.profile_id AND t.revoked_at IS NULL
  WHERE n.id = ANY(v_ids) AND n.push_status = 'queued'
  GROUP BY n.id, n.kind, n.title, n.body, n.deep_link, n.payload, p.locale, g.require_two_step;
END
$function$;
