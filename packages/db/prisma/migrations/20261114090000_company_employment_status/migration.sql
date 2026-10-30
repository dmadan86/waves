-- Company employment status: "Employed / Not employed" for an employee, decided by the owner or the
-- employee's own manager. It REUSES the existing departed-member model (left_at + removed_at):
--   * every company read/write path already requires a live membership (left_at/removed_at NULL), so a
--     not-employed person is out of sync pull, RLS, RPCs, uploads and push with no per-table change;
--   * their entries, attendance and wages keep their member_id, so the owner's statements, totals and
--     exports are unchanged (waves_company_detail lets the company read a past member's rows);
--   * company entries are never split between members, so no re-split and no balance change.
-- New: the last working date and a short note, one RPC to end/restore, and three safety nets so a
-- not-employed person is never revived or notified by another path.
ALTER TABLE public.group_members
 ADD COLUMN employment_ended_on date,
 ADD COLUMN employment_note text,
 ADD CONSTRAINT company_member_employment_note_len CHECK(employment_note IS NULL OR length(employment_note)<=200);

-- Net 1: only the RPC below writes the two columns, and a person marked not employed can only come back
-- through it (which clears the date). Invite links, claims and direct updates cannot.
CREATE FUNCTION public.waves_company_employment_guard() RETURNS trigger
 LANGUAGE plpgsql SET search_path TO 'public','pg_temp' AS $$
BEGIN
 IF current_user IN ('anon','authenticated') AND (NEW.employment_ended_on IS DISTINCT FROM OLD.employment_ended_on OR NEW.employment_note IS DISTINCT FROM OLD.employment_note) THEN
  RAISE EXCEPTION 'FORBIDDEN_COLUMN: use the employment RPC' USING ERRCODE='insufficient_privilege'; END IF;
 IF OLD.employment_ended_on IS NOT NULL AND NEW.employment_ended_on IS NOT NULL AND (NEW.left_at IS NULL OR NEW.removed_at IS NULL) THEN
  RAISE EXCEPTION 'NOT_EMPLOYED: mark them as employed first' USING ERRCODE='check_violation'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER company_employment_guard BEFORE UPDATE ON public.group_members FOR EACH ROW EXECUTE FUNCTION public.waves_company_employment_guard();
REVOKE ALL ON FUNCTION public.waves_company_employment_guard() FROM PUBLIC,anon,authenticated;

-- Net 2: an invite (old or new) never re-activates someone marked not employed.
CREATE OR REPLACE FUNCTION public.waves_join_via_invite(p_invite_id uuid, p_profile_id uuid) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $function$
DECLARE v_vendor uuid; v_group uuid; res jsonb; v_member uuid;
BEGIN
 SELECT company_vendor_id,group_id INTO v_vendor,v_group FROM public.invites WHERE id=p_invite_id;
 IF EXISTS(SELECT 1 FROM public.group_members WHERE group_id=v_group AND profile_id=p_profile_id AND employment_ended_on IS NOT NULL) THEN
  RETURN jsonb_build_object('ok',false,'reason','REMOVED'); END IF;
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
END $function$;

-- Net 3: nothing new is notified to a person who is no longer a live member of that company
-- (a past entry being approved, a reminder, a comment...). Notifications to people who have no member
-- row yet are untouched.
CREATE OR REPLACE FUNCTION public.waves_notify(p_profile_id uuid, p_group_id uuid, p_kind text, p_title text, p_body text, p_deep_link text, p_payload jsonb, p_dedupe_key text)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $function$
DECLARE
  v_id uuid;
BEGIN
  IF p_profile_id IS NULL THEN
    RETURN NULL;
  END IF;
  IF p_group_id IS NOT NULL AND public.waves_is_company(p_group_id)
     AND EXISTS(SELECT 1 FROM public.group_members WHERE group_id=p_group_id AND profile_id=p_profile_id AND (left_at IS NOT NULL OR removed_at IS NOT NULL))
     AND NOT EXISTS(SELECT 1 FROM public.group_members WHERE group_id=p_group_id AND profile_id=p_profile_id AND left_at IS NULL AND removed_at IS NULL) THEN
    RETURN NULL;
  END IF;
  INSERT INTO public.notifications
    (profile_id, group_id, kind, title, body, deep_link, payload, channels, dedupe_key)
  VALUES
    (p_profile_id, p_group_id, p_kind, p_title, p_body, p_deep_link,
     COALESCE(p_payload, '{}'::jsonb), ARRAY['in_app']::text[], p_dedupe_key)
  ON CONFLICT (dedupe_key) DO NOTHING
  RETURNING id INTO v_id;
  RETURN v_id;
END
$function$;

-- The one door. p_employed=false ends employment (optional last day, default today, and a short note);
-- p_employed=true restores. Owner: any employee or manager (not another owner). Manager: only their own team.
-- Ending a manager moves their team to "no manager" (owner) and revokes their invites; a manager who still
-- holds company float must settle it first (MANAGER_HAS_POOL). Nothing is written to the ledger.
CREATE FUNCTION public.waves_company_employment_set(p_group_id uuid, p_member_id uuid, p_employed boolean, p_ended_on date DEFAULT NULL, p_note text DEFAULT NULL) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
DECLARE me uuid; t public.group_members%ROWTYPE; v_note text:=nullif(btrim(coalesce(p_note,'')),''); v_day date:=coalesce(p_ended_on,current_date);
BEGIN
 me:=public.waves_company_actor(p_group_id);
 IF p_employed IS NULL THEN RAISE EXCEPTION 'INVALID_DATA'; END IF;
 PERFORM 1 FROM public.groups WHERE id=p_group_id FOR UPDATE;
 SELECT * INTO t FROM public.group_members WHERE id=p_member_id AND group_id=p_group_id AND merged_into_member_id IS NULL FOR UPDATE;
 IF NOT FOUND OR t.role::text NOT IN ('member','manager') THEN RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE='insufficient_privilege'; END IF;
 IF t.id=me THEN RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE='insufficient_privilege'; END IF;
 IF NOT public.is_group_admin(p_group_id) AND NOT (t.role::text='member' AND t.manager_id=me AND EXISTS(SELECT 1 FROM public.group_members WHERE id=me AND role::text='manager')) THEN
  RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE='insufficient_privilege'; END IF;
 IF p_employed THEN
  IF t.left_at IS NULL AND t.removed_at IS NULL THEN RETURN; END IF;
  UPDATE public.group_members SET left_at=NULL,removed_at=NULL,removed_by=NULL,employment_ended_on=NULL,employment_note=NULL,updated_at=now(),
   manager_id=CASE WHEN manager_id IS NOT NULL AND public.waves_company_manager_ok(p_group_id,manager_id) THEN manager_id END
   WHERE id=t.id;
  RETURN;
 END IF;
 IF t.left_at IS NOT NULL OR t.removed_at IS NOT NULL THEN RETURN; END IF;
 IF v_day>current_date OR v_day<current_date-3650 OR length(coalesce(v_note,''))>200 THEN RAISE EXCEPTION 'INVALID_DATA' USING ERRCODE='check_violation'; END IF;
 IF t.role::text='manager' THEN
  IF (public.waves_company_pool_balance(p_group_id,t.id)->>'balance')::numeric<>0 THEN RAISE EXCEPTION 'MANAGER_HAS_POOL'; END IF;
  UPDATE public.group_members SET manager_id=NULL,updated_at=now() WHERE group_id=p_group_id AND manager_id=t.id;
  UPDATE public.invites SET revoked_at=now() WHERE group_id=p_group_id AND company_manager_id=t.id AND revoked_at IS NULL;
 END IF;
 UPDATE public.group_members SET left_at=now(),removed_at=now(),removed_by=public.waves_current_profile_id(),employment_ended_on=v_day,employment_note=v_note,updated_at=now() WHERE id=t.id;
EXCEPTION WHEN unique_violation THEN RAISE EXCEPTION 'EMPLOYEE_ID_TAKEN' USING ERRCODE='check_violation';
END $$;
REVOKE ALL ON FUNCTION public.waves_company_employment_set(uuid,uuid,boolean,date,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.waves_company_employment_set(uuid,uuid,boolean,date,text) TO authenticated,service_role;

-- Managers (and owners) keep seeing the not-employed people they may restore: their rows and history stay in scope.
CREATE OR REPLACE FUNCTION public.waves_company_people(p_group_id uuid)
 RETURNS TABLE(member_id uuid,display_name text,role text,manager_id uuid,detail boolean)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
DECLARE actor uuid; own_manager uuid; owner boolean; manager boolean;
BEGIN
 actor:=public.waves_company_actor(p_group_id);
 SELECT m.manager_id,m.role::text='admin',m.role::text='manager' INTO own_manager,owner,manager FROM public.group_members m WHERE m.id=actor;
 RETURN QUERY SELECT m.id,coalesce(p.display_name,m.ghost_name,'Someone'),m.role::text,m.manager_id,public.waves_company_detail(p_group_id,m.id)
 FROM public.group_members m LEFT JOIN public.profiles p ON p.id=m.profile_id
 WHERE m.group_id=p_group_id AND ((m.left_at IS NULL AND m.removed_at IS NULL) OR m.employment_ended_on IS NOT NULL) AND m.merged_into_member_id IS NULL
 AND (owner OR m.id=actor OR m.role::text='admin' OR (manager AND m.role::text='member' AND m.manager_id=actor) OR m.id=own_manager)
 ORDER BY m.id;
END $$;
