-- Paid extra companies. A user may OWN one company free; each further owned company needs its own monthly
-- "company slot" subscription (RevenueCat product waves_company_slot_monthly), bound to that company.
-- Employee/manager roles in other companies are never counted. A lapsed slot never deletes data: the company
-- turns read-only (groups.slot_lapsed_at, honoured by waves_company_is_blocked) until a slot is active again.

ALTER TABLE public.groups ADD COLUMN slot_lapsed_at timestamptz;

-- One row per store subscription (keyed like the storage pack by its original transaction id).
-- group_id is null until a company claims the slot; it is only ever moved off a deleted company.
CREATE TABLE public.company_slots (
 store_txn_id text PRIMARY KEY,
 profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
 active boolean NOT NULL,
 event_at timestamptz,
 group_id uuid, -- no FK: the binding outlives a deleted company
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX company_slots_profile_idx ON public.company_slots(profile_id);
CREATE INDEX company_slots_group_idx ON public.company_slots(group_id) WHERE group_id IS NOT NULL;
ALTER TABLE public.company_slots ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.company_slots FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.company_slots TO service_role;

-- A company is read-only for Waves moderation (suspended_at) or a lapsed slot (slot_lapsed_at).
-- Drift-checked against 20261113130000_company_moderation: same body plus the slot test.
CREATE OR REPLACE FUNCTION public.waves_company_is_blocked(p_group_id uuid) RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
 SELECT EXISTS(SELECT 1 FROM public.groups WHERE id=p_group_id AND (suspended_at IS NOT NULL OR slot_lapsed_at IS NOT NULL));
$$;

-- Drift-checked against 20261113130000_company_moderation. Added: slot_lapsed_at is written only by the
-- slot functions below (they set waves.company_slot_sync), and a lapsed company accepts nothing but deletion.
CREATE OR REPLACE FUNCTION public.waves_company_block_group_guard() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
DECLARE keep text[]:=ARRAY['updated_seq','updated_at'];
BEGIN
 IF public.waves_current_profile_id() IS NULL OR (to_jsonb(NEW)-keep)=(to_jsonb(OLD)-keep) THEN RETURN NEW; END IF; -- seq stamping on a member change is not a settings write
 IF NEW.slot_lapsed_at IS DISTINCT FROM OLD.slot_lapsed_at THEN
  IF current_setting('waves.company_slot_sync',true) IS DISTINCT FROM 'on' THEN RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE='insufficient_privilege'; END IF;
  RETURN NEW;
 END IF;
 IF NEW.suspended_at IS DISTINCT FROM OLD.suspended_at THEN RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE='insufficient_privilege'; END IF;
 IF OLD.suspended_at IS NOT NULL THEN RAISE EXCEPTION 'COMPANY_BLOCKED' USING ERRCODE='insufficient_privilege'; END IF;
 IF OLD.slot_lapsed_at IS NOT NULL AND (to_jsonb(NEW)-keep-'deleted_at')<>(to_jsonb(OLD)-keep-'deleted_at') THEN
  RAISE EXCEPTION 'COMPANY_BLOCKED' USING ERRCODE='insufficient_privilege';
 END IF;
 RETURN NEW;
END $$;

-- Lapsed exactly when no active slot is bound to a company that has a slot bound at all.
-- The free company has no slot ever bound, so it is never touched.
CREATE FUNCTION public.waves_company_slot_lapse_sync(p_group_id uuid) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
DECLARE v_lapsed boolean;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.company_slots WHERE group_id=p_group_id) THEN RETURN; END IF;
 v_lapsed:=NOT EXISTS(SELECT 1 FROM public.company_slots WHERE group_id=p_group_id AND active);
 PERFORM set_config('waves.company_slot_sync','on',true);
 UPDATE public.groups SET slot_lapsed_at=CASE WHEN v_lapsed THEN coalesce(slot_lapsed_at,now()) ELSE NULL END
  WHERE id=p_group_id AND (slot_lapsed_at IS NOT NULL) IS DISTINCT FROM v_lapsed;
 PERFORM set_config('waves.company_slot_sync','off',true);
END $$;
REVOKE ALL ON FUNCTION public.waves_company_slot_lapse_sync(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.waves_company_slot_lapse_sync(uuid) TO service_role;

-- Claims one free active slot of the profile for a company: unbound, or bound to a deleted company.
-- Returns false when there is none. Caller holds the per-profile lock.
CREATE FUNCTION public.waves_company_slot_claim(p_profile_id uuid, p_group_id uuid) RETURNS boolean
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
DECLARE v_txn text;
BEGIN
 SELECT s.store_txn_id INTO v_txn FROM public.company_slots s
  WHERE s.profile_id=p_profile_id AND s.active
   AND (s.group_id IS NULL OR EXISTS(SELECT 1 FROM public.groups g WHERE g.id=s.group_id AND g.deleted_at IS NOT NULL))
  ORDER BY s.created_at LIMIT 1 FOR UPDATE SKIP LOCKED;
 IF v_txn IS NULL THEN RETURN false; END IF;
 UPDATE public.company_slots SET group_id=p_group_id,updated_at=now() WHERE store_txn_id=v_txn;
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.waves_company_slot_claim(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.waves_company_slot_claim(uuid,uuid) TO service_role;

-- The gate. Covers waves_create_group AND a direct insert (groups_insert RLS lets a member insert a row), and
-- turning an existing group into a company or restoring a deleted one. Service/migration writes (no profile) skip it.
CREATE FUNCTION public.waves_company_slot_guard() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
DECLARE v_owner uuid:=NEW.created_by;
BEGIN
 IF NEW.type::text<>'company' OR NEW.deleted_at IS NOT NULL OR v_owner IS NULL
  OR public.waves_current_profile_id() IS NULL THEN RETURN NEW; END IF;
 IF TG_OP='UPDATE' AND OLD.type::text='company' AND OLD.deleted_at IS NULL THEN RETURN NEW; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('company-slot:'||v_owner::text,0));
 -- A restored company keeps the slot it already holds.
 IF TG_OP='UPDATE' AND EXISTS(SELECT 1 FROM public.company_slots WHERE group_id=NEW.id AND active) THEN RETURN NEW; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.groups WHERE created_by=v_owner AND type::text='company' AND deleted_at IS NULL AND id<>NEW.id) THEN
  RETURN NEW; -- the first company is free
 END IF;
 IF NOT public.waves_company_slot_claim(v_owner,NEW.id) THEN
  RAISE EXCEPTION 'COMPANY_SLOT_REQUIRED: an extra company needs a company subscription' USING ERRCODE='insufficient_privilege';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.waves_company_slot_guard() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.waves_company_slot_guard() TO service_role;
CREATE TRIGGER company_slot_guard BEFORE INSERT OR UPDATE OF type,deleted_at ON public.groups
 FOR EACH ROW EXECUTE FUNCTION public.waves_company_slot_guard();

-- Called by revenuecat-webhook for a slot event; dedupes on the same ledger as the other apply functions.
-- p_action: {store_txn_id, active}. Never deletes anything: a lapse only flips the bound company read-only.
CREATE FUNCTION public.waves_company_slot_apply(
 p_event_id text,p_type text,p_app_user_id text,p_event_at timestamptz,p_action jsonb
) RETURNS text LANGUAGE plpgsql SET search_path TO 'public','pg_temp' AS $fn$
DECLARE
 uuid_re constant text:='^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
 v_txn text:=p_action->>'store_txn_id'; v_active boolean:=coalesce((p_action->>'active')::boolean,false);
 v_profile uuid; v_out text; s public.company_slots%ROWTYPE;
BEGIN
 IF p_event_id IS NULL OR length(p_event_id)=0 THEN RAISE EXCEPTION 'waves_company_slot_apply needs an event id'; END IF;
 INSERT INTO public.revenuecat_events(id,type,app_user_id,event_at) VALUES(p_event_id,p_type,p_app_user_id,p_event_at) ON CONFLICT(id) DO NOTHING;
 IF NOT FOUND THEN RETURN 'duplicate'; END IF;
 IF v_txn IS NULL OR length(v_txn)=0 THEN v_out:='ignored';
 ELSE
  PERFORM pg_advisory_xact_lock(hashtextextended('company-slot-txn:'||v_txn,0));
  SELECT * INTO s FROM public.company_slots WHERE store_txn_id=v_txn FOR UPDATE;
  IF NOT FOUND THEN
   IF coalesce(p_app_user_id,'') ~ uuid_re THEN v_profile:=p_app_user_id::uuid; END IF;
   IF v_profile IS NULL OR NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=v_profile) THEN v_out:='unknown_user';
   ELSE
    INSERT INTO public.company_slots(store_txn_id,profile_id,active,event_at) VALUES(v_txn,v_profile,v_active,p_event_at);
    v_out:='applied';
   END IF;
  ELSIF s.event_at IS NOT NULL AND p_event_at IS NOT NULL AND s.event_at>p_event_at THEN v_out:='stale';
  ELSE
   UPDATE public.company_slots SET active=v_active,event_at=p_event_at,updated_at=now() WHERE store_txn_id=v_txn;
   IF s.group_id IS NOT NULL THEN PERFORM public.waves_company_slot_lapse_sync(s.group_id); END IF;
   v_out:='applied';
  END IF;
 END IF;
 UPDATE public.revenuecat_events SET outcome=v_out WHERE id=p_event_id;
 RETURN v_out;
END $fn$;
REVOKE ALL ON FUNCTION public.waves_company_slot_apply(text,text,text,timestamptz,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.waves_company_slot_apply(text,text,text,timestamptz,jsonb) TO service_role;

-- What the create-company screen asks: does this user need a slot for one more company, and is one free?
CREATE FUNCTION public.waves_company_slot_status() RETURNS jsonb
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
 SELECT jsonb_build_object(
  'needs_slot', EXISTS(SELECT 1 FROM public.groups WHERE created_by=public.waves_current_profile_id() AND type::text='company' AND deleted_at IS NULL),
  'has_free_slot', EXISTS(SELECT 1 FROM public.company_slots s WHERE s.profile_id=public.waves_current_profile_id() AND s.active
    AND (s.group_id IS NULL OR EXISTS(SELECT 1 FROM public.groups g WHERE g.id=s.group_id AND g.deleted_at IS NOT NULL))))
$$;
REVOKE ALL ON FUNCTION public.waves_company_slot_status() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.waves_company_slot_status() TO authenticated,service_role;

-- Renew a lapsed company with a fresh subscription (a store may issue a new transaction on resubscribing).
CREATE FUNCTION public.waves_company_slot_renew(p_group_id uuid) RETURNS boolean
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
DECLARE v_profile uuid:=public.waves_current_profile_id();
BEGIN
 IF v_profile IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE='insufficient_privilege'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('company-slot:'||v_profile::text,0));
 IF NOT EXISTS(SELECT 1 FROM public.groups WHERE id=p_group_id AND created_by=v_profile AND type::text='company'
   AND deleted_at IS NULL AND slot_lapsed_at IS NOT NULL) THEN RETURN false; END IF;
 IF NOT public.waves_company_slot_claim(v_profile,p_group_id) THEN RETURN false; END IF;
 PERFORM public.waves_company_slot_lapse_sync(p_group_id);
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.waves_company_slot_renew(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.waves_company_slot_renew(uuid) TO authenticated,service_role;

REVOKE ALL ON FUNCTION public.waves_company_is_blocked(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.waves_company_is_blocked(uuid) TO authenticated,service_role;
REVOKE ALL ON FUNCTION public.waves_company_block_group_guard() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.waves_company_block_group_guard() TO service_role;
