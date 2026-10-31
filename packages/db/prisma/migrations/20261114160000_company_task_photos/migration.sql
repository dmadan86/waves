-- Photos on a daily-work task. Same bucket ('company-entry-images'), quota, committed-object and preview rules as company entry
-- and vendor-line photos; only the owning row differs. The column is still called entry_id (here: the task id) so the byte door
-- and the mirror treat every company photo alike. Seen exactly where the task is: owner, the assignee's manager, the assignee.
-- Added and removed by the owner or the assignee's manager only.

ALTER TABLE public.company_work_tasks ADD CONSTRAINT company_work_tasks_id_group_id_key UNIQUE(id,group_id);
CREATE TABLE public.company_work_task_attachments (
 id uuid PRIMARY KEY, entry_id uuid NOT NULL, group_id uuid NOT NULL,
 uploader_member_id uuid NOT NULL,
 storage_path text NOT NULL UNIQUE,
 preview text CHECK(preview IS NULL OR (length(preview)<=4096 AND preview ~ '^data:image/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$')),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 deleted_at timestamptz, updated_seq bigint NOT NULL DEFAULT 0,
 FOREIGN KEY(entry_id,group_id) REFERENCES public.company_work_tasks(id,group_id) ON DELETE CASCADE,
 FOREIGN KEY(uploader_member_id,group_id) REFERENCES public.group_members(id,group_id),
 CHECK(storage_path ~ ('^' || entry_id::text || '/' || id::text || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$'))
);
CREATE INDEX company_work_task_attachments_group_seq_idx ON public.company_work_task_attachments(group_id,updated_seq);
CREATE INDEX company_work_task_attachments_entry_idx ON public.company_work_task_attachments(entry_id,deleted_at);
CREATE TRIGGER company_work_task_attachments_stamp BEFORE INSERT OR UPDATE ON public.company_work_task_attachments
 FOR EACH ROW EXECUTE FUNCTION public.waves_stamp_seq();
CREATE TRIGGER aa_company_block_guard BEFORE INSERT OR UPDATE OR DELETE ON public.company_work_task_attachments
 FOR EACH ROW EXECUTE FUNCTION public.waves_company_block_guard();
ALTER TABLE public.company_work_task_attachments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.company_work_task_attachments FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.company_work_task_attachments TO authenticated;
GRANT ALL ON public.company_work_task_attachments TO service_role;

-- Can the signed-in caller see this task (and so its photos)? Same rule as the task's own select policy.
CREATE FUNCTION public.waves_can_read_company_work_task(p_task_id uuid) RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
 SELECT EXISTS(SELECT 1 FROM public.company_work_tasks k WHERE k.id=p_task_id AND public.waves_company_detail(k.group_id,k.member_id));
$$;
REVOKE ALL ON FUNCTION public.waves_can_read_company_work_task(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.waves_can_read_company_work_task(uuid) TO authenticated,service_role;
CREATE POLICY company_work_task_attachments_select ON public.company_work_task_attachments FOR SELECT TO authenticated
 USING(public.waves_can_read_company_work_task(entry_id));

-- May this profile add or remove photos on this task? The owner, or the manager of the person it is assigned to.
CREATE FUNCTION public.waves_company_task_photo_actor(p_task_id uuid,p_profile_id uuid) RETURNS uuid
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
 SELECT m.id FROM public.company_work_tasks k
 JOIN public.group_members a ON a.id=k.member_id AND a.group_id=k.group_id
 JOIN public.group_members m ON m.group_id=k.group_id
 JOIN public.groups g ON g.id=k.group_id
 WHERE k.id=p_task_id AND k.deleted_at IS NULL AND g.type='company' AND g.deleted_at IS NULL
 AND m.profile_id=p_profile_id AND m.left_at IS NULL AND m.removed_at IS NULL AND m.merged_into_member_id IS NULL
 AND (m.role::text='admin' OR (m.role::text='manager' AND a.role::text='member' AND a.manager_id=m.id));
$$;

CREATE FUNCTION public.waves_attach_company_task_image(p_task_id uuid,p_storage_path text,p_attachment_id uuid,p_preview text DEFAULT NULL) RETURNS uuid
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $fn$
DECLARE e public.company_work_tasks%ROWTYPE; a public.company_work_task_attachments%ROWTYPE; actor uuid; o public.storage_objects%ROWTYPE;
BEGIN
 SELECT * INTO e FROM public.company_work_tasks WHERE id=p_task_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE='insufficient_privilege'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(e.group_id::text,4));
 SELECT * INTO e FROM public.company_work_tasks WHERE id=p_task_id FOR UPDATE;
 actor:=public.waves_company_task_photo_actor(e.id,public.waves_current_profile_id());
 IF actor IS NULL OR NOT public.waves_can_read_company_work_task(e.id) THEN RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE='insufficient_privilege'; END IF;
 SELECT * INTO a FROM public.company_work_task_attachments WHERE id=p_attachment_id;
 IF FOUND THEN
  IF a.entry_id=e.id AND a.storage_path=p_storage_path AND a.uploader_member_id=actor
   AND a.preview IS NOT DISTINCT FROM public.waves_clean_image_preview(p_preview) AND a.deleted_at IS NULL THEN RETURN a.id; END IF;
  RAISE EXCEPTION 'ATTACHMENT_CONFLICT' USING ERRCODE='check_violation';
 END IF;
 IF (SELECT count(*) FROM public.company_work_task_attachments WHERE entry_id=e.id AND deleted_at IS NULL)>=10 THEN RAISE EXCEPTION 'ATTACHMENT_LIMIT'; END IF;
 SELECT * INTO o FROM public.storage_objects WHERE logical_bucket='company-entry-images' AND path=p_storage_path FOR UPDATE;
 PERFORM public.waves_require_committed_object('company-entry-images',p_storage_path);
 IF o.company_group_id IS DISTINCT FROM e.group_id OR o.owner_profile_id IS DISTINCT FROM public.waves_current_profile_id() THEN RAISE EXCEPTION 'NOT_UPLOADER' USING ERRCODE='insufficient_privilege'; END IF;
 INSERT INTO public.company_work_task_attachments(id,entry_id,group_id,uploader_member_id,storage_path,preview)
 VALUES(p_attachment_id,e.id,e.group_id,actor,p_storage_path,public.waves_clean_image_preview(p_preview));
 RETURN p_attachment_id;
END
$fn$;

CREATE FUNCTION public.waves_remove_company_task_image(p_attachment_id uuid) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $fn$
DECLARE a public.company_work_task_attachments%ROWTYPE; actor uuid;
BEGIN
 SELECT * INTO a FROM public.company_work_task_attachments WHERE id=p_attachment_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE='insufficient_privilege'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(a.group_id::text,4));
 SELECT * INTO a FROM public.company_work_task_attachments WHERE id=p_attachment_id FOR UPDATE;
 actor:=public.waves_company_task_photo_actor(a.entry_id,public.waves_current_profile_id());
 IF actor IS NULL OR NOT public.waves_can_read_company_work_task(a.entry_id) THEN RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE='insufficient_privilege'; END IF;
 IF a.deleted_at IS NOT NULL THEN RETURN; END IF;
 UPDATE public.company_work_task_attachments SET deleted_at=now(),updated_at=now() WHERE id=a.id;
 DELETE FROM public.storage_objects WHERE logical_bucket='company-entry-images' AND path IN(a.storage_path,a.storage_path||'.thumb.jpg');
END
$fn$;

-- Byte door, step 1: record an upload (service role, called by r2-sign). Twin of waves_company_vendor_storage_write.
CREATE FUNCTION public.waves_company_task_storage_write(
 p_profile_id uuid,p_group_id uuid,p_path text,p_bytes bigint,p_content_type text,p_commit boolean
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $fn$
DECLARE e public.company_work_tasks%ROWTYPE; o public.storage_objects%ROWTYPE;
 base text:=regexp_replace(p_path,'\.thumb\.jpg$',''); quota bigint; used bigint;
BEGIN
 IF p_bytes IS NULL OR p_bytes<=0 OR p_bytes>12582912 OR p_profile_id IS NULL
  OR p_content_type NOT IN ('image/jpeg','image/png','image/webp','image/heic','image/heif')
  OR p_path !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg(\.thumb\.jpg)?$' THEN RAISE EXCEPTION 'STORAGE_BAD_INPUT'; END IF;
 SELECT * INTO e FROM public.company_work_tasks WHERE id=split_part(base,'/',1)::uuid;
 IF NOT FOUND THEN RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE='insufficient_privilege'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(e.group_id::text,4));
 SELECT * INTO e FROM public.company_work_tasks WHERE id=e.id FOR UPDATE;
 IF e.group_id IS DISTINCT FROM p_group_id OR public.waves_company_task_photo_actor(e.id,p_profile_id) IS NULL THEN RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE='insufficient_privilege'; END IF;
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

CREATE FUNCTION public.waves_company_task_cancel_upload(
 p_task_id uuid,p_path text,p_profile_id uuid,p_pending_only boolean DEFAULT false
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $fn$
DECLARE e public.company_work_tasks%ROWTYPE; o public.storage_objects%ROWTYPE;
 base text:=regexp_replace(p_path,'\.thumb\.jpg$',''); is_admin boolean;
BEGIN
 SELECT * INTO e FROM public.company_work_tasks WHERE id=p_task_id;
 IF NOT FOUND OR split_part(base,'/',1)<>e.id::text THEN RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE='insufficient_privilege'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(e.group_id::text,4));
 SELECT * INTO e FROM public.company_work_tasks WHERE id=p_task_id FOR UPDATE;
 IF public.waves_company_task_photo_actor(e.id,p_profile_id) IS NULL THEN RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE='insufficient_privilege'; END IF;
 SELECT EXISTS(SELECT 1 FROM public.group_members WHERE group_id=e.group_id AND profile_id=p_profile_id AND left_at IS NULL AND role='admin') INTO is_admin;
 IF EXISTS(SELECT 1 FROM public.company_work_task_attachments WHERE entry_id=e.id AND storage_path=base) THEN
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

-- A removed task takes its photos with it.
CREATE FUNCTION public.waves_company_task_image_cleanup() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $fn$
BEGIN
 IF NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL THEN
  UPDATE public.company_work_task_attachments SET deleted_at=coalesce(deleted_at,now()),updated_at=now() WHERE entry_id=OLD.id AND deleted_at IS NULL;
  DELETE FROM public.storage_objects WHERE logical_bucket='company-entry-images' AND company_group_id=OLD.group_id AND split_part(path,'/',1)=OLD.id::text;
 END IF;
 RETURN NEW;
END $fn$;
CREATE TRIGGER company_task_image_cleanup AFTER UPDATE OF deleted_at ON public.company_work_tasks
 FOR EACH ROW EXECUTE FUNCTION public.waves_company_task_image_cleanup();

-- Handing a task to someone else, or moving the assignee to another manager, changes who may read its photos: re-stamp so they pull.
CREATE FUNCTION public.waves_company_task_photo_restamp() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $fn$
BEGIN
 IF TG_TABLE_NAME='company_work_tasks' THEN
  UPDATE public.company_work_task_attachments SET updated_at=now() WHERE entry_id=NEW.id;
 ELSE
  UPDATE public.company_work_task_attachments SET updated_at=now() WHERE entry_id IN(SELECT id FROM public.company_work_tasks WHERE member_id=NEW.id);
 END IF;
 RETURN NEW;
END $fn$;
CREATE TRIGGER company_task_photo_restamp_assignee AFTER UPDATE OF member_id ON public.company_work_tasks
 FOR EACH ROW WHEN (OLD.member_id IS DISTINCT FROM NEW.member_id) EXECUTE FUNCTION public.waves_company_task_photo_restamp();
CREATE TRIGGER company_task_photo_restamp_manager AFTER UPDATE OF manager_id ON public.group_members
 FOR EACH ROW WHEN (OLD.manager_id IS DISTINCT FROM NEW.manager_id) EXECUTE FUNCTION public.waves_company_task_photo_restamp();

-- A task id never equals a company entry or vendor line id: all three own image keys under '<id>/'.
CREATE FUNCTION public.waves_company_task_id_guard() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $fn$
BEGIN
 IF EXISTS(SELECT 1 FROM public.company_entries WHERE id=NEW.id) OR EXISTS(SELECT 1 FROM public.company_vendor_entries WHERE id=NEW.id) THEN
  RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE='insufficient_privilege'; END IF;
 RETURN NEW;
END $fn$;
CREATE TRIGGER company_task_id_guard BEFORE INSERT ON public.company_work_tasks FOR EACH ROW EXECUTE FUNCTION public.waves_company_task_id_guard();

REVOKE ALL ON FUNCTION public.waves_company_task_photo_actor(uuid,uuid),public.waves_company_task_storage_write(uuid,uuid,text,bigint,text,boolean),
 public.waves_company_task_cancel_upload(uuid,text,uuid,boolean),public.waves_company_task_image_cleanup(),public.waves_company_task_photo_restamp(),
 public.waves_company_task_id_guard() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.waves_attach_company_task_image(uuid,text,uuid,text),public.waves_remove_company_task_image(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.waves_company_task_photo_actor(uuid,uuid),public.waves_company_task_storage_write(uuid,uuid,text,bigint,text,boolean),
 public.waves_company_task_cancel_upload(uuid,text,uuid,boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.waves_attach_company_task_image(uuid,text,uuid,text),public.waves_remove_company_task_image(uuid) TO authenticated,service_role;

-- r2-sign and waves_storage_record keep calling the two company functions; a task id routes to the task twin first.
CREATE OR REPLACE FUNCTION public.waves_company_storage_write(
 p_profile_id uuid,p_group_id uuid,p_path text,p_bytes bigint,p_content_type text,p_commit boolean
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $fn$
BEGIN
 IF p_path ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/'
  AND EXISTS(SELECT 1 FROM public.company_work_tasks WHERE id=split_part(p_path,'/',1)::uuid) THEN
  PERFORM public.waves_company_task_storage_write(p_profile_id,p_group_id,p_path,p_bytes,p_content_type,p_commit);
 ELSIF p_path ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/'
  AND EXISTS(SELECT 1 FROM public.company_vendor_entries WHERE id=split_part(p_path,'/',1)::uuid) THEN
  PERFORM public.waves_company_vendor_storage_write(p_profile_id,p_group_id,p_path,p_bytes,p_content_type,p_commit);
 ELSE
  PERFORM public.waves_company_storage_write_entry(p_profile_id,p_group_id,p_path,p_bytes,p_content_type,p_commit);
 END IF;
END $fn$;
CREATE OR REPLACE FUNCTION public.waves_company_cancel_upload(
 p_entry_id uuid,p_path text,p_profile_id uuid,p_pending_only boolean DEFAULT false
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $fn$
BEGIN
 IF EXISTS(SELECT 1 FROM public.company_work_tasks WHERE id=p_entry_id) THEN
  RETURN public.waves_company_task_cancel_upload(p_entry_id,p_path,p_profile_id,p_pending_only);
 END IF;
 IF EXISTS(SELECT 1 FROM public.company_vendor_entries WHERE id=p_entry_id) THEN
  RETURN public.waves_company_vendor_cancel_upload(p_entry_id,p_path,p_profile_id,p_pending_only);
 END IF;
 RETURN public.waves_company_cancel_upload_entry(p_entry_id,p_path,p_profile_id,p_pending_only);
END $fn$;
