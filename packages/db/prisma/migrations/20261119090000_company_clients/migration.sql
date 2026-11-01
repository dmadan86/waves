-- Clients and inquiries: one record with a stage (inquiry -> quoted -> client, or lost).
-- A follow-up is a company work task linked by client_id; estimates and bills link by client_id too.
-- Owners and managers see every client of the company; an employee only the ones assigned to them; a vendor login none.

CREATE TABLE public.company_clients (
 id uuid PRIMARY KEY, group_id uuid NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
 name text NOT NULL CHECK(length(btrim(name)) BETWEEN 1 AND 120),
 phone text CHECK(phone IS NULL OR length(phone)<=32),
 need text CHECK(need IS NULL OR length(need)<=500),
 source text NOT NULL DEFAULT 'other' CHECK(source IN ('walk_in','call','whatsapp','referral','other')),
 expected_value bigint CHECK(expected_value IS NULL OR (expected_value>=0 AND expected_value<=9000000000000000)),
 address text CHECK(address IS NULL OR length(address)<=300),
 stage text NOT NULL DEFAULT 'inquiry' CHECK(stage IN ('inquiry','quoted','client','lost')),
 lost_reason text CHECK(lost_reason IS NULL OR length(lost_reason)<=200),
 owner_member_id uuid, created_by uuid NOT NULL,
 version integer NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 deleted_at timestamptz, updated_seq bigint NOT NULL DEFAULT 0,
 CONSTRAINT company_clients_lost_reason CHECK(lost_reason IS NULL OR stage='lost'),
 UNIQUE(id,group_id),
 FOREIGN KEY(owner_member_id,group_id) REFERENCES public.group_members(id,group_id),
 FOREIGN KEY(created_by,group_id) REFERENCES public.group_members(id,group_id)
);
CREATE INDEX company_clients_sync_idx ON public.company_clients(group_id,updated_seq);
CREATE INDEX company_clients_owner_idx ON public.company_clients(group_id,owner_member_id);

-- Notes are append-only text (photos on notes are not built yet).
CREATE TABLE public.company_client_notes (
 id uuid PRIMARY KEY, group_id uuid NOT NULL, client_id uuid NOT NULL,
 body text NOT NULL CHECK(length(btrim(body)) BETWEEN 1 AND 1000),
 created_by uuid NOT NULL, version integer NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 deleted_at timestamptz, updated_seq bigint NOT NULL DEFAULT 0,
 FOREIGN KEY(client_id,group_id) REFERENCES public.company_clients(id,group_id) ON DELETE CASCADE,
 FOREIGN KEY(created_by,group_id) REFERENCES public.group_members(id,group_id)
);
CREATE INDEX company_client_notes_sync_idx ON public.company_client_notes(group_id,updated_seq);
CREATE INDEX company_client_notes_client_idx ON public.company_client_notes(client_id,created_at);

CREATE TRIGGER company_clients_stamp BEFORE INSERT OR UPDATE ON public.company_clients FOR EACH ROW EXECUTE FUNCTION public.waves_stamp_seq();
CREATE TRIGGER company_client_notes_stamp BEFORE INSERT OR UPDATE ON public.company_client_notes FOR EACH ROW EXECUTE FUNCTION public.waves_stamp_seq();
CREATE TRIGGER aa_company_block_guard BEFORE INSERT OR UPDATE OR DELETE ON public.company_clients FOR EACH ROW EXECUTE FUNCTION public.waves_company_block_guard();
CREATE TRIGGER aa_company_block_guard BEFORE INSERT OR UPDATE OR DELETE ON public.company_client_notes FOR EACH ROW EXECUTE FUNCTION public.waves_company_block_guard();
ALTER TABLE public.company_clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_client_notes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.company_clients, public.company_client_notes FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.company_clients, public.company_client_notes TO authenticated;
GRANT ALL ON public.company_clients, public.company_client_notes TO service_role;

-- Owner (admin) and manager: every client. An employee: the clients assigned to them. A vendor login: none.
CREATE FUNCTION public.waves_company_client_visible(p_group_id uuid,p_client_id uuid) RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
 SELECT EXISTS(SELECT 1 FROM public.company_clients c JOIN public.group_members me ON me.group_id=c.group_id JOIN public.groups g ON g.id=c.group_id
 WHERE c.id=p_client_id AND c.group_id=p_group_id AND g.type='company' AND g.deleted_at IS NULL
 AND me.profile_id=public.waves_current_profile_id() AND me.left_at IS NULL AND me.removed_at IS NULL AND me.merged_into_member_id IS NULL
 AND (me.role::text IN ('admin','manager') OR (me.role::text='member' AND c.owner_member_id=me.id)));
$$;
REVOKE ALL ON FUNCTION public.waves_company_client_visible(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.waves_company_client_visible(uuid,uuid) TO authenticated,service_role;
CREATE POLICY company_clients_select ON public.company_clients FOR SELECT TO authenticated USING(public.waves_company_client_visible(group_id,id));
CREATE POLICY company_client_notes_select ON public.company_client_notes FOR SELECT TO authenticated USING(public.waves_company_client_visible(group_id,client_id));

-- Create or edit a client. Owner and manager: any client, any field. An employee: only a new inquiry assigned to themselves,
-- and later edits to their own client while it is still an inquiry (stage and owner stay as they are).
CREATE FUNCTION public.waves_company_client_set(p_group_id uuid,p_client_id uuid,p_data jsonb) RETURNS uuid
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
DECLARE me uuid; rl text; r public.company_clients%ROWTYPE; boss boolean;
 v_name text; v_phone text; v_need text; v_src text; v_val bigint; v_addr text; v_stage text; v_lost text; v_owner uuid;
BEGIN
 me:=public.waves_company_actor(p_group_id);
 SELECT role::text INTO rl FROM public.group_members WHERE id=me;
 IF rl NOT IN ('admin','manager','member') THEN RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE='insufficient_privilege'; END IF;
 boss:=rl IN ('admin','manager');
 IF p_client_id IS NULL OR jsonb_typeof(p_data) IS DISTINCT FROM 'object'
  OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_data) k WHERE k NOT IN ('name','phone','need','source','expectedValue','address','stage','lostReason','ownerMemberId')) THEN RAISE EXCEPTION 'INVALID_DATA' USING ERRCODE='check_violation'; END IF;
 v_name:=btrim(coalesce(p_data->>'name','')); v_phone:=nullif(btrim(coalesce(p_data->>'phone','')),''); v_need:=nullif(btrim(coalesce(p_data->>'need','')),'');
 v_src:=coalesce(nullif(p_data->>'source',''),'other'); v_addr:=nullif(btrim(coalesce(p_data->>'address','')),'');
 v_stage:=coalesce(nullif(p_data->>'stage',''),'inquiry'); v_lost:=nullif(btrim(coalesce(p_data->>'lostReason','')),'');
 IF coalesce(p_data->>'expectedValue','') !~ '^\d{0,16}$' THEN RAISE EXCEPTION 'INVALID_DATA: value' USING ERRCODE='check_violation'; END IF;
 v_val:=nullif(p_data->>'expectedValue','')::bigint;
 IF v_name='' OR length(v_name)>120 OR length(coalesce(v_phone,''))>32 OR length(coalesce(v_need,''))>500 OR length(coalesce(v_addr,''))>300 OR length(coalesce(v_lost,''))>200
  OR v_src NOT IN ('walk_in','call','whatsapp','referral','other') OR v_stage NOT IN ('inquiry','quoted','client','lost') THEN RAISE EXCEPTION 'INVALID_DATA' USING ERRCODE='check_violation'; END IF;
 IF v_stage<>'lost' THEN v_lost:=NULL; END IF;
 BEGIN v_owner:=nullif(p_data->>'ownerMemberId','')::uuid; EXCEPTION WHEN invalid_text_representation THEN RAISE EXCEPTION 'INVALID_DATA: owner' USING ERRCODE='check_violation'; END;
 PERFORM 1 FROM public.groups WHERE id=p_group_id FOR UPDATE;
 SELECT * INTO r FROM public.company_clients WHERE id=p_client_id;
 IF FOUND THEN
  IF r.group_id<>p_group_id OR r.deleted_at IS NOT NULL OR NOT public.waves_company_client_visible(p_group_id,r.id) THEN RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE='insufficient_privilege'; END IF;
  IF NOT boss AND (r.stage<>'inquiry' OR v_stage<>'inquiry' OR v_owner IS DISTINCT FROM r.owner_member_id) THEN RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE='insufficient_privilege'; END IF;
 ELSE
  IF NOT boss AND (v_stage<>'inquiry' OR v_owner IS DISTINCT FROM me) THEN RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE='insufficient_privilege'; END IF;
 END IF;
 IF v_owner IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.group_members WHERE id=v_owner AND group_id=p_group_id AND role::text IN ('admin','manager','member') AND left_at IS NULL AND removed_at IS NULL AND merged_into_member_id IS NULL) THEN RAISE EXCEPTION 'UNKNOWN_MEMBER' USING ERRCODE='insufficient_privilege'; END IF;
 IF r.id IS NOT NULL THEN
  -- A new follow-up person must also receive the history: re-stamp the notes so their next pull carries them.
  IF v_owner IS DISTINCT FROM r.owner_member_id THEN UPDATE public.company_client_notes SET updated_at=now() WHERE client_id=r.id; END IF;
  UPDATE public.company_clients SET name=v_name,phone=v_phone,need=v_need,source=v_src,expected_value=v_val,address=v_addr,stage=v_stage,lost_reason=v_lost,owner_member_id=v_owner,version=version+1,updated_at=now() WHERE id=r.id;
  RETURN r.id;
 END IF;
 INSERT INTO public.company_clients(id,group_id,name,phone,need,source,expected_value,address,stage,lost_reason,owner_member_id,created_by) VALUES(p_client_id,p_group_id,v_name,v_phone,v_need,v_src,v_val,v_addr,v_stage,v_lost,v_owner,me);
 RETURN p_client_id;
END $$;

CREATE FUNCTION public.waves_company_client_remove(p_client_id uuid) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
DECLARE r public.company_clients%ROWTYPE; me uuid; rl text;
BEGIN
 SELECT * INTO r FROM public.company_clients WHERE id=p_client_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE='insufficient_privilege'; END IF;
 me:=public.waves_company_actor(r.group_id);
 SELECT role::text INTO rl FROM public.group_members WHERE id=me;
 IF rl NOT IN ('admin','manager') THEN RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE='insufficient_privilege'; END IF;
 IF r.deleted_at IS NOT NULL THEN RETURN; END IF;
 UPDATE public.company_clients SET deleted_at=now(),version=version+1,updated_at=now() WHERE id=r.id;
END $$;

-- Add a note to a client the caller can see. Retrying the same note id changes nothing.
CREATE FUNCTION public.waves_company_client_note_add(p_group_id uuid,p_note_id uuid,p_client_id uuid,p_body text) RETURNS uuid
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
DECLARE me uuid; v_body text:=btrim(coalesce(p_body,''));
BEGIN
 me:=public.waves_company_actor(p_group_id);
 IF p_note_id IS NULL OR v_body='' OR length(v_body)>1000 THEN RAISE EXCEPTION 'INVALID_DATA' USING ERRCODE='check_violation'; END IF;
 IF NOT public.waves_company_client_visible(p_group_id,p_client_id) OR EXISTS(SELECT 1 FROM public.company_clients WHERE id=p_client_id AND deleted_at IS NOT NULL) THEN RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE='insufficient_privilege'; END IF;
 IF EXISTS(SELECT 1 FROM public.company_client_notes WHERE id=p_note_id) THEN
  IF EXISTS(SELECT 1 FROM public.company_client_notes WHERE id=p_note_id AND group_id=p_group_id AND created_by=me) THEN RETURN p_note_id; END IF;
  RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE='insufficient_privilege';
 END IF;
 INSERT INTO public.company_client_notes(id,group_id,client_id,body,created_by) VALUES(p_note_id,p_group_id,p_client_id,v_body,me);
 RETURN p_note_id;
END $$;

REVOKE ALL ON FUNCTION public.waves_company_client_set(uuid,uuid,jsonb),public.waves_company_client_remove(uuid),public.waves_company_client_note_add(uuid,uuid,uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.waves_company_client_set(uuid,uuid,jsonb),public.waves_company_client_remove(uuid),public.waves_company_client_note_add(uuid,uuid,uuid,text) TO authenticated,service_role;

-- Follow-ups: a task and a document may point at a client.
ALTER TABLE public.company_work_tasks ADD COLUMN client_id uuid, ADD CONSTRAINT company_work_tasks_client_id_group_id_fkey FOREIGN KEY(client_id,group_id) REFERENCES public.company_clients(id,group_id);
ALTER TABLE public.company_documents ADD COLUMN client_id uuid, ADD CONSTRAINT company_documents_client_id_group_id_fkey FOREIGN KEY(client_id,group_id) REFERENCES public.company_clients(id,group_id);
CREATE INDEX company_work_tasks_client_idx ON public.company_work_tasks(client_id) WHERE client_id IS NOT NULL;
CREATE INDEX company_documents_client_idx ON public.company_documents(client_id) WHERE client_id IS NOT NULL;

-- The 11-argument task writer. A task linked to a client (a follow-up) may be for the owner or a manager too, and an
-- employee may add one for themselves on a client they can see. p_client_id NULL unlinks.
CREATE FUNCTION public.waves_company_work_set(p_group_id uuid,p_task_id uuid,p_member_id uuid,p_day date,p_title text,p_project_id uuid,p_status text,p_blocked_reason text,p_note text,p_due_time time,p_client_id uuid) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
DECLARE v_me uuid; r public.company_work_tasks; v_boss boolean;
 v_title text:=btrim(coalesce(p_title,'')); v_reason text:=nullif(btrim(coalesce(p_blocked_reason,'')),''); v_note text:=nullif(btrim(coalesce(p_note,'')),'');
 v_roles text[]:=CASE WHEN p_client_id IS NULL THEN ARRAY['member'] ELSE ARRAY['member','manager','admin'] END;
BEGIN
 v_me:=public.waves_company_actor(p_group_id);
 IF p_status IS NULL OR p_status NOT IN ('todo','doing','done','blocked') THEN RAISE EXCEPTION 'INVALID_DATA: status'; END IF;
 IF p_status='blocked' AND v_reason IS NULL THEN RAISE EXCEPTION 'INVALID_DATA: blocked reason'; END IF;
 IF p_status<>'blocked' THEN v_reason:=NULL; END IF;
 IF length(coalesce(v_reason,''))>120 OR length(coalesce(v_note,''))>200 THEN RAISE EXCEPTION 'INVALID_DATA: text too long'; END IF;
 SELECT * INTO r FROM public.company_work_tasks WHERE id=p_task_id AND group_id=p_group_id AND deleted_at IS NULL FOR UPDATE;
 IF FOUND THEN
  v_boss:=public.is_group_admin(p_group_id) OR public.waves_company_team(p_group_id,r.member_id);
  IF NOT v_boss AND r.member_id IS DISTINCT FROM v_me THEN RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE='insufficient_privilege'; END IF;
  IF v_boss THEN
   IF v_title='' OR length(v_title)>200 THEN RAISE EXCEPTION 'INVALID_DATA: title'; END IF;
   IF p_project_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.company_projects WHERE id=p_project_id AND group_id=p_group_id AND deleted_at IS NULL) THEN RAISE EXCEPTION 'INVALID_DATA: site'; END IF;
   IF p_day IS NULL OR p_day>current_date+730 OR p_day<current_date-400 THEN RAISE EXCEPTION 'INVALID_DATA: day'; END IF;
   IF p_client_id IS NOT NULL AND (p_client_id IS DISTINCT FROM r.client_id) AND NOT EXISTS(SELECT 1 FROM public.company_clients WHERE id=p_client_id AND group_id=p_group_id AND deleted_at IS NULL AND public.waves_company_client_visible(p_group_id,id)) THEN RAISE EXCEPTION 'INVALID_DATA: client'; END IF;
   -- Handing a task to someone else: the editor must manage the new assignee too, who must be a live employee.
   IF p_member_id IS DISTINCT FROM r.member_id AND (NOT (public.is_group_admin(p_group_id) OR public.waves_company_team(p_group_id,p_member_id))
    OR NOT EXISTS(SELECT 1 FROM public.group_members WHERE id=p_member_id AND group_id=p_group_id AND role::text=ANY(v_roles) AND left_at IS NULL AND removed_at IS NULL AND merged_into_member_id IS NULL)) THEN RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE='insufficient_privilege'; END IF;
   UPDATE public.company_work_tasks SET member_id=p_member_id,title=v_title,project_id=p_project_id,due_time=p_due_time,day=p_day,status=p_status,blocked_reason=v_reason,note=v_note,client_id=p_client_id,updated_at=now() WHERE id=r.id;
  ELSE
   UPDATE public.company_work_tasks SET status=p_status,blocked_reason=v_reason,note=v_note,updated_at=now() WHERE id=r.id;
  END IF;
  RETURN;
 END IF;
 IF EXISTS(SELECT 1 FROM public.company_work_tasks WHERE id=p_task_id) THEN RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE='insufficient_privilege'; END IF;
 IF NOT public.is_group_admin(p_group_id) AND NOT public.waves_company_team(p_group_id,p_member_id) AND NOT (p_client_id IS NOT NULL AND p_member_id=v_me) THEN RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE='insufficient_privilege'; END IF;
 IF v_title='' OR length(v_title)>200 THEN RAISE EXCEPTION 'INVALID_DATA: title'; END IF;
 IF p_day IS NULL OR p_day>current_date+730 OR p_day<current_date-400 THEN RAISE EXCEPTION 'INVALID_DATA: day'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.group_members WHERE id=p_member_id AND group_id=p_group_id AND role::text=ANY(v_roles) AND left_at IS NULL AND removed_at IS NULL AND merged_into_member_id IS NULL) THEN RAISE EXCEPTION 'UNKNOWN_MEMBER' USING ERRCODE='insufficient_privilege'; END IF;
 IF p_project_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.company_projects WHERE id=p_project_id AND group_id=p_group_id AND deleted_at IS NULL) THEN RAISE EXCEPTION 'INVALID_DATA: site'; END IF;
 IF p_client_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.company_clients WHERE id=p_client_id AND group_id=p_group_id AND deleted_at IS NULL AND public.waves_company_client_visible(p_group_id,id)) THEN RAISE EXCEPTION 'INVALID_DATA: client'; END IF;
 INSERT INTO public.company_work_tasks(id,group_id,member_id,day,title,project_id,status,blocked_reason,note,due_time,created_by,client_id) VALUES(p_task_id,p_group_id,p_member_id,p_day,v_title,p_project_id,p_status,v_reason,v_note,p_due_time,v_me,p_client_id);
END $$;

-- The 10-argument form keeps the saved client link.
CREATE OR REPLACE FUNCTION public.waves_company_work_set(p_group_id uuid,p_task_id uuid,p_member_id uuid,p_day date,p_title text,p_project_id uuid,p_status text,p_blocked_reason text,p_note text,p_due_time time) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
BEGIN
 PERFORM public.waves_company_work_set(p_group_id,p_task_id,p_member_id,p_day,p_title,p_project_id,p_status,p_blocked_reason,p_note,p_due_time,
  (SELECT client_id FROM public.company_work_tasks WHERE id=p_task_id AND group_id=p_group_id AND deleted_at IS NULL));
END $$;

REVOKE ALL ON FUNCTION public.waves_company_work_set(uuid,uuid,uuid,date,text,uuid,text,text,text,time,uuid),public.waves_company_work_set(uuid,uuid,uuid,date,text,uuid,text,text,text,time) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.waves_company_work_set(uuid,uuid,uuid,date,text,uuid,text,text,text,time,uuid),public.waves_company_work_set(uuid,uuid,uuid,date,text,uuid,text,text,text,time) TO authenticated,service_role;

-- Estimates and bills may be linked to a client (clientId in the data; absent keeps the link, null clears it). Converting copies it.
CREATE OR REPLACE FUNCTION public.waves_company_doc_save(p_group_id uuid, p_doc_id uuid, p_data jsonb) RETURNS uuid
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
DECLARE v_me uuid; v_role text; r public.company_documents%ROWTYPE; it jsonb; v_type text; v_disc bigint; v_total bigint;
 v_client uuid; v_date text; v_name text; v_phone text; v_notes text; v_cur character(3); v_n integer; v_status text;
BEGIN
 v_me := public.waves_company_actor(p_group_id);
 SELECT role::text INTO v_role FROM public.group_members WHERE id = v_me;
 IF v_role NOT IN ('admin','manager') THEN RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE = 'insufficient_privilege'; END IF;
 IF p_doc_id IS NULL OR jsonb_typeof(p_data) IS DISTINCT FROM 'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_data) k
  WHERE k NOT IN ('docType','customerName','customerPhone','docDate','items','discountMinor','notes','clientId')) THEN RAISE EXCEPTION 'INVALID_DATA'; END IF;
 v_type := p_data->>'docType'; v_name := btrim(coalesce(p_data->>'customerName','')); v_phone := nullif(btrim(coalesce(p_data->>'customerPhone','')),'');
 v_notes := nullif(btrim(coalesce(p_data->>'notes','')),''); v_date := p_data->>'docDate';
 IF v_type NOT IN ('estimate','bill') OR v_name = '' OR length(v_name) > 120 OR length(coalesce(v_phone,'')) > 32 OR length(coalesce(v_notes,'')) > 1000
  OR coalesce(v_date,'') !~ '^\d{4}-\d{2}-\d{2}$' OR coalesce(p_data->>'discountMinor','0') !~ '^\d{1,16}$' THEN RAISE EXCEPTION 'INVALID_DATA'; END IF;
 v_disc := coalesce(p_data->>'discountMinor','0')::bigint;
 BEGIN v_client := nullif(p_data->>'clientId','')::uuid; EXCEPTION WHEN invalid_text_representation THEN RAISE EXCEPTION 'INVALID_DATA: client'; END;
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
  UPDATE public.company_documents SET customer_name = v_name, customer_phone = v_phone, doc_date = v_date::date, items = it->'items',
   discount_minor = v_disc, total_minor = v_total, notes = v_notes, status = v_status, client_id = CASE WHEN p_data ? 'clientId' THEN v_client ELSE client_id END, version = version + 1, updated_by = v_me, updated_at = now() WHERE id = p_doc_id;
  RETURN p_doc_id;
 END IF;
 SELECT default_currency INTO v_cur FROM public.groups WHERE id = p_group_id;
 SELECT coalesce(max(number), 0) + 1 INTO v_n FROM public.company_documents WHERE group_id = p_group_id AND doc_type = v_type;
 INSERT INTO public.company_documents(id, group_id, doc_type, number, customer_name, customer_phone, doc_date, items, discount_minor, total_minor, currency, notes, status, created_by, updated_by, client_id)
 VALUES(p_doc_id, p_group_id, v_type, v_n, v_name, v_phone, v_date::date, it->'items', v_disc, v_total, v_cur, v_notes, CASE WHEN v_type = 'estimate' THEN 'draft' ELSE 'unpaid' END, v_me, v_me, v_client);
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
 INSERT INTO public.company_documents(id, group_id, doc_type, number, customer_name, customer_phone, doc_date, items, discount_minor, total_minor, currency, notes, status, converted_from, created_by, updated_by, client_id)
 VALUES(p_bill_id, r.group_id, 'bill', v_n, r.customer_name, r.customer_phone, current_date, r.items, r.discount_minor, r.total_minor, r.currency, r.notes, 'unpaid', r.id, v_me, v_me, r.client_id);
 UPDATE public.company_documents SET converted_to = p_bill_id, status = CASE WHEN status IN ('draft','sent') THEN 'accepted' ELSE status END,
  version = version + 1, updated_by = v_me, updated_at = now() WHERE id = p_doc_id;
 RETURN p_bill_id;
END $$;

REVOKE ALL ON FUNCTION public.waves_company_doc_save(uuid,uuid,jsonb),public.waves_company_doc_convert(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.waves_company_doc_save(uuid,uuid,jsonb),public.waves_company_doc_convert(uuid,uuid) TO authenticated,service_role;
