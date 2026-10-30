-- Company vendors: a named supplier/contractor/landlord with a ledger (bills, advances, payments).
-- Separate tables, not company_entries: no employee-facing trigger, statement, export or wage path can ever see them.
-- A vendor who is invited becomes a group member with role 'vendor' (sees only their own vendor row + ledger).

CREATE TABLE public.company_vendors (
 id uuid PRIMARY KEY, group_id uuid NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
 name text NOT NULL CHECK(length(btrim(name)) BETWEEN 1 AND 120),
 phone text CHECK(phone IS NULL OR length(phone)<=32),
 category text CHECK(category IS NULL OR length(category)<=40),
 added_by uuid NOT NULL, member_id uuid UNIQUE,
 version integer NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 deleted_at timestamptz, updated_seq bigint NOT NULL DEFAULT 0,
 UNIQUE(id,group_id),
 FOREIGN KEY(added_by,group_id) REFERENCES public.group_members(id,group_id),
 FOREIGN KEY(member_id,group_id) REFERENCES public.group_members(id,group_id)
);
CREATE INDEX company_vendors_sync_idx ON public.company_vendors(group_id,updated_seq);
CREATE TABLE public.company_vendor_entries (
 id uuid PRIMARY KEY, group_id uuid NOT NULL, vendor_id uuid NOT NULL,
 kind text NOT NULL CHECK(kind IN ('bill','advance','payment')),
 amount bigint NOT NULL CHECK(amount>0 AND amount<=100000000000000),
 occurred_on date NOT NULL, note text CHECK(note IS NULL OR length(note)<=500),
 status text NOT NULL DEFAULT 'approved' CHECK(status IN ('pending','approved','rejected')),
 created_by uuid NOT NULL, reviewed_by uuid, reviewed_at timestamptz, review_note text CHECK(review_note IS NULL OR length(review_note)<=500),
 funding_manager_id uuid, received_at timestamptz, void_reason text CHECK(void_reason IS NULL OR length(void_reason)<=500),
 request_hash text, version integer NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 deleted_at timestamptz, updated_seq bigint NOT NULL DEFAULT 0,
 -- Only a bill is ever pending or rejected; only a payment can be marked received or drawn from a manager's pool.
 CONSTRAINT vendor_entry_shape CHECK((kind='bill' OR status='approved') AND (kind<>'bill' OR (received_at IS NULL AND funding_manager_id IS NULL))),
 FOREIGN KEY(vendor_id,group_id) REFERENCES public.company_vendors(id,group_id) ON DELETE CASCADE,
 FOREIGN KEY(created_by,group_id) REFERENCES public.group_members(id,group_id),
 FOREIGN KEY(funding_manager_id,group_id) REFERENCES public.group_members(id,group_id)
);
CREATE INDEX company_vendor_entries_sync_idx ON public.company_vendor_entries(group_id,updated_seq);
CREATE INDEX company_vendor_entries_vendor_idx ON public.company_vendor_entries(vendor_id,occurred_on);
CREATE INDEX company_vendor_entries_fund_idx ON public.company_vendor_entries(funding_manager_id) WHERE funding_manager_id IS NOT NULL;
CREATE TRIGGER company_vendors_stamp BEFORE INSERT OR UPDATE ON public.company_vendors FOR EACH ROW EXECUTE FUNCTION public.waves_stamp_seq();
CREATE TRIGGER company_vendor_entries_stamp BEFORE INSERT OR UPDATE ON public.company_vendor_entries FOR EACH ROW EXECUTE FUNCTION public.waves_stamp_seq();
ALTER TABLE public.company_vendors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_vendor_entries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.company_vendors, public.company_vendor_entries FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.company_vendors, public.company_vendor_entries TO authenticated;
GRANT ALL ON public.company_vendors, public.company_vendor_entries TO service_role;

-- Owner: every vendor. Manager: only vendors they added. A vendor: only their own row. Employees: none.
CREATE FUNCTION public.waves_company_vendor_visible(p_group_id uuid,p_vendor_id uuid) RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
 SELECT EXISTS(SELECT 1 FROM public.company_vendors v JOIN public.group_members me ON me.group_id=v.group_id JOIN public.groups g ON g.id=v.group_id
 WHERE v.id=p_vendor_id AND v.group_id=p_group_id AND g.type='company' AND g.deleted_at IS NULL
 AND me.profile_id=public.waves_current_profile_id() AND me.left_at IS NULL AND me.removed_at IS NULL AND me.merged_into_member_id IS NULL
 AND (me.role::text='admin' OR (me.role::text='manager' AND v.added_by=me.id) OR (me.role::text='vendor' AND v.member_id=me.id)));
$$;
REVOKE ALL ON FUNCTION public.waves_company_vendor_visible(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.waves_company_vendor_visible(uuid,uuid) TO authenticated,service_role;
CREATE POLICY company_vendors_select ON public.company_vendors FOR SELECT TO authenticated USING(public.waves_company_vendor_visible(group_id,id));
CREATE POLICY company_vendor_entries_select ON public.company_vendor_entries FOR SELECT TO authenticated USING(public.waves_company_vendor_visible(group_id,vendor_id));

-- Caller's live member row and role in a company (raises when not a member).
CREATE FUNCTION public.waves_company_vendor_role(p_group_id uuid,OUT v_me uuid,OUT v_role text) RETURNS record
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
BEGIN
 v_me:=public.waves_company_actor(p_group_id);
 SELECT role::text INTO v_role FROM public.group_members WHERE id=v_me;
END $$;
REVOKE ALL ON FUNCTION public.waves_company_vendor_role(uuid) FROM PUBLIC,anon,authenticated;

-- Create or edit a vendor (owner, or a manager for their own vendors).
CREATE FUNCTION public.waves_company_vendor_set(p_group_id uuid,p_vendor_id uuid,p_data jsonb) RETURNS uuid
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
DECLARE me uuid; rl text; r public.company_vendors%ROWTYPE; v_name text; v_phone text; v_cat text;
BEGIN
 SELECT * INTO me,rl FROM public.waves_company_vendor_role(p_group_id);
 IF rl NOT IN ('admin','manager') THEN RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE='insufficient_privilege'; END IF;
 IF p_vendor_id IS NULL OR jsonb_typeof(p_data) IS DISTINCT FROM 'object'
  OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_data) k WHERE k NOT IN ('name','phone','category')) THEN RAISE EXCEPTION 'INVALID_DATA' USING ERRCODE='check_violation'; END IF;
 v_name:=btrim(p_data->>'name'); v_phone:=nullif(btrim(coalesce(p_data->>'phone','')),''); v_cat:=nullif(btrim(coalesce(p_data->>'category','')),'');
 IF coalesce(length(v_name),0) NOT BETWEEN 1 AND 120 THEN RAISE EXCEPTION 'INVALID_DATA' USING ERRCODE='check_violation'; END IF;
 PERFORM 1 FROM public.groups WHERE id=p_group_id FOR UPDATE;
 SELECT * INTO r FROM public.company_vendors WHERE id=p_vendor_id;
 IF FOUND THEN
  IF r.group_id<>p_group_id OR NOT public.waves_company_vendor_visible(p_group_id,r.id) OR r.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE='insufficient_privilege'; END IF;
  UPDATE public.company_vendors SET name=v_name,phone=v_phone,category=v_cat,version=version+1,updated_at=now() WHERE id=r.id;
  RETURN r.id;
 END IF;
 INSERT INTO public.company_vendors(id,group_id,name,phone,category,added_by) VALUES(p_vendor_id,p_group_id,v_name,v_phone,v_cat,me);
 RETURN p_vendor_id;
END $$;

CREATE FUNCTION public.waves_company_vendor_remove(p_vendor_id uuid) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
DECLARE r public.company_vendors%ROWTYPE; rl text; me uuid;
BEGIN
 SELECT * INTO r FROM public.company_vendors WHERE id=p_vendor_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE='insufficient_privilege'; END IF;
 SELECT * INTO me,rl FROM public.waves_company_vendor_role(r.group_id);
 IF rl NOT IN ('admin','manager') OR NOT public.waves_company_vendor_visible(r.group_id,r.id) THEN RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE='insufficient_privilege'; END IF;
 IF r.deleted_at IS NOT NULL THEN RETURN; END IF;
 UPDATE public.company_vendors SET deleted_at=now(),version=version+1,updated_at=now() WHERE id=r.id;
 -- A linked vendor login stops seeing the ledger once the vendor is removed.
 IF r.member_id IS NOT NULL THEN UPDATE public.group_members SET left_at=now() WHERE id=r.member_id AND left_at IS NULL; END IF;
END $$;

-- One ledger line. A vendor may only add a pending bill; owner/manager lines count at once.
CREATE FUNCTION public.waves_company_vendor_entry_create(p_group_id uuid,p_entry_id uuid,p_vendor_id uuid,p_kind text,p_data jsonb) RETURNS uuid
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
DECLARE me uuid; rl text; v public.company_vendors%ROWTYPE; r public.company_vendor_entries%ROWTYPE; h text; v_amount bigint; v_status text:='approved'; v_fund uuid;
BEGIN
 SELECT * INTO me,rl FROM public.waves_company_vendor_role(p_group_id);
 IF p_entry_id IS NULL OR p_kind NOT IN ('bill','advance','payment') OR jsonb_typeof(p_data) IS DISTINCT FROM 'object'
  OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_data) k WHERE k NOT IN ('amount','occurredOn','note')) THEN RAISE EXCEPTION 'INVALID_DATA' USING ERRCODE='check_violation'; END IF;
 IF p_data->>'amount' !~ '^[0-9]{1,15}$' OR (p_data->>'amount')::bigint<=0 OR p_data->>'occurredOn' !~ '^\d{4}-\d{2}-\d{2}$'
  OR length(coalesce(p_data->>'note',''))>500 THEN RAISE EXCEPTION 'INVALID_DATA' USING ERRCODE='check_violation'; END IF;
 v_amount:=(p_data->>'amount')::bigint;
 h:=encode(sha256(convert_to(jsonb_build_array(p_group_id,p_vendor_id,p_kind,p_data)::text,'UTF8')),'hex');
 PERFORM pg_advisory_xact_lock(hashtextextended(p_entry_id::text,5));
 SELECT * INTO r FROM public.company_vendor_entries WHERE id=p_entry_id;
 IF FOUND THEN
  IF r.group_id=p_group_id AND public.waves_company_vendor_visible(r.group_id,r.vendor_id) THEN
   IF r.request_hash IS NOT DISTINCT FROM h THEN RETURN r.id; END IF;
   RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT';
  END IF;
  RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE='insufficient_privilege';
 END IF;
 SELECT * INTO v FROM public.company_vendors WHERE id=p_vendor_id AND group_id=p_group_id AND deleted_at IS NULL;
 IF NOT FOUND OR NOT public.waves_company_vendor_visible(p_group_id,p_vendor_id) THEN RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE='insufficient_privilege'; END IF;
 IF rl='vendor' THEN
  IF p_kind<>'bill' THEN RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE='insufficient_privilege'; END IF;
  v_status:='pending';
 ELSIF rl NOT IN ('admin','manager') THEN RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE='insufficient_privilege';
 END IF;
 -- A manager's payments come out of their own cash pool.
 IF p_kind IN ('advance','payment') AND rl='manager' THEN v_fund:=me; END IF;
 INSERT INTO public.company_vendor_entries(id,group_id,vendor_id,kind,amount,occurred_on,note,status,created_by,funding_manager_id,request_hash)
 VALUES(p_entry_id,p_group_id,p_vendor_id,p_kind,v_amount,(p_data->>'occurredOn')::date,nullif(btrim(coalesce(p_data->>'note','')),''),v_status,me,v_fund,h);
 RETURN p_entry_id;
END $$;

-- Confirm or reject a vendor's pending bill (owner, or the manager who added the vendor).
CREATE FUNCTION public.waves_company_vendor_entry_review(p_entry_id uuid,p_to text,p_note text,p_version integer) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
DECLARE r public.company_vendor_entries%ROWTYPE; me uuid; rl text;
BEGIN
 SELECT * INTO r FROM public.company_vendor_entries WHERE id=p_entry_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE='insufficient_privilege'; END IF;
 SELECT * INTO me,rl FROM public.waves_company_vendor_role(r.group_id);
 IF rl NOT IN ('admin','manager') OR NOT public.waves_company_vendor_visible(r.group_id,r.vendor_id) THEN RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE='insufficient_privilege'; END IF;
 IF p_to NOT IN ('approved','rejected') OR length(coalesce(p_note,''))>500 THEN RAISE EXCEPTION 'INVALID_DATA' USING ERRCODE='check_violation'; END IF;
 IF r.deleted_at IS NOT NULL OR r.kind<>'bill' THEN RAISE EXCEPTION 'ENTRY_FROZEN'; END IF;
 IF r.status=p_to THEN RETURN; END IF;
 IF r.status<>'pending' OR r.version<>p_version THEN RAISE EXCEPTION 'STALE_VERSION' USING ERRCODE='check_violation'; END IF;
 UPDATE public.company_vendor_entries SET status=p_to,review_note=nullif(btrim(coalesce(p_note,'')),''),reviewed_by=me,reviewed_at=now(),version=version+1,updated_at=now() WHERE id=r.id;
END $$;

-- Void a line: owner/manager of the vendor any line; a vendor only their own bill that is still pending.
CREATE FUNCTION public.waves_company_vendor_entry_void(p_entry_id uuid,p_reason text) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
DECLARE r public.company_vendor_entries%ROWTYPE; me uuid; rl text;
BEGIN
 SELECT * INTO r FROM public.company_vendor_entries WHERE id=p_entry_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE='insufficient_privilege'; END IF;
 SELECT * INTO me,rl FROM public.waves_company_vendor_role(r.group_id);
 IF NOT public.waves_company_vendor_visible(r.group_id,r.vendor_id) OR length(coalesce(p_reason,''))>500
  OR NOT (rl IN ('admin','manager') OR (rl='vendor' AND r.created_by=me AND r.status='pending')) THEN RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE='insufficient_privilege'; END IF;
 IF r.deleted_at IS NOT NULL THEN RETURN; END IF;
 UPDATE public.company_vendor_entries SET deleted_at=now(),void_reason=p_reason,version=version+1,updated_at=now() WHERE id=r.id;
END $$;

-- The vendor says a recorded payment reached them. It never changes the balance.
CREATE FUNCTION public.waves_company_vendor_entry_received(p_entry_id uuid,p_received boolean) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
DECLARE r public.company_vendor_entries%ROWTYPE; me uuid; rl text;
BEGIN
 SELECT * INTO r FROM public.company_vendor_entries WHERE id=p_entry_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE='insufficient_privilege'; END IF;
 SELECT * INTO me,rl FROM public.waves_company_vendor_role(r.group_id);
 IF rl<>'vendor' OR r.kind='bill' OR r.deleted_at IS NOT NULL OR NOT public.waves_company_vendor_visible(r.group_id,r.vendor_id) THEN RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE='insufficient_privilege'; END IF;
 IF (r.received_at IS NOT NULL)=coalesce(p_received,false) THEN RETURN; END IF;
 UPDATE public.company_vendor_entries SET received_at=CASE WHEN p_received THEN now() END,version=version+1,updated_at=now() WHERE id=r.id;
END $$;

-- Invite link for one vendor (single use, 30 days). Joining turns the person into that vendor's login.
ALTER TABLE public.invites ADD COLUMN company_vendor_id uuid REFERENCES public.company_vendors(id) ON DELETE CASCADE;
CREATE FUNCTION public.waves_company_vendor_invite(p_vendor_id uuid) RETURNS text
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
DECLARE r public.company_vendors%ROWTYPE; me uuid; rl text; v_token text;
BEGIN
 SELECT * INTO r FROM public.company_vendors WHERE id=p_vendor_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE='insufficient_privilege'; END IF;
 SELECT * INTO me,rl FROM public.waves_company_vendor_role(r.group_id);
 IF rl NOT IN ('admin','manager') OR NOT public.waves_company_vendor_visible(r.group_id,r.id) OR r.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE='insufficient_privilege'; END IF;
 IF r.member_id IS NOT NULL THEN RAISE EXCEPTION 'VENDOR_ALREADY_LINKED' USING ERRCODE='check_violation'; END IF;
 UPDATE public.invites SET revoked_at=now() WHERE company_vendor_id=r.id AND revoked_at IS NULL;
 v_token:=replace(gen_random_uuid()::text||gen_random_uuid()::text,'-','');
 INSERT INTO public.invites(group_id,token_hash,created_by,expires_at,max_uses,company_vendor_id)
 VALUES(r.group_id,encode(extensions.digest(v_token,'sha256'),'hex'),public.waves_current_profile_id(),now()+interval '30 days',1,r.id);
 RETURN v_token;
END $$;

-- Join: the shared function does the membership; a vendor invite then makes the person that vendor's login.
ALTER FUNCTION public.waves_join_via_invite(uuid,uuid) RENAME TO waves_join_via_invite_base;
CREATE FUNCTION public.waves_join_via_invite(p_invite_id uuid,p_profile_id uuid) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
DECLARE v_vendor uuid; v_group uuid; res jsonb; v_member uuid;
BEGIN
 SELECT company_vendor_id,group_id INTO v_vendor,v_group FROM public.invites WHERE id=p_invite_id;
 IF v_vendor IS NULL THEN RETURN public.waves_join_via_invite_base(p_invite_id,p_profile_id); END IF;
 PERFORM 1 FROM public.company_vendors WHERE id=v_vendor FOR UPDATE;
 IF NOT EXISTS(SELECT 1 FROM public.company_vendors WHERE id=v_vendor AND member_id IS NULL AND deleted_at IS NULL)
  OR EXISTS(SELECT 1 FROM public.group_members WHERE group_id=v_group AND profile_id=p_profile_id AND left_at IS NULL) THEN
  RETURN jsonb_build_object('ok',false,'reason','INVITE_INVALID');
 END IF;
 res:=public.waves_join_via_invite_base(p_invite_id,p_profile_id);
 IF res->>'ok'<>'true' THEN RETURN res; END IF;
 v_member:=(res->>'member_id')::uuid;
 UPDATE public.group_members SET role='vendor',manager_id=NULL WHERE id=v_member;
 UPDATE public.company_vendors SET member_id=v_member,version=version+1,updated_at=now() WHERE id=v_vendor;
 RETURN res;
END $$;
REVOKE ALL ON FUNCTION public.waves_join_via_invite_base(uuid,uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.waves_join_via_invite(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.waves_join_via_invite(uuid,uuid),public.waves_join_via_invite_base(uuid,uuid) TO service_role;

-- A vendor login is never an employee: no expense/allowance/advance rows for or by it.
CREATE FUNCTION public.waves_company_no_vendor_entries() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM public.group_members WHERE role::text='vendor' AND id IN (NEW.member_id,NEW.created_by)) THEN RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE='insufficient_privilege'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER company_no_vendor_entries BEFORE INSERT ON public.company_entries FOR EACH ROW EXECUTE FUNCTION public.waves_company_no_vendor_entries();

-- Every RPC: callable by signed-in users only (each checks the caller itself).
REVOKE ALL ON FUNCTION public.waves_company_vendor_set(uuid,uuid,jsonb),public.waves_company_vendor_remove(uuid),
 public.waves_company_vendor_entry_create(uuid,uuid,uuid,text,jsonb),public.waves_company_vendor_entry_review(uuid,text,text,integer),
 public.waves_company_vendor_entry_void(uuid,text),public.waves_company_vendor_entry_received(uuid,boolean),public.waves_company_vendor_invite(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.waves_company_vendor_set(uuid,uuid,jsonb),public.waves_company_vendor_remove(uuid),
 public.waves_company_vendor_entry_create(uuid,uuid,uuid,text,jsonb),public.waves_company_vendor_entry_review(uuid,text,text,integer),
 public.waves_company_vendor_entry_void(uuid,text),public.waves_company_vendor_entry_received(uuid,boolean),public.waves_company_vendor_invite(uuid) TO authenticated,service_role;

-- A manager's pool also pays their vendors (confirmed advances and payments they recorded).
CREATE OR REPLACE FUNCTION public.waves_company_pool_balance(p_group_id uuid,p_manager_id uuid) RETURNS jsonb
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
DECLARE actor uuid; a numeric; r numeric; j numeric; d numeric; b numeric; w numeric; s numeric; c numeric; q numeric; vp numeric;
BEGIN
 actor:=public.waves_company_actor(p_group_id);
 IF NOT public.is_group_admin(p_group_id) AND NOT (actor=p_manager_id AND EXISTS(SELECT 1 FROM public.group_members WHERE id=actor AND role::text='manager')) THEN RAISE EXCEPTION 'ADMIN_ONLY' USING ERRCODE='insufficient_privilege'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.group_members WHERE id=p_manager_id AND group_id=p_group_id AND role::text='manager') THEN RAISE EXCEPTION 'INVALID_MANAGER'; END IF;
 SELECT coalesce(sum(amount) FILTER(WHERE entry_kind='allocation' AND funding_manager_id=p_manager_id),0),
 coalesce(sum(amount) FILTER(WHERE entry_kind='pool_return' AND funding_manager_id=p_manager_id),0),
 coalesce(sum(amount) FILTER(WHERE entry_kind='pool_adjustment' AND funding_manager_id=p_manager_id),0),
 coalesce(sum(amount) FILTER(WHERE entry_kind='advance' AND funding_manager_id=p_manager_id),0),
 coalesce(sum(amount) FILTER(WHERE entry_kind='reimbursement' AND direction='company_to_employee' AND funding_manager_id=p_manager_id),0),
 coalesce(sum(amount) FILTER(WHERE entry_kind='wage_payment' AND funding_manager_id=p_manager_id),0),
 coalesce(sum(amount) FILTER(WHERE entry_kind IN ('expense','allowance') AND member_id=p_manager_id),0),
 coalesce(sum(amount) FILTER(WHERE entry_kind='reimbursement' AND direction='employee_to_company' AND funding_manager_id=p_manager_id),0),
 coalesce(sum(amount) FILTER(WHERE entry_kind='expense' AND paid_by_company AND funding_manager_id=p_manager_id),0)
 INTO a,r,j,d,b,w,s,c,q FROM public.company_entries WHERE group_id=p_group_id AND deleted_at IS NULL AND status IN ('approved','reimbursed');
 SELECT coalesce(sum(amount),0) INTO vp FROM public.company_vendor_entries WHERE group_id=p_group_id AND funding_manager_id=p_manager_id AND kind IN ('advance','payment') AND status='approved' AND deleted_at IS NULL;
 RETURN jsonb_build_object('allocated',a::text,'returned',r::text,'adjusted',j::text,'advances',d::text,'reimbursed',b::text,'wages',w::text,'ownSpend',s::text,'cashReturned',c::text,'companySpend',q::text,'vendorPaid',vp::text,'balance',(a+j-r-d-b-w-s-q-vp+c)::text);
END $$;
