-- Hard-purge groups that were deleted (soft, `groups.deleted_at`) more than 30
-- days ago, so "deleted" eventually means erased.
--
--   * `waves_delete_group` only stamps `deleted_at`; nothing ever removed the
--     rows. This function does, with `DELETE FROM groups`: every child table
--     references `groups(id)` ON DELETE CASCADE (members, expenses and their
--     versions, settlements, balances, activity, notifications, ...), so the
--     database deletes the children before the parent, in FK-safe order.
--   * Four tables forbid deletes on purpose (ADR-004): activity_log,
--     expense_versions, expenses and settlements. Those triggers also fire on
--     cascades, so they are switched off for this one transaction and back on
--     before it ends. If anything fails the whole transaction rolls back and
--     they stay enabled.
--   * Company groups are left alone: their tables carry their own guards and
--     retention (business records), which is a separate decision.
--   * Receipt and photo files go through `storage_objects`' own delete trigger,
--     which queues them for the storage sweep.
--   * Nothing to purge means no table lock is taken at all.
--
-- Service role / cron only, scheduled daily by pg_cron like the other sweeps.

CREATE OR REPLACE FUNCTION public.waves_purge_deleted_groups(p_limit integer DEFAULT 50) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_ids uuid[];
  v_purged integer;
BEGIN
  SELECT coalesce(array_agg(id), '{}') INTO v_ids
  FROM (
    SELECT id FROM public.groups
    WHERE deleted_at IS NOT NULL
      AND deleted_at < now() - interval '30 days'
      AND type <> 'company'
    ORDER BY deleted_at
    LIMIT greatest(p_limit, 1)
  ) due;

  IF coalesce(array_length(v_ids, 1), 0) = 0 THEN
    RETURN 0;
  END IF;

  ALTER TABLE public.activity_log DISABLE TRIGGER activity_log_append_only;
  ALTER TABLE public.expense_versions DISABLE TRIGGER expense_versions_append_only;
  ALTER TABLE public.expenses DISABLE TRIGGER expenses_no_hard_delete;
  ALTER TABLE public.settlements DISABLE TRIGGER settlements_no_hard_delete;

  DELETE FROM public.groups WHERE id = ANY (v_ids);
  GET DIAGNOSTICS v_purged = ROW_COUNT;

  ALTER TABLE public.activity_log ENABLE TRIGGER activity_log_append_only;
  ALTER TABLE public.expense_versions ENABLE TRIGGER expense_versions_append_only;
  ALTER TABLE public.expenses ENABLE TRIGGER expenses_no_hard_delete;
  ALTER TABLE public.settlements ENABLE TRIGGER settlements_no_hard_delete;

  RETURN v_purged;
END
$$;

REVOKE ALL ON FUNCTION public.waves_purge_deleted_groups(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.waves_purge_deleted_groups(integer) TO service_role;

-- Guarded like the other schedules: a local stack has no pg_cron.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('waves-purge-deleted-groups')
      WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'waves-purge-deleted-groups');
    PERFORM cron.schedule(
      'waves-purge-deleted-groups',
      '20 3 * * *',
      $cron$SELECT public.waves_purge_deleted_groups();$cron$
    );
  END IF;
END
$$;
