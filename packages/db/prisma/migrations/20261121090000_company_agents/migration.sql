-- Company agents (phase 1, MCP): an AI assistant may act inside ONE company, only when the owner allows it.
--
-- Supabase's OAuth server cannot put a company in the token, so the binding is a row: an assistant (OAuth client_id)
-- used by a person is linked to exactly one company, at consent time. Every company tool calls waves_company_agent_gate
-- first, so switching agents off, revoking a link, suspending the company or leaving it takes effect on the very next call.

ALTER TABLE public.groups
 ADD COLUMN company_agents_enabled boolean NOT NULL DEFAULT false,
 ADD COLUMN company_agent_approval boolean NOT NULL DEFAULT true;

CREATE TABLE public.company_agent_links (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 group_id uuid NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
 profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE ON UPDATE CASCADE,
 client_id text NOT NULL CHECK (length(client_id) BETWEEN 1 AND 200),
 created_at timestamptz NOT NULL DEFAULT now(),
 last_used_at timestamptz,
 revoked_at timestamptz,
 UNIQUE (profile_id, client_id)
);
CREATE INDEX company_agent_links_group_idx ON public.company_agent_links(group_id);
ALTER TABLE public.company_agent_links ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.company_agent_links FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.company_agent_links TO authenticated;
GRANT ALL ON public.company_agent_links TO service_role;
-- Own rows only; there is no write policy (the definer RPCs below are the only writers).
CREATE POLICY company_agent_links_own_read ON public.company_agent_links FOR SELECT TO authenticated
 USING (profile_id = public.waves_current_profile_id());

-- "What did the agents do in this company" reads agent_writes by group.
CREATE INDEX agent_writes_group_created_idx ON public.agent_writes (group_id, created_at DESC);

-- ─────────────────────────────────────────────────────────── binding ──

-- Bind this assistant to one company (or, with a NULL company, unbind it). Called by the consent page with the person's
-- own session: an agent token must never bind itself, or the choice the person made at consent would mean nothing.
CREATE FUNCTION public.waves_company_agent_link(p_group_id uuid, p_client_id text) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
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
 INSERT INTO public.company_agent_links(group_id, profile_id, client_id) VALUES (p_group_id, v_me, v_client)
 ON CONFLICT (profile_id, client_id) DO UPDATE SET group_id = EXCLUDED.group_id, revoked_at = NULL, last_used_at = NULL, created_at = now();
END $$;

-- First call of every company tool. Returns the caller's current role in the company; refuses otherwise.
CREATE FUNCTION public.waves_company_agent_gate(p_group_id uuid) RETURNS text
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
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
 SELECT value INTO v_rpm FROM public.app_config WHERE key = 'agent_company_rpm';
 v_hit := public.waves_rate_limit('agentco:' || p_group_id::text || ':' || v_client, 'agent-company', coalesce(v_rpm, 120), 60);
 IF NOT coalesce((v_hit->>'allowed')::boolean, true) THEN RAISE EXCEPTION 'RATE_LIMITED: slow down' USING ERRCODE='insufficient_privilege'; END IF;
 IF l.last_used_at IS NULL OR l.last_used_at < now() - interval '1 minute' THEN
  UPDATE public.company_agent_links SET last_used_at = now() WHERE id = l.id;
 END IF;
 RETURN v_role;
END $$;

-- ────────────────────────────────────────────────────────── owner controls ──

CREATE FUNCTION public.waves_company_agent_settings_set(p_group_id uuid, p_enabled boolean, p_approval boolean) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
BEGIN
 IF public.waves_agent_client_id() IS NOT NULL THEN RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE='insufficient_privilege'; END IF;
 PERFORM public.waves_company_actor(p_group_id);
 IF NOT public.is_group_admin(p_group_id) THEN RAISE EXCEPTION 'ADMIN_ONLY' USING ERRCODE='insufficient_privilege'; END IF;
 IF p_enabled IS NULL OR p_approval IS NULL THEN RAISE EXCEPTION 'INVALID_DATA' USING ERRCODE='check_violation'; END IF;
 UPDATE public.groups SET company_agents_enabled = p_enabled, company_agent_approval = p_approval, updated_at = now() WHERE id = p_group_id AND deleted_at IS NULL;
END $$;

-- Settings and live connections, for the owner's screen.
CREATE FUNCTION public.waves_company_agent_links_list(p_group_id uuid) RETURNS jsonb
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
BEGIN
 PERFORM public.waves_company_actor(p_group_id);
 IF NOT public.is_group_admin(p_group_id) THEN RAISE EXCEPTION 'ADMIN_ONLY' USING ERRCODE='insufficient_privilege'; END IF;
 RETURN (SELECT jsonb_build_object('enabled', g.company_agents_enabled, 'approval', g.company_agent_approval,
  'links', coalesce((SELECT jsonb_agg(jsonb_build_object('id', l.id, 'name', coalesce(p.display_name, 'Someone'), 'clientId', l.client_id,
     'createdAt', l.created_at, 'lastUsedAt', l.last_used_at) ORDER BY l.created_at DESC)
    FROM public.company_agent_links l JOIN public.profiles p ON p.id = l.profile_id WHERE l.group_id = g.id AND l.revoked_at IS NULL), '[]'::jsonb))
  FROM public.groups g WHERE g.id = p_group_id);
END $$;

CREATE FUNCTION public.waves_company_agent_link_revoke(p_link_id uuid) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
DECLARE l public.company_agent_links%ROWTYPE; v_me uuid := public.waves_current_profile_id();
BEGIN
 IF v_me IS NULL OR public.waves_agent_client_id() IS NOT NULL THEN RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE='insufficient_privilege'; END IF;
 SELECT * INTO l FROM public.company_agent_links WHERE id = p_link_id FOR UPDATE;
 IF NOT FOUND OR NOT (l.profile_id = v_me OR (public.is_group_admin(l.group_id) AND public.waves_is_company(l.group_id))) THEN
  RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE='insufficient_privilege';
 END IF;
 UPDATE public.company_agent_links SET revoked_at = now() WHERE id = l.id AND revoked_at IS NULL;
END $$;

-- What agents changed in this company, newest first (owner and managers).
CREATE FUNCTION public.waves_company_agent_writes(p_group_id uuid, p_limit integer DEFAULT 50)
 RETURNS TABLE(id uuid, person text, client_id text, action text, object_id uuid, amount_minor bigint, currency character, created_at timestamptz)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
DECLARE v_role text;
BEGIN
 SELECT m.role::text INTO v_role FROM public.group_members m WHERE m.id = public.waves_company_actor(p_group_id);
 IF v_role NOT IN ('admin','manager') THEN RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE='insufficient_privilege'; END IF;
 RETURN QUERY SELECT w.id, coalesce(p.display_name, 'Someone'), w.client_id, w.action, w.object_id, w.amount_minor, w.currency, w.created_at
  FROM public.agent_writes w JOIN public.profiles p ON p.id = w.profile_id
  WHERE w.group_id = p_group_id ORDER BY w.created_at DESC LIMIT least(greatest(coalesce(p_limit, 50), 1), 200);
END $$;

REVOKE ALL ON FUNCTION public.waves_company_agent_link(uuid,text), public.waves_company_agent_gate(uuid),
 public.waves_company_agent_settings_set(uuid,boolean,boolean), public.waves_company_agent_links_list(uuid),
 public.waves_company_agent_link_revoke(uuid), public.waves_company_agent_writes(uuid,integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.waves_company_agent_link(uuid,text), public.waves_company_agent_gate(uuid),
 public.waves_company_agent_settings_set(uuid,boolean,boolean), public.waves_company_agent_links_list(uuid),
 public.waves_company_agent_link_revoke(uuid), public.waves_company_agent_writes(uuid,integer) TO authenticated, service_role;

-- ───────────────────────────────────────────────────── approval for agents ──

-- Identical to 20261112090000_company_paid_direct except the INSERT branch: an entry written through an assistant is
-- also held for review while the company's "agent changes need approval" switch is on, whatever the approvals setting.
CREATE OR REPLACE FUNCTION public.waves_company_review_guard() RETURNS trigger
 LANGUAGE plpgsql  SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $fn$
BEGIN
 IF NEW.deleted_at IS NULL AND NOT EXISTS(SELECT 1 FROM public.groups WHERE id=NEW.group_id AND deleted_at IS NULL) THEN RAISE EXCEPTION 'GROUP_DELETED'; END IF;
 IF NEW.paid_by_company OR NEW.entry_kind IN ('allocation','pool_return','pool_adjustment','pool_request','wage_payment') OR (NEW.entry_kind IN ('advance','reimbursement') AND EXISTS(SELECT 1 FROM public.group_members WHERE id=NEW.created_by AND role::text='manager')) THEN NEW.status:='approved'; RETURN NEW; END IF;
 IF TG_OP='INSERT' THEN
  IF (SELECT company_approvals_enabled FROM public.groups WHERE id=NEW.group_id)
   OR (public.waves_agent_client_id() IS NOT NULL AND (SELECT company_agent_approval FROM public.groups WHERE id=NEW.group_id)) THEN NEW.status:='submitted'; END IF;
 ELSIF NEW.deleted_at IS NULL AND
  (to_jsonb(NEW)-ARRAY['status','review_note','reviewed_by','reviewed_at','version','updated_by','updated_at','updated_seq'])
  IS DISTINCT FROM
  (to_jsonb(OLD)-ARRAY['status','review_note','reviewed_by','reviewed_at','version','updated_by','updated_at','updated_seq'])
  AND (SELECT company_approvals_enabled FROM public.groups WHERE id=NEW.group_id) THEN
  NEW.status:='submitted'; NEW.review_note:=NULL; NEW.reviewed_by:=NULL; NEW.reviewed_at:=NULL;
 ELSIF NEW.deleted_at IS NULL AND OLD.status='rejected' AND NEW.status='rejected'
  AND (to_jsonb(NEW)-ARRAY['status','review_note','reviewed_by','reviewed_at','version','updated_by','updated_at','updated_seq'])
  IS DISTINCT FROM
  (to_jsonb(OLD)-ARRAY['status','review_note','reviewed_by','reviewed_at','version','updated_by','updated_at','updated_seq']) THEN
  -- Approvals are off and a rejected claim was edited: it is approved again, not stuck out of the balance.
  NEW.status:='approved'; NEW.review_note:=NULL; NEW.reviewed_by:=NULL; NEW.reviewed_at:=NULL;
 END IF;
 RETURN NEW;
END
$fn$;
