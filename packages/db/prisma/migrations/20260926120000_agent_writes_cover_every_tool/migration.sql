-- Every write an agent can make, on the record — not only the ones that move money.
--
-- 20260907140000 put expense writes (through `expense-write`) and settlements
-- (inside `waves_record_settlement`) on the audit trail. Everything else the MCP
-- server can do left nothing behind: deleting an expense, creating a group,
-- adding a person, minting a join link. The comment on the table even named
-- `expense.delete`, and nothing wrote it. A person asking "what did my
-- assistant do?" was shown the harmless half of the answer.
--
-- These are AFTER triggers on the rows, not lines added to each RPC, on
-- purpose. An OAuth token is a user token: nothing stops a client from calling
-- PostgREST directly instead of going through the MCP server, and a trail
-- written only by the RPCs an MCP tool happens to call is a trail that path
-- skips. A trigger sees the row change however it was reached.
--
-- Each one is a no-op for the app: `waves_record_agent_write` returns before
-- writing anything when the token carries no `client_id`, so the only cost to a
-- person's own writes is one settings read.
--
-- None of these rows carries an amount. `waves_assert_agent_cap` sums
-- `amount_minor` for the day's total, and a delete or a new ghost is not money
-- written — counting it would let an agent run out of allowance by tidying up.

-- ─────────────────────────────────────────────────── expenses: delete, restore ──

CREATE OR REPLACE FUNCTION public.waves_audit_agent_expense_delete() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public', 'pg_temp'
    AS $$
BEGIN
  IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
    PERFORM public.waves_record_agent_write('expense.delete', NEW.group_id, NEW.id);
  ELSIF OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL THEN
    PERFORM public.waves_record_agent_write('expense.restore', NEW.group_id, NEW.id);
  END IF;
  RETURN NULL;
END
$$;

DROP TRIGGER IF EXISTS waves_audit_agent_expense_delete ON public.expenses;
CREATE TRIGGER waves_audit_agent_expense_delete
  AFTER UPDATE OF deleted_at ON public.expenses
  FOR EACH ROW
  WHEN (OLD.deleted_at IS DISTINCT FROM NEW.deleted_at)
  EXECUTE FUNCTION public.waves_audit_agent_expense_delete();

-- ───────────────────────────────────────────────────────────── groups: create ──

CREATE OR REPLACE FUNCTION public.waves_audit_agent_group_create() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public', 'pg_temp'
    AS $$
BEGIN
  PERFORM public.waves_record_agent_write('group.create', NEW.id, NEW.id);
  RETURN NULL;
END
$$;

DROP TRIGGER IF EXISTS waves_audit_agent_group_create ON public.groups;
CREATE TRIGGER waves_audit_agent_group_create
  AFTER INSERT ON public.groups
  FOR EACH ROW
  EXECUTE FUNCTION public.waves_audit_agent_group_create();

-- ──────────────────────────────────────────────────── members: a person added ──

-- Only ghosts. A member row with a profile is somebody joining — the creator of
-- a new group, or a person opening a link — and that is the joiner acting for
-- themselves, not an agent adding somebody to a ledger.
CREATE OR REPLACE FUNCTION public.waves_audit_agent_member_add() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public', 'pg_temp'
    AS $$
BEGIN
  PERFORM public.waves_record_agent_write('member.add', NEW.group_id, NEW.id);
  RETURN NULL;
END
$$;

DROP TRIGGER IF EXISTS waves_audit_agent_member_add ON public.group_members;
CREATE TRIGGER waves_audit_agent_member_add
  AFTER INSERT ON public.group_members
  FOR EACH ROW
  WHEN (NEW.profile_id IS NULL)
  EXECUTE FUNCTION public.waves_audit_agent_member_add();

-- ─────────────────────────────────────────────────────── invites: a link minted ──

-- On the invite row rather than in `waves_ensure_group_join_token`, which hands
-- back the live link when there is one: asking for the link twice mints it
-- once, and only the minting gives anybody new a way in.
CREATE OR REPLACE FUNCTION public.waves_audit_agent_invite_create() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public', 'pg_temp'
    AS $$
BEGIN
  PERFORM public.waves_record_agent_write('invite.create', NEW.group_id, NEW.id);
  RETURN NULL;
END
$$;

DROP TRIGGER IF EXISTS waves_audit_agent_invite_create ON public.invites;
CREATE TRIGGER waves_audit_agent_invite_create
  AFTER INSERT ON public.invites
  FOR EACH ROW
  EXECUTE FUNCTION public.waves_audit_agent_invite_create();

