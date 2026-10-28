-- Private employee ledger. Deliberately outside activity, notifications and realtime.
ALTER TABLE public.group_members ADD COLUMN daily_rate_minor bigint CHECK (daily_rate_minor >= 0);
CREATE TABLE public.company_entries (
 id uuid PRIMARY KEY,
 group_id uuid NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE ON UPDATE CASCADE,
 member_id uuid NOT NULL REFERENCES public.group_members(id) ON UPDATE CASCADE,
 entry_kind text NOT NULL CHECK (entry_kind IN ('expense','advance','allowance','wages','reimbursement')),
 category text CHECK (category IN ('fuel','transport','travel','food','office','other')),
 amount bigint NOT NULL CHECK (amount > 0),
 currency character(3) NOT NULL,
 calc_mode text NOT NULL DEFAULT 'typed' CHECK (calc_mode IN ('typed','days_rate','fixed_weekly')),
 days numeric(8,2), rate_minor bigint,
 occurred_on date NOT NULL,
 direction text CHECK (direction IN ('company_to_employee','employee_to_company')),
 status text NOT NULL DEFAULT 'approved' CHECK (status IN ('submitted','approved','rejected','reimbursed')),
 note text CHECK (length(note) <= 500), void_reason text,
 created_by uuid NOT NULL, updated_by uuid NOT NULL,
 version integer NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 deleted_at timestamptz, updated_seq bigint NOT NULL DEFAULT 0,
 CHECK (category IS NULL OR entry_kind = 'expense'),
 CHECK ((entry_kind = 'reimbursement') = (direction IS NOT NULL)),
 CHECK (entry_kind <> 'allowance' OR calc_mode = 'days_rate'),
 CHECK (calc_mode <> 'fixed_weekly' OR entry_kind = 'wages'),
 CHECK (calc_mode <> 'days_rate' OR (entry_kind IN ('allowance','wages') AND days IS NOT NULL AND days > 0 AND rate_minor IS NOT NULL AND rate_minor >= 0)),
 CHECK (calc_mode = 'days_rate' OR (days IS NULL AND rate_minor IS NULL))
);
CREATE INDEX company_entries_group_id_updated_seq_idx ON public.company_entries(group_id, updated_seq);
CREATE INDEX company_entries_group_id_member_id_occurred_on_id_idx ON public.company_entries(group_id, member_id, occurred_on, id);
CREATE INDEX company_entries_member_id_idx ON public.company_entries(member_id);
CREATE TRIGGER company_entries_stamp_seq BEFORE INSERT OR UPDATE ON public.company_entries
 FOR EACH ROW EXECUTE FUNCTION public.waves_stamp_seq();
ALTER TABLE public.company_entries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.company_entries FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.company_entries TO authenticated;
GRANT ALL ON TABLE public.company_entries TO service_role;

CREATE FUNCTION public.waves_is_company(p_group_id uuid) RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
 SELECT EXISTS (SELECT 1 FROM public.groups WHERE id = p_group_id AND type = 'company');
$$;
REVOKE ALL ON FUNCTION public.waves_is_company(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.waves_is_company(uuid) TO authenticated, service_role;
CREATE POLICY company_entries_select ON public.company_entries FOR SELECT TO authenticated
 USING (public.is_group_member(group_id) AND (public.is_group_admin(group_id) OR member_id = public.waves_my_member_id(group_id)));
CREATE POLICY company_members_privacy ON public.group_members AS RESTRICTIVE FOR SELECT TO authenticated
 USING (NOT public.waves_is_company(group_id) OR public.is_group_admin(group_id) OR profile_id = public.waves_current_profile_id());
-- profiles_select reads group_members under caller RLS, so the restrictive
-- policy above also closes its co-membership branch without recursive policies.
CREATE OR REPLACE FUNCTION public.waves_profiles_share_group(p_a uuid, p_b uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  SELECT p_a = p_b OR EXISTS (
    SELECT 1
      FROM public.group_members ma
      JOIN public.group_members mb ON mb.group_id = ma.group_id
     WHERE ma.profile_id = p_a AND ma.left_at IS NULL
       AND mb.profile_id = p_b AND mb.left_at IS NULL
       AND (NOT public.waves_is_company(ma.group_id) OR ma.role = 'admin')
  );
$$;
REVOKE ALL ON FUNCTION public.waves_profiles_share_group(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.waves_profiles_share_group(uuid, uuid) TO service_role;
CREATE OR REPLACE FUNCTION public.waves_guard_membership_columns()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF current_user NOT IN ('anon', 'authenticated') THEN
    RETURN NEW;
  END IF;

  IF NEW.daily_rate_minor IS DISTINCT FROM OLD.daily_rate_minor THEN
    RAISE EXCEPTION 'FORBIDDEN_COLUMN: use company member rate RPC' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NEW.role IS DISTINCT FROM OLD.role THEN
    RAISE EXCEPTION 'FORBIDDEN_COLUMN: a role is not yours to change'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NEW.profile_id IS DISTINCT FROM OLD.profile_id THEN
    RAISE EXCEPTION 'FORBIDDEN_COLUMN: a ghost is claimed by an admin approving a request, not by an update'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NEW.group_id IS DISTINCT FROM OLD.group_id THEN
    RAISE EXCEPTION 'FORBIDDEN_COLUMN: a membership cannot move between groups'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NEW.removed_at IS DISTINCT FROM OLD.removed_at
     OR NEW.removed_by IS DISTINCT FROM OLD.removed_by THEN
    RAISE EXCEPTION 'FORBIDDEN_COLUMN: a removal is recorded by waves_remove_member, not by an update'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF OLD.removed_at IS NOT NULL AND NEW.left_at IS DISTINCT FROM OLD.left_at THEN
    RAISE EXCEPTION 'FORBIDDEN_COLUMN: a removed member comes back through a new invite, not an update'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NEW.merged_into_member_id IS DISTINCT FROM OLD.merged_into_member_id THEN
    RAISE EXCEPTION 'FORBIDDEN_COLUMN: a placeholder is merged by waves_merge_member_into, not by an update'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF OLD.profile_id IS NULL
     AND (NEW.vpa IS DISTINCT FROM OLD.vpa
       OR NEW.payment_handle IS DISTINCT FROM OLD.payment_handle
       OR NEW.payment_rail IS DISTINCT FROM OLD.payment_rail
       OR NEW.invite_email IS DISTINCT FROM OLD.invite_email
       OR NEW.invite_phone IS DISTINCT FROM OLD.invite_phone)
     AND NOT public.is_group_admin(OLD.group_id) THEN
    RAISE EXCEPTION 'FORBIDDEN_COLUMN: only an admin changes a placeholder''s payment or contact details'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN NEW;
END
$function$
;
REVOKE ALL ON FUNCTION public.waves_guard_membership_columns() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.waves_guard_membership_columns() TO service_role;
-- Direct membership inserts must not smuggle a default rate either.
CREATE FUNCTION public.waves_company_membership_insert_guard() RETURNS trigger
 LANGUAGE plpgsql SET search_path TO 'public', 'pg_temp' AS $$
BEGIN
 IF current_user IN ('anon','authenticated') AND NEW.daily_rate_minor IS NOT NULL THEN
  RAISE EXCEPTION 'FORBIDDEN_COLUMN: use company member rate RPC' USING ERRCODE = 'insufficient_privilege';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER company_membership_insert_guard BEFORE INSERT ON public.group_members
 FOR EACH ROW EXECUTE FUNCTION public.waves_company_membership_insert_guard();
CREATE FUNCTION public.waves_company_type_guard() RETURNS trigger
 LANGUAGE plpgsql SET search_path TO 'public', 'pg_temp' AS $$
BEGIN
 IF NEW.type IS DISTINCT FROM OLD.type AND (NEW.type = 'company' OR OLD.type = 'company') THEN
  RAISE EXCEPTION 'COMPANY_TYPE_IMMUTABLE' USING ERRCODE = 'check_violation';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER company_type_guard BEFORE UPDATE ON public.groups FOR EACH ROW EXECUTE FUNCTION public.waves_company_type_guard();
CREATE FUNCTION public.waves_company_legacy_write_guard() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
BEGIN
 IF public.waves_is_company(NEW.group_id) THEN
  RAISE EXCEPTION 'COMPANY_GROUP: use company entries' USING ERRCODE = 'check_violation';
 END IF;
 RETURN NEW;
END $$;
-- Import inserts expenses/settlements; recurring generation calls waves_apply_expense.
-- These final table boundaries cover all of those service/definer paths.
CREATE TRIGGER company_expense_guard BEFORE INSERT ON public.expenses FOR EACH ROW EXECUTE FUNCTION public.waves_company_legacy_write_guard();
CREATE TRIGGER company_settlement_guard BEFORE INSERT ON public.settlements FOR EACH ROW EXECUTE FUNCTION public.waves_company_legacy_write_guard();
CREATE TRIGGER company_recurring_guard BEFORE INSERT ON public.group_recurring_expenses FOR EACH ROW EXECUTE FUNCTION public.waves_company_legacy_write_guard();

CREATE FUNCTION public.waves_company_actor(p_group_id uuid) RETURNS uuid
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
DECLARE v_me uuid;
BEGIN
 IF public.waves_current_profile_id() IS NULL THEN
  RAISE EXCEPTION 'NOT_SIGNED_IN' USING ERRCODE = 'insufficient_privilege';
 END IF;
 v_me := public.waves_my_member_id(p_group_id);
 IF NOT public.waves_is_company(p_group_id) OR NOT EXISTS (
  SELECT 1 FROM public.group_members WHERE id = v_me AND group_id = p_group_id
   AND profile_id = public.waves_current_profile_id() AND left_at IS NULL
 ) THEN
  RAISE EXCEPTION 'NOT_A_MEMBER: live company membership required' USING ERRCODE = 'insufficient_privilege';
 END IF;
 RETURN v_me;
END $$;
-- Validate/normalize one financial snapshot; used by create and patch alike.
CREATE FUNCTION public.waves_company_entry_values(p_kind text, p_member uuid, p_data jsonb)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
DECLARE v_mode text := COALESCE(p_data->>'calcMode', CASE WHEN p_kind = 'allowance' THEN 'days_rate' ELSE 'typed' END);
 v_days numeric(8,2); v_rate bigint; v_amount bigint; v_direction text;
BEGIN
 IF NOT EXISTS (SELECT 1 FROM public.group_members m WHERE m.id = p_member
  AND public.waves_company_actor(m.group_id) IS NOT NULL
  AND (m.id = public.waves_my_member_id(m.group_id) OR public.is_group_admin(m.group_id))) THEN
  RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE = 'insufficient_privilege';
 END IF;
 IF jsonb_typeof(p_data) IS DISTINCT FROM 'object' OR EXISTS (
  SELECT 1 FROM jsonb_object_keys(p_data) k WHERE k NOT IN ('amount','category','days','rateMinor','calcMode','occurredOn','note','direction')
 ) THEN RAISE EXCEPTION 'INVALID_DATA' USING ERRCODE = 'check_violation'; END IF;
 IF v_mode = 'days_rate' THEN
  v_days := (p_data->>'days')::numeric;
  v_rate := (p_data->>'rateMinor')::bigint;
  IF v_rate IS NULL THEN SELECT daily_rate_minor INTO v_rate FROM public.group_members WHERE id = p_member; END IF;
  IF v_rate IS NULL OR v_rate < 0 OR v_days IS NULL OR v_days <= 0 THEN
   RAISE EXCEPTION 'INVALID_RATE: days and rate required' USING ERRCODE = 'check_violation';
  END IF;
  v_amount := round(v_days * v_rate)::bigint;
 ELSE v_amount := (p_data->>'amount')::bigint;
 END IF;
 IF p_data->>'occurredOn' IS NULL OR (p_data->>'occurredOn') !~ '^\d{4}-\d{2}-\d{2}$' THEN
  RAISE EXCEPTION 'INVALID_DATE' USING ERRCODE = 'check_violation';
 END IF;
 IF p_kind = 'reimbursement' THEN v_direction := COALESCE(p_data->>'direction','company_to_employee');
 ELSE v_direction := p_data->>'direction'; END IF;
 RETURN p_data || jsonb_build_object('amount',v_amount,'calcMode',v_mode,'days',v_days,'rateMinor',v_rate,'direction',v_direction);
END $$;
CREATE FUNCTION public.waves_company_entry_create(p_group_id uuid, p_entry_id uuid, p_member_id uuid, p_entry_kind text, p_data jsonb)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
DECLARE v_me uuid; v_admin boolean; r public.company_entries%ROWTYPE; d jsonb; v_currency character(3);
BEGIN
 v_me := public.waves_company_actor(p_group_id); v_admin := public.is_group_admin(p_group_id);
 -- Serialize same-id creates, including retries from different devices.
 PERFORM pg_advisory_xact_lock(hashtextextended(p_entry_id::text, 0));
 SELECT * INTO r FROM public.company_entries WHERE id = p_entry_id;
 IF FOUND THEN
  IF r.group_id = p_group_id AND (v_admin OR r.member_id = v_me) THEN RETURN r.id; END IF;
  RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE = 'insufficient_privilege';
 END IF;
 IF NOT v_admin AND (p_member_id IS DISTINCT FROM v_me OR p_entry_kind NOT IN ('expense','allowance')) THEN
  RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE = 'insufficient_privilege';
 END IF;
 IF NOT EXISTS (SELECT 1 FROM public.group_members WHERE id = p_member_id AND group_id = p_group_id AND left_at IS NULL) THEN
  RAISE EXCEPTION 'UNKNOWN_MEMBER' USING ERRCODE = 'insufficient_privilege';
 END IF;
 SELECT default_currency INTO v_currency FROM public.groups WHERE id = p_group_id FOR SHARE;
 d := public.waves_company_entry_values(p_entry_kind,p_member_id,p_data);
 INSERT INTO public.company_entries(id,group_id,member_id,entry_kind,category,amount,currency,calc_mode,days,rate_minor,occurred_on,direction,note,created_by,updated_by)
 VALUES(p_entry_id,p_group_id,p_member_id,p_entry_kind,d->>'category',(d->>'amount')::bigint,v_currency,d->>'calcMode',(d->>'days')::numeric,(d->>'rateMinor')::bigint,(d->>'occurredOn')::date,d->>'direction',d->>'note',v_me,v_me);
 RETURN p_entry_id;
END $$;
CREATE FUNCTION public.waves_company_entry_update(p_entry_id uuid, p_patch jsonb) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
DECLARE r public.company_entries%ROWTYPE; v_me uuid; d jsonb;
BEGIN
 SELECT * INTO r FROM public.company_entries WHERE id = p_entry_id FOR UPDATE;
 v_me := public.waves_company_actor(r.group_id);
 IF r.id IS NULL OR r.deleted_at IS NOT NULL OR (NOT public.is_group_admin(r.group_id) AND
  (r.member_id <> v_me OR r.created_by <> v_me OR r.entry_kind NOT IN ('expense','allowance'))) THEN
  RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE = 'insufficient_privilege';
 END IF;
 IF jsonb_typeof(p_patch) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'INVALID_DATA' USING ERRCODE = 'check_violation'; END IF;
 d := public.waves_company_entry_values(r.entry_kind,r.member_id,jsonb_build_object(
  'amount',r.amount,'category',r.category,'days',r.days,'rateMinor',r.rate_minor,'calcMode',r.calc_mode,
  'occurredOn',r.occurred_on,'note',r.note,'direction',r.direction) || p_patch);
 UPDATE public.company_entries SET amount=(d->>'amount')::bigint, category=d->>'category',
  days=(d->>'days')::numeric, rate_minor=(d->>'rateMinor')::bigint, calc_mode=d->>'calcMode',
  occurred_on=(d->>'occurredOn')::date,note=d->>'note',direction=d->>'direction',
  version=version+1,updated_by=v_me,updated_at=now() WHERE id=p_entry_id;
END $$;
CREATE FUNCTION public.waves_company_entry_void(p_entry_id uuid, p_reason text) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
DECLARE r public.company_entries%ROWTYPE; v_me uuid;
BEGIN
 SELECT * INTO r FROM public.company_entries WHERE id = p_entry_id FOR UPDATE;
 v_me := public.waves_company_actor(r.group_id);
 IF r.id IS NULL OR (NOT public.is_group_admin(r.group_id) AND
  (r.member_id <> v_me OR r.created_by <> v_me OR r.entry_kind NOT IN ('expense','allowance'))) THEN
  RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE = 'insufficient_privilege';
 END IF;
 IF r.deleted_at IS NOT NULL THEN RETURN; END IF;
 UPDATE public.company_entries SET deleted_at=now(),void_reason=p_reason,version=version+1,updated_by=v_me,updated_at=now() WHERE id=p_entry_id;
END $$;
CREATE FUNCTION public.waves_company_entry_transition(p_entry_id uuid, p_to text) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
DECLARE r public.company_entries%ROWTYPE; v_me uuid;
BEGIN
 SELECT * INTO r FROM public.company_entries WHERE id=p_entry_id FOR UPDATE;
 v_me := public.waves_company_actor(r.group_id);
 IF NOT public.is_group_admin(r.group_id) THEN RAISE EXCEPTION 'ADMIN_ONLY' USING ERRCODE = 'insufficient_privilege'; END IF;
 IF r.deleted_at IS NOT NULL OR r.status <> 'submitted' OR p_to IS NULL OR p_to NOT IN ('approved','rejected') THEN
  RAISE EXCEPTION 'INVALID_TRANSITION' USING ERRCODE = 'check_violation';
 END IF;
 UPDATE public.company_entries SET status=p_to,version=version+1,updated_by=v_me,updated_at=now() WHERE id=p_entry_id;
END $$;
CREATE FUNCTION public.waves_company_member_rate_set(p_group_id uuid,p_member_id uuid,p_daily_rate_minor bigint) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
BEGIN
 PERFORM public.waves_company_actor(p_group_id);
 IF NOT public.is_group_admin(p_group_id) THEN RAISE EXCEPTION 'ADMIN_ONLY' USING ERRCODE = 'insufficient_privilege'; END IF;
 UPDATE public.group_members SET daily_rate_minor=p_daily_rate_minor, updated_at=now()
 WHERE id=p_member_id AND group_id=p_group_id AND left_at IS NULL;
 IF NOT FOUND THEN RAISE EXCEPTION 'UNKNOWN_MEMBER' USING ERRCODE = 'insufficient_privilege'; END IF;
 -- group_members_stamp_seq stamps this update just like all membership changes.
END $$;
REVOKE ALL ON FUNCTION public.waves_company_actor(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.waves_company_actor(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.waves_company_entry_values(text, uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.waves_company_entry_values(text, uuid, jsonb) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.waves_company_entry_create(uuid, uuid, uuid, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.waves_company_entry_create(uuid, uuid, uuid, text, jsonb) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.waves_company_entry_update(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.waves_company_entry_update(uuid, jsonb) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.waves_company_entry_void(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.waves_company_entry_void(uuid, text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.waves_company_entry_transition(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.waves_company_entry_transition(uuid, text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.waves_company_member_rate_set(uuid, uuid, bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.waves_company_member_rate_set(uuid, uuid, bigint) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.waves_company_membership_insert_guard() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.waves_company_membership_insert_guard() TO service_role;
REVOKE ALL ON FUNCTION public.waves_company_type_guard() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.waves_company_type_guard() TO service_role;
REVOKE ALL ON FUNCTION public.waves_company_legacy_write_guard() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.waves_company_legacy_write_guard() TO service_role;

-- Preserve same-group identity even for trusted direct writers.
CREATE FUNCTION public.waves_company_entry_scope_guard() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
BEGIN
 IF NOT public.waves_is_company(NEW.group_id) OR EXISTS (
  SELECT 1 FROM unnest(ARRAY[NEW.member_id,NEW.created_by,NEW.updated_by]) AS actor(id)
  WHERE NOT EXISTS (SELECT 1 FROM public.group_members m WHERE m.id=actor.id AND m.group_id=NEW.group_id)
 ) THEN RAISE EXCEPTION 'UNKNOWN_MEMBER: company entry scope mismatch' USING ERRCODE = 'foreign_key_violation'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER company_entry_scope_guard BEFORE INSERT OR UPDATE ON public.company_entries
 FOR EACH ROW EXECUTE FUNCTION public.waves_company_entry_scope_guard();
REVOKE ALL ON FUNCTION public.waves_company_entry_scope_guard() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.waves_company_entry_scope_guard() TO service_role;


-- Company activity remains admin-only even when another permissive policy matches.
CREATE POLICY activity_log_company_admin ON public.activity_log AS RESTRICTIVE
 FOR SELECT TO anon, authenticated
 USING (NOT public.waves_is_company(group_id) OR public.is_group_admin(group_id));

DROP POLICY invites_insert ON public.invites;
CREATE POLICY invites_insert ON public.invites FOR INSERT TO authenticated
 WITH CHECK (public.is_group_member(group_id)
   AND (NOT public.waves_is_company(group_id) OR public.is_group_admin(group_id)));

DROP POLICY group_members_insert_ghost ON public.group_members;
CREATE POLICY group_members_insert_ghost ON public.group_members FOR INSERT TO anon, authenticated
 WITH CHECK (public.is_group_member(group_id) AND profile_id IS NULL
   AND (NOT public.waves_is_company(group_id) OR public.is_group_admin(group_id)));

CREATE OR REPLACE FUNCTION public.waves_person_profile(p_person_key text)
RETURNS TABLE(
  person_key       text,
  display_name     text,
  avatar_url       text,
  is_ghost         boolean,
  is_you           boolean,
  shared_groups    integer,
  email            text,
  phone            text,
  payment_rail     text,
  payment_handle   text,
  country_code     character(2),
  -- The difference between "they have not told us" and "they have told us not
  -- to tell you". A screen that cannot tell those apart has to write a weasel
  -- sentence covering both; with this it can say the true one.
  contact_withheld boolean
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_me      uuid := public.waves_current_profile_id();
  v_profile uuid;
  v_shared  integer := 0;
  v_name    text;
  v_avatar  text;
  v_rail    text;
  v_handle  text;
  v_country character(2);
  v_ghost   boolean := true;
  v_visible boolean := false;
  v_email   text;
  v_phone   text;
BEGIN
  IF v_me IS NULL OR p_person_key IS NULL OR btrim(p_person_key) = '' THEN
    RETURN;
  END IF;

  -- Case 1: the key is a real account.
  IF p_person_key ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    SELECT p.id, p.display_name, p.avatar_url, p.payment_rail, p.payment_handle,
           p.country_code, (p.contact_visibility = 'groups')
      INTO v_profile, v_name, v_avatar, v_rail, v_handle, v_country, v_visible
      FROM public.profiles p
     WHERE p.id = p_person_key::uuid;
  END IF;

  IF v_profile IS NOT NULL THEN
    v_ghost := false;

    IF v_profile = v_me THEN
      -- Looking at yourself: your own contact details are always yours to see,
      -- and "shared groups" means every group you are in — every group that
      -- still exists, that is.
      v_shared := (SELECT count(*)::int
                     FROM public.group_members gm
                     JOIN public.groups g ON g.id = gm.group_id AND g.deleted_at IS NULL
                    WHERE gm.profile_id = v_me AND gm.left_at IS NULL);
      v_visible := true;
    ELSE
      -- The shared-group count doubles as the permission check.
      SELECT count(DISTINCT mine.group_id)::int INTO v_shared
        FROM public.group_members mine
        JOIN public.groups g
          ON g.id = mine.group_id
         AND g.deleted_at IS NULL
        JOIN public.group_members theirs
          ON theirs.group_id = mine.group_id
         AND theirs.left_at IS NULL
         AND theirs.profile_id = v_profile
       WHERE mine.profile_id = v_me
         AND mine.left_at IS NULL
         AND (g.type <> 'company' OR mine.role = 'admin');

      IF coalesce(v_shared, 0) = 0 THEN
        RETURN;
      END IF;
    END IF;

  ELSE
    -- Cases 2 and 3: a merged ghost (the caller's own merge) or a plain ghost.
    -- Either way there is no account, so there is nothing to reveal and the
    -- only question is whether the caller can see this person at all.
    SELECT max(coalesce(mrg.display_name, gm.ghost_name, 'Someone')),
           count(DISTINCT gm.group_id)::int
      INTO v_name, v_shared
      FROM public.group_members gm
      JOIN public.groups g
        ON g.id = gm.group_id
       AND g.deleted_at IS NULL
      JOIN public.group_members mine
        ON mine.group_id = gm.group_id
       AND mine.profile_id = v_me
       AND mine.left_at IS NULL
      LEFT JOIN public.ghost_merges mrg
        ON mrg.member_id = gm.id
       AND mrg.owner = v_me
     WHERE gm.left_at IS NULL
       AND (g.type <> 'company' OR mine.role = 'admin')
       AND gm.profile_id IS NULL
       AND coalesce(mrg.person_id::text, gm.id::text) = p_person_key;

    IF coalesce(v_shared, 0) = 0 THEN
      RETURN;
    END IF;
  END IF;

  -- The reveal. Guarded on a real `auth.users` for the same reason every other
  -- read of it in this schema is: the DB test suite and the self-host stack run
  -- these RPCs against a Postgres with no `auth` schema, or with a stub one,
  -- where the right answer is "no contact on file", not an error.
  IF NOT v_ghost AND v_visible AND public.waves_auth_contact_readable() THEN
    SELECT nullif(btrim(lower(coalesce(u.email, ''))), ''),
           -- Stored bare in `auth.users`; the '+' is put back so the number is
           -- dialable and reads like every other number in the app.
           CASE WHEN nullif(btrim(coalesce(u.phone, '')), '') IS NULL THEN NULL
                ELSE '+' || regexp_replace(u.phone, '[^0-9]', '', 'g') END
      INTO v_email, v_phone
      FROM auth.users u
     WHERE u.id = v_profile
       AND u.deleted_at IS NULL;
  END IF;

  person_key       := p_person_key;
  display_name     := coalesce(v_name, 'Someone');
  avatar_url       := v_avatar;
  is_ghost         := v_ghost;
  is_you           := (v_profile IS NOT NULL AND v_profile = v_me);
  shared_groups    := coalesce(v_shared, 0);
  email            := v_email;
  phone            := v_phone;
  payment_rail     := CASE WHEN v_visible THEN v_rail ELSE NULL END;
  payment_handle   := CASE WHEN v_visible THEN v_handle ELSE NULL END;
  country_code     := CASE WHEN v_visible THEN v_country ELSE NULL END;
  contact_withheld := (NOT v_ghost) AND (NOT v_visible);
  RETURN NEXT;
END
$fn$;
REVOKE ALL ON FUNCTION public.waves_person_profile(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.waves_person_profile(text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.waves_member_link_candidates(p_group_id uuid)
RETURNS TABLE(
  profile_id   uuid,
  display_name text,
  avatar_url   text
)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
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
     AND (NOT public.waves_is_company(mine.group_id) OR mine.role = 'admin')
     AND EXISTS (
       SELECT 1 FROM public.group_members gm
        WHERE gm.group_id = p_group_id
          AND gm.profile_id = public.waves_current_profile_id()
          AND gm.left_at IS NULL
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
$$;
REVOKE ALL ON FUNCTION public.waves_member_link_candidates(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.waves_member_link_candidates(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.waves_guard_group_columns() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_allowed constant text[] := ARRAY[
    'name',
    'description',
    'type',
    'cover_emoji',
    'photo_path',
    'simplify_debts',
    'default_currency',
    'country_code',
    'archived_at',
    'start_date',
    'end_date',
    'time_zone',
    'remind_daily',
    'remind_morning_at',
    'remind_evening_at',
    'event_template',
    'custom_tag',
    'cover_color',
    'units'
  ];
  v_refused text;
BEGIN
  IF NEW.default_currency IS DISTINCT FROM OLD.default_currency
     AND (
       EXISTS (SELECT 1 FROM public.company_entries ce WHERE ce.group_id = NEW.id)
       OR EXISTS (SELECT 1 FROM public.expenses e WHERE e.group_id = NEW.id)
       OR EXISTS (SELECT 1 FROM public.settlements st WHERE st.group_id = NEW.id)
       OR COALESCE(OLD.fx_rates, '{}'::jsonb) <> '{}'::jsonb
     ) THEN
    RAISE EXCEPTION
      'CURRENCY_LOCKED: a group''s currency cannot change once it has bills, rates or settlements'
      USING ERRCODE = 'check_violation';
  END IF;

  IF current_user NOT IN ('anon', 'authenticated') THEN
    RETURN NEW;
  END IF;

  SELECT string_agg(changed.key, ', ' ORDER BY changed.key)
    INTO v_refused
    FROM jsonb_each(to_jsonb(NEW)) AS changed(key, value)
   WHERE changed.value IS DISTINCT FROM (to_jsonb(OLD) -> changed.key)
     AND NOT (changed.key = ANY (v_allowed));

  IF v_refused IS NOT NULL THEN
    RAISE EXCEPTION
      'FORBIDDEN_COLUMN: % is set by the server or through its own RPC, not by a direct write', v_refused
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NEW.photo_path IS DISTINCT FROM OLD.photo_path
     AND NEW.photo_path IS NOT NULL
     AND NOT public.waves_can_upload_group_photo(NEW.id) THEN
    RAISE EXCEPTION 'PHOTO_GATE: a group photo is a paid feature'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- ── new: only an admin arranges the families ────────────────────────────
  IF NEW.units IS DISTINCT FROM OLD.units THEN
    IF NOT public.is_group_admin(NEW.id) THEN
      RAISE EXCEPTION 'NOT_AN_ADMIN: only an admin changes the families'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    PERFORM public.waves_check_group_units(NEW.id, NEW.units);
  END IF;

  RETURN NEW;
END
$$;
REVOKE ALL ON FUNCTION public.waves_guard_group_columns() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.waves_guard_group_columns() TO service_role;

CREATE OR REPLACE FUNCTION public.waves_add_ghost_member(
  p_group_id uuid,
  p_name text,
  p_member_id uuid DEFAULT NULL::uuid,
  p_email text DEFAULT NULL::text,
  p_phone text DEFAULT NULL::text,
  p_profile_id uuid DEFAULT NULL::uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_profile_id uuid := public.waves_current_profile_id();
  v_member_id  uuid;
  v_email      text := nullif(btrim(lower(coalesce(p_email, ''))), '');
  v_phone      text := nullif(regexp_replace(coalesce(p_phone, ''), '[^0-9+]', '', 'g'), '');
  v_name       text := nullif(btrim(coalesce(p_name, '')), '');
  v_phone_bare text;
  v_target     uuid;
  v_existing   public.group_members%ROWTYPE;
  v_group_name text;
  v_actor_name text;
BEGIN
  IF v_profile_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.group_members gm
    WHERE gm.group_id = p_group_id AND gm.profile_id = v_profile_id AND gm.left_at IS NULL
  ) THEN
    RAISE EXCEPTION 'NOT_A_MEMBER: you are not in that group'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF public.waves_is_company(p_group_id) AND NOT public.is_group_admin(p_group_id) THEN
    RAISE EXCEPTION 'ADMIN_ONLY' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- A name is no longer required, because picking an email out of a contact
  -- card often carries no usable one. Something is still required.
  IF v_name IS NULL AND v_email IS NULL AND v_phone IS NULL THEN
    RAISE EXCEPTION 'NOTHING_TO_ADD: give a name, an email or a number'
      USING ERRCODE = 'check_violation';
  END IF;

  -- A number typed without its country code cannot be assumed Indian just
  -- because this is an India-first app — somebody on a trip is exactly the
  -- person whose contacts are foreign. Reject rather than guess wrong.
  IF v_phone IS NOT NULL AND v_phone !~ '^\+' THEN
    RAISE EXCEPTION 'PHONE_NEEDS_COUNTRY_CODE: % has no country code', v_phone
      USING ERRCODE = 'check_violation';
  END IF;

  -- Replay of a queued offline mutation returns the same member (ADR-005).
  IF p_member_id IS NOT NULL THEN
    SELECT id INTO v_member_id FROM public.group_members
     WHERE id = p_member_id AND group_id = p_group_id;
    IF FOUND THEN
      RETURN v_member_id;
    END IF;
  END IF;

  -- Adding the same person twice is the common accident when picking from a
  -- contact list, and two ghosts for one human split their balance in half.
  -- Matched on contact rather than name: two people really can be called Ravi.
  IF v_email IS NOT NULL OR v_phone IS NOT NULL THEN
    SELECT gm.id INTO v_member_id
      FROM public.group_members gm
     WHERE gm.group_id = p_group_id
       AND gm.left_at IS NULL
       AND ((v_email IS NOT NULL AND gm.invite_email = v_email)
         OR (v_phone IS NOT NULL AND gm.invite_phone = v_phone))
     LIMIT 1;
    IF v_member_id IS NOT NULL THEN
      RETURN v_member_id;
    END IF;
  END IF;

  -- ── Somebody you know, named by their account ──────────────────────────────
  -- Yourself is the row you already have. Anyone else counts only when you
  -- already share a group with them and they have a real account; otherwise
  -- the id is ignored and the add goes on as a contact match or a ghost.
  IF p_profile_id = v_profile_id THEN
    SELECT gm.id INTO v_member_id
      FROM public.group_members gm
     WHERE gm.group_id = p_group_id AND gm.profile_id = v_profile_id AND gm.left_at IS NULL;
    RETURN v_member_id;
  END IF;
  IF p_profile_id IS NOT NULL
     AND public.waves_profiles_share_group(v_profile_id, p_profile_id)
     AND NOT public.waves_is_guest(p_profile_id) THEN
    v_target := p_profile_id;
  END IF;

  -- ── Is this somebody already on Waves? ─────────────────────────────────────
  -- `auth.users` stores phone as bare E.164 digits (no leading '+'), so the
  -- typed number is compared digits to digits.
  --
  -- Guarded on `auth.users` existing: the DB test suite runs these RPCs against
  -- a bare Postgres with no `auth` schema. No auth table means no accounts to
  -- match, so a plain ghost is exactly right.
  IF v_target IS NULL AND to_regclass('auth.users') IS NOT NULL
     AND (v_email IS NOT NULL OR v_phone IS NOT NULL) THEN
    v_phone_bare := nullif(regexp_replace(coalesce(v_phone, ''), '[^0-9]', '', 'g'), '');

    SELECT u.id INTO v_target
      FROM auth.users u
      JOIN public.profiles p ON p.id = u.id
     WHERE u.deleted_at IS NULL
       AND (
         (v_email IS NOT NULL AND lower(u.email) = v_email AND p.discoverable_by_email)
         OR (v_phone_bare IS NOT NULL
             AND p.discoverable_by_phone
             AND regexp_replace(coalesce(u.phone, ''), '[^0-9]', '', 'g') = v_phone_bare)
       )
     ORDER BY (v_email IS NOT NULL AND lower(u.email) = v_email) DESC
     LIMIT 1;

    -- Yourself, picked from your own contacts: you are already in, so that row
    -- is the answer. Checked against your own account whatever its
    -- discoverability, which only hides you from other people.
    IF EXISTS (
      SELECT 1 FROM auth.users u
       WHERE u.id = v_profile_id
         AND ((v_email IS NOT NULL AND lower(u.email) = v_email)
           OR (v_phone_bare IS NOT NULL
               AND regexp_replace(coalesce(u.phone, ''), '[^0-9]', '', 'g') = v_phone_bare))
    ) THEN
      SELECT gm.id INTO v_member_id
        FROM public.group_members gm
       WHERE gm.group_id = p_group_id AND gm.profile_id = v_profile_id AND gm.left_at IS NULL;
      RETURN v_member_id;
    END IF;

    IF v_target = v_profile_id THEN
      v_target := NULL;
    END IF;
  END IF;

  IF v_target IS NOT NULL THEN
    SELECT * INTO v_existing
      FROM public.group_members gm
     WHERE gm.group_id = p_group_id AND gm.profile_id = v_target;
    IF FOUND THEN
      -- Already inside: that row is who they meant.
      IF v_existing.left_at IS NULL THEN
        RETURN v_existing.id;
      END IF;
      -- Left or removed: a ghost, and no tap — they are not being let back in.
      v_target := NULL;
    END IF;
  END IF;

  IF v_target IS NOT NULL THEN
    INSERT INTO public.group_members
      (id, group_id, profile_id, joined_via, invite_email, invite_phone)
    VALUES
      (COALESCE(p_member_id, gen_random_uuid()), p_group_id, v_target, 'contact', v_email, v_phone)
    RETURNING id INTO v_member_id;

    SELECT g.name INTO v_group_name FROM public.groups g WHERE g.id = p_group_id;
    SELECT p.display_name INTO v_actor_name FROM public.profiles p WHERE p.id = v_profile_id;

    PERFORM public.waves_notify(
      v_target,
      p_group_id,
      'group_added',
      -- English fallback only; every current build re-renders from kind +
      -- payload in the reader's own language (see render.ts). `counterparty`
      -- is the fact `{actor}` reads from; `group` is `{group}`.
      coalesce(v_actor_name, 'Someone') || ' added you to ' || coalesce(v_group_name, 'a group'),
      'Tap to open the group',
      'waves://group/' || p_group_id::text,
      jsonb_build_object(
        'counterparty', coalesce(v_actor_name, ''),
        'group',        coalesce(v_group_name, '')
      ),
      'group_added:' || p_group_id::text || ':' || v_target::text
    );

    RETURN v_member_id;
  END IF;

  INSERT INTO public.group_members
    (id, group_id, ghost_name, joined_via, invite_email, invite_phone)
  VALUES
    (COALESCE(p_member_id, gen_random_uuid()), p_group_id,
     COALESCE(v_name, v_email, v_phone), 'ghost', v_email, v_phone)
  RETURNING id INTO v_member_id;

  RETURN v_member_id;
END
$function$;
REVOKE ALL ON FUNCTION public.waves_add_ghost_member(uuid, text, uuid, text, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.waves_add_ghost_member(uuid, text, uuid, text, text, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.waves_member_has_history(p_member_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  SELECT EXISTS (SELECT 1 FROM public.company_entries WHERE member_id = p_member_id OR created_by = p_member_id OR updated_by = p_member_id)
      OR EXISTS (SELECT 1 FROM public.expenses WHERE created_by = p_member_id)
      OR EXISTS (SELECT 1 FROM public.expense_shares WHERE member_id = p_member_id)
      OR EXISTS (SELECT 1 FROM public.expense_payers WHERE member_id = p_member_id)
      OR EXISTS (
           SELECT 1 FROM public.settlements
            WHERE from_member_id = p_member_id OR to_member_id = p_member_id
         );
$$;
REVOKE ALL ON FUNCTION public.waves_member_has_history(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.waves_member_has_history(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.waves_shares_a_group_with(p_profile_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  SELECT p_profile_id IS NOT NULL
     AND (
       -- Your own face, always.
       p_profile_id = public.waves_current_profile_id()
       OR EXISTS (
         SELECT 1
         FROM public.group_members mine
         JOIN public.group_members theirs ON theirs.group_id = mine.group_id
         WHERE mine.profile_id = public.waves_current_profile_id()
           AND theirs.profile_id = p_profile_id
           AND mine.left_at IS NULL
           AND (NOT public.waves_is_company(mine.group_id) OR mine.role = 'admin')
       )
     )
$$;
REVOKE ALL ON FUNCTION public.waves_shares_a_group_with(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.waves_shares_a_group_with(uuid) TO authenticated, service_role;


-- The invoker column guard cannot see other employees' ledger rows under RLS.
-- Enforce the same currency lock independently with the full ledger visible.
CREATE FUNCTION public.waves_company_currency_guard() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
BEGIN
 IF NEW.default_currency IS DISTINCT FROM OLD.default_currency
    AND EXISTS (SELECT 1 FROM public.company_entries WHERE group_id = OLD.id) THEN
   RAISE EXCEPTION 'CURRENCY_LOCKED: a company ledger fixes the group currency'
     USING ERRCODE = 'check_violation';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.waves_company_currency_guard() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.waves_company_currency_guard() TO service_role;
CREATE TRIGGER company_currency_guard BEFORE UPDATE ON public.groups
 FOR EACH ROW EXECUTE FUNCTION public.waves_company_currency_guard();

-- Folding a placeholder into another member does not move company entries; until it
-- does, refuse it in company groups so a ledger is never stranded on a retired row.
CREATE FUNCTION public.waves_company_no_fold() RETURNS trigger
 LANGUAGE plpgsql SET search_path TO 'public', 'pg_temp' AS $$
BEGIN
 IF NEW.merged_into_member_id IS DISTINCT FROM OLD.merged_into_member_id AND public.waves_is_company(NEW.group_id) THEN
  RAISE EXCEPTION 'COMPANY_GROUP: members cannot be merged in a company group' USING ERRCODE = 'check_violation';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER company_no_fold BEFORE UPDATE ON public.group_members FOR EACH ROW EXECUTE FUNCTION public.waves_company_no_fold();
REVOKE ALL ON FUNCTION public.waves_company_no_fold() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.waves_company_no_fold() TO service_role;
