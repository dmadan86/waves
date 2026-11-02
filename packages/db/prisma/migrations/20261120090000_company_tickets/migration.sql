-- Complaints / tickets for a company's customers. Staff log them against a client (the customer phoned or messaged);
-- each ticket has an assignee and a due time. Escalation is DERIVED on the phone and in queries from due_at and the
-- priority window (level 1 once past due: the assignee's manager; level 2 after the same window again: the owner), so
-- there is no cron and no stored level. Visibility: owner all; manager the tickets of their own reports plus ones assigned
-- to or logged by them; an employee the ones assigned to or logged by them; a vendor login none.

CREATE TABLE public.company_tickets (
 id uuid PRIMARY KEY, group_id uuid NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
 client_id uuid,
 -- The client's name and phone as they were when linked, so whoever holds the ticket can call without seeing the whole client.
 client_name text CHECK(client_name IS NULL OR length(client_name)<=120), client_phone text CHECK(client_phone IS NULL OR length(client_phone)<=32),
 number integer NOT NULL CHECK(number>0),
 title text NOT NULL CHECK(length(btrim(title)) BETWEEN 1 AND 120),
 details text CHECK(details IS NULL OR length(details)<=1000),
 priority text NOT NULL DEFAULT 'normal' CHECK(priority IN ('low','normal','high','urgent')),
 status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','in_progress','resolved','closed')),
 assignee_member_id uuid NOT NULL,
 due_at timestamptz NOT NULL,
 resolution text CHECK(resolution IS NULL OR length(resolution)<=500),
 resolved_at timestamptz,
 created_by uuid NOT NULL, updated_by uuid NOT NULL,
 version integer NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 deleted_at timestamptz, updated_seq bigint NOT NULL DEFAULT 0,
 UNIQUE(id,group_id), UNIQUE(group_id,number),
 FOREIGN KEY(client_id,group_id) REFERENCES public.company_clients(id,group_id),
 FOREIGN KEY(assignee_member_id,group_id) REFERENCES public.group_members(id,group_id),
 FOREIGN KEY(created_by,group_id) REFERENCES public.group_members(id,group_id),
 FOREIGN KEY(updated_by,group_id) REFERENCES public.group_members(id,group_id)
);
CREATE INDEX company_tickets_sync_idx ON public.company_tickets(group_id,updated_seq);
CREATE INDEX company_tickets_assignee_idx ON public.company_tickets(group_id,assignee_member_id);
CREATE INDEX company_tickets_client_idx ON public.company_tickets(client_id) WHERE client_id IS NOT NULL;

-- The timeline: created, assigned, status change, comment. Escalations are not stored: they follow from due_at.
CREATE TABLE public.company_ticket_events (
 id uuid PRIMARY KEY, group_id uuid NOT NULL, ticket_id uuid NOT NULL,
 kind text NOT NULL CHECK(kind IN ('created','assigned','status','comment')),
 body text CHECK(body IS NULL OR length(body)<=1000),
 to_status text CHECK(to_status IS NULL OR to_status IN ('open','in_progress','resolved','closed')),
 member_id uuid,
 created_by uuid NOT NULL, version integer NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 deleted_at timestamptz, updated_seq bigint NOT NULL DEFAULT 0,
 FOREIGN KEY(ticket_id,group_id) REFERENCES public.company_tickets(id,group_id) ON DELETE CASCADE,
 FOREIGN KEY(created_by,group_id) REFERENCES public.group_members(id,group_id)
);
CREATE INDEX company_ticket_events_sync_idx ON public.company_ticket_events(group_id,updated_seq);
CREATE INDEX company_ticket_events_ticket_idx ON public.company_ticket_events(ticket_id,created_at);

CREATE TRIGGER company_tickets_stamp BEFORE INSERT OR UPDATE ON public.company_tickets FOR EACH ROW EXECUTE FUNCTION public.waves_stamp_seq();
CREATE TRIGGER company_ticket_events_stamp BEFORE INSERT OR UPDATE ON public.company_ticket_events FOR EACH ROW EXECUTE FUNCTION public.waves_stamp_seq();
CREATE TRIGGER aa_company_block_guard BEFORE INSERT OR UPDATE OR DELETE ON public.company_tickets FOR EACH ROW EXECUTE FUNCTION public.waves_company_block_guard();
CREATE TRIGGER aa_company_block_guard BEFORE INSERT OR UPDATE OR DELETE ON public.company_ticket_events FOR EACH ROW EXECUTE FUNCTION public.waves_company_block_guard();
ALTER TABLE public.company_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_ticket_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.company_tickets, public.company_ticket_events FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.company_tickets, public.company_ticket_events TO authenticated;
GRANT ALL ON public.company_tickets, public.company_ticket_events TO service_role;

-- May the caller see (and act on) a ticket with this assignee and this author? Owner: any. Manager: their own reports'
-- tickets and the ones assigned to or logged by them. Employee: assigned to or logged by them. Vendor login: never.
CREATE FUNCTION public.waves_company_ticket_can(p_group_id uuid,p_assignee uuid,p_created_by uuid) RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
 SELECT EXISTS(SELECT 1 FROM public.group_members me JOIN public.groups g ON g.id=me.group_id
 WHERE me.group_id=p_group_id AND g.type='company' AND g.deleted_at IS NULL
 AND me.profile_id=public.waves_current_profile_id() AND me.left_at IS NULL AND me.removed_at IS NULL AND me.merged_into_member_id IS NULL
 AND (me.role::text='admin'
  OR (me.role::text IN ('manager','member') AND (p_assignee=me.id OR p_created_by=me.id))
  OR (me.role::text='manager' AND EXISTS(SELECT 1 FROM public.group_members a WHERE a.id=p_assignee AND a.group_id=p_group_id AND a.role::text='member' AND a.manager_id=me.id))));
$$;
CREATE FUNCTION public.waves_company_ticket_visible(p_group_id uuid,p_ticket_id uuid) RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
 SELECT EXISTS(SELECT 1 FROM public.company_tickets t WHERE t.id=p_ticket_id AND t.group_id=p_group_id
 AND public.waves_company_ticket_can(t.group_id,t.assignee_member_id,t.created_by));
$$;
REVOKE ALL ON FUNCTION public.waves_company_ticket_can(uuid,uuid,uuid),public.waves_company_ticket_visible(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.waves_company_ticket_can(uuid,uuid,uuid),public.waves_company_ticket_visible(uuid,uuid) TO authenticated,service_role;
CREATE POLICY company_tickets_select ON public.company_tickets FOR SELECT TO authenticated USING(public.waves_company_ticket_can(group_id,assignee_member_id,created_by));
CREATE POLICY company_ticket_events_select ON public.company_ticket_events FOR SELECT TO authenticated USING(public.waves_company_ticket_visible(group_id,ticket_id));

-- Create or edit a ticket (also how it is reassigned). Retrying the same id with the same data changes nothing.
-- dueAt is optional: absent, it is set from the priority (urgent 4h, high 1 day, normal 3 days, low 7 days).
CREATE FUNCTION public.waves_company_ticket_set(p_group_id uuid,p_ticket_id uuid,p_data jsonb) RETURNS uuid
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
DECLARE me uuid; rl text; r public.company_tickets%ROWTYPE;
 v_title text; v_details text; v_prio text; v_assignee uuid; v_client uuid; v_due timestamptz; v_cname text; v_cphone text; v_n integer;
BEGIN
 me:=public.waves_company_actor(p_group_id);
 SELECT role::text INTO rl FROM public.group_members WHERE id=me;
 IF rl NOT IN ('admin','manager','member') THEN RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE='insufficient_privilege'; END IF;
 IF p_ticket_id IS NULL OR jsonb_typeof(p_data) IS DISTINCT FROM 'object'
  OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_data) k WHERE k NOT IN ('clientId','title','details','priority','assigneeMemberId','dueAt')) THEN RAISE EXCEPTION 'INVALID_DATA' USING ERRCODE='check_violation'; END IF;
 v_title:=btrim(coalesce(p_data->>'title','')); v_details:=nullif(btrim(coalesce(p_data->>'details','')),''); v_prio:=coalesce(nullif(p_data->>'priority',''),'normal');
 IF v_title='' OR length(v_title)>120 OR length(coalesce(v_details,''))>1000 OR v_prio NOT IN ('low','normal','high','urgent') THEN RAISE EXCEPTION 'INVALID_DATA' USING ERRCODE='check_violation'; END IF;
 BEGIN
  v_client:=nullif(p_data->>'clientId','')::uuid; v_assignee:=nullif(p_data->>'assigneeMemberId','')::uuid; v_due:=nullif(p_data->>'dueAt','')::timestamptz;
 EXCEPTION WHEN invalid_text_representation OR datetime_field_overflow OR invalid_datetime_format THEN RAISE EXCEPTION 'INVALID_DATA' USING ERRCODE='check_violation'; END;
 IF v_assignee IS NULL THEN RAISE EXCEPTION 'INVALID_DATA: assignee' USING ERRCODE='check_violation'; END IF;
 v_due:=coalesce(v_due,now()+CASE v_prio WHEN 'urgent' THEN interval '4 hours' WHEN 'high' THEN interval '1 day' WHEN 'normal' THEN interval '3 days' ELSE interval '7 days' END);
 IF v_due>now()+interval '400 days' OR v_due<now()-interval '400 days' THEN RAISE EXCEPTION 'INVALID_DATA: due' USING ERRCODE='check_violation'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.group_members WHERE id=v_assignee AND group_id=p_group_id AND role::text IN ('admin','manager','member') AND left_at IS NULL AND removed_at IS NULL AND merged_into_member_id IS NULL) THEN RAISE EXCEPTION 'UNKNOWN_MEMBER' USING ERRCODE='insufficient_privilege'; END IF;
 PERFORM 1 FROM public.groups WHERE id=p_group_id FOR UPDATE;
 SELECT * INTO r FROM public.company_tickets WHERE id=p_ticket_id;
 IF FOUND THEN
  IF r.group_id<>p_group_id OR r.deleted_at IS NOT NULL OR NOT public.waves_company_ticket_can(r.group_id,r.assignee_member_id,r.created_by) THEN RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE='insufficient_privilege'; END IF;
 END IF;
 -- A newly linked client must be one the caller can see; an unchanged link stays even if the caller cannot see the client.
 IF v_client IS NOT NULL AND v_client IS DISTINCT FROM r.client_id THEN
  SELECT name,phone INTO v_cname,v_cphone FROM public.company_clients WHERE id=v_client AND group_id=p_group_id AND deleted_at IS NULL AND public.waves_company_client_visible(p_group_id,id);
  IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_DATA: client' USING ERRCODE='check_violation'; END IF;
 ELSIF v_client IS NOT NULL THEN v_cname:=r.client_name; v_cphone:=r.client_phone; END IF;
 IF r.id IS NOT NULL THEN
  IF r.title=v_title AND r.details IS NOT DISTINCT FROM v_details AND r.priority=v_prio AND r.assignee_member_id=v_assignee AND r.client_id IS NOT DISTINCT FROM v_client AND r.due_at=v_due THEN RETURN r.id; END IF;
  IF v_assignee<>r.assignee_member_id THEN
   INSERT INTO public.company_ticket_events(id,group_id,ticket_id,kind,member_id,created_by) VALUES(gen_random_uuid(),p_group_id,r.id,'assigned',v_assignee,me);
   -- The new assignee's next pull must carry the history.
   UPDATE public.company_ticket_events SET updated_at=now() WHERE ticket_id=r.id;
  END IF;
  UPDATE public.company_tickets SET client_id=v_client,client_name=v_cname,client_phone=v_cphone,title=v_title,details=v_details,priority=v_prio,assignee_member_id=v_assignee,due_at=v_due,
   version=version+1,updated_by=me,updated_at=now() WHERE id=r.id;
  RETURN r.id;
 END IF;
 IF EXISTS(SELECT 1 FROM public.company_tickets WHERE id=p_ticket_id) THEN RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE='insufficient_privilege'; END IF;
 SELECT coalesce(max(number),0)+1 INTO v_n FROM public.company_tickets WHERE group_id=p_group_id;
 INSERT INTO public.company_tickets(id,group_id,client_id,client_name,client_phone,number,title,details,priority,assignee_member_id,due_at,created_by,updated_by)
 VALUES(p_ticket_id,p_group_id,v_client,v_cname,v_cphone,v_n,v_title,v_details,v_prio,v_assignee,v_due,me,me);
 INSERT INTO public.company_ticket_events(id,group_id,ticket_id,kind,member_id,created_by) VALUES(gen_random_uuid(),p_group_id,p_ticket_id,'created',v_assignee,me);
 RETURN p_ticket_id;
END $$;

-- Move a ticket on: open -> in_progress -> resolved (a note is required) -> closed, and reopen from resolved or closed.
-- Asking for the status it already has, or a move that is no longer possible because someone else moved it first, changes nothing.
-- Reopening starts a fresh due time from the priority.
CREATE FUNCTION public.waves_company_ticket_status(p_ticket_id uuid,p_status text,p_note text) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
DECLARE r public.company_tickets%ROWTYPE; me uuid; v_note text:=nullif(btrim(coalesce(p_note,'')),'');
BEGIN
 IF p_status IS NULL OR p_status NOT IN ('open','in_progress','resolved','closed') OR length(coalesce(v_note,''))>500 THEN RAISE EXCEPTION 'INVALID_DATA' USING ERRCODE='check_violation'; END IF;
 SELECT * INTO r FROM public.company_tickets WHERE id=p_ticket_id FOR UPDATE;
 IF NOT FOUND OR r.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE='insufficient_privilege'; END IF;
 me:=public.waves_company_actor(r.group_id);
 IF NOT public.waves_company_ticket_can(r.group_id,r.assignee_member_id,r.created_by) THEN RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE='insufficient_privilege'; END IF;
 IF r.status=p_status THEN RETURN; END IF;
 IF NOT ((r.status='open' AND p_status IN ('in_progress','resolved'))
  OR (r.status='in_progress' AND p_status='resolved')
  OR (r.status='resolved' AND p_status IN ('open','closed'))
  OR (r.status='closed' AND p_status='open')) THEN RETURN; END IF;
 IF p_status='resolved' AND v_note IS NULL THEN RAISE EXCEPTION 'INVALID_DATA: note' USING ERRCODE='check_violation'; END IF;
 UPDATE public.company_tickets SET status=p_status,
  resolution=CASE WHEN p_status='resolved' THEN v_note WHEN p_status='open' THEN NULL ELSE resolution END,
  resolved_at=CASE WHEN p_status='resolved' THEN now() WHEN p_status='open' THEN NULL ELSE coalesce(resolved_at,now()) END,
  due_at=CASE WHEN p_status='open' THEN now()+CASE priority WHEN 'urgent' THEN interval '4 hours' WHEN 'high' THEN interval '1 day' WHEN 'normal' THEN interval '3 days' ELSE interval '7 days' END ELSE due_at END,
  version=version+1,updated_by=me,updated_at=now() WHERE id=r.id;
 INSERT INTO public.company_ticket_events(id,group_id,ticket_id,kind,body,to_status,created_by) VALUES(gen_random_uuid(),r.group_id,r.id,'status',CASE WHEN p_status='resolved' THEN v_note END,p_status,me);
END $$;

-- Add a comment to a ticket the caller can see. Retrying the same comment id changes nothing.
CREATE FUNCTION public.waves_company_ticket_comment_add(p_group_id uuid,p_event_id uuid,p_ticket_id uuid,p_body text) RETURNS uuid
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
DECLARE me uuid; v_body text:=btrim(coalesce(p_body,''));
BEGIN
 me:=public.waves_company_actor(p_group_id);
 IF p_event_id IS NULL OR v_body='' OR length(v_body)>1000 THEN RAISE EXCEPTION 'INVALID_DATA' USING ERRCODE='check_violation'; END IF;
 IF NOT public.waves_company_ticket_visible(p_group_id,p_ticket_id) OR EXISTS(SELECT 1 FROM public.company_tickets WHERE id=p_ticket_id AND deleted_at IS NOT NULL) THEN RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE='insufficient_privilege'; END IF;
 IF EXISTS(SELECT 1 FROM public.company_ticket_events WHERE id=p_event_id) THEN
  IF EXISTS(SELECT 1 FROM public.company_ticket_events WHERE id=p_event_id AND group_id=p_group_id AND ticket_id=p_ticket_id AND kind='comment' AND created_by=me) THEN RETURN p_event_id; END IF;
  RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE='insufficient_privilege';
 END IF;
 INSERT INTO public.company_ticket_events(id,group_id,ticket_id,kind,body,created_by) VALUES(p_event_id,p_group_id,p_ticket_id,'comment',v_body,me);
 RETURN p_event_id;
END $$;

-- Owner, or a manager of the assignee, removes a ticket. Removing it again changes nothing.
CREATE FUNCTION public.waves_company_ticket_remove(p_ticket_id uuid) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
DECLARE r public.company_tickets%ROWTYPE; me uuid; rl text;
BEGIN
 SELECT * INTO r FROM public.company_tickets WHERE id=p_ticket_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE='insufficient_privilege'; END IF;
 me:=public.waves_company_actor(r.group_id);
 SELECT role::text INTO rl FROM public.group_members WHERE id=me;
 IF rl NOT IN ('admin','manager') OR NOT public.waves_company_ticket_can(r.group_id,r.assignee_member_id,r.created_by) THEN RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE='insufficient_privilege'; END IF;
 IF r.deleted_at IS NOT NULL THEN RETURN; END IF;
 UPDATE public.company_tickets SET deleted_at=now(),version=version+1,updated_by=me,updated_at=now() WHERE id=r.id;
END $$;

REVOKE ALL ON FUNCTION public.waves_company_ticket_set(uuid,uuid,jsonb),public.waves_company_ticket_status(uuid,text,text),public.waves_company_ticket_comment_add(uuid,uuid,uuid,text),public.waves_company_ticket_remove(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.waves_company_ticket_set(uuid,uuid,jsonb),public.waves_company_ticket_status(uuid,text,text),public.waves_company_ticket_comment_add(uuid,uuid,uuid,text),public.waves_company_ticket_remove(uuid) TO authenticated,service_role;

-- An employee who moves to another manager: the new manager's next pull must carry that employee's tickets and history.
CREATE FUNCTION public.waves_company_ticket_restamp() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
BEGIN
 UPDATE public.company_ticket_events SET updated_at=now() WHERE ticket_id IN (SELECT id FROM public.company_tickets WHERE assignee_member_id=NEW.id);
 UPDATE public.company_tickets SET updated_at=now() WHERE assignee_member_id=NEW.id;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.waves_company_ticket_restamp() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER company_ticket_restamp AFTER UPDATE OF manager_id ON public.group_members FOR EACH ROW WHEN (OLD.manager_id IS DISTINCT FROM NEW.manager_id) EXECUTE FUNCTION public.waves_company_ticket_restamp();
