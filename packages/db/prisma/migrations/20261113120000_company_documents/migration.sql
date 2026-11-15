-- Company estimates and bills. Waves only records: an "Estimate" (quotation) or a "Bill" (a plain bill/receipt).
-- Never a tax invoice: no GST, no GSTIN, no e-invoicing. Items and payments live inside the row (one table to sync).
-- Visibility reuses waves_company_paid_visible: owners see every document, a manager only the ones they created,
-- employees and vendors none. Totals are recomputed here from the items, never trusted from the client.
CREATE TABLE public.company_documents (
 id uuid PRIMARY KEY,
 group_id uuid NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE ON UPDATE CASCADE,
 doc_type text NOT NULL CHECK (doc_type IN ('estimate','bill')),
 number integer NOT NULL CHECK (number > 0),
 customer_name text NOT NULL CHECK (length(btrim(customer_name)) BETWEEN 1 AND 120),
 customer_phone text CHECK (customer_phone IS NULL OR length(customer_phone) <= 32),
 doc_date date NOT NULL,
 items jsonb NOT NULL CHECK (jsonb_typeof(items) = 'array' AND jsonb_array_length(items) BETWEEN 1 AND 50),
 discount_minor bigint NOT NULL DEFAULT 0 CHECK (discount_minor >= 0),
 total_minor bigint NOT NULL CHECK (total_minor > 0 AND total_minor <= 9000000000000000),
 currency character(3) NOT NULL,
 notes text CHECK (length(notes) <= 1000),
 status text NOT NULL,
 payments jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(payments) = 'array'),
 paid_minor bigint NOT NULL DEFAULT 0 CHECK (paid_minor >= 0),
 converted_to uuid, converted_from uuid,
 created_by uuid NOT NULL, updated_by uuid NOT NULL,
 version integer NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 deleted_at timestamptz, updated_seq bigint NOT NULL DEFAULT 0,
 UNIQUE (group_id, doc_type, number),
 FOREIGN KEY (created_by) REFERENCES public.group_members(id),
 CHECK ((doc_type = 'estimate' AND status IN ('draft','sent','accepted','declined') AND paid_minor = 0)
     OR (doc_type = 'bill' AND status IN ('unpaid','part_paid','paid') AND paid_minor <= total_minor
         AND status = CASE WHEN paid_minor = 0 THEN 'unpaid' WHEN paid_minor < total_minor THEN 'part_paid' ELSE 'paid' END))
);
CREATE INDEX company_documents_sync_idx ON public.company_documents(group_id, updated_seq);
CREATE INDEX company_documents_creator_idx ON public.company_documents(group_id, created_by);
CREATE TRIGGER company_documents_stamp BEFORE INSERT OR UPDATE ON public.company_documents
 FOR EACH ROW EXECUTE FUNCTION public.waves_stamp_seq();
ALTER TABLE public.company_documents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.company_documents FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.company_documents TO authenticated;
GRANT ALL ON TABLE public.company_documents TO service_role;
CREATE POLICY company_documents_select ON public.company_documents FOR SELECT TO authenticated
 USING (public.waves_company_paid_visible(group_id, created_by));

-- Items: [{description, qtyMilli, rateMinor}] -> adds amountMinor = round_half_up(qtyMilli * rateMinor / 1000).
-- Returns {items, subtotal}. Quantities are thousandths (2.5 -> 2500) so the maths stays in integers.
CREATE FUNCTION public.waves_company_doc_items(p_items jsonb) RETURNS jsonb
 LANGUAGE plpgsql IMMUTABLE SET search_path TO 'public','pg_temp' AS $$
DECLARE it jsonb; out jsonb := '[]'; sub numeric := 0; q numeric; r numeric; a numeric; d text;
BEGIN
 IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' OR jsonb_array_length(p_items) NOT BETWEEN 1 AND 50 THEN RAISE EXCEPTION 'INVALID_DATA: items'; END IF;
 FOR it IN SELECT * FROM jsonb_array_elements(p_items) LOOP
  IF jsonb_typeof(it) IS DISTINCT FROM 'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(it) k WHERE k NOT IN ('description','qtyMilli','rateMinor','amountMinor')) THEN RAISE EXCEPTION 'INVALID_DATA: item'; END IF;
  d := btrim(coalesce(it->>'description',''));
  IF d = '' OR length(d) > 200 OR coalesce(it->>'qtyMilli','') !~ '^\d{1,9}$' OR coalesce(it->>'rateMinor','') !~ '^\d{1,13}$' THEN RAISE EXCEPTION 'INVALID_DATA: item'; END IF;
  q := (it->>'qtyMilli')::numeric; r := (it->>'rateMinor')::numeric;
  IF q <= 0 THEN RAISE EXCEPTION 'INVALID_DATA: qty'; END IF;
  a := div(q * r + 500, 1000);
  sub := sub + a;
  IF sub > 9000000000000000 THEN RAISE EXCEPTION 'INVALID_DATA: too large'; END IF;
  out := out || jsonb_build_array(jsonb_build_object('description', d, 'qtyMilli', q::bigint, 'rateMinor', r::bigint, 'amountMinor', a::bigint));
 END LOOP;
 RETURN jsonb_build_object('items', out, 'subtotal', sub::bigint);
END $$;
REVOKE ALL ON FUNCTION public.waves_company_doc_items(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.waves_company_doc_items(jsonb) TO service_role;

-- Create or edit. Owners and managers only. The number is assigned here, per company and type, under the group lock.
CREATE FUNCTION public.waves_company_doc_save(p_group_id uuid, p_doc_id uuid, p_data jsonb) RETURNS uuid
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
DECLARE v_me uuid; v_role text; r public.company_documents%ROWTYPE; it jsonb; v_type text; v_disc bigint; v_total bigint;
 v_date text; v_name text; v_phone text; v_notes text; v_cur character(3); v_n integer; v_status text;
BEGIN
 v_me := public.waves_company_actor(p_group_id);
 SELECT role::text INTO v_role FROM public.group_members WHERE id = v_me;
 IF v_role NOT IN ('admin','manager') THEN RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE = 'insufficient_privilege'; END IF;
 IF p_doc_id IS NULL OR jsonb_typeof(p_data) IS DISTINCT FROM 'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_data) k
  WHERE k NOT IN ('docType','customerName','customerPhone','docDate','items','discountMinor','notes')) THEN RAISE EXCEPTION 'INVALID_DATA'; END IF;
 v_type := p_data->>'docType'; v_name := btrim(coalesce(p_data->>'customerName','')); v_phone := nullif(btrim(coalesce(p_data->>'customerPhone','')),'');
 v_notes := nullif(btrim(coalesce(p_data->>'notes','')),''); v_date := p_data->>'docDate';
 IF v_type NOT IN ('estimate','bill') OR v_name = '' OR length(v_name) > 120 OR length(coalesce(v_phone,'')) > 32 OR length(coalesce(v_notes,'')) > 1000
  OR coalesce(v_date,'') !~ '^\d{4}-\d{2}-\d{2}$' OR coalesce(p_data->>'discountMinor','0') !~ '^\d{1,16}$' THEN RAISE EXCEPTION 'INVALID_DATA'; END IF;
 v_disc := coalesce(p_data->>'discountMinor','0')::bigint;
 it := public.waves_company_doc_items(p_data->'items');
 IF v_disc >= (it->>'subtotal')::bigint THEN RAISE EXCEPTION 'INVALID_DATA: discount'; END IF;
 v_total := (it->>'subtotal')::bigint - v_disc;
 PERFORM 1 FROM public.groups WHERE id = p_group_id FOR UPDATE;
 SELECT * INTO r FROM public.company_documents WHERE id = p_doc_id;
 IF FOUND THEN
  IF r.group_id <> p_group_id OR r.deleted_at IS NOT NULL OR NOT public.waves_company_paid_visible(r.group_id, r.created_by) THEN RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE = 'insufficient_privilege'; END IF;
  IF r.doc_type <> v_type THEN RAISE EXCEPTION 'DOC_TYPE_IMMUTABLE'; END IF;
  IF r.converted_to IS NOT NULL THEN RAISE EXCEPTION 'ALREADY_CONVERTED'; END IF;
  IF r.doc_type = 'bill' AND v_total < r.paid_minor THEN RAISE EXCEPTION 'TOTAL_BELOW_PAID'; END IF;
  v_status := CASE WHEN r.doc_type = 'estimate' THEN r.status WHEN r.paid_minor = 0 THEN 'unpaid' WHEN r.paid_minor < v_total THEN 'part_paid' ELSE 'paid' END;
  UPDATE public.company_documents SET customer_name = v_name, customer_phone = v_phone, doc_date = v_date::date, items = it->'items',
   discount_minor = v_disc, total_minor = v_total, notes = v_notes, status = v_status, version = version + 1, updated_by = v_me, updated_at = now() WHERE id = p_doc_id;
  RETURN p_doc_id;
 END IF;
 SELECT default_currency INTO v_cur FROM public.groups WHERE id = p_group_id;
 SELECT coalesce(max(number), 0) + 1 INTO v_n FROM public.company_documents WHERE group_id = p_group_id AND doc_type = v_type;
 INSERT INTO public.company_documents(id, group_id, doc_type, number, customer_name, customer_phone, doc_date, items, discount_minor, total_minor, currency, notes, status, created_by, updated_by)
 VALUES(p_doc_id, p_group_id, v_type, v_n, v_name, v_phone, v_date::date, it->'items', v_disc, v_total, v_cur, v_notes, CASE WHEN v_type = 'estimate' THEN 'draft' ELSE 'unpaid' END, v_me, v_me);
 RETURN p_doc_id;
END $$;

-- Estimate status: draft / sent / accepted / declined.
CREATE FUNCTION public.waves_company_doc_status(p_doc_id uuid, p_status text) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
DECLARE r public.company_documents%ROWTYPE; v_me uuid;
BEGIN
 SELECT * INTO r FROM public.company_documents WHERE id = p_doc_id FOR UPDATE;
 IF NOT FOUND OR r.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE = 'insufficient_privilege'; END IF;
 v_me := public.waves_company_actor(r.group_id);
 IF NOT public.waves_company_paid_visible(r.group_id, r.created_by) THEN RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE = 'insufficient_privilege'; END IF;
 IF r.doc_type <> 'estimate' OR p_status NOT IN ('draft','sent','accepted','declined') THEN RAISE EXCEPTION 'INVALID_DATA'; END IF;
 UPDATE public.company_documents SET status = p_status, version = version + 1, updated_by = v_me, updated_at = now() WHERE id = p_doc_id;
END $$;

-- Convert an estimate to a new bill (p_bill_id), once. Retrying the same call returns the same bill.
CREATE FUNCTION public.waves_company_doc_convert(p_doc_id uuid, p_bill_id uuid) RETURNS uuid
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
DECLARE r public.company_documents%ROWTYPE; v_me uuid; v_n integer;
BEGIN
 SELECT * INTO r FROM public.company_documents WHERE id = p_doc_id;
 IF NOT FOUND OR r.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE = 'insufficient_privilege'; END IF;
 v_me := public.waves_company_actor(r.group_id);
 IF NOT public.waves_company_paid_visible(r.group_id, r.created_by) OR p_bill_id IS NULL THEN RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE = 'insufficient_privilege'; END IF;
 PERFORM 1 FROM public.groups WHERE id = r.group_id FOR UPDATE;
 SELECT * INTO r FROM public.company_documents WHERE id = p_doc_id FOR UPDATE;
 IF r.doc_type <> 'estimate' THEN RAISE EXCEPTION 'INVALID_DATA'; END IF;
 IF r.converted_to = p_bill_id THEN RETURN p_bill_id; END IF;
 IF r.converted_to IS NOT NULL THEN RAISE EXCEPTION 'ALREADY_CONVERTED'; END IF;
 IF EXISTS(SELECT 1 FROM public.company_documents WHERE id = p_bill_id) THEN RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE = 'insufficient_privilege'; END IF;
 SELECT coalesce(max(number), 0) + 1 INTO v_n FROM public.company_documents WHERE group_id = r.group_id AND doc_type = 'bill';
 INSERT INTO public.company_documents(id, group_id, doc_type, number, customer_name, customer_phone, doc_date, items, discount_minor, total_minor, currency, notes, status, converted_from, created_by, updated_by)
 VALUES(p_bill_id, r.group_id, 'bill', v_n, r.customer_name, r.customer_phone, current_date, r.items, r.discount_minor, r.total_minor, r.currency, r.notes, 'unpaid', r.id, v_me, v_me);
 UPDATE public.company_documents SET converted_to = p_bill_id, status = CASE WHEN status IN ('draft','sent') THEN 'accepted' ELSE status END,
  version = version + 1, updated_by = v_me, updated_at = now() WHERE id = p_doc_id;
 RETURN p_bill_id;
END $$;

-- Record a payment received against a bill (Waves records only, it moves no money). Idempotent on the payment id.
CREATE FUNCTION public.waves_company_doc_payment(p_doc_id uuid, p_payment_id uuid, p_amount bigint, p_paid_on date) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
DECLARE r public.company_documents%ROWTYPE; v_me uuid; v_paid bigint;
BEGIN
 SELECT * INTO r FROM public.company_documents WHERE id = p_doc_id FOR UPDATE;
 IF NOT FOUND OR r.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE = 'insufficient_privilege'; END IF;
 v_me := public.waves_company_actor(r.group_id);
 IF NOT public.waves_company_paid_visible(r.group_id, r.created_by) THEN RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE = 'insufficient_privilege'; END IF;
 IF r.doc_type <> 'bill' OR p_payment_id IS NULL OR p_amount IS NULL OR p_amount <= 0 OR p_paid_on IS NULL THEN RAISE EXCEPTION 'INVALID_DATA'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(r.payments) p WHERE p->>'id' = p_payment_id::text) THEN RETURN; END IF;
 v_paid := r.paid_minor + p_amount;
 IF v_paid > r.total_minor THEN RAISE EXCEPTION 'OVERPAID'; END IF;
 UPDATE public.company_documents SET payments = payments || jsonb_build_array(jsonb_build_object('id', p_payment_id, 'amountMinor', p_amount, 'paidOn', p_paid_on)),
  paid_minor = v_paid, status = CASE WHEN v_paid < total_minor THEN 'part_paid' ELSE 'paid' END,
  version = version + 1, updated_by = v_me, updated_at = now() WHERE id = p_doc_id;
END $$;

-- Remove (soft). A bill with a payment recorded stays.
CREATE FUNCTION public.waves_company_doc_void(p_doc_id uuid) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
DECLARE r public.company_documents%ROWTYPE; v_me uuid;
BEGIN
 SELECT * INTO r FROM public.company_documents WHERE id = p_doc_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE = 'insufficient_privilege'; END IF;
 v_me := public.waves_company_actor(r.group_id);
 IF NOT public.waves_company_paid_visible(r.group_id, r.created_by) THEN RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE = 'insufficient_privilege'; END IF;
 IF r.deleted_at IS NOT NULL THEN RETURN; END IF;
 IF r.paid_minor > 0 THEN RAISE EXCEPTION 'HAS_PAYMENTS'; END IF;
 UPDATE public.company_documents SET deleted_at = now(), version = version + 1, updated_by = v_me, updated_at = now() WHERE id = p_doc_id;
END $$;

REVOKE ALL ON FUNCTION public.waves_company_doc_save(uuid,uuid,jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.waves_company_doc_status(uuid,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.waves_company_doc_convert(uuid,uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.waves_company_doc_payment(uuid,uuid,bigint,date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.waves_company_doc_void(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.waves_company_doc_save(uuid,uuid,jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.waves_company_doc_status(uuid,text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.waves_company_doc_convert(uuid,uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.waves_company_doc_payment(uuid,uuid,bigint,date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.waves_company_doc_void(uuid) TO authenticated, service_role;
