-- Company moderation: an admin can suspend (block) a company, members and vendors can report one,
-- and every admin action on a company is written to an append-only log.
-- A suspended company is read-only for every member; reads and exports keep working.
-- Any NEW company table must attach a trigger that calls waves_company_block_guard() (see below).

ALTER TABLE public.groups ADD COLUMN suspended_at timestamptz;

-- One helper every company write path can ask.
CREATE FUNCTION public.waves_company_is_blocked(p_group_id uuid) RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
 SELECT EXISTS(SELECT 1 FROM public.groups WHERE id=p_group_id AND suspended_at IS NOT NULL);
$$;
REVOKE ALL ON FUNCTION public.waves_company_is_blocked(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.waves_company_is_blocked(uuid) TO authenticated,service_role;

-- Complaints: filed by a member or vendor of the company; read only by the admin console (service role).
CREATE TABLE public.company_complaints (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 group_id uuid NOT NULL, -- no FK: a complaint outlives a deleted company
 reporter_profile_id uuid,
 reporter_role text NOT NULL,
 category text NOT NULL CHECK(category IN ('fraud','illegal','harassment','wages','other')),
 body text NOT NULL CHECK(length(btrim(body)) BETWEEN 1 AND 1000),
 status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','reviewing','closed')),
 admin_note text CHECK(admin_note IS NULL OR length(admin_note)<=2000),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX company_complaints_group_idx ON public.company_complaints(group_id,created_at DESC);

-- The moderation log. Append-only: nobody (service role included) can change or remove a row.
CREATE TABLE public.company_moderation_log (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 group_id uuid NOT NULL,
 action text NOT NULL CHECK(action IN ('block','unblock','records_opened','records_viewed','export','complaint_update')),
 actor text NOT NULL DEFAULT 'admin console',
 category text, reason text CHECK(reason IS NULL OR length(reason)<=2000),
 meta jsonb NOT NULL DEFAULT '{}'::jsonb,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX company_moderation_log_group_idx ON public.company_moderation_log(group_id,created_at DESC);
CREATE FUNCTION public.waves_company_log_append_only() RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public','pg_temp' AS $$
BEGIN RAISE EXCEPTION 'LOG_APPEND_ONLY' USING ERRCODE='insufficient_privilege'; END $$;
CREATE TRIGGER company_moderation_log_no_change BEFORE UPDATE OR DELETE ON public.company_moderation_log FOR EACH ROW EXECUTE FUNCTION public.waves_company_log_append_only();
CREATE TRIGGER company_moderation_log_no_truncate BEFORE TRUNCATE ON public.company_moderation_log FOR EACH STATEMENT EXECUTE FUNCTION public.waves_company_log_append_only();
ALTER TABLE public.company_complaints ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_moderation_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.company_complaints, public.company_moderation_log FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.company_complaints TO service_role;
GRANT SELECT,INSERT ON public.company_moderation_log TO service_role;

-- ── Enforcement ─────────────────────────────────────────────────────────────
-- A write is "by a person" when a user JWT is present (sync and the app call RPCs as the caller). Maintenance
-- run by the service role alone (admin console, sweeps) has no user and passes. Joining and invites are
-- refused whoever asks (TG_ARGV[0]='hard').
CREATE FUNCTION public.waves_company_block_guard() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
DECLARE g uuid;
BEGIN
 IF TG_ARGV[0] IS DISTINCT FROM 'hard' AND public.waves_current_profile_id() IS NULL THEN RETURN COALESCE(NEW,OLD); END IF;
 g:=(to_jsonb(CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END)->>'group_id')::uuid;
 IF public.waves_company_is_blocked(g) THEN RAISE EXCEPTION 'COMPANY_BLOCKED' USING ERRCODE='insufficient_privilege'; END IF;
 RETURN COALESCE(NEW,OLD);
END $$;

-- Members: no new member while blocked; role/rate/manager changes refused; leaving and erasure stay possible.
CREATE FUNCTION public.waves_company_block_member_guard() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
DECLARE keep text[]:=ARRAY['updated_at','updated_seq'];
BEGIN
 IF TG_OP='UPDATE' THEN
  -- Leaving also clears the person's manager link, so that rides along with a left_at change.
  IF NEW.left_at IS DISTINCT FROM OLD.left_at THEN keep:=keep||ARRAY['left_at','manager_id']; END IF;
  -- Account erasure detaches the profile and blanks personal details; nothing else may edit them.
  IF NEW.profile_id IS NULL AND OLD.profile_id IS NOT NULL THEN keep:=keep||ARRAY['profile_id','ghost_name','payment_handle','payment_rail','vpa','invite_email','invite_phone']; END IF;
  IF public.waves_current_profile_id() IS NULL OR (to_jsonb(NEW)-keep)=(to_jsonb(OLD)-keep) THEN RETURN NEW; END IF;
 END IF;
 IF public.waves_company_is_blocked(NEW.group_id) THEN RAISE EXCEPTION 'COMPANY_BLOCKED' USING ERRCODE='insufficient_privilege'; END IF;
 RETURN NEW;
END $$;

-- The company's own settings row: nobody but the admin console may suspend, lift or delete while suspended.
CREATE FUNCTION public.waves_company_block_group_guard() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
BEGIN
 IF public.waves_current_profile_id() IS NULL OR (to_jsonb(NEW)-ARRAY['updated_seq','updated_at'])=(to_jsonb(OLD)-ARRAY['updated_seq','updated_at']) THEN RETURN NEW; END IF; -- seq stamping on a member change is not a settings write
 IF NEW.suspended_at IS DISTINCT FROM OLD.suspended_at THEN RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE='insufficient_privilege'; END IF;
 IF OLD.suspended_at IS NOT NULL THEN RAISE EXCEPTION 'COMPANY_BLOCKED' USING ERRCODE='insufficient_privilege'; END IF;
 RETURN NEW;
END $$;

DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['company_entries','company_entry_attachments','company_projects','company_project_members','company_project_budgets',
  'company_wage_runs','company_wage_splits','company_vendors','company_vendor_entries'] LOOP
  EXECUTE format('CREATE TRIGGER aa_company_block_guard BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.waves_company_block_guard()',t);
 END LOOP;
END $$;
-- Photo uploads reserve a key through the service role (no user), so this one is hard as well.
CREATE TRIGGER aa_company_block_guard BEFORE INSERT ON public.company_image_keys FOR EACH ROW EXECUTE FUNCTION public.waves_company_block_guard('hard');
CREATE TRIGGER aa_company_block_guard BEFORE INSERT OR UPDATE ON public.invites FOR EACH ROW EXECUTE FUNCTION public.waves_company_block_guard('hard');
CREATE TRIGGER aa_company_block_guard BEFORE INSERT OR UPDATE ON public.group_members FOR EACH ROW EXECUTE FUNCTION public.waves_company_block_member_guard();
CREATE TRIGGER aa_company_block_guard BEFORE UPDATE ON public.groups FOR EACH ROW EXECUTE FUNCTION public.waves_company_block_group_guard();

-- A used-up or suspended company's invite link no longer admits anyone.
CREATE OR REPLACE FUNCTION public.waves_consume_invite(p_invite_id uuid) RETURNS boolean
 LANGUAGE sql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
 UPDATE public.invites i SET use_count = use_count + 1
 WHERE i.id = p_invite_id AND i.revoked_at IS NULL AND i.expires_at > now() AND i.use_count < i.max_uses
 AND EXISTS (SELECT 1 FROM public.groups g WHERE g.id = i.group_id AND g.deleted_at IS NULL AND g.suspended_at IS NULL)
 RETURNING true;
$$;

-- ── Reporting (members and vendors) ─────────────────────────────────────────
CREATE FUNCTION public.waves_company_report(p_group_id uuid,p_category text,p_text text) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
DECLARE me uuid:=public.waves_current_profile_id(); rl text; gate jsonb; v_id uuid;
BEGIN
 IF me IS NULL THEN RAISE EXCEPTION 'NOT_SIGNED_IN'; END IF;
 SELECT m.role::text INTO rl FROM public.group_members m JOIN public.groups g ON g.id=m.group_id
  WHERE m.group_id=p_group_id AND g.type='company' AND g.deleted_at IS NULL AND m.profile_id=me
  AND m.left_at IS NULL AND m.removed_at IS NULL AND m.merged_into_member_id IS NULL;
 IF rl IS NULL THEN RAISE EXCEPTION 'NOT_A_MEMBER' USING ERRCODE='insufficient_privilege'; END IF;
 IF p_category NOT IN ('fraud','illegal','harassment','wages','other') OR length(btrim(coalesce(p_text,''))) NOT BETWEEN 1 AND 1000 THEN
  RAISE EXCEPTION 'INVALID_DATA' USING ERRCODE='check_violation'; END IF;
 gate:=public.waves_rate_limit('companyreport:'||me::text,'company-report',5,86400);
 IF NOT (gate->>'allowed')::boolean THEN RETURN jsonb_build_object('ok',false,'reason','RATE_LIMITED'); END IF;
 INSERT INTO public.company_complaints(group_id,reporter_profile_id,reporter_role,category,body)
 VALUES(p_group_id,me,rl,p_category,btrim(p_text)) RETURNING id INTO v_id;
 RETURN jsonb_build_object('ok',true,'id',v_id);
END $$;
REVOKE ALL ON FUNCTION public.waves_company_report(uuid,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.waves_company_report(uuid,text,text) TO authenticated,service_role;

-- ── Admin console (service role only) ───────────────────────────────────────
-- Monitoring returns metadata and aggregates: names, roles, counts, totals. Entry content (notes, per-line
-- amounts, vendors, photos) is only reachable through waves_admin_company_records, which needs a logged reason.
CREATE FUNCTION public.waves_admin_company_facts(p_group_id uuid) RETURNS jsonb
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
 SELECT jsonb_build_object(
  'id',g.id,'name',g.name,'created_at',g.created_at,'suspended_at',g.suspended_at,'currency',g.default_currency,
  'owner_name',(SELECT p.display_name FROM public.profiles p WHERE p.id=o.profile_id),
  'owner_email',(SELECT u.email FROM auth.users u WHERE u.id=o.profile_id),
  'owner_phone',(SELECT u.phone FROM auth.users u WHERE u.id=o.profile_id),
  'owners',(SELECT count(*) FROM public.group_members m WHERE m.group_id=g.id AND m.left_at IS NULL AND m.removed_at IS NULL AND m.role::text='admin'),
  'managers',(SELECT count(*) FROM public.group_members m WHERE m.group_id=g.id AND m.left_at IS NULL AND m.removed_at IS NULL AND m.role::text='manager'),
  'employees',(SELECT count(*) FROM public.group_members m WHERE m.group_id=g.id AND m.left_at IS NULL AND m.removed_at IS NULL AND m.role::text='member'),
  'vendors',(SELECT count(*) FROM public.company_vendors v WHERE v.group_id=g.id AND v.deleted_at IS NULL),
  'last_activity',greatest((SELECT max(e.updated_at) FROM public.company_entries e WHERE e.group_id=g.id),
                           (SELECT max(e.updated_at) FROM public.company_vendor_entries e WHERE e.group_id=g.id)),
  'entries_30d',(SELECT count(*) FROM public.company_entries e WHERE e.group_id=g.id AND e.deleted_at IS NULL AND e.created_at>now()-interval '30 days'),
  'total_30d',(SELECT coalesce(sum(e.amount),0) FROM public.company_entries e WHERE e.group_id=g.id AND e.deleted_at IS NULL AND e.created_at>now()-interval '30 days'),
  'open_complaints',(SELECT count(*) FROM public.company_complaints c WHERE c.group_id=g.id AND c.status<>'closed'))
 FROM public.groups g
 LEFT JOIN LATERAL (SELECT m.profile_id FROM public.group_members m WHERE m.group_id=g.id AND m.role::text='admin' AND m.profile_id IS NOT NULL
   ORDER BY (m.profile_id=g.created_by) DESC,m.created_at LIMIT 1) o ON true
 WHERE g.id=p_group_id AND g.type='company' AND g.deleted_at IS NULL;
$$;

CREATE FUNCTION public.waves_admin_companies(p_search text DEFAULT NULL,p_filter text DEFAULT NULL,p_limit integer DEFAULT 50,p_offset integer DEFAULT 0) RETURNS jsonb
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
 WITH base AS (SELECT f AS j FROM public.groups g CROSS JOIN LATERAL public.waves_admin_company_facts(g.id) f WHERE g.type='company' AND g.deleted_at IS NULL),
 hit AS (SELECT j FROM base WHERE
  (nullif(btrim(coalesce(p_search,'')),'') IS NULL OR concat_ws(' ',j->>'name',j->>'owner_name',j->>'owner_email',j->>'owner_phone') ILIKE '%'||btrim(p_search)||'%')
  AND (p_filter IS NULL OR p_filter='' OR (p_filter='blocked' AND j->>'suspended_at' IS NOT NULL) OR (p_filter='complaints' AND (j->>'open_complaints')::int>0)))
 SELECT jsonb_build_object('total',(SELECT count(*) FROM hit),'rows',coalesce((SELECT jsonb_agg(j) FROM
  (SELECT j FROM hit ORDER BY (j->>'open_complaints')::int DESC,j->>'created_at' DESC
   OFFSET greatest(coalesce(p_offset,0),0) LIMIT least(greatest(coalesce(p_limit,50),1),200)) x),'[]'::jsonb));
$$;

-- Facts, members (name + role only), activity per week (counts only), complaints and the moderation log.
CREATE FUNCTION public.waves_admin_company_detail(p_group_id uuid) RETURNS jsonb
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
DECLARE f jsonb:=public.waves_admin_company_facts(p_group_id);
BEGIN
 IF f IS NULL THEN RETURN NULL; END IF;
 RETURN jsonb_build_object('facts',f,
  'members',coalesce((SELECT jsonb_agg(jsonb_build_object('name',coalesce(p.display_name,m.ghost_name,'Member'),'role',m.role::text) ORDER BY m.role::text,m.created_at)
    FROM public.group_members m LEFT JOIN public.profiles p ON p.id=m.profile_id
    WHERE m.group_id=p_group_id AND m.left_at IS NULL AND m.removed_at IS NULL),'[]'::jsonb),
  'weeks',coalesce((SELECT jsonb_agg(jsonb_build_object('week',w.wk,'entries',w.n) ORDER BY w.wk)
    FROM (SELECT date_trunc('week',e.created_at)::date AS wk,count(*) AS n FROM public.company_entries e
          WHERE e.group_id=p_group_id AND e.created_at>now()-interval '8 weeks' GROUP BY 1) w),'[]'::jsonb),
  'complaints',coalesce((SELECT jsonb_agg(to_jsonb(c)-'reporter_profile_id' ORDER BY c.created_at DESC) FROM public.company_complaints c WHERE c.group_id=p_group_id),'[]'::jsonb),
  'log',coalesce((SELECT jsonb_agg(to_jsonb(l) ORDER BY l.id DESC) FROM public.company_moderation_log l WHERE l.group_id=p_group_id),'[]'::jsonb));
END $$;

CREATE FUNCTION public.waves_admin_company_block(p_group_id uuid,p_category text,p_reason text) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
DECLARE lid bigint; o record;
BEGIN
 IF p_category NOT IN ('complaint','fraud','spam','other') OR length(btrim(coalesce(p_reason,''))) NOT BETWEEN 1 AND 2000 THEN RAISE EXCEPTION 'INVALID_DATA' USING ERRCODE='check_violation'; END IF;
 PERFORM 1 FROM public.groups WHERE id=p_group_id AND type='company' AND deleted_at IS NULL FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
 IF public.waves_company_is_blocked(p_group_id) THEN RETURN; END IF;
 UPDATE public.groups SET suspended_at=now() WHERE id=p_group_id;
 INSERT INTO public.company_moderation_log(group_id,action,category,reason) VALUES(p_group_id,'block',p_category,btrim(p_reason)) RETURNING id INTO lid;
 FOR o IN SELECT DISTINCT profile_id FROM public.group_members WHERE group_id=p_group_id AND role::text='admin' AND profile_id IS NOT NULL AND left_at IS NULL LOOP
  PERFORM public.waves_notify(o.profile_id,p_group_id,'company_suspended','Company suspended','This company has been suspended by Waves. It is read-only until the issue is resolved.',NULL,'{}'::jsonb,'company-block:'||lid);
 END LOOP;
END $$;

CREATE FUNCTION public.waves_admin_company_unblock(p_group_id uuid,p_reason text) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
DECLARE lid bigint; o record;
BEGIN
 IF length(btrim(coalesce(p_reason,''))) NOT BETWEEN 1 AND 2000 THEN RAISE EXCEPTION 'INVALID_DATA' USING ERRCODE='check_violation'; END IF;
 PERFORM 1 FROM public.groups WHERE id=p_group_id AND type='company' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
 IF NOT public.waves_company_is_blocked(p_group_id) THEN RETURN; END IF;
 UPDATE public.groups SET suspended_at=NULL WHERE id=p_group_id;
 INSERT INTO public.company_moderation_log(group_id,action,reason) VALUES(p_group_id,'unblock',btrim(p_reason)) RETURNING id INTO lid;
 FOR o IN SELECT DISTINCT profile_id FROM public.group_members WHERE group_id=p_group_id AND role::text='admin' AND profile_id IS NOT NULL AND left_at IS NULL LOOP
  PERFORM public.waves_notify(o.profile_id,p_group_id,'company_restored','Company restored','Waves has lifted the suspension. You can add and edit again.',NULL,'{}'::jsonb,'company-block:'||lid);
 END LOOP;
END $$;

CREATE FUNCTION public.waves_admin_company_complaint_set(p_id uuid,p_status text,p_note text) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
DECLARE c public.company_complaints%ROWTYPE;
BEGIN
 IF p_status NOT IN ('open','reviewing','closed') OR length(coalesce(p_note,''))>2000 THEN RAISE EXCEPTION 'INVALID_DATA' USING ERRCODE='check_violation'; END IF;
 UPDATE public.company_complaints SET status=p_status,admin_note=nullif(btrim(coalesce(p_note,'')),''),updated_at=now() WHERE id=p_id RETURNING * INTO c;
 IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
 INSERT INTO public.company_moderation_log(group_id,action,meta) VALUES(c.group_id,'complaint_update',jsonb_build_object('complaint',p_id,'status',p_status));
END $$;

-- The only door to company content. A written reason is logged first; the grant lasts one hour.
CREATE FUNCTION public.waves_admin_company_open_records(p_group_id uuid,p_reason text) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
BEGIN
 IF length(btrim(coalesce(p_reason,''))) NOT BETWEEN 5 AND 2000 THEN RAISE EXCEPTION 'INVALID_DATA' USING ERRCODE='check_violation'; END IF;
 IF public.waves_admin_company_facts(p_group_id) IS NULL THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
 INSERT INTO public.company_moderation_log(group_id,action,reason) VALUES(p_group_id,'records_opened',btrim(p_reason));
END $$;

CREATE FUNCTION public.waves_admin_company_entries_json(p_group_id uuid) RETURNS jsonb
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
 SELECT jsonb_build_object(
  'entries',coalesce((SELECT jsonb_agg(x ORDER BY x->>'occurred_on' DESC) FROM (
    SELECT jsonb_build_object('id',e.id,'kind',e.entry_kind,'category',e.category,'amount',e.amount,'currency',e.currency,'occurred_on',e.occurred_on,
     'status',e.status,'note',e.note,'vendor',e.vendor,'invoice_no',e.invoice_no,'paid_by_company',e.paid_by_company,'deleted',e.deleted_at IS NOT NULL,
     'person',(SELECT coalesce(p.display_name,m.ghost_name) FROM public.group_members m LEFT JOIN public.profiles p ON p.id=m.profile_id WHERE m.id=e.member_id),
     'photos',(SELECT count(*) FROM public.company_entry_attachments a WHERE a.entry_id=e.id AND a.deleted_at IS NULL)) AS x
    FROM public.company_entries e WHERE e.group_id=p_group_id ORDER BY e.occurred_on DESC,e.created_at DESC LIMIT 500) s),'[]'::jsonb),
  'vendor_entries',coalesce((SELECT jsonb_agg(x ORDER BY x->>'occurred_on' DESC) FROM (
    SELECT jsonb_build_object('id',ve.id,'vendor',v.name,'kind',ve.kind,'amount',ve.amount,'occurred_on',ve.occurred_on,'status',ve.status,'note',ve.note,'deleted',ve.deleted_at IS NOT NULL) AS x
    FROM public.company_vendor_entries ve JOIN public.company_vendors v ON v.id=ve.vendor_id WHERE ve.group_id=p_group_id ORDER BY ve.occurred_on DESC LIMIT 500) s),'[]'::jsonb));
$$;

-- Read-only entries, only while a 'records_opened' log row for this company is less than an hour old.
CREATE FUNCTION public.waves_admin_company_records(p_group_id uuid) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.company_moderation_log WHERE group_id=p_group_id AND action='records_opened' AND created_at>now()-interval '1 hour') THEN
  RAISE EXCEPTION 'REASON_REQUIRED'; END IF;
 INSERT INTO public.company_moderation_log(group_id,action) VALUES(p_group_id,'records_viewed');
 RETURN public.waves_admin_company_entries_json(p_group_id);
END $$;

-- The moderation file for legal use. Entries are included only while a records_opened grant (reason logged) is under an hour old.
CREATE FUNCTION public.waves_admin_company_export(p_group_id uuid) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
DECLARE d jsonb:=public.waves_admin_company_detail(p_group_id); opened boolean; res jsonb;
BEGIN
 IF d IS NULL THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
 opened:=EXISTS(SELECT 1 FROM public.company_moderation_log WHERE group_id=p_group_id AND action='records_opened' AND created_at>now()-interval '1 hour');
 res:=jsonb_build_object('generated_at',now(),'company',d->'facts','members',d->'members','complaints',d->'complaints','moderation_log',d->'log',
  'records_included',opened)
  || CASE WHEN opened THEN public.waves_admin_company_entries_json(p_group_id) ELSE '{}'::jsonb END;
 INSERT INTO public.company_moderation_log(group_id,action,meta) VALUES(p_group_id,'export',jsonb_build_object('records_included',opened));
 RETURN res;
END $$;

-- Service role only. Trigger and helper functions are never called directly.
REVOKE ALL ON FUNCTION public.waves_admin_company_facts(uuid),public.waves_admin_companies(text,text,integer,integer),public.waves_admin_company_detail(uuid),
 public.waves_admin_company_block(uuid,text,text),public.waves_admin_company_unblock(uuid,text),public.waves_admin_company_complaint_set(uuid,text,text),
 public.waves_admin_company_open_records(uuid,text),public.waves_admin_company_entries_json(uuid),public.waves_admin_company_records(uuid),
 public.waves_admin_company_export(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.waves_admin_company_facts(uuid),public.waves_admin_companies(text,text,integer,integer),public.waves_admin_company_detail(uuid),
 public.waves_admin_company_block(uuid,text,text),public.waves_admin_company_unblock(uuid,text),public.waves_admin_company_complaint_set(uuid,text,text),
 public.waves_admin_company_open_records(uuid,text),public.waves_admin_company_entries_json(uuid),public.waves_admin_company_records(uuid),
 public.waves_admin_company_export(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.waves_company_block_guard(),public.waves_company_block_member_guard(),public.waves_company_block_group_guard(),
 public.waves_company_log_append_only() FROM PUBLIC,anon,authenticated;
