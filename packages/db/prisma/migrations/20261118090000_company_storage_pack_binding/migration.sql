-- Who paid for the pack (the store account's app user), so the app can tell which company a store subscription pays for.
ALTER TABLE public.company_plans ADD COLUMN pack_profile uuid;
-- Packs bought before this: best guess is the company owner (only an admin can attach a pack).
UPDATE public.company_plans SET pack_profile=owner_profile_id WHERE pack_txn IS NOT NULL;
-- A store subscription belongs to the company of its first purchase for good: expiry keeps pack_txn
-- (a company's next subscription replaces it, which the unique index still allows).
CREATE OR REPLACE FUNCTION public.waves_company_storage_pack_apply(
 p_event_id text,p_type text,p_app_user_id text,p_event_at timestamptz,p_action jsonb
) RETURNS text LANGUAGE plpgsql SET search_path TO 'public','pg_temp' AS $fn$
DECLARE
 uuid_re constant text:='^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
 v_txn text:=p_action->>'store_txn_id'; v_bytes bigint:=coalesce((p_action->>'pack_bytes')::bigint,0);
 v_group uuid; v_profile uuid; v_out text; v_rows integer; plan public.company_plans%ROWTYPE;
BEGIN
 IF p_event_id IS NULL OR length(p_event_id)=0 THEN RAISE EXCEPTION 'waves_company_storage_pack_apply needs an event id'; END IF;
 INSERT INTO public.revenuecat_events(id,type,app_user_id,event_at) VALUES(p_event_id,p_type,p_app_user_id,p_event_at) ON CONFLICT(id) DO NOTHING;
 IF NOT FOUND THEN RETURN 'duplicate'; END IF;

 -- A subscription stays with the company it first paid for: the subscriber attribute is mutable
 -- (a later purchase for another company changes it), so only a subscription with no company yet reads it.
 SELECT group_id INTO v_group FROM public.company_plans WHERE pack_txn=v_txn;
 IF v_group IS NULL AND v_bytes>0 AND coalesce(p_action->>'group_id','') ~ uuid_re THEN v_group:=(p_action->>'group_id')::uuid; END IF;
 IF v_group IS NULL THEN v_out:='unknown_company';
 ELSE
  PERFORM pg_advisory_xact_lock(hashtextextended('company-storage:'||v_group::text,0));
  SELECT * INTO plan FROM public.company_plans WHERE group_id=v_group FOR UPDATE;
  IF NOT FOUND THEN v_out:='unknown_company';
  ELSIF v_bytes>0 THEN
   -- Only an owner of the company can attach a pack to it.
   IF coalesce(p_app_user_id,'') ~ uuid_re THEN v_profile:=p_app_user_id::uuid; END IF;
   IF v_profile IS NULL OR NOT EXISTS(SELECT 1 FROM public.group_members WHERE group_id=v_group AND profile_id=v_profile
     AND role='admin' AND left_at IS NULL) THEN v_out:='not_owner';
   ELSIF plan.pack_event_at IS NOT NULL AND p_event_at IS NOT NULL AND plan.pack_event_at>p_event_at THEN v_out:='stale';
   ELSE
    UPDATE public.company_plans SET storage_quota_bytes=public.waves_company_free_storage_bytes()+v_bytes,
     pack_txn=v_txn,pack_profile=v_profile,pack_event_at=p_event_at,updated_at=now() WHERE group_id=v_group;
    v_out:='applied';
   END IF;
  -- Ending reverts the quota but keeps pack_txn: the binding is permanent, so a late event for this
  -- subscription can never attach it to another company. Only the subscription that holds the pack may end it (a switch can expire the old one late).
  ELSIF plan.pack_txn IS DISTINCT FROM v_txn THEN v_out:='stale';
  ELSIF plan.pack_event_at IS NOT NULL AND p_event_at IS NOT NULL AND plan.pack_event_at>p_event_at THEN v_out:='stale';
  ELSE
   UPDATE public.company_plans SET storage_quota_bytes=NULL,pack_event_at=p_event_at,updated_at=now() WHERE group_id=v_group;
   v_out:='applied';
  END IF;
 END IF;
 UPDATE public.revenuecat_events SET outcome=v_out WHERE id=p_event_id;
 RETURN v_out;
END $fn$;
REVOKE ALL ON FUNCTION public.waves_company_storage_pack_apply(text,text,text,timestamptz,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.waves_company_storage_pack_apply(text,text,text,timestamptz,jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.waves_company_storage_pack_apply(text,text,text,timestamptz,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.waves_company_storage_pack_apply(text,text,text,timestamptz,jsonb) TO service_role;

-- The company this caller's store account currently pays a pack for (null when none).
CREATE FUNCTION public.waves_my_pack_company() RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $fn$
 SELECT group_id FROM public.company_plans WHERE pack_profile=public.waves_current_profile_id() AND storage_quota_bytes IS NOT NULL LIMIT 1
$fn$;
REVOKE ALL ON FUNCTION public.waves_my_pack_company() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.waves_my_pack_company() TO authenticated,service_role;
