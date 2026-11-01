-- Vendor payments v2: a bill's due date, a payment's method + reference, and a per-company receipt number (#R-12).
ALTER TABLE public.company_vendor_entries
 ADD COLUMN due_on date,
 ADD COLUMN method text CHECK(method IS NULL OR method IN ('upi','bank','cash','other')),
 ADD COLUMN reference text CHECK(reference IS NULL OR length(reference)<=64),
 ADD COLUMN receipt_no integer,
 ADD CONSTRAINT vendor_entry_extras CHECK((kind='bill' OR due_on IS NULL) AND (kind='payment' OR (method IS NULL AND reference IS NULL AND receipt_no IS NULL)));

-- Existing payments are numbered oldest first. The UPDATE also re-stamps updated_seq, so phones pull the number.
UPDATE public.company_vendor_entries e SET receipt_no=n.rn
FROM (SELECT id, row_number() OVER (PARTITION BY group_id ORDER BY created_at, id) AS rn FROM public.company_vendor_entries WHERE kind='payment') n
WHERE e.id=n.id;

ALTER TABLE public.company_vendor_entries ADD CONSTRAINT company_vendor_entries_group_receipt_key UNIQUE(group_id, receipt_no);

-- One writer per company at a time while it takes the next number (voided payments keep theirs).
CREATE FUNCTION public.waves_company_vendor_receipt_no() RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public','pg_temp' AS $$
BEGIN
 IF TG_OP='UPDATE' THEN NEW.receipt_no:=OLD.receipt_no; RETURN NEW; END IF;
 IF NEW.kind<>'payment' THEN NEW.receipt_no:=NULL; RETURN NEW; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.group_id::text,11));
 SELECT coalesce(max(receipt_no),0)+1 INTO NEW.receipt_no FROM public.company_vendor_entries WHERE group_id=NEW.group_id;
 RETURN NEW;
END $$;
-- Named so it runs before the updated_seq stamp trigger (alphabetical order).
CREATE TRIGGER company_vendor_entries_a_receipt BEFORE INSERT OR UPDATE ON public.company_vendor_entries FOR EACH ROW EXECUTE FUNCTION public.waves_company_vendor_receipt_no();
REVOKE ALL ON FUNCTION public.waves_company_vendor_receipt_no() FROM PUBLIC, anon, authenticated;

-- Same as before, plus dueOn (bills), method + reference (payments).
CREATE OR REPLACE FUNCTION public.waves_company_vendor_entry_create(p_group_id uuid,p_entry_id uuid,p_vendor_id uuid,p_kind text,p_data jsonb) RETURNS uuid
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
DECLARE me uuid; rl text; v public.company_vendors%ROWTYPE; r public.company_vendor_entries%ROWTYPE; h text; v_amount bigint; v_status text:='approved'; v_fund uuid;
 v_due date; v_method text; v_ref text;
BEGIN
 SELECT * INTO me,rl FROM public.waves_company_vendor_role(p_group_id);
 IF p_entry_id IS NULL OR p_kind NOT IN ('bill','advance','payment') OR jsonb_typeof(p_data) IS DISTINCT FROM 'object'
  OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_data) k WHERE k NOT IN ('amount','occurredOn','note','dueOn','method','reference')) THEN RAISE EXCEPTION 'INVALID_DATA' USING ERRCODE='check_violation'; END IF;
 IF p_data->>'amount' !~ '^[0-9]{1,15}$' OR (p_data->>'amount')::bigint<=0 OR p_data->>'occurredOn' !~ '^\d{4}-\d{2}-\d{2}$'
  OR length(coalesce(p_data->>'note',''))>500 THEN RAISE EXCEPTION 'INVALID_DATA' USING ERRCODE='check_violation'; END IF;
 v_amount:=(p_data->>'amount')::bigint;
 v_due:=NULL; v_method:=nullif(p_data->>'method',''); v_ref:=nullif(btrim(coalesce(p_data->>'reference','')),'');
 IF nullif(p_data->>'dueOn','') IS NOT NULL THEN
  IF p_kind<>'bill' OR p_data->>'dueOn' !~ '^\d{4}-\d{2}-\d{2}$' THEN RAISE EXCEPTION 'INVALID_DATA' USING ERRCODE='check_violation'; END IF;
  v_due:=(p_data->>'dueOn')::date;
 END IF;
 IF (v_method IS NOT NULL OR v_ref IS NOT NULL) AND p_kind<>'payment' THEN RAISE EXCEPTION 'INVALID_DATA' USING ERRCODE='check_violation'; END IF;
 IF v_method IS NOT NULL AND v_method NOT IN ('upi','bank','cash','other') THEN RAISE EXCEPTION 'INVALID_DATA' USING ERRCODE='check_violation'; END IF;
 IF length(coalesce(v_ref,''))>64 THEN RAISE EXCEPTION 'INVALID_DATA' USING ERRCODE='check_violation'; END IF;
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
 IF p_kind IN ('advance','payment') AND rl='manager' THEN v_fund:=me; END IF;
 INSERT INTO public.company_vendor_entries(id,group_id,vendor_id,kind,amount,occurred_on,note,status,created_by,funding_manager_id,request_hash,due_on,method,reference)
 VALUES(p_entry_id,p_group_id,p_vendor_id,p_kind,v_amount,(p_data->>'occurredOn')::date,nullif(btrim(coalesce(p_data->>'note','')),''),v_status,me,v_fund,h,v_due,v_method,v_ref);
 RETURN p_entry_id;
END $$;
REVOKE ALL ON FUNCTION public.waves_company_vendor_entry_create(uuid,uuid,uuid,text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.waves_company_vendor_entry_create(uuid,uuid,uuid,text,jsonb) TO authenticated,service_role;
