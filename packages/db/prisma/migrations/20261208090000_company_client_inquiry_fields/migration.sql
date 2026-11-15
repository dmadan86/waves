-- New inquiry form: email, company, category and priority on a client (all optional; priority defaults to normal).
-- Notes reuse company_client_notes. waves_company_client_set keeps its signature, so grants carry over; an absent key keeps the stored value.
ALTER TABLE public.company_clients
 ADD COLUMN email text CHECK(email IS NULL OR (length(email)<=200 AND email ~ '^[^@\s]+@[^@\s]+$')),
 ADD COLUMN company_name text CHECK(company_name IS NULL OR length(company_name)<=120),
 ADD COLUMN category text CHECK(category IS NULL OR length(category)<=60),
 ADD COLUMN priority text NOT NULL DEFAULT 'normal' CHECK(priority IN ('normal','urgent','high'));

CREATE OR REPLACE FUNCTION public.waves_company_client_set(p_group_id uuid,p_client_id uuid,p_data jsonb) RETURNS uuid
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
DECLARE me uuid; rl text; r public.company_clients%ROWTYPE; boss boolean;
 v_name text; v_phone text; v_need text; v_src text; v_val bigint; v_addr text; v_stage text; v_lost text; v_owner uuid; v_email text; v_comp text; v_cat text; v_prio text;
BEGIN
 me:=public.waves_company_actor(p_group_id);
 SELECT role::text INTO rl FROM public.group_members WHERE id=me;
 IF rl NOT IN ('admin','manager','member') THEN RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE='insufficient_privilege'; END IF;
 boss:=rl IN ('admin','manager');
 IF p_client_id IS NULL OR jsonb_typeof(p_data) IS DISTINCT FROM 'object'
  OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_data) k WHERE k NOT IN ('name','phone','need','source','expectedValue','address','stage','lostReason','ownerMemberId','email','company','category','priority')) THEN RAISE EXCEPTION 'INVALID_DATA' USING ERRCODE='check_violation'; END IF;
 v_name:=btrim(coalesce(p_data->>'name','')); v_phone:=nullif(btrim(coalesce(p_data->>'phone','')),''); v_need:=nullif(btrim(coalesce(p_data->>'need','')),'');
 v_src:=coalesce(nullif(p_data->>'source',''),'other'); v_addr:=nullif(btrim(coalesce(p_data->>'address','')),'');
 v_stage:=coalesce(nullif(p_data->>'stage',''),'inquiry'); v_lost:=nullif(btrim(coalesce(p_data->>'lostReason','')),'');
 -- An absent key keeps what the client already has (older apps and stage changes do not send these).
 SELECT * INTO r FROM public.company_clients WHERE id=p_client_id;
 v_email:=CASE WHEN p_data ? 'email' THEN nullif(btrim(coalesce(p_data->>'email','')),'') ELSE r.email END;
 v_comp:=CASE WHEN p_data ? 'company' THEN nullif(btrim(coalesce(p_data->>'company','')),'') ELSE r.company_name END;
 v_cat:=CASE WHEN p_data ? 'category' THEN nullif(btrim(coalesce(p_data->>'category','')),'') ELSE r.category END;
 v_prio:=CASE WHEN p_data ? 'priority' THEN coalesce(nullif(p_data->>'priority',''),'normal') ELSE coalesce(r.priority,'normal') END;
 IF length(coalesce(v_email,''))>200 OR (v_email IS NOT NULL AND v_email !~ '^[^@\s]+@[^@\s]+$') OR length(coalesce(v_comp,''))>120 OR length(coalesce(v_cat,''))>60 OR v_prio NOT IN ('normal','urgent','high') THEN RAISE EXCEPTION 'INVALID_DATA' USING ERRCODE='check_violation'; END IF;
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
  UPDATE public.company_clients SET name=v_name,phone=v_phone,need=v_need,source=v_src,expected_value=v_val,address=v_addr,email=v_email,company_name=v_comp,category=v_cat,priority=v_prio,stage=v_stage,lost_reason=v_lost,owner_member_id=v_owner,version=version+1,updated_at=now() WHERE id=r.id;
  RETURN r.id;
 END IF;
 INSERT INTO public.company_clients(id,group_id,name,phone,need,source,expected_value,address,email,company_name,category,priority,stage,lost_reason,owner_member_id,created_by) VALUES(p_client_id,p_group_id,v_name,v_phone,v_need,v_src,v_val,v_addr,v_email,v_comp,v_cat,v_prio,v_stage,v_lost,v_owner,me);
 RETURN p_client_id;
END $$;

REVOKE ALL ON FUNCTION public.waves_company_client_set(uuid,uuid,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.waves_company_client_set(uuid,uuid,jsonb) TO authenticated,service_role;
