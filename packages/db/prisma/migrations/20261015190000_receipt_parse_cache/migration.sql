-- Exact-match cache for receipt-parse (an LLM cost saving).
--
-- The same photo parsed twice (a retry, a re-scan, two people in a group
-- uploading the same bill) used to pay for the model twice. The edge function
-- now hashes the image bytes and looks here first. The cache holds ONLY the
-- parsed receipt JSON and a hash: no image, no profile, no group.
--
--   * Key: (sha256 of the image bytes, model, prompt/schema version, currency).
--     The currency hint is in the prompt, so it is in the key; a model or
--     PROMPT_VERSION change misses every older entry.
--   * Service role only. RLS on, no policy, no grant to anon/authenticated.
--   * Retention: 30 days, enforced on read and swept daily by pg_cron.
--   * A cache hit is not a paid scan, so waves_record_receipt gains p_cached,
--     which writes a 'receipt_scan_cached' usage event that
--     waves_scans_used_this_month() (kind = 'receipt_scan') does not count.

CREATE TABLE IF NOT EXISTS public.receipt_parse_cache (
  sha256         text        NOT NULL,
  model          text        NOT NULL,
  schema_version text        NOT NULL,
  currency       text        NOT NULL DEFAULT '',
  result         jsonb       NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  hit_count      integer     NOT NULL DEFAULT 0,
  last_hit_at    timestamptz,
  PRIMARY KEY (sha256, model, schema_version, currency),
  CONSTRAINT receipt_parse_cache_sha256_shape CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT receipt_parse_cache_hits_nonneg CHECK (hit_count >= 0)
);

CREATE INDEX IF NOT EXISTS receipt_parse_cache_created_idx
  ON public.receipt_parse_cache (created_at);

ALTER TABLE public.receipt_parse_cache ENABLE ROW LEVEL SECURITY;

-- Supabase's default privileges hand new tables to anon and authenticated.
REVOKE ALL ON TABLE public.receipt_parse_cache FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.receipt_parse_cache TO service_role;

-- Look up, and count the hit. Entries older than 30 days are treated as absent
-- even before the sweep removes them.
CREATE OR REPLACE FUNCTION public.waves_receipt_cache_get(
  p_sha256 text, p_model text, p_schema_version text, p_currency text DEFAULT ''
) RETURNS jsonb
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  UPDATE public.receipt_parse_cache
     SET hit_count = hit_count + 1, last_hit_at = now()
   WHERE sha256 = p_sha256
     AND model = p_model
     AND schema_version = p_schema_version
     AND currency = COALESCE(p_currency, '')
     AND created_at > now() - interval '30 days'
  RETURNING result;
$$;

REVOKE ALL ON FUNCTION public.waves_receipt_cache_get(text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.waves_receipt_cache_get(text, text, text, text) TO service_role;

-- Store a result. A concurrent writer of the same key just refreshes it.
CREATE OR REPLACE FUNCTION public.waves_receipt_cache_put(
  p_sha256 text, p_model text, p_schema_version text, p_currency text, p_result jsonb
) RETURNS void
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  INSERT INTO public.receipt_parse_cache (sha256, model, schema_version, currency, result)
  VALUES (p_sha256, p_model, p_schema_version, COALESCE(p_currency, ''), p_result)
  ON CONFLICT (sha256, model, schema_version, currency) DO UPDATE
    SET result = excluded.result, created_at = now();
$$;

REVOKE ALL ON FUNCTION public.waves_receipt_cache_put(text, text, text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.waves_receipt_cache_put(text, text, text, text, jsonb) TO service_role;

-- Retention.
CREATE OR REPLACE FUNCTION public.waves_prune_receipt_parse_cache() RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_deleted integer;
BEGIN
  DELETE FROM public.receipt_parse_cache WHERE created_at < now() - interval '30 days';
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END
$$;

REVOKE ALL ON FUNCTION public.waves_prune_receipt_parse_cache() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.waves_prune_receipt_parse_cache() TO service_role;

-- Guarded like the other schedules: a local stack has no pg_cron.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('waves-prune-receipt-parse-cache')
      WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'waves-prune-receipt-parse-cache');
    PERFORM cron.schedule(
      'waves-prune-receipt-parse-cache',
      '40 3 * * *',
      $cron$SELECT public.waves_prune_receipt_parse_cache();$cron$
    );
  END IF;
END
$$;

-- waves_record_receipt: the same function plus p_cached. Replacing it with a
-- longer signature would leave the old one beside it, so drop that first.
DROP FUNCTION IF EXISTS public.waves_record_receipt(uuid, uuid, uuid, text, text, text, jsonb, text, integer, integer);

CREATE OR REPLACE FUNCTION public.waves_record_receipt(p_group_id uuid, p_receipt_id uuid, p_profile_id uuid, p_source text, p_storage_path text, p_raw_text text, p_parsed jsonb, p_status text, p_input_tokens integer DEFAULT 0, p_output_tokens integer DEFAULT 0, p_cached boolean DEFAULT false) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_id uuid;
BEGIN
  -- Serialize recording for this group, so the count below and the INSERT are
  -- atomic against a concurrent recorder for the same group (TOCTOU). Keyed on
  -- the group, released on commit/rollback. Same device as the ghost-merge
  -- serialization (20260816150000).
  PERFORM pg_advisory_xact_lock(hashtext('waves_record_receipt:' || p_group_id::text)::bigint);

  -- The group question first: a non-null id that already exists in a DIFFERENT
  -- group is neither a new receipt for this group nor a valid update of one, so
  -- it is refused before the cap is even consulted — an accurate error, and no
  -- report of this group's cap state for a receipt that was never in it.
  IF p_receipt_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.receipts
     WHERE id = p_receipt_id AND group_id <> p_group_id
  ) THEN
    RAISE EXCEPTION 'RECEIPT_GROUP_MISMATCH'
      USING ERRCODE = 'check_violation',
            HINT = 'That receipt belongs to a different group.';
  END IF;

  -- The ceiling, enforced at the one insert path. A paid group is exempt; an
  -- update of a receipt that already exists IN THIS GROUP is not a new receipt
  -- and is exempt.
  IF NOT public.waves_group_is_paid(p_group_id)
     AND (p_receipt_id IS NULL
          OR NOT EXISTS (
            SELECT 1 FROM public.receipts
             WHERE id = p_receipt_id AND group_id = p_group_id
          ))
     AND (SELECT count(*) FROM public.receipts WHERE group_id = p_group_id)
         >= public.waves_receipt_cap()
  THEN
    RAISE EXCEPTION 'RECEIPT_CAP'
      USING ERRCODE = 'check_violation',
            HINT = 'This group has reached its receipt limit; upgrade or add storage to add more.';
  END IF;

  -- Insert, or update only when the conflicting row is already this group's. The
  -- cross-group case is already refused above; this WHERE is the backstop.
  INSERT INTO public.receipts
    (id, group_id, storage_path, source, raw_text, parse_status, parsed, created_by)
  VALUES
    (COALESCE(p_receipt_id, gen_random_uuid()), p_group_id, p_storage_path,
     p_source::"ReceiptSource", p_raw_text, p_status::"ParseStatus", p_parsed,
     public.waves_my_member_id_for(p_group_id, p_profile_id))
  ON CONFLICT (id) DO UPDATE
    SET parsed = excluded.parsed,
        parse_status = excluded.parse_status,
        raw_text = excluded.raw_text
    WHERE receipts.group_id = p_group_id
  RETURNING id INTO v_id;

  -- Backstop: no row means the id exists but in a different group (already caught
  -- above). Refuse rather than return NULL.
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'RECEIPT_GROUP_MISMATCH'
      USING ERRCODE = 'check_violation',
            HINT = 'That receipt belongs to a different group.';
  END IF;

  -- Metered because each scan has a real API cost to watch (ADR-011).
  INSERT INTO public.usage_events
    (profile_id, group_id, kind, input_tokens, output_tokens, metadata)
  VALUES (p_profile_id, p_group_id,
          CASE WHEN p_cached THEN 'receipt_scan_cached' ELSE 'receipt_scan' END,
          p_input_tokens, p_output_tokens,
          jsonb_build_object('receiptId', v_id, 'status', p_status, 'cached', p_cached));

  RETURN v_id;
END
$$;

REVOKE ALL ON FUNCTION public.waves_record_receipt(uuid, uuid, uuid, text, text, text, jsonb, text, integer, integer, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.waves_record_receipt(uuid, uuid, uuid, text, text, text, jsonb, text, integer, integer, boolean) TO service_role;
