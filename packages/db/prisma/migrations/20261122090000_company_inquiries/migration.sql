-- A client now has MANY inquiries (INQ-001, INQ-002, ...), each with its own derived status, and several assigned people.
-- Status is derived in the app from linked estimates and bills (see packages/core/src/company/inquiries.ts); only a rejection is stored.
-- Same visibility as the client: owner and manager see all; an employee only the clients they are assigned to (as owner or co-assignee).

CREATE TABLE public.company_inquiries (
 id uuid PRIMARY KEY, group_id uuid NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
 client_id uuid NOT NULL,
 number integer NOT NULL CHECK(number>0),
 title text NOT NULL CHECK(length(btrim(title)) BETWEEN 1 AND 120),
 details text CHECK(details IS NULL OR length(details)<=1000),
 expected_value_minor bigint CHECK(expected_value_minor IS NULL OR (expected_value_minor>=0 AND expected_value_minor<=9000000000000000)),
 inquiry_date date NOT NULL DEFAULT current_date,
 rejected_at timestamptz, reject_reason text CHECK(reject_reason IS NULL OR length(reject_reason)<=200),
 created_by uuid NOT NULL, updated_by uuid NOT NULL,
 version integer NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 deleted_at timestamptz, updated_seq bigint NOT NULL DEFAULT 0,
 CONSTRAINT company_inquiries_reject_reason CHECK(reject_reason IS NULL OR rejected_at IS NOT NULL),
 UNIQUE(id,group_id), UNIQUE(group_id,number),
 FOREIGN KEY(client_id,group_id) REFERENCES public.company_clients(id,group_id) ON DELETE CASCADE,
 FOREIGN KEY(created_by,group_id) REFERENCES public.group_members(id,group_id),
 FOREIGN KEY(updated_by,group_id) REFERENCES public.group_members(id,group_id)
);
CREATE INDEX company_inquiries_sync_idx ON public.company_inquiries(group_id,updated_seq);
CREATE INDEX company_inquiries_client_idx ON public.company_inquiries(client_id);

-- Many people per client. owner_member_id on the client stays the primary and is always in this set. A removal is a tombstone (deleted_at) so it syncs.
CREATE TABLE public.company_client_assignees (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), group_id uuid NOT NULL, client_id uuid NOT NULL, member_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 deleted_at timestamptz, updated_seq bigint NOT NULL DEFAULT 0,
 UNIQUE(client_id,member_id),
 FOREIGN KEY(client_id,group_id) REFERENCES public.company_clients(id,group_id) ON DELETE CASCADE,
 FOREIGN KEY(member_id,group_id) REFERENCES public.group_members(id,group_id)
);
CREATE INDEX company_client_assignees_sync_idx ON public.company_client_assignees(group_id,updated_seq);
CREATE INDEX company_client_assignees_member_idx ON public.company_client_assignees(member_id) WHERE deleted_at IS NULL;

ALTER TABLE public.company_documents ADD COLUMN inquiry_id uuid, ADD CONSTRAINT company_documents_inquiry_id_group_id_fkey FOREIGN KEY(inquiry_id,group_id) REFERENCES public.company_inquiries(id,group_id);
CREATE INDEX company_documents_inquiry_idx ON public.company_documents(inquiry_id) WHERE inquiry_id IS NOT NULL;

CREATE TRIGGER company_inquiries_stamp BEFORE INSERT OR UPDATE ON public.company_inquiries FOR EACH ROW EXECUTE FUNCTION public.waves_stamp_seq();
CREATE TRIGGER company_client_assignees_stamp BEFORE INSERT OR UPDATE ON public.company_client_assignees FOR EACH ROW EXECUTE FUNCTION public.waves_stamp_seq();
CREATE TRIGGER aa_company_block_guard BEFORE INSERT OR UPDATE OR DELETE ON public.company_inquiries FOR EACH ROW EXECUTE FUNCTION public.waves_company_block_guard();
CREATE TRIGGER aa_company_block_guard BEFORE INSERT OR UPDATE OR DELETE ON public.company_client_assignees FOR EACH ROW EXECUTE FUNCTION public.waves_company_block_guard();
ALTER TABLE public.company_inquiries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_client_assignees ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.company_inquiries, public.company_client_assignees FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.company_inquiries, public.company_client_assignees TO authenticated;
GRANT ALL ON public.company_inquiries, public.company_client_assignees TO service_role;

-- Drift check: this is the body from 20261119090000_company_clients (its only definition), with one change: an employee also sees
-- the clients they are a live co-assignee of, not only the ones they own.
CREATE OR REPLACE FUNCTION public.waves_company_client_visible(p_group_id uuid,p_client_id uuid) RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
 SELECT EXISTS(SELECT 1 FROM public.company_clients c JOIN public.group_members me ON me.group_id=c.group_id JOIN public.groups g ON g.id=c.group_id
 WHERE c.id=p_client_id AND c.group_id=p_group_id AND g.type='company' AND g.deleted_at IS NULL
 AND me.profile_id=public.waves_current_profile_id() AND me.left_at IS NULL AND me.removed_at IS NULL AND me.merged_into_member_id IS NULL
 AND (me.role::text IN ('admin','manager') OR (me.role::text='member' AND (c.owner_member_id=me.id
  OR EXISTS(SELECT 1 FROM public.company_client_assignees a WHERE a.client_id=c.id AND a.member_id=me.id AND a.deleted_at IS NULL)))));
$$;

CREATE POLICY company_inquiries_select ON public.company_inquiries FOR SELECT TO authenticated USING(public.waves_company_client_visible(group_id,client_id));
CREATE POLICY company_client_assignees_select ON public.company_client_assignees FOR SELECT TO authenticated USING(public.waves_company_client_visible(group_id,client_id));

-- The owner is always an assignee. Handing the client to a different owner (the edit form) hands it over: the previous owner is no longer an
-- assignee (the assign list below keeps whoever it names). A new owner also receives the history: re-stamp the rows so their next pull carries them.
CREATE FUNCTION public.waves_company_client_owner_assignee() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
BEGIN
 IF TG_OP='UPDATE' AND OLD.owner_member_id IS NOT NULL AND OLD.owner_member_id IS DISTINCT FROM NEW.owner_member_id THEN
  UPDATE public.company_client_assignees SET deleted_at=now(),updated_at=now() WHERE client_id=NEW.id AND member_id=OLD.owner_member_id AND deleted_at IS NULL;
 END IF;
 IF NEW.owner_member_id IS NOT NULL THEN
  IF TG_OP='UPDATE' THEN
   UPDATE public.company_inquiries SET updated_at=now() WHERE client_id=NEW.id;
   UPDATE public.company_client_assignees SET updated_at=now() WHERE client_id=NEW.id AND deleted_at IS NULL;
  END IF;
  INSERT INTO public.company_client_assignees(group_id,client_id,member_id) VALUES(NEW.group_id,NEW.id,NEW.owner_member_id)
  ON CONFLICT(client_id,member_id) DO UPDATE SET deleted_at=NULL,updated_at=now() WHERE public.company_client_assignees.deleted_at IS NOT NULL;
 END IF;
 RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.waves_company_client_owner_assignee() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER company_clients_owner_assignee AFTER INSERT OR UPDATE OF owner_member_id ON public.company_clients FOR EACH ROW EXECUTE FUNCTION public.waves_company_client_owner_assignee();

-- Create or edit an inquiry of a client the caller can see. Owner and manager: any; an employee: only on a client assigned to them that is not lost.
-- Retrying the same inquiry id edits the same row. The number (INQ-001) is the next one for the company.
CREATE FUNCTION public.waves_company_inquiry_set(p_group_id uuid,p_inquiry_id uuid,p_client_id uuid,p_data jsonb) RETURNS uuid
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
DECLARE me uuid; rl text; r public.company_inquiries%ROWTYPE; c public.company_clients%ROWTYPE;
 v_title text; v_details text; v_val bigint; v_date date; v_n integer;
BEGIN
 me:=public.waves_company_actor(p_group_id);
 SELECT role::text INTO rl FROM public.group_members WHERE id=me;
 IF rl NOT IN ('admin','manager','member') THEN RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE='insufficient_privilege'; END IF;
 IF p_inquiry_id IS NULL OR p_client_id IS NULL OR jsonb_typeof(p_data) IS DISTINCT FROM 'object'
  OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_data) k WHERE k NOT IN ('title','details','expectedValue','inquiryDate')) THEN RAISE EXCEPTION 'INVALID_DATA' USING ERRCODE='check_violation'; END IF;
 v_title:=btrim(coalesce(p_data->>'title','')); v_details:=nullif(btrim(coalesce(p_data->>'details','')),'');
 IF v_title='' OR length(v_title)>120 OR length(coalesce(v_details,''))>1000 OR coalesce(p_data->>'expectedValue','') !~ '^\d{0,16}$'
  OR coalesce(p_data->>'inquiryDate','') !~ '^\d{4}-\d{2}-\d{2}$' THEN RAISE EXCEPTION 'INVALID_DATA' USING ERRCODE='check_violation'; END IF;
 v_val:=nullif(p_data->>'expectedValue','')::bigint;
 BEGIN v_date:=(p_data->>'inquiryDate')::date; EXCEPTION WHEN others THEN RAISE EXCEPTION 'INVALID_DATA: date' USING ERRCODE='check_violation'; END;
 IF v_date>current_date+30 OR v_date<current_date-3650 THEN RAISE EXCEPTION 'INVALID_DATA: date' USING ERRCODE='check_violation'; END IF;
 PERFORM 1 FROM public.groups WHERE id=p_group_id FOR UPDATE;
 SELECT * INTO c FROM public.company_clients WHERE id=p_client_id AND group_id=p_group_id AND deleted_at IS NULL;
 IF NOT FOUND OR NOT public.waves_company_client_visible(p_group_id,c.id) OR (rl='member' AND c.stage='lost') THEN RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE='insufficient_privilege'; END IF;
 SELECT * INTO r FROM public.company_inquiries WHERE id=p_inquiry_id;
 IF FOUND THEN
  IF r.group_id<>p_group_id OR r.client_id<>c.id OR r.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE='insufficient_privilege'; END IF;
  UPDATE public.company_inquiries SET title=v_title,details=v_details,expected_value_minor=v_val,inquiry_date=v_date,version=version+1,updated_by=me,updated_at=now() WHERE id=r.id;
  RETURN r.id;
 END IF;
 SELECT coalesce(max(number),0)+1 INTO v_n FROM public.company_inquiries WHERE group_id=p_group_id;
 INSERT INTO public.company_inquiries(id,group_id,client_id,number,title,details,expected_value_minor,inquiry_date,created_by,updated_by) VALUES(p_inquiry_id,p_group_id,c.id,v_n,v_title,v_details,v_val,v_date,me,me);
 RETURN p_inquiry_id;
END $$;

-- Mark an inquiry rejected (with a reason) or reopen it. Retrying changes nothing.
CREATE FUNCTION public.waves_company_inquiry_reject(p_inquiry_id uuid,p_rejected boolean,p_reason text) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
DECLARE r public.company_inquiries%ROWTYPE; me uuid; rl text; v_reason text:=nullif(btrim(coalesce(p_reason,'')),''); st text;
BEGIN
 SELECT * INTO r FROM public.company_inquiries WHERE id=p_inquiry_id FOR UPDATE;
 IF NOT FOUND OR r.deleted_at IS NOT NULL OR p_rejected IS NULL THEN RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE='insufficient_privilege'; END IF;
 IF length(coalesce(v_reason,''))>200 THEN RAISE EXCEPTION 'INVALID_DATA' USING ERRCODE='check_violation'; END IF;
 me:=public.waves_company_actor(r.group_id);
 SELECT role::text INTO rl FROM public.group_members WHERE id=me;
 SELECT stage INTO st FROM public.company_clients WHERE id=r.client_id;
 IF rl NOT IN ('admin','manager','member') OR NOT public.waves_company_client_visible(r.group_id,r.client_id) OR (rl='member' AND st='lost') THEN RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE='insufficient_privilege'; END IF;
 IF p_rejected THEN
  IF r.rejected_at IS NULL THEN UPDATE public.company_inquiries SET rejected_at=now(),reject_reason=v_reason,version=version+1,updated_by=me,updated_at=now() WHERE id=r.id; END IF;
 ELSIF r.rejected_at IS NOT NULL THEN
  UPDATE public.company_inquiries SET rejected_at=NULL,reject_reason=NULL,version=version+1,updated_by=me,updated_at=now() WHERE id=r.id;
 END IF;
END $$;

CREATE FUNCTION public.waves_company_inquiry_remove(p_inquiry_id uuid) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
DECLARE r public.company_inquiries%ROWTYPE; me uuid; rl text;
BEGIN
 SELECT * INTO r FROM public.company_inquiries WHERE id=p_inquiry_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE='insufficient_privilege'; END IF;
 me:=public.waves_company_actor(r.group_id);
 SELECT role::text INTO rl FROM public.group_members WHERE id=me;
 IF rl NOT IN ('admin','manager') THEN RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE='insufficient_privilege'; END IF;
 IF r.deleted_at IS NOT NULL THEN RETURN; END IF;
 UPDATE public.company_inquiries SET deleted_at=now(),version=version+1,updated_by=me,updated_at=now() WHERE id=r.id;
END $$;

-- Replace the people assigned to a client (owner and manager only). The primary owner stays if still in the list, else the first one
-- becomes it; an empty list leaves the client unassigned. Everyone newly assigned gets the full history on their next pull.
CREATE FUNCTION public.waves_company_client_assign(p_group_id uuid,p_client_id uuid,p_member_ids uuid[]) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
DECLARE me uuid; rl text; r public.company_clients%ROWTYPE; ids uuid[]; v_owner uuid;
BEGIN
 me:=public.waves_company_actor(p_group_id);
 SELECT role::text INTO rl FROM public.group_members WHERE id=me;
 IF rl NOT IN ('admin','manager') THEN RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE='insufficient_privilege'; END IF;
 IF p_client_id IS NULL OR p_member_ids IS NULL OR cardinality(p_member_ids)>30 OR array_position(p_member_ids,NULL) IS NOT NULL THEN RAISE EXCEPTION 'INVALID_DATA' USING ERRCODE='check_violation'; END IF;
 ids:=ARRAY(SELECT DISTINCT x FROM unnest(p_member_ids) x);
 PERFORM 1 FROM public.groups WHERE id=p_group_id FOR UPDATE;
 SELECT * INTO r FROM public.company_clients WHERE id=p_client_id AND group_id=p_group_id AND deleted_at IS NULL FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE='insufficient_privilege'; END IF;
 IF (SELECT count(*) FROM public.group_members WHERE id=ANY(ids) AND group_id=p_group_id AND role::text IN ('admin','manager','member') AND left_at IS NULL AND removed_at IS NULL AND merged_into_member_id IS NULL)<>cardinality(ids)
  THEN RAISE EXCEPTION 'UNKNOWN_MEMBER' USING ERRCODE='insufficient_privilege'; END IF;
 v_owner:=CASE WHEN r.owner_member_id=ANY(ids) THEN r.owner_member_id ELSE p_member_ids[1] END;
 UPDATE public.company_client_assignees SET deleted_at=now(),updated_at=now() WHERE client_id=r.id AND deleted_at IS NULL AND NOT (member_id=ANY(ids));
 INSERT INTO public.company_client_assignees(group_id,client_id,member_id) SELECT p_group_id,r.id,x FROM unnest(ids) x
  ON CONFLICT(client_id,member_id) DO UPDATE SET deleted_at=NULL,updated_at=now() WHERE public.company_client_assignees.deleted_at IS NOT NULL;
 UPDATE public.company_client_notes SET updated_at=now() WHERE client_id=r.id;
 UPDATE public.company_inquiries SET updated_at=now() WHERE client_id=r.id;
 UPDATE public.company_client_assignees SET updated_at=now() WHERE client_id=r.id;
 UPDATE public.company_clients SET owner_member_id=v_owner,version=version+1,updated_at=now() WHERE id=r.id;
END $$;

-- Estimates and bills: an optional inquiry of the same client (inquiryId in the data; absent keeps the link, null clears it). Converting copies it.
-- Drift check: waves_company_doc_save / waves_company_doc_convert are copied from 20261119090000_company_clients (their latest definition) plus the inquiry link.
CREATE OR REPLACE FUNCTION public.waves_company_doc_save(p_group_id uuid, p_doc_id uuid, p_data jsonb) RETURNS uuid
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
DECLARE v_me uuid; v_role text; r public.company_documents%ROWTYPE; it jsonb; v_type text; v_disc bigint; v_total bigint;
 v_client uuid; v_date text; v_name text; v_phone text; v_notes text; v_cur character(3); v_n integer; v_status text;
 v_inq uuid; v_eff_client uuid; v_eff_inq uuid;
BEGIN
 v_me := public.waves_company_actor(p_group_id);
 SELECT role::text INTO v_role FROM public.group_members WHERE id = v_me;
 IF v_role NOT IN ('admin','manager') THEN RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE = 'insufficient_privilege'; END IF;
 IF p_doc_id IS NULL OR jsonb_typeof(p_data) IS DISTINCT FROM 'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_data) k
  WHERE k NOT IN ('docType','customerName','customerPhone','docDate','items','discountMinor','notes','clientId','inquiryId')) THEN RAISE EXCEPTION 'INVALID_DATA'; END IF;
 v_type := p_data->>'docType'; v_name := btrim(coalesce(p_data->>'customerName','')); v_phone := nullif(btrim(coalesce(p_data->>'customerPhone','')),'');
 v_notes := nullif(btrim(coalesce(p_data->>'notes','')),''); v_date := p_data->>'docDate';
 IF v_type NOT IN ('estimate','bill') OR v_name = '' OR length(v_name) > 120 OR length(coalesce(v_phone,'')) > 32 OR length(coalesce(v_notes,'')) > 1000
  OR coalesce(v_date,'') !~ '^\d{4}-\d{2}-\d{2}$' OR coalesce(p_data->>'discountMinor','0') !~ '^\d{1,16}$' THEN RAISE EXCEPTION 'INVALID_DATA'; END IF;
 v_disc := coalesce(p_data->>'discountMinor','0')::bigint;
 BEGIN v_client := nullif(p_data->>'clientId','')::uuid; EXCEPTION WHEN invalid_text_representation THEN RAISE EXCEPTION 'INVALID_DATA: client'; END;
 BEGIN v_inq := nullif(p_data->>'inquiryId','')::uuid; EXCEPTION WHEN invalid_text_representation THEN RAISE EXCEPTION 'INVALID_DATA: inquiry'; END;
 IF v_client IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.company_clients WHERE id = v_client AND group_id = p_group_id AND deleted_at IS NULL AND public.waves_company_client_visible(p_group_id, id)) THEN RAISE EXCEPTION 'INVALID_DATA: client'; END IF;
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
  v_eff_client := CASE WHEN p_data ? 'clientId' THEN v_client ELSE r.client_id END;
  v_eff_inq := CASE WHEN p_data ? 'inquiryId' THEN v_inq ELSE r.inquiry_id END;
  -- An inquiry must belong to the document's client: an explicit mismatch is refused, a stale link (client changed) is cleared.
  IF v_eff_inq IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.company_inquiries WHERE id = v_eff_inq AND group_id = p_group_id AND deleted_at IS NULL AND client_id IS NOT DISTINCT FROM v_eff_client) THEN
   IF p_data ? 'inquiryId' THEN RAISE EXCEPTION 'INVALID_DATA: inquiry'; END IF;
   v_eff_inq := NULL;
  END IF;
  UPDATE public.company_documents SET customer_name = v_name, customer_phone = v_phone, doc_date = v_date::date, items = it->'items',
   discount_minor = v_disc, total_minor = v_total, notes = v_notes, status = v_status, client_id = v_eff_client, inquiry_id = v_eff_inq, version = version + 1, updated_by = v_me, updated_at = now() WHERE id = p_doc_id;
  RETURN p_doc_id;
 END IF;
 IF v_inq IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.company_inquiries WHERE id = v_inq AND group_id = p_group_id AND deleted_at IS NULL AND client_id IS NOT DISTINCT FROM v_client) THEN RAISE EXCEPTION 'INVALID_DATA: inquiry'; END IF;
 SELECT default_currency INTO v_cur FROM public.groups WHERE id = p_group_id;
 SELECT coalesce(max(number), 0) + 1 INTO v_n FROM public.company_documents WHERE group_id = p_group_id AND doc_type = v_type;
 INSERT INTO public.company_documents(id, group_id, doc_type, number, customer_name, customer_phone, doc_date, items, discount_minor, total_minor, currency, notes, status, created_by, updated_by, client_id, inquiry_id)
 VALUES(p_doc_id, p_group_id, v_type, v_n, v_name, v_phone, v_date::date, it->'items', v_disc, v_total, v_cur, v_notes, CASE WHEN v_type = 'estimate' THEN 'draft' ELSE 'unpaid' END, v_me, v_me, v_client, v_inq);
 RETURN p_doc_id;
END $$;

CREATE OR REPLACE FUNCTION public.waves_company_doc_convert(p_doc_id uuid, p_bill_id uuid) RETURNS uuid
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
 INSERT INTO public.company_documents(id, group_id, doc_type, number, customer_name, customer_phone, doc_date, items, discount_minor, total_minor, currency, notes, status, converted_from, created_by, updated_by, client_id, inquiry_id)
 VALUES(p_bill_id, r.group_id, 'bill', v_n, r.customer_name, r.customer_phone, current_date, r.items, r.discount_minor, r.total_minor, r.currency, r.notes, 'unpaid', r.id, v_me, v_me, r.client_id, r.inquiry_id);
 UPDATE public.company_documents SET converted_to = p_bill_id, status = CASE WHEN status IN ('draft','sent') THEN 'accepted' ELSE status END,
  version = version + 1, updated_by = v_me, updated_at = now() WHERE id = p_doc_id;
 RETURN p_bill_id;
END $$;

REVOKE ALL ON FUNCTION public.waves_company_client_visible(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.waves_company_client_visible(uuid,uuid) TO authenticated,service_role;
REVOKE ALL ON FUNCTION public.waves_company_inquiry_set(uuid,uuid,uuid,jsonb),public.waves_company_inquiry_reject(uuid,boolean,text),public.waves_company_inquiry_remove(uuid),public.waves_company_client_assign(uuid,uuid,uuid[]) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.waves_company_inquiry_set(uuid,uuid,uuid,jsonb),public.waves_company_inquiry_reject(uuid,boolean,text),public.waves_company_inquiry_remove(uuid),public.waves_company_client_assign(uuid,uuid,uuid[]) TO authenticated,service_role;
REVOKE ALL ON FUNCTION public.waves_company_doc_save(uuid,uuid,jsonb),public.waves_company_doc_convert(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.waves_company_doc_save(uuid,uuid,jsonb),public.waves_company_doc_convert(uuid,uuid) TO authenticated,service_role;

-- Backfill, so nothing disappears. Every live client gets one inquiry carrying its need and expected value (numbered per company by
-- creation order); a lost client's inquiry is rejected with the reason; its existing estimates and bills are linked to it; its owner becomes an assignee.
-- A client that was marked "won" by hand but has no estimate or bill shows as an open inquiry (status is derived, not stored).
INSERT INTO public.company_inquiries(id,group_id,client_id,number,title,details,expected_value_minor,inquiry_date,rejected_at,reject_reason,created_by,updated_by,created_at,updated_at)
SELECT gen_random_uuid(),c.group_id,c.id,row_number() OVER (PARTITION BY c.group_id ORDER BY c.created_at,c.id),
 left(coalesce(nullif(btrim(c.need),''),c.name),120), CASE WHEN length(btrim(coalesce(c.need,'')))>120 THEN btrim(c.need) END,
 c.expected_value,(c.created_at AT TIME ZONE 'UTC')::date,
 CASE WHEN c.stage='lost' THEN c.updated_at END, CASE WHEN c.stage='lost' THEN c.lost_reason END,
 c.created_by,c.created_by,c.created_at,now()
FROM public.company_clients c WHERE c.deleted_at IS NULL;
UPDATE public.company_documents d SET inquiry_id=i.id FROM public.company_inquiries i WHERE d.client_id=i.client_id AND d.group_id=i.group_id AND d.inquiry_id IS NULL;
INSERT INTO public.company_client_assignees(group_id,client_id,member_id)
SELECT group_id,id,owner_member_id FROM public.company_clients WHERE owner_member_id IS NOT NULL AND deleted_at IS NULL
ON CONFLICT(client_id,member_id) DO NOTHING;
