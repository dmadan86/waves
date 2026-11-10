-- Company Files: folders, uploaded files and links. Each item says who may see it: everyone (owner, managers, employees),
-- managers (owner + managers) or owners. A vendor login sees nothing. Owners create, edit and delete anything; a manager
-- only what they created (and may not pick 'owners', which would hide their own item from them).
-- File bytes ride the company-image pipeline: same bucket ('company-entry-images'), same R2 byte door (r2-sign), same
-- storage_objects ledger, so every uploaded byte counts against the company storage quota. Key: cf/<groupId>/<fileId>.

CREATE TABLE public.company_file_folders (
 id uuid PRIMARY KEY, group_id uuid NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
 name text NOT NULL CHECK(length(btrim(name)) BETWEEN 1 AND 80),
 visibility text NOT NULL DEFAULT 'everyone' CHECK(visibility IN ('everyone','managers','owners')),
 created_by uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 deleted_at timestamptz, updated_seq bigint NOT NULL DEFAULT 0,
 UNIQUE(id,group_id),
 FOREIGN KEY(created_by,group_id) REFERENCES public.group_members(id,group_id)
);
CREATE INDEX company_file_folders_sync_idx ON public.company_file_folders(group_id,updated_seq);

CREATE TABLE public.company_files (
 id uuid PRIMARY KEY, group_id uuid NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
 folder_id uuid,
 kind text NOT NULL CHECK(kind IN ('file','link')),
 name text NOT NULL CHECK(length(btrim(name)) BETWEEN 1 AND 120),
 url text CHECK(url IS NULL OR (length(url)<=2048 AND url ~* '^https?://[^[:space:]]+$')),
 r2_key text UNIQUE, size_bytes bigint CHECK(size_bytes IS NULL OR (size_bytes>0 AND size_bytes<=26214400)),
 mime text CHECK(mime IS NULL OR length(mime)<=100),
 visibility text NOT NULL DEFAULT 'everyone' CHECK(visibility IN ('everyone','managers','owners')),
 created_by uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 deleted_at timestamptz, updated_seq bigint NOT NULL DEFAULT 0,
 CONSTRAINT company_files_shape CHECK(
  (kind='link' AND url IS NOT NULL AND r2_key IS NULL AND size_bytes IS NULL AND mime IS NULL) OR
  (kind='file' AND url IS NULL AND size_bytes IS NOT NULL AND mime IS NOT NULL AND r2_key='cf/'||group_id::text||'/'||id::text)),
 FOREIGN KEY(folder_id,group_id) REFERENCES public.company_file_folders(id,group_id),
 FOREIGN KEY(created_by,group_id) REFERENCES public.group_members(id,group_id)
);
CREATE INDEX company_files_sync_idx ON public.company_files(group_id,updated_seq);
CREATE INDEX company_files_folder_idx ON public.company_files(folder_id);

CREATE TRIGGER company_file_folders_stamp BEFORE INSERT OR UPDATE ON public.company_file_folders FOR EACH ROW EXECUTE FUNCTION public.waves_stamp_seq();
CREATE TRIGGER company_files_stamp BEFORE INSERT OR UPDATE ON public.company_files FOR EACH ROW EXECUTE FUNCTION public.waves_stamp_seq();
CREATE TRIGGER aa_company_block_guard BEFORE INSERT OR UPDATE OR DELETE ON public.company_file_folders FOR EACH ROW EXECUTE FUNCTION public.waves_company_block_guard();
CREATE TRIGGER aa_company_block_guard BEFORE INSERT OR UPDATE OR DELETE ON public.company_files FOR EACH ROW EXECUTE FUNCTION public.waves_company_block_guard();
ALTER TABLE public.company_file_folders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_files ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.company_file_folders, public.company_files FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.company_file_folders, public.company_files TO authenticated;
GRANT ALL ON public.company_file_folders, public.company_files TO service_role;

-- The caller's rank in the company: 3 owner, 2 manager, 1 employee, 0 none (vendor, outsider, two-step not passed).
CREATE FUNCTION public.waves_company_file_rank(p_group_id uuid) RETURNS integer
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
 SELECT coalesce((SELECT CASE m.role::text WHEN 'admin' THEN 3 WHEN 'manager' THEN 2 WHEN 'member' THEN 1 ELSE 0 END
  FROM public.group_members m JOIN public.groups g ON g.id=m.group_id
  WHERE m.group_id=p_group_id AND m.profile_id=public.waves_current_profile_id() AND m.left_at IS NULL AND m.removed_at IS NULL
  AND m.merged_into_member_id IS NULL AND g.type='company' AND g.deleted_at IS NULL AND public.waves_two_step_ok(p_group_id)),0);
$$;
CREATE FUNCTION public.waves_company_file_can_see(p_group_id uuid,p_visibility text) RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
 SELECT public.waves_company_file_rank(p_group_id)>=CASE p_visibility WHEN 'everyone' THEN 1 WHEN 'managers' THEN 2 ELSE 3 END
 AND public.waves_company_file_rank(p_group_id)>0;
$$;
REVOKE ALL ON FUNCTION public.waves_company_file_rank(uuid),public.waves_company_file_can_see(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.waves_company_file_rank(uuid),public.waves_company_file_can_see(uuid,text) TO authenticated,service_role;

CREATE POLICY company_file_folders_select ON public.company_file_folders FOR SELECT TO authenticated
 USING(public.waves_company_file_can_see(group_id,visibility));
-- An item inside a folder is as hidden as the folder (the folder subquery runs under the folder policy above).
CREATE POLICY company_files_select ON public.company_files FOR SELECT TO authenticated
 USING(public.waves_company_file_can_see(group_id,visibility)
  AND (folder_id IS NULL OR EXISTS(SELECT 1 FROM public.company_file_folders f WHERE f.id=folder_id AND f.group_id=company_files.group_id)));

-- Who may change an item: owner any, manager only their own. Returns the actor's member id.
CREATE FUNCTION public.waves_company_file_actor(p_group_id uuid,p_created_by uuid,p_visibility text) RETURNS uuid
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
DECLARE me uuid; rl text;
BEGIN
 me:=public.waves_company_actor(p_group_id);
 SELECT role::text INTO rl FROM public.group_members WHERE id=me;
 IF rl NOT IN ('admin','manager') THEN RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE='insufficient_privilege'; END IF;
 IF p_visibility IS NOT NULL AND p_visibility NOT IN ('everyone','managers','owners') THEN RAISE EXCEPTION 'INVALID_DATA' USING ERRCODE='check_violation'; END IF;
 IF rl='manager' AND (p_visibility='owners' OR (p_created_by IS NOT NULL AND p_created_by<>me)) THEN RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE='insufficient_privilege'; END IF;
 RETURN me;
END $$;

-- Create or rename/re-share a folder.
CREATE FUNCTION public.waves_company_file_folder_set(p_group_id uuid,p_id uuid,p_name text,p_visibility text) RETURNS uuid
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
DECLARE me uuid; r public.company_file_folders%ROWTYPE; v_name text:=btrim(coalesce(p_name,''));
BEGIN
 IF p_id IS NULL OR length(v_name) NOT BETWEEN 1 AND 80 THEN RAISE EXCEPTION 'INVALID_DATA' USING ERRCODE='check_violation'; END IF;
 SELECT * INTO r FROM public.company_file_folders WHERE id=p_id FOR UPDATE;
 IF FOUND THEN
  IF r.group_id<>p_group_id OR r.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE='insufficient_privilege'; END IF;
  me:=public.waves_company_file_actor(p_group_id,r.created_by,p_visibility);
  UPDATE public.company_file_folders SET name=v_name,visibility=p_visibility,updated_at=now() WHERE id=p_id;
 ELSE
  me:=public.waves_company_file_actor(p_group_id,NULL,p_visibility);
  INSERT INTO public.company_file_folders(id,group_id,name,visibility,created_by) VALUES(p_id,p_group_id,v_name,p_visibility,me);
 END IF;
 RETURN p_id;
END $$;

-- Delete a folder with what is in it. A manager may only when everything inside is theirs.
CREATE FUNCTION public.waves_company_file_folder_delete(p_id uuid) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
DECLARE r public.company_file_folders%ROWTYPE; me uuid;
BEGIN
 SELECT * INTO r FROM public.company_file_folders WHERE id=p_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE='insufficient_privilege'; END IF;
 me:=public.waves_company_file_actor(r.group_id,r.created_by,NULL);
 IF r.deleted_at IS NOT NULL THEN RETURN; END IF;
 IF NOT public.waves_company_file_can_see(r.group_id,r.visibility) THEN RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE='insufficient_privilege'; END IF;
 IF EXISTS(SELECT 1 FROM public.company_files f WHERE f.folder_id=p_id AND f.deleted_at IS NULL AND f.created_by<>me)
  AND (SELECT role::text FROM public.group_members WHERE id=me)<>'admin' THEN RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE='insufficient_privilege'; END IF;
 DELETE FROM public.storage_objects WHERE logical_bucket='company-entry-images' AND company_group_id=r.group_id
  AND path IN(SELECT r2_key FROM public.company_files WHERE folder_id=p_id AND r2_key IS NOT NULL);
 UPDATE public.company_files SET deleted_at=now(),updated_at=now() WHERE folder_id=p_id AND deleted_at IS NULL;
 UPDATE public.company_file_folders SET deleted_at=now(),updated_at=now() WHERE id=p_id;
END $$;

-- Create a link, or register an uploaded file (bytes already committed through r2-sign at cf/<groupId>/<id>).
CREATE FUNCTION public.waves_company_file_create(p_group_id uuid,p_id uuid,p_folder_id uuid,p_kind text,p_name text,p_visibility text,p_url text DEFAULT NULL)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
DECLARE me uuid; r public.company_files%ROWTYPE; o public.storage_objects%ROWTYPE; v_name text:=btrim(coalesce(p_name,'')); v_key text;
BEGIN
 IF p_id IS NULL OR p_kind NOT IN ('file','link') OR length(v_name) NOT BETWEEN 1 AND 120 THEN RAISE EXCEPTION 'INVALID_DATA' USING ERRCODE='check_violation'; END IF;
 IF p_kind='link' AND (p_url IS NULL OR length(p_url)>2048 OR p_url !~* '^https?://[^[:space:]]+$') THEN RAISE EXCEPTION 'INVALID_DATA: url' USING ERRCODE='check_violation'; END IF;
 me:=public.waves_company_file_actor(p_group_id,NULL,p_visibility);
 SELECT * INTO r FROM public.company_files WHERE id=p_id;
 IF FOUND THEN
  IF r.group_id=p_group_id AND r.created_by=me AND r.deleted_at IS NULL AND r.kind=p_kind AND r.name=v_name THEN RETURN p_id; END IF;
  RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE='insufficient_privilege';
 END IF;
 IF p_folder_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.company_file_folders f WHERE f.id=p_folder_id AND f.group_id=p_group_id AND f.deleted_at IS NULL
  AND public.waves_company_file_can_see(f.group_id,f.visibility)) THEN RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE='insufficient_privilege'; END IF;
 IF p_kind='link' THEN
  INSERT INTO public.company_files(id,group_id,folder_id,kind,name,url,visibility,created_by) VALUES(p_id,p_group_id,p_folder_id,'link',v_name,p_url,p_visibility,me);
 ELSE
  v_key:='cf/'||p_group_id::text||'/'||p_id::text;
  PERFORM pg_advisory_xact_lock(hashtextextended('company-storage:'||p_group_id::text,0));
  SELECT * INTO o FROM public.storage_objects WHERE logical_bucket='company-entry-images' AND path=v_key FOR UPDATE;
  IF o.path IS NULL OR o.pending OR o.company_group_id IS DISTINCT FROM p_group_id OR o.owner_profile_id IS DISTINCT FROM public.waves_current_profile_id()
  THEN RAISE EXCEPTION 'NOT_UPLOADED' USING ERRCODE='check_violation'; END IF;
  INSERT INTO public.company_files(id,group_id,folder_id,kind,name,r2_key,size_bytes,mime,visibility,created_by)
  VALUES(p_id,p_group_id,p_folder_id,'file',v_name,v_key,o.bytes,o.content_type,p_visibility,me);
 END IF;
 RETURN p_id;
END $$;

-- Rename, move, re-share (and change a link's address).
CREATE FUNCTION public.waves_company_file_update(p_id uuid,p_folder_id uuid,p_name text,p_visibility text,p_url text DEFAULT NULL) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
DECLARE r public.company_files%ROWTYPE; v_name text:=btrim(coalesce(p_name,''));
BEGIN
 SELECT * INTO r FROM public.company_files WHERE id=p_id FOR UPDATE;
 IF NOT FOUND OR r.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE='insufficient_privilege'; END IF;
 PERFORM public.waves_company_file_actor(r.group_id,r.created_by,p_visibility);
 IF NOT public.waves_company_file_can_see(r.group_id,r.visibility) THEN RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE='insufficient_privilege'; END IF;
 IF length(v_name) NOT BETWEEN 1 AND 120 OR (r.kind='link' AND (p_url IS NULL OR length(p_url)>2048 OR p_url !~* '^https?://[^[:space:]]+$'))
 THEN RAISE EXCEPTION 'INVALID_DATA' USING ERRCODE='check_violation'; END IF;
 IF p_folder_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.company_file_folders f WHERE f.id=p_folder_id AND f.group_id=r.group_id AND f.deleted_at IS NULL
  AND public.waves_company_file_can_see(f.group_id,f.visibility)) THEN RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE='insufficient_privilege'; END IF;
 UPDATE public.company_files SET folder_id=p_folder_id,name=v_name,visibility=p_visibility,url=CASE WHEN kind='link' THEN p_url ELSE NULL END,updated_at=now() WHERE id=p_id;
END $$;

-- Delete a file or link; an uploaded file frees its quota at once and its bytes are swept from R2 by the orphan queue.
CREATE FUNCTION public.waves_company_file_delete(p_id uuid) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
DECLARE r public.company_files%ROWTYPE;
BEGIN
 SELECT * INTO r FROM public.company_files WHERE id=p_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE='insufficient_privilege'; END IF;
 PERFORM public.waves_company_file_actor(r.group_id,r.created_by,NULL);
 IF NOT public.waves_company_file_can_see(r.group_id,r.visibility) THEN RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE='insufficient_privilege'; END IF;
 IF r.deleted_at IS NOT NULL THEN RETURN; END IF;
 UPDATE public.company_files SET deleted_at=now(),updated_at=now() WHERE id=p_id;
 IF r.r2_key IS NOT NULL THEN DELETE FROM public.storage_objects WHERE logical_bucket='company-entry-images' AND path=r.r2_key; END IF;
END $$;

-- Can the signed-in caller read this file's bytes? Called by r2-sign as the caller, so the row's visibility rule applies.
CREATE FUNCTION public.waves_can_read_company_file(p_file_id uuid,p_path text) RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
 SELECT EXISTS(SELECT 1 FROM public.company_files f WHERE f.id=p_file_id AND f.r2_key=p_path AND f.deleted_at IS NULL
  AND public.waves_company_file_can_see(f.group_id,f.visibility)
  AND (f.folder_id IS NULL OR EXISTS(SELECT 1 FROM public.company_file_folders d WHERE d.id=f.folder_id AND d.deleted_at IS NULL AND public.waves_company_file_can_see(d.group_id,d.visibility))));
$$;

-- Byte door, step 1: record an upload (service role, called by r2-sign through waves_storage_reserve / waves_storage_record).
-- Only an owner or manager of the company may upload; any type in the allow-list up to 25 MB; counted against the company quota.
CREATE FUNCTION public.waves_company_file_storage_write(
 p_profile_id uuid,p_group_id uuid,p_path text,p_bytes bigint,p_content_type text,p_commit boolean
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $fn$
DECLARE o public.storage_objects%ROWTYPE; quota bigint; used bigint; is_admin boolean;
BEGIN
 IF p_bytes IS NULL OR p_bytes<=0 OR p_bytes>26214400 OR p_profile_id IS NULL OR p_content_type NOT IN (
  'application/pdf','image/jpeg','image/png','image/webp','image/heic','image/heif','text/plain','text/csv','application/zip',
  'application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint','application/vnd.openxmlformats-officedocument.presentationml.presentation')
  OR p_path !~ '^cf/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  OR split_part(p_path,'/',2)<>p_group_id::text THEN RAISE EXCEPTION 'STORAGE_BAD_INPUT'; END IF;
 SELECT m.role::text='admin' INTO is_admin FROM public.group_members m JOIN public.groups g ON g.id=m.group_id
  WHERE m.group_id=p_group_id AND m.profile_id=p_profile_id AND m.left_at IS NULL AND m.removed_at IS NULL AND m.merged_into_member_id IS NULL
  AND m.role::text IN ('admin','manager') AND g.type='company' AND g.deleted_at IS NULL;
 IF is_admin IS NULL THEN RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE='insufficient_privilege'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('company-storage:'||p_group_id::text,0));
 IF EXISTS(SELECT 1 FROM public.company_files WHERE r2_key=p_path) THEN RAISE EXCEPTION 'IMMUTABLE_OBJECT'; END IF;
 SELECT * INTO o FROM public.storage_objects WHERE logical_bucket='company-entry-images' AND path=p_path FOR UPDATE;
 IF o.path IS NOT NULL AND o.owner_profile_id IS DISTINCT FROM p_profile_id AND NOT is_admin THEN RAISE EXCEPTION 'NOT_UPLOADER' USING ERRCODE='insufficient_privilege'; END IF;
 IF NOT p_commit AND o.path IS NOT NULL AND NOT o.pending THEN RAISE EXCEPTION 'IMMUTABLE_OBJECT'; END IF;
 IF p_commit AND (o.path IS NULL OR NOT o.pending) THEN
  IF o.path IS NOT NULL AND NOT o.pending AND o.bytes=p_bytes AND o.content_type=p_content_type THEN RETURN; END IF;
  RAISE EXCEPTION 'RESERVATION_REQUIRED';
 END IF;
 IF o.path IS NULL THEN INSERT INTO public.company_image_keys(path,group_id) VALUES(p_path,p_group_id); END IF;
 IF NOT p_commit AND (SELECT count(*) FROM public.storage_objects WHERE company_group_id=p_group_id AND owner_profile_id=p_profile_id AND pending AND path<>p_path)>=16 THEN RAISE EXCEPTION 'STORAGE_TOO_MANY_PENDING'; END IF;
 quota:=public.waves_company_storage_quota(p_group_id);
 SELECT coalesce(sum(bytes),0) INTO used FROM public.storage_objects WHERE company_group_id=p_group_id AND path<>p_path;
 IF used+p_bytes>quota THEN RAISE EXCEPTION 'STORAGE_CAP'; END IF;
 INSERT INTO public.storage_objects(logical_bucket,path,owner_profile_id,group_id,company_group_id,bytes,content_type,counted,pending)
 VALUES('company-entry-images',p_path,p_profile_id,p_group_id,p_group_id,p_bytes,p_content_type,false,NOT p_commit)
 ON CONFLICT(logical_bucket,path) DO UPDATE SET bytes=excluded.bytes,content_type=excluded.content_type,pending=excluded.pending,updated_at=now();
END $fn$;

-- Drop an upload that never became a file (failed PUT, wrong size or type). Refuses once a file row owns the key.
CREATE FUNCTION public.waves_company_file_cancel_upload(p_file_id uuid,p_path text,p_profile_id uuid,p_pending_only boolean DEFAULT false)
 RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $fn$
DECLARE o public.storage_objects%ROWTYPE; g uuid; is_admin boolean;
BEGIN
 IF p_path !~ '^cf/[0-9a-f-]{36}/[0-9a-f-]{36}$' OR split_part(p_path,'/',3)<>p_file_id::text THEN RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE='insufficient_privilege'; END IF;
 g:=split_part(p_path,'/',2)::uuid;
 SELECT m.role::text='admin' INTO is_admin FROM public.group_members m
  WHERE m.group_id=g AND m.profile_id=p_profile_id AND m.left_at IS NULL AND m.removed_at IS NULL AND m.merged_into_member_id IS NULL AND m.role::text IN ('admin','manager');
 IF is_admin IS NULL THEN RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE='insufficient_privilege'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('company-storage:'||g::text,0));
 IF EXISTS(SELECT 1 FROM public.company_files WHERE r2_key=p_path) THEN RAISE EXCEPTION 'IMMUTABLE_OBJECT'; END IF;
 SELECT * INTO o FROM public.storage_objects WHERE logical_bucket='company-entry-images' AND path=p_path FOR UPDATE;
 IF o.path IS NULL THEN RETURN false; END IF;
 IF o.company_group_id IS DISTINCT FROM g OR (o.owner_profile_id IS DISTINCT FROM p_profile_id AND NOT is_admin) THEN RAISE EXCEPTION 'NOT_UPLOADER' USING ERRCODE='insufficient_privilege'; END IF;
 IF p_pending_only AND NOT o.pending THEN RETURN false; END IF;
 DELETE FROM public.storage_objects WHERE logical_bucket='company-entry-images' AND path=p_path;
 RETURN true;
END $fn$;

-- A deleted file's key stays retired; an uploaded-but-never-registered object is dropped after a day (same sweep idea as photos).
CREATE FUNCTION public.waves_company_file_expire_unattached() RETURNS integer
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $fn$
DECLARE n integer;
BEGIN
 DELETE FROM public.storage_objects o WHERE o.logical_bucket='company-entry-images' AND o.path LIKE 'cf/%'
  AND NOT o.pending AND o.updated_at<now()-interval '1 day'
  AND NOT EXISTS(SELECT 1 FROM public.company_files f WHERE f.r2_key=o.path);
 GET DIAGNOSTICS n=ROW_COUNT;
 RETURN n;
END $fn$;

-- r2-sign and waves_storage_record keep calling the two company functions; a files key routes to the files twin first.
CREATE OR REPLACE FUNCTION public.waves_company_storage_write(
 p_profile_id uuid,p_group_id uuid,p_path text,p_bytes bigint,p_content_type text,p_commit boolean
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $fn$
BEGIN
 IF p_path LIKE 'cf/%' THEN
  PERFORM public.waves_company_file_storage_write(p_profile_id,p_group_id,p_path,p_bytes,p_content_type,p_commit);
 ELSIF p_path ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/'
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
 IF p_path LIKE 'cf/%' THEN
  RETURN public.waves_company_file_cancel_upload(p_entry_id,p_path,p_profile_id,p_pending_only);
 END IF;
 IF EXISTS(SELECT 1 FROM public.company_work_tasks WHERE id=p_entry_id) THEN
  RETURN public.waves_company_task_cancel_upload(p_entry_id,p_path,p_profile_id,p_pending_only);
 END IF;
 IF EXISTS(SELECT 1 FROM public.company_vendor_entries WHERE id=p_entry_id) THEN
  RETURN public.waves_company_vendor_cancel_upload(p_entry_id,p_path,p_profile_id,p_pending_only);
 END IF;
 RETURN public.waves_company_cancel_upload_entry(p_entry_id,p_path,p_profile_id,p_pending_only);
END $fn$;

REVOKE ALL ON FUNCTION public.waves_company_file_actor(uuid,uuid,text),public.waves_company_file_storage_write(uuid,uuid,text,bigint,text,boolean),
 public.waves_company_file_cancel_upload(uuid,text,uuid,boolean),public.waves_company_file_expire_unattached(),
 public.waves_company_storage_write(uuid,uuid,text,bigint,text,boolean),public.waves_company_cancel_upload(uuid,text,uuid,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.waves_company_file_storage_write(uuid,uuid,text,bigint,text,boolean),
 public.waves_company_file_cancel_upload(uuid,text,uuid,boolean),public.waves_company_file_expire_unattached(),
 public.waves_company_storage_write(uuid,uuid,text,bigint,text,boolean),public.waves_company_cancel_upload(uuid,text,uuid,boolean) TO service_role;
REVOKE ALL ON FUNCTION public.waves_company_file_folder_set(uuid,uuid,text,text),public.waves_company_file_folder_delete(uuid),
 public.waves_company_file_create(uuid,uuid,uuid,text,text,text,text),public.waves_company_file_update(uuid,uuid,text,text,text),
 public.waves_company_file_delete(uuid),public.waves_can_read_company_file(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.waves_company_file_folder_set(uuid,uuid,text,text),public.waves_company_file_folder_delete(uuid),
 public.waves_company_file_create(uuid,uuid,uuid,text,text,text,text),public.waves_company_file_update(uuid,uuid,text,text,text),
 public.waves_company_file_delete(uuid),public.waves_can_read_company_file(uuid,text) TO authenticated,service_role;
