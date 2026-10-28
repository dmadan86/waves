-- Phase 2: private company evidence and explicit review. No personal entitlement changes.
ALTER TABLE public.groups
 ADD COLUMN company_default_daily_rate_minor bigint CHECK (company_default_daily_rate_minor >= 0),
 ADD COLUMN company_approvals_enabled boolean NOT NULL DEFAULT false,
 ADD CONSTRAINT groups_company_settings CHECK (type = 'company' OR
  (company_default_daily_rate_minor IS NULL AND NOT company_approvals_enabled));
ALTER TABLE public.company_entries
 ADD COLUMN review_note text CHECK (length(review_note) <= 500),
 ADD COLUMN reviewed_by uuid REFERENCES public.group_members(id),
 ADD COLUMN reviewed_at timestamptz,
 ADD CONSTRAINT company_entries_id_group_unique UNIQUE(id,group_id);
ALTER TABLE public.group_members ADD CONSTRAINT company_members_id_group_unique UNIQUE(id,group_id);
CREATE TABLE public.company_plans (
 group_id uuid PRIMARY KEY REFERENCES public.groups(id) ON DELETE CASCADE,
 plan text NOT NULL DEFAULT 'free',
 owner_profile_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
 storage_quota_bytes bigint CHECK(storage_quota_bytes >= 0),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.company_plans ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.company_plans FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.company_plans TO service_role;
INSERT INTO public.company_plans(group_id,owner_profile_id)
 SELECT id,created_by FROM public.groups WHERE type='company';
CREATE TABLE public.company_entry_attachments (
 id uuid PRIMARY KEY, entry_id uuid NOT NULL, group_id uuid NOT NULL,
 uploader_member_id uuid NOT NULL,
 storage_path text NOT NULL UNIQUE,
 preview text CHECK(preview IS NULL OR (length(preview)<=4096 AND preview ~ '^data:image/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$')),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 deleted_at timestamptz, updated_seq bigint NOT NULL DEFAULT 0,
 FOREIGN KEY(entry_id,group_id) REFERENCES public.company_entries(id,group_id) ON DELETE CASCADE,
 FOREIGN KEY(uploader_member_id,group_id) REFERENCES public.group_members(id,group_id),
 CHECK(storage_path ~ ('^' || entry_id::text || '/' || id::text || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$'))
);
CREATE INDEX company_entry_attachments_group_seq_idx ON public.company_entry_attachments(group_id,updated_seq);
CREATE INDEX company_entry_attachments_entry_deleted_idx ON public.company_entry_attachments(entry_id,deleted_at);
CREATE TRIGGER company_entry_attachments_stamp BEFORE INSERT OR UPDATE ON public.company_entry_attachments
 FOR EACH ROW EXECUTE FUNCTION public.waves_stamp_seq();
ALTER TABLE public.company_entry_attachments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.company_entry_attachments FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.company_entry_attachments TO authenticated;
GRANT ALL ON public.company_entry_attachments TO service_role;
ALTER TABLE public.storage_objects
 ADD COLUMN company_group_id uuid REFERENCES public.groups(id) ON DELETE CASCADE,
 ALTER COLUMN owner_profile_id DROP NOT NULL,
 DROP CONSTRAINT storage_objects_owner_profile_id_fkey,
 ADD CONSTRAINT storage_objects_owner_profile_id_fkey FOREIGN KEY(owner_profile_id) REFERENCES public.profiles(id) ON DELETE SET NULL,
 ADD CONSTRAINT storage_objects_company_scope CHECK (
  (logical_bucket='company-entry-images' AND company_group_id IS NOT NULL AND group_id IS NOT NULL
   AND company_group_id=group_id AND NOT counted) OR
  (logical_bucket<>'company-entry-images' AND company_group_id IS NULL));
CREATE INDEX storage_objects_company_idx ON public.storage_objects(company_group_id);
-- A retired key stays retired even after the durable deletion queue is drained.
CREATE TABLE public.company_image_keys (
 path text PRIMARY KEY, group_id uuid REFERENCES public.groups(id) ON DELETE SET NULL
);
ALTER TABLE public.company_image_keys ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.company_image_keys FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.company_image_keys TO service_role;

CREATE FUNCTION public.waves_can_read_company_entry(p_entry_id uuid) RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $fn$
 SELECT EXISTS(SELECT 1 FROM public.company_entries e JOIN public.groups g ON g.id=e.group_id
 WHERE e.id=p_entry_id AND g.type='company' AND g.deleted_at IS NULL
 AND public.is_group_member(g.id) AND
 (public.is_group_admin(g.id) OR e.member_id=public.waves_my_member_id(g.id)));
$fn$;
CREATE POLICY company_entry_attachments_select ON public.company_entry_attachments FOR SELECT TO authenticated USING(public.waves_can_read_company_entry(entry_id));

CREATE FUNCTION public.waves_company_plan(p_group_id uuid) RETURNS TABLE(plan text,storage_quota_bytes bigint)
 LANGUAGE plpgsql  SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $fn$
BEGIN
 PERFORM public.waves_company_actor(p_group_id);
 IF NOT EXISTS(SELECT 1 FROM public.groups WHERE id=p_group_id AND deleted_at IS NULL) THEN RAISE EXCEPTION 'NOT_A_MEMBER'; END IF;
 RETURN QUERY SELECT cp.plan,cp.storage_quota_bytes FROM public.company_plans cp WHERE cp.group_id=p_group_id;
END
$fn$;

CREATE FUNCTION public.waves_company_storage_usage(p_group_id uuid) RETURNS TABLE(used_bytes bigint,reserved_bytes bigint,quota_bytes bigint)
 LANGUAGE plpgsql  SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $fn$
BEGIN
 PERFORM public.waves_company_actor(p_group_id);
 IF NOT EXISTS(SELECT 1 FROM public.groups WHERE id=p_group_id AND deleted_at IS NULL) THEN RAISE EXCEPTION 'NOT_A_MEMBER' USING ERRCODE='insufficient_privilege'; END IF;
 IF NOT public.is_group_admin(p_group_id) THEN RAISE EXCEPTION 'ADMIN_ONLY' USING ERRCODE='insufficient_privilege'; END IF;
 RETURN QUERY SELECT coalesce(sum(o.bytes) FILTER(WHERE NOT o.pending),0)::bigint,
 coalesce(sum(o.bytes) FILTER(WHERE o.pending),0)::bigint,
 (SELECT cp.storage_quota_bytes FROM public.company_plans cp WHERE cp.group_id=p_group_id)
 FROM public.storage_objects o WHERE o.company_group_id=p_group_id;
END
$fn$;

CREATE FUNCTION public.waves_company_settings_set(p_group_id uuid,p_default_daily_rate_minor bigint,p_approvals_enabled boolean) RETURNS void
 LANGUAGE plpgsql  SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $fn$
BEGIN
 PERFORM public.waves_company_actor(p_group_id);
 IF NOT EXISTS(SELECT 1 FROM public.groups WHERE id=p_group_id AND deleted_at IS NULL) THEN RAISE EXCEPTION 'NOT_A_MEMBER' USING ERRCODE='insufficient_privilege'; END IF;
 IF NOT public.is_group_admin(p_group_id) THEN RAISE EXCEPTION 'ADMIN_ONLY' USING ERRCODE='insufficient_privilege'; END IF;
 UPDATE public.groups SET company_default_daily_rate_minor=p_default_daily_rate_minor,
 company_approvals_enabled=p_approvals_enabled,updated_at=now() WHERE id=p_group_id AND deleted_at IS NULL;
 IF NOT FOUND THEN RAISE EXCEPTION 'NOT_A_MEMBER'; END IF;
END
$fn$;

CREATE FUNCTION public.waves_company_review_guard() RETURNS trigger
 LANGUAGE plpgsql  SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $fn$
BEGIN
 IF NEW.deleted_at IS NULL AND NOT EXISTS(SELECT 1 FROM public.groups WHERE id=NEW.group_id AND deleted_at IS NULL) THEN RAISE EXCEPTION 'GROUP_DELETED'; END IF;
 IF TG_OP='INSERT' THEN
  IF (SELECT company_approvals_enabled FROM public.groups WHERE id=NEW.group_id) THEN NEW.status:='submitted'; END IF;
 ELSIF NEW.deleted_at IS NULL AND
  (to_jsonb(NEW)-ARRAY['status','review_note','reviewed_by','reviewed_at','version','updated_by','updated_at','updated_seq'])
  IS DISTINCT FROM
  (to_jsonb(OLD)-ARRAY['status','review_note','reviewed_by','reviewed_at','version','updated_by','updated_at','updated_seq'])
  AND (SELECT company_approvals_enabled FROM public.groups WHERE id=NEW.group_id) THEN
  NEW.status:='submitted'; NEW.review_note:=NULL; NEW.reviewed_by:=NULL; NEW.reviewed_at:=NULL;
 ELSIF NEW.deleted_at IS NULL AND OLD.status='rejected' AND NEW.status='rejected'
  AND (to_jsonb(NEW)-ARRAY['status','review_note','reviewed_by','reviewed_at','version','updated_by','updated_at','updated_seq'])
  IS DISTINCT FROM
  (to_jsonb(OLD)-ARRAY['status','review_note','reviewed_by','reviewed_at','version','updated_by','updated_at','updated_seq']) THEN
  -- Approvals are off and a rejected claim was edited: it is approved again, not stuck out of the balance.
  NEW.status:='approved'; NEW.review_note:=NULL; NEW.reviewed_by:=NULL; NEW.reviewed_at:=NULL;
 END IF;
 RETURN NEW;
END
$fn$;
CREATE TRIGGER company_review_guard BEFORE INSERT OR UPDATE ON public.company_entries FOR EACH ROW EXECUTE FUNCTION public.waves_company_review_guard();
DROP FUNCTION public.waves_company_entry_transition(uuid,text);

CREATE FUNCTION public.waves_company_entry_transition(p_entry_id uuid,p_to text,p_note text DEFAULT NULL,p_expected_version integer DEFAULT NULL) RETURNS void
 LANGUAGE plpgsql  SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $fn$
DECLARE r public.company_entries%ROWTYPE; actor uuid;
BEGIN
 SELECT * INTO r FROM public.company_entries WHERE id=p_entry_id FOR UPDATE;
 actor:=public.waves_company_actor(r.group_id);
 IF NOT public.is_group_admin(r.group_id) THEN RAISE EXCEPTION 'ADMIN_ONLY' USING ERRCODE='insufficient_privilege'; END IF;
 IF r.deleted_at IS NOT NULL OR r.status<>'submitted' OR p_to IS NULL OR p_to NOT IN ('approved','rejected') THEN RAISE EXCEPTION 'INVALID_TRANSITION' USING ERRCODE='check_violation'; END IF;
 IF p_expected_version IS NULL OR p_expected_version<>r.version THEN RAISE EXCEPTION 'VERSION_CONFLICT: entry changed; refresh before review' USING ERRCODE='check_violation'; END IF;
 IF p_to='rejected' AND (p_note IS NULL OR p_note !~ '[^[:space:]]') THEN RAISE EXCEPTION 'REVIEW_NOTE_REQUIRED: explain the rejection' USING ERRCODE='check_violation'; END IF;
 UPDATE public.company_entries SET status=p_to,review_note=nullif(btrim(p_note),''),reviewed_by=actor,
 reviewed_at=now(),version=version+1,updated_by=actor,updated_at=now() WHERE id=p_entry_id;
END
$fn$;

CREATE FUNCTION public.waves_company_evidence_changed(p_entry_id uuid,p_actor uuid) RETURNS void
 LANGUAGE plpgsql  SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $fn$
BEGIN
 UPDATE public.company_entries e SET version=version+1,updated_at=now(),updated_by=p_actor,
 status=CASE WHEN g.company_approvals_enabled THEN 'submitted' ELSE e.status END,
 review_note=CASE WHEN g.company_approvals_enabled THEN NULL ELSE e.review_note END,
 reviewed_by=CASE WHEN g.company_approvals_enabled THEN NULL ELSE e.reviewed_by END,
 reviewed_at=CASE WHEN g.company_approvals_enabled THEN NULL ELSE e.reviewed_at END
 FROM public.groups g WHERE e.id=p_entry_id AND g.id=e.group_id AND e.deleted_at IS NULL;
END
$fn$;

CREATE FUNCTION public.waves_attach_company_entry_image(p_entry_id uuid,p_storage_path text,p_attachment_id uuid,p_preview text DEFAULT NULL) RETURNS uuid
 LANGUAGE plpgsql  SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $fn$
DECLARE e public.company_entries%ROWTYPE; a public.company_entry_attachments%ROWTYPE; actor uuid; o public.storage_objects%ROWTYPE;
BEGIN
 SELECT * INTO e FROM public.company_entries WHERE id=p_entry_id FOR UPDATE;
 actor:=public.waves_company_actor(e.group_id);
 IF e.deleted_at IS NOT NULL OR NOT public.waves_can_read_company_entry(e.id) THEN RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE='insufficient_privilege'; END IF;
 SELECT * INTO a FROM public.company_entry_attachments WHERE id=p_attachment_id;
 IF FOUND THEN
  IF a.entry_id=e.id AND a.storage_path=p_storage_path AND a.uploader_member_id=actor
   AND a.preview IS NOT DISTINCT FROM public.waves_clean_image_preview(p_preview) AND a.deleted_at IS NULL THEN RETURN a.id; END IF;
  RAISE EXCEPTION 'ATTACHMENT_CONFLICT' USING ERRCODE='check_violation';
 END IF;
 IF (SELECT count(*) FROM public.company_entry_attachments WHERE entry_id=e.id AND deleted_at IS NULL)>=10 THEN RAISE EXCEPTION 'ATTACHMENT_LIMIT'; END IF;
 SELECT * INTO o FROM public.storage_objects WHERE logical_bucket='company-entry-images' AND path=p_storage_path FOR UPDATE;
 PERFORM public.waves_require_committed_object('company-entry-images',p_storage_path);
 IF o.company_group_id IS DISTINCT FROM e.group_id OR o.owner_profile_id IS DISTINCT FROM public.waves_current_profile_id() THEN RAISE EXCEPTION 'NOT_UPLOADER' USING ERRCODE='insufficient_privilege'; END IF;
 INSERT INTO public.company_entry_attachments(id,entry_id,group_id,uploader_member_id,storage_path,preview)
 VALUES(p_attachment_id,e.id,e.group_id,actor,p_storage_path,public.waves_clean_image_preview(p_preview));
 PERFORM public.waves_company_evidence_changed(e.id,actor);
 RETURN p_attachment_id;
END
$fn$;

CREATE FUNCTION public.waves_remove_company_entry_image(p_attachment_id uuid) RETURNS void
 LANGUAGE plpgsql  SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $fn$
DECLARE a public.company_entry_attachments%ROWTYPE; actor uuid;
BEGIN
 SELECT * INTO a FROM public.company_entry_attachments WHERE id=p_attachment_id;
 PERFORM 1 FROM public.company_entries WHERE id=a.entry_id FOR UPDATE;
 SELECT * INTO a FROM public.company_entry_attachments WHERE id=p_attachment_id FOR UPDATE;
 actor:=public.waves_company_actor(a.group_id);
 IF NOT public.waves_can_read_company_entry(a.entry_id) OR (a.uploader_member_id<>actor AND NOT public.is_group_admin(a.group_id)) THEN RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE='insufficient_privilege'; END IF;
 IF a.deleted_at IS NOT NULL THEN RETURN; END IF;
 UPDATE public.company_entry_attachments SET deleted_at=now(),updated_at=now() WHERE id=a.id;
 DELETE FROM public.storage_objects WHERE logical_bucket='company-entry-images' AND path IN(a.storage_path,a.storage_path||'.thumb.jpg');
 PERFORM public.waves_company_evidence_changed(a.entry_id,actor);
END
$fn$;

CREATE FUNCTION public.waves_company_entry_image_cleanup() RETURNS trigger
 LANGUAGE plpgsql  SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $fn$
BEGIN
 IF TG_OP='DELETE' OR (NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL) THEN
  UPDATE public.company_entry_attachments SET deleted_at=coalesce(deleted_at,now()),updated_at=now() WHERE entry_id=OLD.id AND deleted_at IS NULL;
  DELETE FROM public.storage_objects WHERE logical_bucket='company-entry-images' AND split_part(path,'/',1)=OLD.id::text;
 END IF;
 RETURN OLD;
END
$fn$;
CREATE TRIGGER company_entry_image_cleanup AFTER UPDATE OF deleted_at OR DELETE ON public.company_entries FOR EACH ROW EXECUTE FUNCTION public.waves_company_entry_image_cleanup();

CREATE FUNCTION public.waves_company_group_lifecycle() RETURNS trigger
 LANGUAGE plpgsql  SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $fn$
BEGIN
 IF TG_OP='INSERT' THEN
  IF NEW.type='company' THEN INSERT INTO public.company_plans(group_id,owner_profile_id) VALUES(NEW.id,NEW.created_by); END IF;
 ELSIF NEW.type='company' AND NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL THEN
  UPDATE public.company_entry_attachments SET deleted_at=coalesce(deleted_at,now()),updated_at=now() WHERE group_id=NEW.id AND deleted_at IS NULL;
  DELETE FROM public.storage_objects WHERE company_group_id=NEW.id;
 END IF;
 RETURN NEW;
END
$fn$;
CREATE TRIGGER company_group_lifecycle AFTER INSERT OR UPDATE OF deleted_at ON public.groups FOR EACH ROW EXECUTE FUNCTION public.waves_company_group_lifecycle();

-- Only service callers can reserve/commit. Resolve scope again inside the DB.
CREATE FUNCTION public.waves_company_storage_write(
 p_profile_id uuid,p_group_id uuid,p_path text,p_bytes bigint,p_content_type text,p_commit boolean
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $fn$
DECLARE e public.company_entries%ROWTYPE; o public.storage_objects%ROWTYPE;
 base text:=regexp_replace(p_path,'\.thumb\.jpg$',''); quota bigint; used bigint;
BEGIN
 IF p_bytes IS NULL OR p_bytes<=0 OR p_bytes>12582912 OR p_profile_id IS NULL
  OR p_content_type NOT IN ('image/jpeg','image/png','image/webp','image/heic','image/heif')
  OR p_path !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg(\.thumb\.jpg)?$' THEN RAISE EXCEPTION 'STORAGE_BAD_INPUT'; END IF;
 SELECT * INTO e FROM public.company_entries WHERE id=split_part(base,'/',1)::uuid FOR UPDATE;
 IF e.id IS NULL OR e.deleted_at IS NOT NULL OR e.group_id IS DISTINCT FROM p_group_id OR NOT EXISTS(
  SELECT 1 FROM public.groups g JOIN public.group_members m ON m.group_id=g.id
  WHERE g.id=e.group_id AND g.type='company' AND g.deleted_at IS NULL AND m.profile_id=p_profile_id
   AND m.left_at IS NULL AND (m.id=e.member_id OR m.role='admin')
 ) THEN RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE='insufficient_privilege'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('company-storage:'||e.group_id::text,0));
 SELECT * INTO o FROM public.storage_objects WHERE logical_bucket='company-entry-images' AND path=p_path FOR UPDATE;
 IF o.path IS NOT NULL AND o.owner_profile_id IS DISTINCT FROM p_profile_id AND NOT EXISTS(
  SELECT 1 FROM public.group_members WHERE group_id=e.group_id AND profile_id=p_profile_id AND left_at IS NULL AND role='admin'
 ) THEN RAISE EXCEPTION 'NOT_UPLOADER' USING ERRCODE='insufficient_privilege'; END IF;
 IF NOT p_commit AND o.path IS NOT NULL AND NOT o.pending THEN RAISE EXCEPTION 'IMMUTABLE_OBJECT'; END IF;
 IF p_commit AND (o.path IS NULL OR NOT o.pending) THEN
  IF o.path IS NOT NULL AND NOT o.pending AND o.bytes=p_bytes AND o.content_type=p_content_type THEN RETURN; END IF;
  RAISE EXCEPTION 'RESERVATION_REQUIRED';
 END IF;
 IF p_path<>base THEN
  IF p_bytes>524288 OR p_content_type<>'image/jpeg' OR NOT EXISTS(
   SELECT 1 FROM public.storage_objects WHERE logical_bucket='company-entry-images' AND path=base AND NOT pending AND company_group_id=e.group_id
  ) THEN RAISE EXCEPTION 'NO_ORIGINAL'; END IF;
 END IF;
 IF o.path IS NULL THEN
  INSERT INTO public.company_image_keys(path,group_id) VALUES(p_path,e.group_id);
 END IF;
 IF NOT p_commit AND (SELECT count(*) FROM public.storage_objects WHERE company_group_id=e.group_id AND owner_profile_id=p_profile_id AND pending AND path<>p_path)>=16 THEN RAISE EXCEPTION 'STORAGE_TOO_MANY_PENDING'; END IF;
 SELECT storage_quota_bytes INTO quota FROM public.company_plans WHERE group_id=e.group_id;
 SELECT coalesce(sum(bytes),0) INTO used FROM public.storage_objects WHERE company_group_id=e.group_id AND path<>p_path;
 IF quota IS NOT NULL AND used+p_bytes>quota THEN RAISE EXCEPTION 'STORAGE_CAP'; END IF;
 INSERT INTO public.storage_objects(logical_bucket,path,owner_profile_id,group_id,company_group_id,bytes,content_type,counted,pending)
 VALUES('company-entry-images',p_path,p_profile_id,e.group_id,e.group_id,p_bytes,p_content_type,false,NOT p_commit)
 ON CONFLICT(logical_bucket,path) DO UPDATE SET bytes=excluded.bytes,content_type=excluded.content_type,
 pending=excluded.pending,updated_at=now();
END $fn$;

CREATE OR REPLACE FUNCTION public.waves_storage_reserve(p_profile_id uuid, p_group_id uuid, p_logical_bucket text, p_path text, p_bytes bigint, p_content_type text DEFAULT 'image/webp'::text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_counted       boolean;
  v_used          bigint;
  v_pending_count integer;
BEGIN
  IF p_logical_bucket='company-entry-images' THEN
    PERFORM public.waves_company_storage_write(p_profile_id,p_group_id,p_path,p_bytes,p_content_type,false);
    RETURN;
  END IF;

  IF p_profile_id IS NULL OR p_bytes IS NULL OR p_bytes < 0 THEN
    RAISE EXCEPTION 'STORAGE_BAD_INPUT' USING ERRCODE = 'check_violation';
  END IF;

  -- Serialise every reserve/commit for this owner so the cap check and the write
  -- are one indivisible step.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_profile_id::text, 0));

  v_counted := public.waves_storage_counts(p_profile_id, p_group_id);

  IF v_counted THEN
    -- Bound abandoned reservations (see the note above). A re-reservation of the
    -- same object is a replacement, not a new pending, so it is excluded.
    SELECT count(*) INTO v_pending_count
      FROM public.storage_objects
     WHERE owner_profile_id = p_profile_id
       AND pending
       AND company_group_id IS NULL
       AND NOT (logical_bucket = p_logical_bucket AND path = p_path);
    IF v_pending_count >= 8 THEN
      RAISE EXCEPTION 'STORAGE_TOO_MANY_PENDING'
        USING ERRCODE = 'check_violation',
              HINT = 'Too many uploads in flight; finish or wait a moment.';
    END IF;

    SELECT COALESCE(SUM(bytes), 0) INTO v_used
      FROM public.storage_objects
     WHERE owner_profile_id = p_profile_id
       AND counted
       AND NOT (logical_bucket = p_logical_bucket AND path = p_path);

    IF v_used + p_bytes > public.waves_free_storage_cap() THEN
      RAISE EXCEPTION 'STORAGE_CAP'
        USING ERRCODE = 'check_violation',
              HINT = 'You have reached your free storage limit; upgrade to add more.';
    END IF;
  END IF;

  INSERT INTO public.storage_objects
    (logical_bucket, path, owner_profile_id, group_id, bytes, content_type, counted, pending)
  VALUES
    (p_logical_bucket, p_path, p_profile_id, p_group_id, p_bytes, p_content_type, v_counted, true)
  ON CONFLICT (logical_bucket, path) DO UPDATE
    SET owner_profile_id = excluded.owner_profile_id,
        group_id         = excluded.group_id,
        bytes            = excluded.bytes,
        content_type     = excluded.content_type,
        counted          = excluded.counted,
        pending          = true,
        updated_at       = now()
    -- Only ever refresh an existing *reservation*. A committed object at this
    -- path (a replacement) is left exactly as it is: its row must not flip to
    -- pending, because if this upload is then abandoned or refused the failure
    -- cleanup would delete the row and strand — or destroy — the good image that
    -- is already there. The cap check above already excludes this same path, so a
    -- replacement is still measured as a delta; only the write is withheld.
    WHERE storage_objects.pending;
END
$$;

CREATE OR REPLACE FUNCTION public.waves_storage_record(
  p_profile_id uuid,
  p_group_id uuid,
  p_logical_bucket text,
  p_path text,
  p_bytes bigint,
  p_content_type text DEFAULT 'image/webp'::text
) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_counted boolean;
  v_used    bigint;
BEGIN
  IF p_logical_bucket='company-entry-images' THEN
    PERFORM public.waves_company_storage_write(p_profile_id,p_group_id,p_path,p_bytes,p_content_type,true);
    RETURN;
  END IF;

  IF p_profile_id IS NULL OR p_bytes IS NULL OR p_bytes < 0 THEN
    RAISE EXCEPTION 'STORAGE_BAD_INPUT' USING ERRCODE = 'check_violation';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_profile_id::text, 0));

  v_counted := public.waves_storage_counts(p_profile_id, p_group_id);

  IF v_counted THEN
    -- The true-size cap check, excluding this same object so a replacement
    -- measures the delta, not double.
    SELECT COALESCE(SUM(bytes), 0) INTO v_used
      FROM public.storage_objects
     WHERE owner_profile_id = p_profile_id
       AND counted
       AND NOT (logical_bucket = p_logical_bucket AND path = p_path);

    -- Reject only a *new* object over the ceiling. A replacement of an object
    -- already committed at this path is recorded honestly even if its true size
    -- lands over the cap (see the baseline for the reasoning).
    IF v_used + p_bytes > public.waves_free_storage_cap()
       AND NOT EXISTS (
         SELECT 1 FROM public.storage_objects
          WHERE logical_bucket = p_logical_bucket AND path = p_path AND NOT pending
       )
    THEN
      RAISE EXCEPTION 'STORAGE_CAP'
        USING ERRCODE = 'check_violation',
              HINT = 'You have reached your free storage limit; upgrade to add more.';
    END IF;
  END IF;

  INSERT INTO public.storage_objects
    (logical_bucket, path, owner_profile_id, group_id, bytes, content_type, counted, pending)
  VALUES
    (p_logical_bucket, p_path, p_profile_id, p_group_id, p_bytes, p_content_type, v_counted, false)
  ON CONFLICT (logical_bucket, path) DO UPDATE
    SET owner_profile_id = CASE
                             WHEN storage_objects.pending THEN excluded.owner_profile_id
                             ELSE storage_objects.owner_profile_id
                           END,
        group_id         = excluded.group_id,
        bytes            = excluded.bytes,
        content_type     = excluded.content_type,
        counted          = CASE
                             WHEN storage_objects.pending THEN excluded.counted
                             ELSE public.waves_storage_counts(
                                    storage_objects.owner_profile_id, excluded.group_id)
                           END,
        pending          = false,
        updated_at       = now();
END
$$;

CREATE OR REPLACE FUNCTION public.waves_storage_recount(p_logical_bucket text, p_path text, p_bytes bigint, p_content_type text DEFAULT 'image/webp'::text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
BEGIN
  IF p_bytes IS NULL OR p_bytes < 0 THEN
    RAISE EXCEPTION 'STORAGE_BAD_INPUT' USING ERRCODE = 'check_violation';
  END IF;

  UPDATE public.storage_objects
     SET bytes        = p_bytes,
         content_type = p_content_type,
         counted      = CASE WHEN logical_bucket='company-entry-images' OR owner_profile_id IS NULL THEN false ELSE public.waves_storage_counts(owner_profile_id, group_id) END,
         updated_at   = now()
   WHERE logical_bucket = p_logical_bucket
     AND path = p_path
     AND NOT pending;
END
$$;

DROP FUNCTION public.waves_create_group(text,text,character,text,boolean,uuid,text,character,uuid);
CREATE OR REPLACE FUNCTION public.waves_create_group(p_name text DEFAULT NULL::text, p_type text DEFAULT 'other'::text, p_currency character DEFAULT 'INR'::bpchar, p_emoji text DEFAULT NULL::text, p_simplify boolean DEFAULT true, p_group_id uuid DEFAULT NULL::uuid, p_photo_path text DEFAULT NULL::text, p_country character DEFAULT NULL::bpchar, p_creator_member_id uuid DEFAULT NULL::uuid, p_company_default_daily_rate_minor bigint DEFAULT NULL) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_profile_id uuid := public.waves_current_profile_id();
  v_group_id   uuid;
  v_member_id  uuid;
  v_name       text := nullif(btrim(coalesce(p_name, '')), '');
  v_country    char(2) := nullif(btrim(upper(coalesce(p_country, ''))), '');
  v_is_guest   boolean;
  v_created_at timestamptz;
  v_group_count integer;
BEGIN
  IF v_profile_id IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED: a group needs an owner'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = v_profile_id) THEN
    RAISE EXCEPTION 'NO_PROFILE: profile % does not exist', v_profile_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  IF p_group_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.groups WHERE id = p_group_id) THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.group_members gm
      WHERE gm.group_id = p_group_id AND gm.profile_id = v_profile_id AND gm.left_at IS NULL
    ) THEN
      RAISE EXCEPTION 'GROUP_EXISTS: that group id is already taken'
        USING ERRCODE = 'unique_violation';
    END IF;
    RETURN p_group_id;
  END IF;

  IF to_regclass('auth.users') IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'auth'
         AND table_name = 'users'
         AND column_name = 'is_anonymous'
     ) THEN
    SELECT u.is_anonymous, u.created_at
      INTO v_is_guest, v_created_at
      FROM auth.users u
      WHERE u.id = v_profile_id;

    IF coalesce(v_is_guest, false) THEN
      IF now() >= v_created_at + interval '10 days' THEN
        RAISE EXCEPTION 'GUEST_TRIAL_EXPIRED: sign up to keep using Waves'
          USING ERRCODE = 'insufficient_privilege';
      END IF;

      SELECT count(*) INTO v_group_count
        FROM public.group_members
        WHERE profile_id = v_profile_id AND left_at IS NULL;

      IF v_group_count >= 1 THEN
        RAISE EXCEPTION 'GUEST_GROUP_LIMIT: sign up to be in more than one group'
          USING ERRCODE = 'insufficient_privilege';
      END IF;
    END IF;
  END IF;

  INSERT INTO public.groups
    (id, name, type, default_currency, cover_emoji, simplify_debts, created_by, photo_path,
     country_code, convert_to_group_currency, company_default_daily_rate_minor)
  VALUES
    (COALESCE(p_group_id, gen_random_uuid()), v_name, p_type::"GroupType",
     upper(p_currency), p_emoji, p_simplify, v_profile_id, p_photo_path,
     COALESCE(v_country, (SELECT country_code FROM public.profiles WHERE id = v_profile_id)),
     true, p_company_default_daily_rate_minor)
  RETURNING id INTO v_group_id;

  INSERT INTO public.group_members (id, group_id, profile_id, role, joined_via)
  VALUES (COALESCE(p_creator_member_id, gen_random_uuid()), v_group_id, v_profile_id, 'admin', 'creator')
  RETURNING id INTO v_member_id;

  INSERT INTO public.activity_log (group_id, actor_member_id, verb, object_type, object_id, payload)
  VALUES (v_group_id, v_member_id, 'created', 'group', v_group_id,
          jsonb_build_object('name', v_name));

  RETURN v_group_id;
END
$$;
CREATE OR REPLACE FUNCTION public.waves_company_entry_values(p_kind text, p_member uuid, p_data jsonb)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
DECLARE v_mode text := COALESCE(p_data->>'calcMode', CASE WHEN p_kind = 'allowance' THEN 'days_rate' ELSE 'typed' END);
 v_days numeric(8,2); v_rate bigint; v_amount bigint; v_direction text;
BEGIN
 IF NOT EXISTS (SELECT 1 FROM public.group_members m WHERE m.id = p_member
  AND public.waves_company_actor(m.group_id) IS NOT NULL
  AND (m.id = public.waves_my_member_id(m.group_id) OR public.is_group_admin(m.group_id))) THEN
  RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE = 'insufficient_privilege';
 END IF;
 IF jsonb_typeof(p_data) IS DISTINCT FROM 'object' OR EXISTS (
  SELECT 1 FROM jsonb_object_keys(p_data) k WHERE k NOT IN ('amount','category','days','rateMinor','calcMode','occurredOn','note','direction')
 ) THEN RAISE EXCEPTION 'INVALID_DATA' USING ERRCODE = 'check_violation'; END IF;
 IF v_mode = 'days_rate' THEN
  v_days := (p_data->>'days')::numeric;
  v_rate := (p_data->>'rateMinor')::bigint;
  IF v_rate IS NULL THEN SELECT coalesce(m.daily_rate_minor,g.company_default_daily_rate_minor) INTO v_rate FROM public.group_members m JOIN public.groups g ON g.id=m.group_id WHERE m.id=p_member; END IF;
  IF v_rate IS NULL OR v_rate < 0 OR v_days IS NULL OR v_days <= 0 THEN
   RAISE EXCEPTION 'INVALID_RATE: days and rate required' USING ERRCODE = 'check_violation';
  END IF;
  v_amount := round(v_days * v_rate)::bigint;
 ELSE v_amount := (p_data->>'amount')::bigint;
 END IF;
 IF p_data->>'occurredOn' IS NULL OR (p_data->>'occurredOn') !~ '^\d{4}-\d{2}-\d{2}$' THEN
  RAISE EXCEPTION 'INVALID_DATE' USING ERRCODE = 'check_violation';
 END IF;
 IF p_kind = 'reimbursement' THEN v_direction := COALESCE(p_data->>'direction','company_to_employee');
 ELSE v_direction := p_data->>'direction'; END IF;
 RETURN p_data || jsonb_build_object('amount',v_amount,'calcMode',v_mode,'days',v_days,'rateMinor',v_rate,'direction',v_direction);
END $$;

REVOKE ALL ON FUNCTION public.waves_can_read_company_entry(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.waves_can_read_company_entry(uuid) TO authenticated,service_role;

REVOKE ALL ON FUNCTION public.waves_company_plan(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.waves_company_plan(uuid) TO authenticated,service_role;

REVOKE ALL ON FUNCTION public.waves_company_storage_usage(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.waves_company_storage_usage(uuid) TO authenticated,service_role;

REVOKE ALL ON FUNCTION public.waves_company_settings_set(uuid,bigint,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.waves_company_settings_set(uuid,bigint,boolean) TO authenticated,service_role;

REVOKE ALL ON FUNCTION public.waves_company_review_guard() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.waves_company_review_guard() TO service_role;

REVOKE ALL ON FUNCTION public.waves_company_entry_transition(uuid,text,text,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.waves_company_entry_transition(uuid,text,text,integer) TO authenticated,service_role;

REVOKE ALL ON FUNCTION public.waves_company_evidence_changed(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.waves_company_evidence_changed(uuid,uuid) TO service_role;

REVOKE ALL ON FUNCTION public.waves_attach_company_entry_image(uuid,text,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.waves_attach_company_entry_image(uuid,text,uuid,text) TO authenticated,service_role;

REVOKE ALL ON FUNCTION public.waves_remove_company_entry_image(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.waves_remove_company_entry_image(uuid) TO authenticated,service_role;

REVOKE ALL ON FUNCTION public.waves_company_entry_image_cleanup() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.waves_company_entry_image_cleanup() TO service_role;

REVOKE ALL ON FUNCTION public.waves_company_group_lifecycle() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.waves_company_group_lifecycle() TO service_role;

REVOKE ALL ON FUNCTION public.waves_company_storage_write(uuid,uuid,text,bigint,text,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.waves_company_storage_write(uuid,uuid,text,bigint,text,boolean) TO service_role;

REVOKE ALL ON FUNCTION public.waves_storage_reserve(uuid,uuid,text,text,bigint,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.waves_storage_reserve(uuid,uuid,text,text,bigint,text) TO service_role;

REVOKE ALL ON FUNCTION public.waves_storage_record(uuid,uuid,text,text,bigint,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.waves_storage_record(uuid,uuid,text,text,bigint,text) TO service_role;

REVOKE ALL ON FUNCTION public.waves_storage_recount(text,text,bigint,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.waves_storage_recount(text,text,bigint,text) TO service_role;

REVOKE ALL ON FUNCTION public.waves_create_group(text,text,character,text,boolean,uuid,text,character,uuid,bigint) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.waves_create_group(text,text,character,text,boolean,uuid,text,character,uuid,bigint) TO authenticated,service_role;

-- Defense in depth: no Supabase Storage policy may expose this R2-only bucket.
DO $storage$ BEGIN
 IF to_regclass('storage.objects') IS NOT NULL THEN
  EXECUTE 'CREATE POLICY company_images_never_storage ON storage.objects AS RESTRICTIVE FOR ALL TO public USING (bucket_id <> ''company-entry-images'') WITH CHECK (bucket_id <> ''company-entry-images'')';
 END IF;
END $storage$;

REVOKE ALL ON FUNCTION public.waves_company_entry_values(text,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.waves_company_entry_values(text,uuid,jsonb) TO authenticated,service_role;
ALTER TABLE public.company_entries DROP CONSTRAINT company_entries_amount_check,
 ADD CONSTRAINT company_entries_amount_check CHECK(amount>0 OR (amount=0 AND calc_mode='days_rate'));
DROP POLICY company_entries_select ON public.company_entries;
CREATE POLICY company_entries_select ON public.company_entries FOR SELECT TO authenticated
 USING(public.waves_can_read_company_entry(id));
-- Retain the historical personal-object erasure behavior; company evidence survives uploader deletion.
CREATE FUNCTION public.waves_company_storage_profile_cleanup() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $fn$
BEGIN
 DELETE FROM public.storage_objects WHERE owner_profile_id=OLD.id AND company_group_id IS NULL;
 RETURN OLD;
END $fn$;
REVOKE ALL ON FUNCTION public.waves_company_storage_profile_cleanup() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.waves_company_storage_profile_cleanup() TO service_role;
CREATE TRIGGER company_storage_profile_cleanup BEFORE DELETE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.waves_company_storage_profile_cleanup();
-- Keep deletions queued beyond the 60 second PUT lifetime (including late PUTs).
CREATE FUNCTION public.waves_company_orphan_delay() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $fn$
BEGIN
 IF NEW.logical_bucket='company-entry-images' THEN NEW.enqueued_at:=greatest(NEW.enqueued_at,now()+interval '2 minutes'); END IF;
 RETURN NEW;
END $fn$;
REVOKE ALL ON FUNCTION public.waves_company_orphan_delay() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.waves_company_orphan_delay() TO service_role;
CREATE TRIGGER company_orphan_delay BEFORE INSERT OR UPDATE ON public.storage_orphans FOR EACH ROW EXECUTE FUNCTION public.waves_company_orphan_delay();
CREATE OR REPLACE FUNCTION public.waves_storage_orphans(p_limit integer DEFAULT 100)
 RETURNS TABLE(logical_bucket text,path text) LANGUAGE sql STABLE SECURITY DEFINER
 SET search_path TO 'public','pg_temp' AS $fn$
 SELECT logical_bucket,path FROM public.storage_orphans WHERE enqueued_at<=now()
 ORDER BY enqueued_at LIMIT greatest(1,least(coalesce(p_limit,100),1000));
$fn$;
REVOKE ALL ON FUNCTION public.waves_storage_orphans(integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.waves_storage_orphans(integer) TO service_role;
-- Small, bounded grace-period sweep; serialize against attach via the entry lock.
CREATE FUNCTION public.waves_company_expire_unattached() RETURNS integer
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $fn$
DECLARE e uuid; n integer:=0; removed integer;
BEGIN
 FOR e IN SELECT DISTINCT ce.id FROM public.company_entries ce JOIN public.storage_objects o
 ON o.company_group_id=ce.group_id AND split_part(o.path,'/',1)=ce.id::text
 WHERE o.logical_bucket='company-entry-images' AND NOT o.pending AND o.updated_at<now()-interval '1 day'
 AND NOT EXISTS(SELECT 1 FROM public.company_entry_attachments a WHERE a.entry_id=ce.id AND
 (o.path=a.storage_path OR o.path=a.storage_path||'.thumb.jpg')) LIMIT 200 LOOP
  PERFORM 1 FROM public.company_entries WHERE id=e FOR UPDATE;
  DELETE FROM public.storage_objects o WHERE o.logical_bucket='company-entry-images'
  AND split_part(o.path,'/',1)=e::text AND NOT o.pending AND o.updated_at<now()-interval '1 day'
  AND NOT EXISTS(SELECT 1 FROM public.company_entry_attachments a WHERE a.entry_id=e AND
   (o.path=a.storage_path OR o.path=a.storage_path||'.thumb.jpg'));
  GET DIAGNOSTICS removed=ROW_COUNT; n:=n+removed;
 END LOOP;
 RETURN n;
END $fn$;
REVOKE ALL ON FUNCTION public.waves_company_expire_unattached() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.waves_company_expire_unattached() TO service_role;

-- Edge cancellation must race attach under the same entry lock, before deleting bytes.
CREATE FUNCTION public.waves_company_cancel_upload(
 p_entry_id uuid,p_path text,p_profile_id uuid,p_pending_only boolean DEFAULT false
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $fn$
DECLARE e public.company_entries%ROWTYPE; o public.storage_objects%ROWTYPE;
 base text:=regexp_replace(p_path,'\.thumb\.jpg$',''); is_admin boolean;
BEGIN
 SELECT * INTO e FROM public.company_entries WHERE id=p_entry_id FOR UPDATE;
 SELECT EXISTS(SELECT 1 FROM public.group_members m JOIN public.groups g ON g.id=m.group_id
  WHERE m.group_id=e.group_id AND m.profile_id=p_profile_id AND m.left_at IS NULL
   AND m.role='admin' AND g.deleted_at IS NULL) INTO is_admin;
 IF e.id IS NULL OR e.deleted_at IS NOT NULL OR split_part(base,'/',1)<>e.id::text OR NOT EXISTS(
  SELECT 1 FROM public.group_members m JOIN public.groups g ON g.id=m.group_id
  WHERE m.group_id=e.group_id AND m.profile_id=p_profile_id AND m.left_at IS NULL
   AND (m.id=e.member_id OR m.role='admin') AND g.deleted_at IS NULL
 ) THEN RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE='insufficient_privilege'; END IF;
 IF EXISTS(SELECT 1 FROM public.company_entry_attachments WHERE entry_id=e.id AND storage_path=base) THEN
  RAISE EXCEPTION 'IMMUTABLE_OBJECT';
 END IF;
 SELECT * INTO o FROM public.storage_objects WHERE logical_bucket='company-entry-images' AND path=p_path FOR UPDATE;
 IF o.path IS NULL THEN RETURN false; END IF;
 IF o.company_group_id IS DISTINCT FROM e.group_id OR
  (o.owner_profile_id IS DISTINCT FROM p_profile_id AND NOT is_admin) THEN RAISE EXCEPTION 'NOT_UPLOADER' USING ERRCODE='insufficient_privilege'; END IF;
 IF p_pending_only AND NOT o.pending THEN RETURN false; END IF;
 DELETE FROM public.storage_objects WHERE logical_bucket='company-entry-images'
  AND (path=p_path OR (NOT p_pending_only AND p_path=base AND path=base||'.thumb.jpg'));
 RETURN true;
END $fn$;
REVOKE ALL ON FUNCTION public.waves_company_cancel_upload(uuid,text,uuid,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.waves_company_cancel_upload(uuid,text,uuid,boolean) TO service_role;
