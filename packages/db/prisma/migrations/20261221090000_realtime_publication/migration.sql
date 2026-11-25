-- Live sync: the app already subscribes to postgres_changes on these tables
-- (useGroupRealtime, receipt claims), but supabase_realtime was empty, so no
-- event ever arrived and devices only caught up on the 30s poll. Realtime
-- still applies each subscriber's RLS select policy to every event.
DO $$
DECLARE t text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    FOREACH t IN ARRAY ARRAY['expenses', 'settlements', 'group_members', 'activity_log', 'receipt_item_claims'] LOOP
      IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t
      ) THEN
        EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
      END IF;
    END LOOP;
  END IF;
END $$;
