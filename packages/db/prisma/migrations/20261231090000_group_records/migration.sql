-- Rentals inside a couple / home group.
--
-- A household can keep rental properties together: properties, tenancies, the
-- recurring rent rules and the money records (rent received, property
-- expenses). They are NOT expenses: nothing here touches expenses, shares or
-- balances, and nothing links to anybody's Personal records.
--
-- One group-visible table shaped like `personal_records` (a kind plus an opaque
-- jsonb blob, merged field by field by the sync function), readable and
-- writable by every LIVE member of a couple/home group through RLS, seq-stamped
-- like any group child table, soft-deleted so the pull carries tombstones.
--
-- Three behaviours ride along:
--  1. A rent receipt (txn with category inc.rent) writes one activity row and
--     tells the other live members. Insert only, so merges never re-notify.
--  2. When a member leaves or is removed, or the group is deleted, each affected
--     person gets a COPY of the group's live rental records in their own
--     Personal records. New id = md5('group_records:' || profile || ':' || source
--     id)::uuid, so references (propertyId / tenancyId / recurringId) remap
--     without a lookup table, and copying twice is a no-op (ON CONFLICT DO
--     NOTHING; a copy the person deleted stays deleted). Each copy carries
--     data.copiedFrom = the source id.
--  3. waves_pref_key_for_kind learns 'rent_recorded' (involvesMe).
--
-- Deploy order: this migration, then the `sync` edge function. Old clients
-- ignore the table and the kinds they do not know.

CREATE TABLE public.group_records (
    id uuid NOT NULL,
    group_id uuid NOT NULL,
    record_kind text NOT NULL,
    data jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_seq bigint DEFAULT 0 NOT NULL,
    deleted_at timestamp with time zone,
    CONSTRAINT group_records_pkey PRIMARY KEY (id),
    CONSTRAINT group_records_kind_known CHECK ((record_kind = ANY (ARRAY['property', 'tenancy', 'recurring', 'txn']))),
    CONSTRAINT group_records_data_object CHECK ((jsonb_typeof(data) = 'object'))
);

COMMENT ON TABLE public.group_records IS 'Rental records (property, tenancy, recurring rent, txn) kept inside a couple/home group. Opaque jsonb like personal_records; never an expense.';

ALTER TABLE ONLY public.group_records
    ADD CONSTRAINT group_records_group_id_fkey FOREIGN KEY (group_id)
    REFERENCES public.groups(id) ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE ONLY public.group_records
    ADD CONSTRAINT group_records_created_by_fkey FOREIGN KEY (created_by)
    REFERENCES public.group_members(id) ON UPDATE CASCADE ON DELETE SET NULL;

CREATE INDEX group_records_group_id_updated_seq_idx ON public.group_records USING btree (group_id, updated_seq);
CREATE INDEX group_records_created_by_idx ON public.group_records USING btree (created_by);

-- Fills created_by from the signed-in member and pins the row to its group.
CREATE FUNCTION public.waves_group_records_guard() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- The author is always the signed-in caller, never a value the client sent,
    -- so one partner cannot record rent in the other's name. Only the service
    -- role (server jobs, tests) may set it explicitly.
    IF coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '') <> 'service_role'
       OR NEW.created_by IS NULL THEN
      NEW.created_by := public.waves_my_member_id(NEW.group_id);
    END IF;
  ELSE
    IF NEW.group_id <> OLD.group_id THEN
      RAISE EXCEPTION 'A record cannot move to another group' USING ERRCODE = 'check_violation';
    END IF;
    NEW.created_by := OLD.created_by;
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER group_records_guard BEFORE INSERT OR UPDATE ON public.group_records
  FOR EACH ROW EXECUTE FUNCTION public.waves_group_records_guard();
CREATE TRIGGER group_records_stamp_seq BEFORE INSERT OR UPDATE ON public.group_records
  FOR EACH ROW EXECUTE FUNCTION public.waves_stamp_seq();

-- A live member of a live couple/home group (is_group_member already refuses
-- members who left or were removed).
CREATE FUNCTION public.waves_can_use_group_records(p_group_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  SELECT public.is_group_member(p_group_id)
     AND EXISTS (SELECT 1 FROM public.groups g
                  WHERE g.id = p_group_id AND g.deleted_at IS NULL
                    AND g.type::text IN ('couple', 'home'))
$$;

ALTER TABLE public.group_records ENABLE ROW LEVEL SECURITY;

CREATE POLICY group_records_select ON public.group_records
  FOR SELECT TO authenticated USING (public.waves_can_use_group_records(group_id));
CREATE POLICY group_records_insert ON public.group_records
  FOR INSERT TO authenticated WITH CHECK (public.waves_can_use_group_records(group_id));
CREATE POLICY group_records_update ON public.group_records
  FOR UPDATE TO authenticated USING (public.waves_can_use_group_records(group_id))
  WITH CHECK (public.waves_can_use_group_records(group_id));

REVOKE ALL ON TABLE public.group_records FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE ON TABLE public.group_records TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.group_records TO service_role;

-- ─────────────────────────────────────────────────── rent receipt → partner ──

-- Push text carries no amount: the group is a couple/home space, whose
-- lock-screen text is generic (see isPrivateSpaceType); the amount lives in the
-- payload for the in-app inbox only.
CREATE FUNCTION public.waves_group_records_rent_notify() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_group_name text;
  v_actor_name text;
  v_actor_profile uuid;
  r record;
BEGIN
  IF NEW.record_kind <> 'txn' OR NEW.data->>'category' IS DISTINCT FROM 'inc.rent' THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.activity_log (group_id, actor_member_id, verb, object_type, object_id, payload)
  VALUES (NEW.group_id, NEW.created_by, 'rent_recorded', 'group_record', NEW.id,
          jsonb_build_object('amount', NEW.data->>'amount', 'currency', NEW.data->>'currency',
                             'note', NEW.data->>'note'));

  SELECT name INTO v_group_name FROM public.groups WHERE id = NEW.group_id;
  SELECT m.profile_id, COALESCE(NULLIF(p.display_name, ''), m.ghost_name, 'Someone')
    INTO v_actor_profile, v_actor_name
    FROM public.group_members m LEFT JOIN public.profiles p ON p.id = m.profile_id
   WHERE m.id = NEW.created_by;

  FOR r IN
    SELECT m.profile_id FROM public.group_members m
     WHERE m.group_id = NEW.group_id AND m.profile_id IS NOT NULL
       AND m.left_at IS NULL AND m.removed_at IS NULL
       AND m.id IS DISTINCT FROM NEW.created_by
  LOOP
    PERFORM public.waves_notify(
      r.profile_id, NEW.group_id, 'rent_recorded',
      COALESCE(v_actor_name, 'Someone') || ' recorded rent received',
      COALESCE(v_group_name, ''),
      'waves://group/' || NEW.group_id::text,
      jsonb_build_object('counterparty', COALESCE(v_actor_name, 'Someone'),
                         'group', COALESCE(v_group_name, ''),
                         'amount', NEW.data->>'amount', 'currency', NEW.data->>'currency'),
      'rent_recorded:' || NEW.id::text || ':' || r.profile_id::text);
  END LOOP;
  RETURN NULL;
END
$$;

CREATE TRIGGER group_records_rent_notify AFTER INSERT ON public.group_records
  FOR EACH ROW EXECUTE FUNCTION public.waves_group_records_rent_notify();

-- ──────────────────────────────────────────── copy to Personal on the way out ──

-- Copies the group's live rental records into one person's Personal records.
-- Idempotent (see the header). The personal seq trigger stamps each insert, so
-- the person's devices pull them on the next sync.
CREATE FUNCTION public.waves_copy_group_records_to_personal(p_group_id uuid, p_profile_id uuid) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_n integer;
BEGIN
  IF p_profile_id IS NULL THEN
    RETURN 0;
  END IF;
  WITH src AS (
    SELECT s.id, s.record_kind, s.created_at,
           s.data
             -- Only keys that point at another rental record are remapped.
             || COALESCE((
               SELECT jsonb_object_agg(k, to_jsonb(
                        md5('group_records:' || p_profile_id::text || ':' || (s.data->>k))::uuid))
                 FROM unnest(ARRAY['propertyId', 'tenancyId', 'recurringId']) AS k
                WHERE jsonb_typeof(s.data->k) = 'string'
             ), '{}'::jsonb)
             || jsonb_build_object('copiedFrom', s.id) AS data
      FROM public.group_records s
     WHERE s.group_id = p_group_id AND s.deleted_at IS NULL
  )
  INSERT INTO public.personal_records (id, owner_user_id, record_kind, data, created_at)
  SELECT md5('group_records:' || p_profile_id::text || ':' || src.id::text)::uuid,
         p_profile_id, src.record_kind, src.data, src.created_at
    FROM src
  ON CONFLICT (id) DO NOTHING;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END
$$;

CREATE FUNCTION public.waves_group_records_member_left() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
BEGIN
  -- Never block leaving or removal over the copy.
  BEGIN
    PERFORM public.waves_copy_group_records_to_personal(NEW.group_id, NEW.profile_id);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'group_records copy on leave failed for %: %', NEW.profile_id, SQLERRM;
  END;
  RETURN NULL;
END
$$;

CREATE TRIGGER group_members_copy_group_records AFTER UPDATE OF left_at ON public.group_members
  FOR EACH ROW WHEN (OLD.left_at IS NULL AND NEW.left_at IS NOT NULL AND NEW.profile_id IS NOT NULL)
  EXECUTE FUNCTION public.waves_group_records_member_left();

CREATE FUNCTION public.waves_group_records_group_deleted() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT m.profile_id FROM public.group_members m
     WHERE m.group_id = NEW.id AND m.profile_id IS NOT NULL
       AND m.left_at IS NULL AND m.removed_at IS NULL
  LOOP
    -- Never block deleting the group over the copy.
    BEGIN
      PERFORM public.waves_copy_group_records_to_personal(NEW.id, r.profile_id);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'group_records copy on delete failed for %: %', r.profile_id, SQLERRM;
    END;
  END LOOP;
  RETURN NULL;
END
$$;

CREATE TRIGGER groups_copy_group_records AFTER UPDATE OF deleted_at ON public.groups
  FOR EACH ROW WHEN (OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL)
  EXECUTE FUNCTION public.waves_group_records_group_deleted();

-- ───────────────────────────────────────────────────── push preference key ──

-- Latest body: 20261207090000_company_notifications; adds 'rent_recorded'.
CREATE OR REPLACE FUNCTION public.waves_pref_key_for_kind(p_kind text) RETURNS text
    LANGUAGE sql IMMUTABLE
    SET search_path TO 'public', 'pg_temp'
    AS $$
  SELECT CASE p_kind
    WHEN 'expense_added'             THEN 'involvesMe'
    WHEN 'expense_edited'            THEN 'involvesMe'
    WHEN 'expense_deleted'           THEN 'involvesMe'
    WHEN 'you_owe'                   THEN 'involvesMe'
    WHEN 'expense_disputed'          THEN 'involvesMe'
    WHEN 'expense_dispute_resolved'  THEN 'involvesMe'
    WHEN 'ghost_claimed'             THEN 'involvesMe'
    WHEN 'ghost_claim_requested'     THEN 'involvesMe'
    WHEN 'ghost_claim_approved'      THEN 'involvesMe'
    WHEN 'ghost_claim_declined'      THEN 'involvesMe'
    WHEN 'member_link_requested'     THEN 'involvesMe'
    WHEN 'member_link_accepted'      THEN 'involvesMe'
    WHEN 'member_link_declined'      THEN 'involvesMe'
    WHEN 'member_linked'             THEN 'involvesMe'
    WHEN 'group_invite_accepted'     THEN 'involvesMe'
    WHEN 'group_added'               THEN 'involvesMe'
    WHEN 'settlement_initiated'      THEN 'settlementRequests'
    WHEN 'settlement_confirm_request' THEN 'settlementRequests'
    WHEN 'settlement_confirmed'      THEN 'settlementRequests'
    WHEN 'settlement_cancelled'      THEN 'settlementRequests'
    WHEN 'settlement_disputed'       THEN 'settlementRequests'
    WHEN 'nudge'                     THEN 'nudges'
    WHEN 'trip_nudge_morning'        THEN 'nudges'
    WHEN 'trip_nudge_evening'        THEN 'nudges'
    WHEN 'digest_daily'              THEN 'groupActivityDigest'
    WHEN 'digest_weekly'             THEN 'groupActivityDigest'
    WHEN 'resplit'                   THEN 'involvesMe'
    WHEN 'group_import'              THEN 'involvesMe'
    WHEN 'rent_recorded'             THEN 'involvesMe'
    WHEN 'company_leave_requested'   THEN 'companyUpdates'
    WHEN 'company_leave_approved'    THEN 'companyUpdates'
    WHEN 'company_leave_rejected'    THEN 'companyUpdates'
    WHEN 'company_claim_submitted'   THEN 'companyUpdates'
    WHEN 'company_claim_approved'    THEN 'companyUpdates'
    WHEN 'company_claim_rejected'    THEN 'companyUpdates'
    WHEN 'company_claim_reimbursed'  THEN 'companyUpdates'
    WHEN 'company_payment'           THEN 'companyUpdates'
    WHEN 'company_task_assigned'     THEN 'companyUpdates'
    WHEN 'company_task_done'         THEN 'companyUpdates'
    WHEN 'company_task_blocked'      THEN 'companyUpdates'
    WHEN 'company_event'             THEN 'companyUpdates'
    WHEN 'company_estimate_accepted' THEN 'companyUpdates'
    WHEN 'company_estimate_declined' THEN 'companyUpdates'
    WHEN 'company_bill_paid'         THEN 'companyUpdates'
    WHEN 'company_ticket_assigned'   THEN 'companyUpdates'
    WHEN 'company_ticket_resolved'   THEN 'companyUpdates'
    WHEN 'company_vendor_payment'    THEN 'companyUpdates'
    WHEN 'company_vendor_order'      THEN 'companyUpdates'
    ELSE NULL
  END;
$$;

REVOKE ALL ON FUNCTION public.waves_pref_key_for_kind(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.waves_pref_key_for_kind(text) TO service_role;

-- ───────────────────────────────────────────────────────────────── grants ──

REVOKE ALL ON FUNCTION public.waves_group_records_guard() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.waves_group_records_guard() TO service_role;

REVOKE ALL ON FUNCTION public.waves_can_use_group_records(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.waves_can_use_group_records(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.waves_can_use_group_records(uuid) TO service_role;

REVOKE ALL ON FUNCTION public.waves_group_records_rent_notify() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.waves_group_records_rent_notify() TO service_role;

REVOKE ALL ON FUNCTION public.waves_copy_group_records_to_personal(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.waves_copy_group_records_to_personal(uuid, uuid) TO service_role;

REVOKE ALL ON FUNCTION public.waves_group_records_member_left() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.waves_group_records_member_left() TO service_role;

REVOKE ALL ON FUNCTION public.waves_group_records_group_deleted() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.waves_group_records_group_deleted() TO service_role;
