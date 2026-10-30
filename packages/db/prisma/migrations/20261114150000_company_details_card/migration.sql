-- Details card: one optional card of contact + bank details per side of a company <-> vendor relationship.
--   Company card: public part (address, phone, email, GSTIN, note) readable by every live member;
--   secure part (bank, UPI, PAN) in its OWN table whose RLS excludes employees, so an employee's sync pull never carries it.
--   Vendor card: one table per vendor, visible exactly where waves_company_vendor_visible allows (owner, owning manager, that vendor).
-- Details only: nothing here initiates, requests or records a payment.

CREATE FUNCTION public.waves_company_card_role(p_group_id uuid) RETURNS text
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
 SELECT m.role::text FROM public.group_members m JOIN public.groups g ON g.id=m.group_id
 WHERE m.group_id=p_group_id AND g.type='company' AND g.deleted_at IS NULL
 AND m.profile_id=public.waves_current_profile_id() AND m.left_at IS NULL AND m.removed_at IS NULL AND m.merged_into_member_id IS NULL
 LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.waves_company_card_role(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.waves_company_card_role(uuid) TO authenticated,service_role;

CREATE TABLE public.company_details (
 group_id uuid PRIMARY KEY REFERENCES public.groups(id) ON DELETE CASCADE,
 id uuid GENERATED ALWAYS AS (group_id) STORED NOT NULL,
 address text CHECK(address IS NULL OR length(address)<=300),
 phone text CHECK(phone IS NULL OR length(phone)<=32),
 email text CHECK(email IS NULL OR length(email)<=120),
 gstin text CHECK(gstin IS NULL OR gstin ~ '^[0-9A-Z]{15}$'),
 note text CHECK(note IS NULL OR length(note)<=500),
 updated_by uuid, updated_by_name text CHECK(updated_by_name IS NULL OR length(updated_by_name)<=120),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 deleted_at timestamptz, updated_seq bigint NOT NULL DEFAULT 0
);
-- Bank + PAN: never readable by an employee.
CREATE TABLE public.company_details_secure (
 group_id uuid PRIMARY KEY REFERENCES public.groups(id) ON DELETE CASCADE,
 id uuid GENERATED ALWAYS AS (group_id) STORED NOT NULL,
 bank_name text CHECK(bank_name IS NULL OR length(bank_name)<=120),
 bank_account text CHECK(bank_account IS NULL OR bank_account ~ '^[0-9A-Za-z]{4,34}$'),
 ifsc text CHECK(ifsc IS NULL OR ifsc ~ '^[A-Z]{4}0[A-Z0-9]{6}$'),
 upi text CHECK(upi IS NULL OR upi ~ '^[^@[:space:]]{1,100}@[^@[:space:]]{1,100}$'),
 pan text CHECK(pan IS NULL OR pan ~ '^[A-Z]{5}[0-9]{4}[A-Z]$'),
 bank_changed_at timestamptz, bank_changed_by uuid,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 deleted_at timestamptz, updated_seq bigint NOT NULL DEFAULT 0
);
CREATE TABLE public.company_vendor_details (
 vendor_id uuid PRIMARY KEY, group_id uuid NOT NULL,
 id uuid GENERATED ALWAYS AS (vendor_id) STORED NOT NULL,
 bank_name text CHECK(bank_name IS NULL OR length(bank_name)<=120),
 bank_account text CHECK(bank_account IS NULL OR bank_account ~ '^[0-9A-Za-z]{4,34}$'),
 ifsc text CHECK(ifsc IS NULL OR ifsc ~ '^[A-Z]{4}0[A-Z0-9]{6}$'),
 upi text CHECK(upi IS NULL OR upi ~ '^[^@[:space:]]{1,100}@[^@[:space:]]{1,100}$'),
 pan text CHECK(pan IS NULL OR pan ~ '^[A-Z]{5}[0-9]{4}[A-Z]$'),
 address text CHECK(address IS NULL OR length(address)<=300),
 phone text CHECK(phone IS NULL OR length(phone)<=32),
 email text CHECK(email IS NULL OR length(email)<=120),
 gstin text CHECK(gstin IS NULL OR gstin ~ '^[0-9A-Z]{15}$'),
 note text CHECK(note IS NULL OR length(note)<=500),
 bank_changed_at timestamptz, bank_changed_by uuid,
 updated_by uuid, updated_by_name text CHECK(updated_by_name IS NULL OR length(updated_by_name)<=120),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 deleted_at timestamptz, updated_seq bigint NOT NULL DEFAULT 0,
 FOREIGN KEY(vendor_id,group_id) REFERENCES public.company_vendors(id,group_id) ON DELETE CASCADE
);
CREATE INDEX company_details_sync_idx ON public.company_details(group_id,updated_seq);
CREATE INDEX company_details_secure_sync_idx ON public.company_details_secure(group_id,updated_seq);
CREATE INDEX company_vendor_details_sync_idx ON public.company_vendor_details(group_id,updated_seq);
CREATE TRIGGER company_details_stamp BEFORE INSERT OR UPDATE ON public.company_details FOR EACH ROW EXECUTE FUNCTION public.waves_stamp_seq();
CREATE TRIGGER company_details_secure_stamp BEFORE INSERT OR UPDATE ON public.company_details_secure FOR EACH ROW EXECUTE FUNCTION public.waves_stamp_seq();
CREATE TRIGGER company_vendor_details_stamp BEFORE INSERT OR UPDATE ON public.company_vendor_details FOR EACH ROW EXECUTE FUNCTION public.waves_stamp_seq();
-- A suspended company is read-only.
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['company_details','company_details_secure','company_vendor_details'] LOOP
  EXECUTE format('CREATE TRIGGER aa_company_block_guard BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.waves_company_block_guard()',t);
 END LOOP;
END $$;

ALTER TABLE public.company_details ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_details_secure ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_vendor_details ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.company_details,public.company_details_secure,public.company_vendor_details FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.company_details,public.company_details_secure,public.company_vendor_details TO authenticated;
GRANT ALL ON public.company_details,public.company_details_secure,public.company_vendor_details TO service_role;
CREATE POLICY company_details_select ON public.company_details FOR SELECT TO authenticated USING(public.waves_company_card_role(group_id) IS NOT NULL);
CREATE POLICY company_details_secure_select ON public.company_details_secure FOR SELECT TO authenticated
 USING(public.waves_company_card_role(group_id) IN ('admin','manager','vendor'));
CREATE POLICY company_vendor_details_select ON public.company_vendor_details FOR SELECT TO authenticated USING(public.waves_company_vendor_visible(group_id,vendor_id));

-- Cleans one card: only the known keys, blanks become null, shapes checked. Raises INVALID_DATA.
CREATE FUNCTION public.waves_company_card_clean(p_data jsonb) RETURNS jsonb
 LANGUAGE plpgsql IMMUTABLE SET search_path TO 'public','pg_temp' AS $$
DECLARE k text; v text; o jsonb:='{}'::jsonb;
BEGIN
 IF jsonb_typeof(p_data) IS DISTINCT FROM 'object'
  OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_data) x WHERE x NOT IN ('bankName','bankAccount','ifsc','upi','pan','address','phone','email','gstin','note')) THEN
  RAISE EXCEPTION 'INVALID_DATA' USING ERRCODE='check_violation'; END IF;
 FOREACH k IN ARRAY ARRAY['bankName','bankAccount','ifsc','upi','pan','address','phone','email','gstin','note'] LOOP
  IF jsonb_typeof(p_data->k) NOT IN ('string','null') AND p_data ? k THEN RAISE EXCEPTION 'INVALID_DATA' USING ERRCODE='check_violation'; END IF;
  v:=nullif(btrim(coalesce(p_data->>k,'')),'');
  IF v IS NOT NULL THEN
   IF k IN ('ifsc','gstin','pan') THEN v:=upper(v); END IF;
   IF (k='bankName' AND length(v)>120) OR (k='bankAccount' AND v !~ '^[0-9A-Za-z]{4,34}$')
    OR (k='ifsc' AND v !~ '^[A-Z]{4}0[A-Z0-9]{6}$') OR (k='upi' AND v !~ '^[^@[:space:]]{1,100}@[^@[:space:]]{1,100}$')
    OR (k='pan' AND v !~ '^[A-Z]{5}[0-9]{4}[A-Z]$') OR (k='address' AND length(v)>300) OR (k='phone' AND (length(v)>32 OR v !~ '^[+0-9().[:space:]-]{3,}$'))
    OR (k='email' AND (length(v)>120 OR v !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')) OR (k='gstin' AND v !~ '^[0-9A-Z]{15}$')
    OR (k='note' AND length(v)>500) THEN RAISE EXCEPTION 'INVALID_DATA' USING ERRCODE='check_violation'; END IF;
  END IF;
  o:=o||jsonb_build_object(k,v);
 END LOOP;
 RETURN o;
END $$;
REVOKE ALL ON FUNCTION public.waves_company_card_clean(jsonb) FROM PUBLIC,anon,authenticated;

-- Display name of a member, kept on the card so "Updated 2 days ago by Ravi" needs no member lookup.
CREATE FUNCTION public.waves_company_card_name(p_member_id uuid) RETURNS text
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
 SELECT left(coalesce(p.display_name,m.ghost_name,''),120) FROM public.group_members m LEFT JOIN public.profiles p ON p.id=m.profile_id WHERE m.id=p_member_id;
$$;
REVOKE ALL ON FUNCTION public.waves_company_card_name(uuid) FROM PUBLIC,anon,authenticated;

-- Owner sets the company card (full replace).
CREATE FUNCTION public.waves_company_details_set(p_group_id uuid,p_data jsonb) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
DECLARE me uuid; d jsonb; nm text; old public.company_details_secure%ROWTYPE; chg boolean;
BEGIN
 me:=public.waves_company_actor(p_group_id);
 IF public.waves_company_card_role(p_group_id) IS DISTINCT FROM 'admin' THEN RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE='insufficient_privilege'; END IF;
 IF public.waves_company_is_blocked(p_group_id) THEN RAISE EXCEPTION 'COMPANY_BLOCKED' USING ERRCODE='insufficient_privilege'; END IF;
 d:=public.waves_company_card_clean(p_data);
 nm:=public.waves_company_card_name(me);
 PERFORM 1 FROM public.groups WHERE id=p_group_id FOR UPDATE;
 SELECT * INTO old FROM public.company_details_secure WHERE group_id=p_group_id;
 chg:=(old.bank_name,old.bank_account,old.ifsc,old.upi) IS DISTINCT FROM (d->>'bankName',d->>'bankAccount',d->>'ifsc',d->>'upi');
 INSERT INTO public.company_details(group_id,address,phone,email,gstin,note,updated_by,updated_by_name)
 VALUES(p_group_id,d->>'address',d->>'phone',d->>'email',d->>'gstin',d->>'note',me,nm)
 ON CONFLICT(group_id) DO UPDATE SET address=excluded.address,phone=excluded.phone,email=excluded.email,gstin=excluded.gstin,note=excluded.note,
  updated_by=me,updated_by_name=nm,updated_at=now(),deleted_at=NULL;
 INSERT INTO public.company_details_secure(group_id,bank_name,bank_account,ifsc,upi,pan,bank_changed_at,bank_changed_by)
 VALUES(p_group_id,d->>'bankName',d->>'bankAccount',d->>'ifsc',d->>'upi',d->>'pan',CASE WHEN chg THEN now() END,CASE WHEN chg THEN me END)
 ON CONFLICT(group_id) DO UPDATE SET bank_name=excluded.bank_name,bank_account=excluded.bank_account,ifsc=excluded.ifsc,upi=excluded.upi,pan=excluded.pan,
  bank_changed_at=CASE WHEN chg THEN now() ELSE company_details_secure.bank_changed_at END,
  bank_changed_by=CASE WHEN chg THEN me ELSE company_details_secure.bank_changed_by END,updated_at=now(),deleted_at=NULL;
END $$;

-- Owner, the owning manager, or the linked vendor sets a vendor's card (full replace).
CREATE FUNCTION public.waves_company_vendor_details_set(p_group_id uuid,p_vendor_id uuid,p_data jsonb) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
DECLARE me uuid; rl text; d jsonb; nm text; old public.company_vendor_details%ROWTYPE; chg boolean;
BEGIN
 SELECT * INTO me,rl FROM public.waves_company_vendor_role(p_group_id);
 IF p_vendor_id IS NULL OR rl NOT IN ('admin','manager','vendor')
  OR NOT EXISTS(SELECT 1 FROM public.company_vendors WHERE id=p_vendor_id AND group_id=p_group_id AND deleted_at IS NULL)
  OR NOT public.waves_company_vendor_visible(p_group_id,p_vendor_id) THEN RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE='insufficient_privilege'; END IF;
 IF public.waves_company_is_blocked(p_group_id) THEN RAISE EXCEPTION 'COMPANY_BLOCKED' USING ERRCODE='insufficient_privilege'; END IF;
 d:=public.waves_company_card_clean(p_data);
 nm:=public.waves_company_card_name(me);
 PERFORM 1 FROM public.company_vendors WHERE id=p_vendor_id FOR UPDATE;
 SELECT * INTO old FROM public.company_vendor_details WHERE vendor_id=p_vendor_id;
 chg:=(old.bank_name,old.bank_account,old.ifsc,old.upi) IS DISTINCT FROM (d->>'bankName',d->>'bankAccount',d->>'ifsc',d->>'upi');
 INSERT INTO public.company_vendor_details(vendor_id,group_id,bank_name,bank_account,ifsc,upi,pan,address,phone,email,gstin,note,bank_changed_at,bank_changed_by,updated_by,updated_by_name)
 VALUES(p_vendor_id,p_group_id,d->>'bankName',d->>'bankAccount',d->>'ifsc',d->>'upi',d->>'pan',d->>'address',d->>'phone',d->>'email',d->>'gstin',d->>'note',
  CASE WHEN chg THEN now() END,CASE WHEN chg THEN me END,me,nm)
 ON CONFLICT(vendor_id) DO UPDATE SET bank_name=excluded.bank_name,bank_account=excluded.bank_account,ifsc=excluded.ifsc,upi=excluded.upi,pan=excluded.pan,
  address=excluded.address,phone=excluded.phone,email=excluded.email,gstin=excluded.gstin,note=excluded.note,
  bank_changed_at=CASE WHEN chg THEN now() ELSE company_vendor_details.bank_changed_at END,
  bank_changed_by=CASE WHEN chg THEN me ELSE company_vendor_details.bank_changed_by END,
  updated_by=me,updated_by_name=nm,updated_at=now(),deleted_at=NULL;
END $$;
REVOKE ALL ON FUNCTION public.waves_company_details_set(uuid,jsonb),public.waves_company_vendor_details_set(uuid,uuid,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.waves_company_details_set(uuid,jsonb),public.waves_company_vendor_details_set(uuid,uuid,jsonb) TO authenticated,service_role;
