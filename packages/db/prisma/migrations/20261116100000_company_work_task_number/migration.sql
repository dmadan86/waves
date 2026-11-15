-- Task numbers (#42): a per-company counter, assigned by the server when the task is first saved.
ALTER TABLE public.company_work_tasks ADD COLUMN seq integer;

-- Existing tasks are numbered oldest first. The UPDATE also re-stamps updated_seq, so phones pull the new number.
UPDATE public.company_work_tasks t SET seq=n.rn
FROM (SELECT id, row_number() OVER (PARTITION BY group_id ORDER BY created_at, id) AS rn FROM public.company_work_tasks) n
WHERE t.id=n.id;

ALTER TABLE public.company_work_tasks ADD CONSTRAINT company_work_tasks_group_seq_key UNIQUE(group_id, seq);

-- One writer per company at a time while it takes the next number (removed tasks keep theirs, so numbers are never reused).
CREATE FUNCTION public.waves_company_task_seq() RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public','pg_temp' AS $$
BEGIN
 IF TG_OP='UPDATE' THEN NEW.seq:=OLD.seq; RETURN NEW; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.group_id::text,9));
 SELECT coalesce(max(seq),0)+1 INTO NEW.seq FROM public.company_work_tasks WHERE group_id=NEW.group_id;
 RETURN NEW;
END $$;
CREATE TRIGGER company_work_tasks_seq BEFORE INSERT OR UPDATE ON public.company_work_tasks FOR EACH ROW EXECUTE FUNCTION public.waves_company_task_seq();
