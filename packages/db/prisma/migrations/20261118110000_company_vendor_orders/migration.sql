-- Material orders to a vendor: what the company asked for. Orders never touch the vendor balance (only the vendor's bill does).
CREATE TABLE public.company_vendor_orders (
 id uuid PRIMARY KEY, group_id uuid NOT NULL, vendor_id uuid NOT NULL,
 order_no integer NOT NULL,
 status text NOT NULL DEFAULT 'sent' CHECK(status IN ('sent','accepted','rejected','delivered','cancelled')),
 expected_on date, note text CHECK(note IS NULL OR length(note)<=500),
 created_by uuid NOT NULL, request_hash text, version integer NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 deleted_at timestamptz, updated_seq bigint NOT NULL DEFAULT 0,
 UNIQUE(id,group_id), UNIQUE(group_id,order_no),
 FOREIGN KEY(vendor_id,group_id) REFERENCES public.company_vendors(id,group_id) ON DELETE CASCADE,
 FOREIGN KEY(created_by,group_id) REFERENCES public.group_members(id,group_id)
);
CREATE TABLE public.company_vendor_order_items (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), group_id uuid NOT NULL, order_id uuid NOT NULL,
 name text NOT NULL CHECK(length(btrim(name)) BETWEEN 1 AND 120),
 qty numeric(12,3) NOT NULL CHECK(qty>0),
 unit text NOT NULL CHECK(unit IN ('bags','pieces','kg','litres','metres','other')),
 unit_price bigint NOT NULL CHECK(unit_price>=0 AND unit_price<=100000000000000),
 position integer NOT NULL CHECK(position>=0),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 deleted_at timestamptz, updated_seq bigint NOT NULL DEFAULT 0,
 FOREIGN KEY(order_id,group_id) REFERENCES public.company_vendor_orders(id,group_id) ON DELETE CASCADE
);
-- Status history: one row per change, written only by the RPCs.
CREATE TABLE public.company_vendor_order_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), group_id uuid NOT NULL, order_id uuid NOT NULL,
 status text NOT NULL CHECK(status IN ('sent','accepted','rejected','delivered','cancelled')),
 actor_id uuid NOT NULL, at timestamptz NOT NULL DEFAULT now(),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 deleted_at timestamptz, updated_seq bigint NOT NULL DEFAULT 0,
 FOREIGN KEY(order_id,group_id) REFERENCES public.company_vendor_orders(id,group_id) ON DELETE CASCADE
);
CREATE INDEX company_vendor_orders_sync_idx ON public.company_vendor_orders(group_id,updated_seq);
CREATE INDEX company_vendor_orders_vendor_idx ON public.company_vendor_orders(vendor_id);
CREATE INDEX company_vendor_order_items_sync_idx ON public.company_vendor_order_items(group_id,updated_seq);
CREATE INDEX company_vendor_order_items_order_idx ON public.company_vendor_order_items(order_id);
CREATE INDEX company_vendor_order_events_sync_idx ON public.company_vendor_order_events(group_id,updated_seq);
CREATE INDEX company_vendor_order_events_order_idx ON public.company_vendor_order_events(order_id);

CREATE TRIGGER company_vendor_orders_stamp BEFORE INSERT OR UPDATE ON public.company_vendor_orders FOR EACH ROW EXECUTE FUNCTION public.waves_stamp_seq();
CREATE TRIGGER company_vendor_order_items_stamp BEFORE INSERT OR UPDATE ON public.company_vendor_order_items FOR EACH ROW EXECUTE FUNCTION public.waves_stamp_seq();
CREATE TRIGGER company_vendor_order_events_stamp BEFORE INSERT OR UPDATE ON public.company_vendor_order_events FOR EACH ROW EXECUTE FUNCTION public.waves_stamp_seq();
-- A suspended company is read-only.
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['company_vendor_orders','company_vendor_order_items','company_vendor_order_events'] LOOP
  EXECUTE format('CREATE TRIGGER aa_company_block_guard BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.waves_company_block_guard()',t);
 END LOOP;
END $$;

-- Order numbers (#PO-7): per company, assigned by the server on insert; removed orders keep theirs.
CREATE FUNCTION public.waves_company_vendor_order_no() RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public','pg_temp' AS $$
BEGIN
 IF TG_OP='UPDATE' THEN NEW.order_no:=OLD.order_no; RETURN NEW; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.group_id::text,12));
 SELECT coalesce(max(order_no),0)+1 INTO NEW.order_no FROM public.company_vendor_orders WHERE group_id=NEW.group_id;
 RETURN NEW;
END $$;
CREATE TRIGGER company_vendor_orders_a_no BEFORE INSERT OR UPDATE ON public.company_vendor_orders FOR EACH ROW EXECUTE FUNCTION public.waves_company_vendor_order_no();
REVOKE ALL ON FUNCTION public.waves_company_vendor_order_no() FROM PUBLIC, anon, authenticated;

ALTER TABLE public.company_vendor_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_vendor_order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_vendor_order_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.company_vendor_orders, public.company_vendor_order_items, public.company_vendor_order_events FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.company_vendor_orders, public.company_vendor_order_items, public.company_vendor_order_events TO authenticated;
GRANT ALL ON public.company_vendor_orders, public.company_vendor_order_items, public.company_vendor_order_events TO service_role;
-- Same walls as the vendor: owner all, a manager the vendors they added, a vendor only its own orders.
CREATE POLICY company_vendor_orders_select ON public.company_vendor_orders FOR SELECT TO authenticated USING(public.waves_company_vendor_visible(group_id,vendor_id));
CREATE POLICY company_vendor_order_items_select ON public.company_vendor_order_items FOR SELECT TO authenticated
 USING(EXISTS(SELECT 1 FROM public.company_vendor_orders o WHERE o.id=order_id AND public.waves_company_vendor_visible(o.group_id,o.vendor_id)));
CREATE POLICY company_vendor_order_events_select ON public.company_vendor_order_events FOR SELECT TO authenticated
 USING(EXISTS(SELECT 1 FROM public.company_vendor_orders o WHERE o.id=order_id AND public.waves_company_vendor_visible(o.group_id,o.vendor_id)));

-- Create or edit an order (owner, or the manager of that vendor). Editing is allowed only while it is still 'sent'.
-- p_data: {expectedOn, note, items:[{name, qty "1.5", unit, unitPrice "minor digits"}]}
CREATE FUNCTION public.waves_company_vendor_order_set(p_group_id uuid,p_order_id uuid,p_vendor_id uuid,p_data jsonb) RETURNS uuid
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
DECLARE me uuid; rl text; r public.company_vendor_orders%ROWTYPE; h text; it jsonb; i integer:=0; v_exp date; v_note text; n integer;
BEGIN
 SELECT * INTO me,rl FROM public.waves_company_vendor_role(p_group_id);
 IF rl NOT IN ('admin','manager') THEN RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE='insufficient_privilege'; END IF;
 IF p_order_id IS NULL OR p_vendor_id IS NULL OR jsonb_typeof(p_data) IS DISTINCT FROM 'object'
  OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_data) k WHERE k NOT IN ('expectedOn','note','items'))
  OR jsonb_typeof(p_data->'items') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'INVALID_DATA' USING ERRCODE='check_violation'; END IF;
 n:=jsonb_array_length(p_data->'items');
 IF n NOT BETWEEN 1 AND 50 OR length(coalesce(p_data->>'note',''))>500
  OR (nullif(p_data->>'expectedOn','') IS NOT NULL AND p_data->>'expectedOn' !~ '^\d{4}-\d{2}-\d{2}$') THEN RAISE EXCEPTION 'INVALID_DATA' USING ERRCODE='check_violation'; END IF;
 FOR it IN SELECT * FROM jsonb_array_elements(p_data->'items') LOOP
  IF jsonb_typeof(it) IS DISTINCT FROM 'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(it) k WHERE k NOT IN ('name','qty','unit','unitPrice'))
   OR length(btrim(coalesce(it->>'name','')))NOT BETWEEN 1 AND 120
   OR coalesce(it->>'qty','') !~ '^[0-9]{1,9}(\.[0-9]{1,3})?$' OR (it->>'qty')::numeric<=0
   OR coalesce(it->>'unit','') NOT IN ('bags','pieces','kg','litres','metres','other')
   OR coalesce(it->>'unitPrice','') !~ '^[0-9]{1,15}$' THEN RAISE EXCEPTION 'INVALID_DATA' USING ERRCODE='check_violation'; END IF;
 END LOOP;
 v_exp:=nullif(p_data->>'expectedOn','')::date; v_note:=nullif(btrim(coalesce(p_data->>'note','')),'');
 h:=encode(sha256(convert_to(jsonb_build_array(p_group_id,p_vendor_id,p_data)::text,'UTF8')),'hex');
 PERFORM pg_advisory_xact_lock(hashtextextended(p_order_id::text,13));
 SELECT * INTO r FROM public.company_vendor_orders WHERE id=p_order_id FOR UPDATE;
 IF FOUND THEN
  IF r.group_id<>p_group_id OR r.vendor_id<>p_vendor_id OR r.deleted_at IS NOT NULL OR NOT public.waves_company_vendor_visible(r.group_id,r.vendor_id) THEN RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE='insufficient_privilege'; END IF;
  IF r.request_hash IS NOT DISTINCT FROM h THEN RETURN r.id; END IF;
  IF r.status<>'sent' THEN RAISE EXCEPTION 'ORDER_LOCKED' USING ERRCODE='check_violation'; END IF;
  UPDATE public.company_vendor_orders SET expected_on=v_exp,note=v_note,request_hash=h,version=version+1,updated_at=now() WHERE id=r.id;
  UPDATE public.company_vendor_order_items SET deleted_at=now(),updated_at=now() WHERE order_id=r.id AND deleted_at IS NULL;
 ELSE
  IF NOT EXISTS(SELECT 1 FROM public.company_vendors WHERE id=p_vendor_id AND group_id=p_group_id AND deleted_at IS NULL)
   OR NOT public.waves_company_vendor_visible(p_group_id,p_vendor_id) THEN RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE='insufficient_privilege'; END IF;
  INSERT INTO public.company_vendor_orders(id,group_id,vendor_id,expected_on,note,created_by,request_hash) VALUES(p_order_id,p_group_id,p_vendor_id,v_exp,v_note,me,h);
  INSERT INTO public.company_vendor_order_events(group_id,order_id,status,actor_id) VALUES(p_group_id,p_order_id,'sent',me);
 END IF;
 FOR it IN SELECT * FROM jsonb_array_elements(p_data->'items') LOOP
  INSERT INTO public.company_vendor_order_items(group_id,order_id,name,qty,unit,unit_price,position)
  VALUES(p_group_id,p_order_id,btrim(it->>'name'),(it->>'qty')::numeric,it->>'unit',(it->>'unitPrice')::bigint,i);
  i:=i+1;
 END LOOP;
 RETURN p_order_id;
END $$;

-- Status change. Vendor: sent -> accepted | rejected, accepted -> delivered. Company: sent | accepted -> cancelled.
CREATE FUNCTION public.waves_company_vendor_order_status(p_order_id uuid,p_to text) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
DECLARE r public.company_vendor_orders%ROWTYPE; me uuid; rl text; ok boolean;
BEGIN
 SELECT * INTO r FROM public.company_vendor_orders WHERE id=p_order_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE='insufficient_privilege'; END IF;
 SELECT * INTO me,rl FROM public.waves_company_vendor_role(r.group_id);
 IF r.deleted_at IS NOT NULL OR NOT public.waves_company_vendor_visible(r.group_id,r.vendor_id) OR rl NOT IN ('admin','manager','vendor') THEN RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE='insufficient_privilege'; END IF;
 IF p_to IS NULL OR p_to NOT IN ('accepted','rejected','delivered','cancelled') THEN RAISE EXCEPTION 'INVALID_DATA' USING ERRCODE='check_violation'; END IF;
 IF r.status=p_to THEN RETURN; END IF;
 ok:=CASE WHEN rl='vendor' THEN (r.status='sent' AND p_to IN ('accepted','rejected')) OR (r.status='accepted' AND p_to='delivered')
      ELSE r.status IN ('sent','accepted') AND p_to='cancelled' END;
 IF NOT ok THEN RAISE EXCEPTION 'INVALID_TRANSITION' USING ERRCODE='check_violation'; END IF;
 UPDATE public.company_vendor_orders SET status=p_to,version=version+1,updated_at=now() WHERE id=r.id;
 INSERT INTO public.company_vendor_order_events(group_id,order_id,status,actor_id) VALUES(r.group_id,r.id,p_to,me);
END $$;

REVOKE ALL ON FUNCTION public.waves_company_vendor_order_set(uuid,uuid,uuid,jsonb),public.waves_company_vendor_order_status(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.waves_company_vendor_order_set(uuid,uuid,uuid,jsonb),public.waves_company_vendor_order_status(uuid,text) TO authenticated,service_role;
