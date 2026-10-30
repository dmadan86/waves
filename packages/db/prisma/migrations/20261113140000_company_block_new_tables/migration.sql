-- Attendance, daily work, estimates/bills and vendor photos landed after the moderation guard; a suspended company is read-only for them too.
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['company_attendance','company_work_tasks','company_documents','company_vendor_entry_attachments'] LOOP
  EXECUTE format('CREATE TRIGGER aa_company_block_guard BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.waves_company_block_guard()',t);
 END LOOP;
END $$;
