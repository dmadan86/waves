-- Push receipts find the devices that are gone.
--
-- Expo's reply to a send is a ticket, and a ticket only says Expo accepted the
-- message. Whether Apple or Google then delivered it — and in particular that
-- the app is no longer installed (`DeviceNotRegistered`) — comes back later as
-- a receipt, against the ticket id. `notify-fanout` never asked, so a token
-- from an uninstalled or reinstalled app stayed live forever: every
-- notification to it was marked 'sent' and reached nobody.
--
-- Each device keeps the ticket for the last message it accepted. A later run
-- of the fanout leases tickets old enough to have a receipt, asks Expo,
-- revokes the tokens whose receipt says the device is gone (through
-- `waves_finish_push`, like a ticket-time refusal), and only then clears them. One ticket per device is
-- enough: the question is whether the device still exists, not what happened
-- to each message.

ALTER TABLE public.push_tokens
  ADD COLUMN last_ticket_id text,
  ADD COLUMN last_ticket_at timestamptz,
  ADD COLUMN receipt_lease_until timestamptz;

CREATE INDEX push_tokens_pending_receipt_idx
  ON public.push_tokens (last_ticket_at)
  WHERE last_ticket_id IS NOT NULL;

-- A fresh ticket replaces the old one and drops any lease on it: the device's
-- newest message is the one worth asking about.
CREATE FUNCTION public.waves_record_push_tickets(p_tickets jsonb) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
BEGIN
  UPDATE public.push_tokens t
     SET last_ticket_id = r.ticket_id,
         last_ticket_at = now(),
         receipt_lease_until = NULL
    FROM jsonb_to_recordset(COALESCE(p_tickets, '[]'::jsonb)) AS r(token text, ticket_id text)
   WHERE t.expo_push_token = r.token
     AND r.ticket_id IS NOT NULL;
END
$$;

-- Leases up to p_limit tickets that are due: at least 15 minutes old (Expo's
-- advice for when a receipt is ready), under a day old (Expo keeps receipts for
-- 24 hours), on a live token, and not already leased by a run in progress. The
-- ticket stays on the row until `waves_clear_push_receipts` — a run that fails
-- to reach Expo leaves it to be asked again once the lease lapses.
--
-- Tickets that can no longer be asked about (too old, or on a revoked token)
-- are cleared first, unlimited, so they never crowd due ones out of the limit.
CREATE FUNCTION public.waves_claim_push_receipts(p_limit integer DEFAULT 1000)
    RETURNS TABLE(token text, ticket_id text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
BEGIN
  UPDATE public.push_tokens p
     SET last_ticket_id = NULL,
         last_ticket_at = NULL,
         receipt_lease_until = NULL
   WHERE p.last_ticket_id IS NOT NULL
     AND (p.revoked_at IS NOT NULL OR p.last_ticket_at <= now() - interval '24 hours');

  RETURN QUERY
  WITH due AS (
    SELECT p.id
      FROM public.push_tokens p
     WHERE p.last_ticket_id IS NOT NULL
       AND p.revoked_at IS NULL
       AND p.last_ticket_at < now() - interval '15 minutes'
       AND p.last_ticket_at > now() - interval '24 hours'
       AND (p.receipt_lease_until IS NULL OR p.receipt_lease_until < now())
     ORDER BY p.last_ticket_at
     LIMIT GREATEST(p_limit, 0)
       FOR UPDATE SKIP LOCKED
  ), leased AS (
    UPDATE public.push_tokens t
       SET receipt_lease_until = now() + interval '5 minutes'
      FROM due
     WHERE t.id = due.id
    RETURNING t.expo_push_token, t.last_ticket_id
  )
  SELECT l.expo_push_token, l.last_ticket_id FROM leased l;
END
$$;

-- Called once the receipts have been read. Matches on the ticket, not the
-- token, so a newer ticket recorded meanwhile is left for its own check.
CREATE FUNCTION public.waves_clear_push_receipts(p_ticket_ids text[]) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
BEGIN
  UPDATE public.push_tokens
     SET last_ticket_id = NULL,
         last_ticket_at = NULL,
         receipt_lease_until = NULL
   WHERE last_ticket_id = ANY(COALESCE(p_ticket_ids, '{}'::text[]));
END
$$;

REVOKE ALL ON FUNCTION public.waves_record_push_tickets(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.waves_record_push_tickets(jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.waves_claim_push_receipts(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.waves_claim_push_receipts(integer) TO service_role;
REVOKE ALL ON FUNCTION public.waves_clear_push_receipts(text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.waves_clear_push_receipts(text[]) TO service_role;
