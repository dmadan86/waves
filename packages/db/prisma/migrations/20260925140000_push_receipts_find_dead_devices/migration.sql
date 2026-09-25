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
-- of the fanout claims tickets old enough to have a receipt, asks Expo, and
-- revokes the tokens whose receipt says the device is gone (through
-- `waves_finish_push`, like a ticket-time refusal). One ticket per device is
-- enough: the question is whether the device still exists, not what happened
-- to each message.

ALTER TABLE public.push_tokens
  ADD COLUMN last_ticket_id text,
  ADD COLUMN last_ticket_at timestamptz;

CREATE INDEX push_tokens_pending_receipt_idx
  ON public.push_tokens (last_ticket_at)
  WHERE last_ticket_id IS NOT NULL;

CREATE FUNCTION public.waves_record_push_tickets(p_tickets jsonb) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
BEGIN
  UPDATE public.push_tokens t
     SET last_ticket_id = r.ticket_id,
         last_ticket_at = now()
    FROM jsonb_to_recordset(COALESCE(p_tickets, '[]'::jsonb)) AS r(token text, ticket_id text)
   WHERE t.expo_push_token = r.token
     AND r.ticket_id IS NOT NULL;
END
$$;

-- Claims up to p_limit tickets at least 15 minutes old (Expo's advice for when
-- a receipt is ready) and clears them, so two overlapping runs never ask twice.
-- A ticket older than a day is cleared without being returned: Expo keeps
-- receipts for 24 hours, and asking after that proves nothing.
CREATE FUNCTION public.waves_claim_push_receipts(p_limit integer DEFAULT 1000)
    RETURNS TABLE(token text, ticket_id text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
BEGIN
  RETURN QUERY
  WITH picked AS (
    SELECT p.id, p.last_ticket_id, p.last_ticket_at
      FROM public.push_tokens p
     WHERE p.last_ticket_id IS NOT NULL
       AND p.last_ticket_at < now() - interval '15 minutes'
     ORDER BY p.last_ticket_at
     LIMIT GREATEST(p_limit, 0)
       FOR UPDATE SKIP LOCKED
  ), cleared AS (
    UPDATE public.push_tokens t
       SET last_ticket_id = NULL,
           last_ticket_at = NULL
      FROM picked
     WHERE t.id = picked.id
    RETURNING t.expo_push_token, t.revoked_at, picked.last_ticket_id, picked.last_ticket_at
  )
  SELECT c.expo_push_token, c.last_ticket_id
    FROM cleared c
   WHERE c.revoked_at IS NULL
     AND c.last_ticket_at > now() - interval '24 hours';
END
$$;

REVOKE ALL ON FUNCTION public.waves_record_push_tickets(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.waves_record_push_tickets(jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.waves_claim_push_receipts(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.waves_claim_push_receipts(integer) TO service_role;
