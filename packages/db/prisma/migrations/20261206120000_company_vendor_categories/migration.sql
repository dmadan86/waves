-- A vendor can have several categories (Materials, Cement, ...). `category` stays as the FIRST one, kept in sync by the
-- trigger below, so app versions that only read/write `category` keep working and never wipe the extra categories.
ALTER TABLE public.company_vendors
 ADD COLUMN categories text[] NOT NULL DEFAULT '{}',
 ADD CONSTRAINT company_vendors_categories_max CHECK (cardinality(categories)<=10);

UPDATE public.company_vendors SET categories=ARRAY[btrim(category)] WHERE nullif(btrim(coalesce(category,'')),'') IS NOT NULL;

CREATE FUNCTION public.waves_company_vendor_categories_sync() RETURNS trigger
 LANGUAGE plpgsql SET search_path TO 'public','pg_temp' AS $$
DECLARE a text[]; x text; c text; seen text[]:='{}'; res text[]:='{}';
BEGIN
 IF TG_OP='UPDATE' AND NEW.categories IS NOT DISTINCT FROM OLD.categories AND NEW.category IS DISTINCT FROM OLD.category THEN
  -- Old client: it only knows `category`. Replace (or clear) the first one and keep the rest.
  c:=nullif(btrim(coalesce(NEW.category,'')),'');
  a:=CASE WHEN c IS NULL THEN '{}' ELSE ARRAY[c] END;
  FOREACH x IN ARRAY coalesce(OLD.categories[2:],'{}') LOOP
   IF c IS NULL OR lower(x)<>lower(c) THEN a:=a||x; END IF;
  END LOOP;
 ELSIF TG_OP='INSERT' AND cardinality(NEW.categories)=0 AND nullif(btrim(coalesce(NEW.category,'')),'') IS NOT NULL THEN
  a:=ARRAY[btrim(NEW.category)];
 ELSE
  a:=NEW.categories;
 END IF;
 FOREACH x IN ARRAY a LOOP
  x:=btrim(x);
  IF x IS NULL OR length(x) NOT BETWEEN 1 AND 40 OR lower(x)=ANY(seen) THEN RAISE EXCEPTION 'INVALID_DATA: category' USING ERRCODE='check_violation'; END IF;
  seen:=seen||lower(x); res:=res||x;
 END LOOP;
 NEW.categories:=res;
 NEW.category:=res[1];
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.waves_company_vendor_categories_sync() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER company_vendors_categories_sync BEFORE INSERT OR UPDATE ON public.company_vendors FOR EACH ROW EXECUTE FUNCTION public.waves_company_vendor_categories_sync();

-- Same signature as before. `categories` (array of strings) is optional: without it the write is the old `category`-only one.
CREATE OR REPLACE FUNCTION public.waves_company_vendor_set(p_group_id uuid,p_vendor_id uuid,p_data jsonb) RETURNS uuid
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
DECLARE me uuid; rl text; r public.company_vendors%ROWTYPE; v_name text; v_phone text; v_cat text; v_cats text[];
BEGIN
 SELECT * INTO me,rl FROM public.waves_company_vendor_role(p_group_id);
 IF rl NOT IN ('admin','manager') THEN RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE='insufficient_privilege'; END IF;
 IF p_vendor_id IS NULL OR jsonb_typeof(p_data) IS DISTINCT FROM 'object'
  OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_data) k WHERE k NOT IN ('name','phone','category','categories')) THEN RAISE EXCEPTION 'INVALID_DATA' USING ERRCODE='check_violation'; END IF;
 v_name:=btrim(p_data->>'name'); v_phone:=nullif(btrim(coalesce(p_data->>'phone','')),''); v_cat:=nullif(btrim(coalesce(p_data->>'category','')),'');
 IF coalesce(length(v_name),0) NOT BETWEEN 1 AND 120 THEN RAISE EXCEPTION 'INVALID_DATA' USING ERRCODE='check_violation'; END IF;
 IF p_data ? 'categories' THEN
  IF jsonb_typeof(p_data->'categories') IS DISTINCT FROM 'array' OR jsonb_array_length(p_data->'categories')>10
   OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_data->'categories') e WHERE jsonb_typeof(e) IS DISTINCT FROM 'string') THEN RAISE EXCEPTION 'INVALID_DATA' USING ERRCODE='check_violation'; END IF;
  SELECT coalesce(array_agg(btrim(e)),'{}') INTO v_cats FROM jsonb_array_elements_text(p_data->'categories') e;
 END IF;
 PERFORM 1 FROM public.groups WHERE id=p_group_id FOR UPDATE;
 SELECT * INTO r FROM public.company_vendors WHERE id=p_vendor_id;
 IF FOUND THEN
  IF r.group_id<>p_group_id OR NOT public.waves_company_vendor_visible(p_group_id,r.id) OR r.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE='insufficient_privilege'; END IF;
  IF v_cats IS NULL THEN
   UPDATE public.company_vendors SET name=v_name,phone=v_phone,category=v_cat,version=version+1,updated_at=now() WHERE id=r.id;
  ELSE
   UPDATE public.company_vendors SET name=v_name,phone=v_phone,categories=v_cats,version=version+1,updated_at=now() WHERE id=r.id;
  END IF;
  RETURN r.id;
 END IF;
 INSERT INTO public.company_vendors(id,group_id,name,phone,category,categories,added_by) VALUES(p_vendor_id,p_group_id,v_name,v_phone,v_cat,coalesce(v_cats,'{}'),me);
 RETURN p_vendor_id;
END $$;
