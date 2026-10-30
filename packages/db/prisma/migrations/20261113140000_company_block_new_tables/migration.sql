-- Attendance, daily work and estimates/bills landed after the moderation guard; a suspended company is read-only for them too.
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['company_attendance','company_work_tasks','company_documents'] LOOP
  EXECUTE format('CREATE TRIGGER aa_company_block_guard BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.waves_company_block_guard()',t);
 END LOOP;
END $$;
