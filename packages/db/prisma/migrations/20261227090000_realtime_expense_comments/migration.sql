-- Live comments: the app now listens to postgres_changes on expense_comments, but
-- the table was never added to supabase_realtime, so a comment reached the other
-- phone only on an app restart. Realtime still applies each subscriber's RLS
-- select policy to every event. Idempotent, like 20261221090000.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (
       SELECT 1 FROM pg_publication_tables
       WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'expense_comments'
     ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.expense_comments;
  END IF;
END $$;
