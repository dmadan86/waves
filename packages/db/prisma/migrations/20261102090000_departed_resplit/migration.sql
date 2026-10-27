-- A departed member's shares move atomically; undo appends versions, never
-- mutates history. Like import_batches, clients may read but only RPCs write.
CREATE TABLE public.resplit_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES public.groups(id) ON UPDATE CASCADE ON DELETE CASCADE,
  member_id uuid NOT NULL REFERENCES public.group_members(id) ON UPDATE CASCADE,
  actor_member_id uuid REFERENCES public.group_members(id) ON UPDATE CASCADE ON DELETE SET NULL,
  client_mutation_id uuid NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  undone_at timestamptz
);
CREATE INDEX resplit_batches_group_id_created_at_idx ON public.resplit_batches(group_id, created_at);
ALTER TABLE public.resplit_batches ENABLE ROW LEVEL SECURITY;
CREATE POLICY resplit_batches_select ON public.resplit_batches FOR SELECT TO authenticated
  USING (public.is_group_member(group_id));
REVOKE ALL ON TABLE public.resplit_batches FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.resplit_batches TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.resplit_batches TO service_role;

ALTER TABLE public.expense_versions ADD COLUMN resplit_batch_id uuid
  REFERENCES public.resplit_batches(id) ON UPDATE CASCADE ON DELETE SET NULL;
CREATE INDEX expense_versions_resplit_batch_id_idx ON public.expense_versions(resplit_batch_id)
  WHERE resplit_batch_id IS NOT NULL;

-- The shared apply RPC owns version creation. Stamp BEFORE INSERT to respect
-- its append-only guard; suppress its per-expense activity in favour of ONE
-- batch entry. These invoker triggers only trust a definer's local context,
-- scoped to a real batch, its actor, and its group. Undo uses the same context
-- for quiet activity but deliberately does not stamp the restoring versions.
CREATE FUNCTION public.waves_resplit_write_context() RETURNS trigger
LANGUAGE plpgsql SET search_path TO 'public', 'pg_temp' AS $$
DECLARE
  v_batch public.resplit_batches;
BEGIN
  IF current_user IN ('anon', 'authenticated')
     OR nullif(current_setting('waves.resplit_batch', true), '') IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT * INTO v_batch FROM public.resplit_batches
    WHERE id = nullif(current_setting('waves.resplit_batch', true), '')::uuid
      AND undone_at IS NULL;
  IF NOT FOUND THEN RETURN NEW; END IF;
  IF TG_TABLE_NAME = 'expense_versions' THEN
    IF NEW.author_member_id = public.waves_my_member_id_for(v_batch.group_id, public.waves_current_profile_id())
       AND EXISTS (SELECT 1 FROM public.expenses WHERE id = NEW.expense_id AND group_id = v_batch.group_id)
       AND current_setting('waves.resplit_action', true) = 'apply' THEN
      NEW.resplit_batch_id := v_batch.id;
    END IF;
  ELSIF NEW.group_id = v_batch.group_id AND NEW.object_type = 'expense'
        AND NEW.verb = 'edited'
        AND NEW.actor_member_id = public.waves_my_member_id_for(v_batch.group_id, public.waves_current_profile_id()) THEN
    RETURN NULL;
  END IF;
  RETURN NEW;
END
$$;
REVOKE ALL ON FUNCTION public.waves_resplit_write_context() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER expense_versions_resplit_context BEFORE INSERT ON public.expense_versions
  FOR EACH ROW EXECUTE FUNCTION public.waves_resplit_write_context();
CREATE TRIGGER activity_log_resplit_context BEFORE INSERT ON public.activity_log
  FOR EACH ROW EXECUTE FUNCTION public.waves_resplit_write_context();

-- Private adapter: both forward and undo writes carry every other field and
-- the complete payer set through the canonical apply path. Its JSON uses the
-- actual waves_apply_expense contract (memberId / amount), unlike public items.
CREATE FUNCTION public.waves_apply_resplit_version(
  p_version_id uuid, p_actor uuid, p_split_type text, p_split_params jsonb, p_shares jsonb
) RETURNS jsonb
LANGUAGE plpgsql SET search_path TO 'public', 'pg_temp' AS $$
DECLARE
  v public.expense_versions;
  v_group uuid;
  v_payers jsonb;
BEGIN
  SELECT * INTO STRICT v FROM public.expense_versions WHERE id = p_version_id;
  SELECT group_id INTO v_group FROM public.expenses WHERE id = v.expense_id;
  SELECT jsonb_agg(jsonb_build_object('memberId', member_id, 'amount', amount::text) ORDER BY member_id)
    INTO v_payers FROM public.expense_payers WHERE expense_version_id = v.id;
  RETURN public.waves_apply_expense(
    p_group_id => v_group, p_expense_id => v.expense_id, p_author_member_id => p_actor,
    p_description => v.description, p_category => v.category, p_expense_date => v.expense_date,
    p_currency => v.currency, p_amount => v.amount, p_split_type => p_split_type,
    p_split_params => p_split_params, p_payers => v_payers, p_shares => p_shares,
    p_client_mutation_id => gen_random_uuid(), p_notes => v.notes, p_receipt_id => v.receipt_id,
    p_base_version_no => (SELECT ev.version_no FROM public.expenses e
      JOIN public.expense_versions ev ON ev.id = e.current_version_id WHERE e.id = v.expense_id),
    p_fx => v.fx, p_source => v.source::text, p_payment_method => v.payment_method,
    p_receipt_share_url => v.receipt_share_url, p_category_meta => v.category_meta,
    p_location => v.location, p_sub_event_id => v.sub_event_id, p_is_deposit => v.is_deposit,
    p_balance_due_minor => v.balance_due_minor, p_balance_due_date => v.balance_due_date,
    p_occurred_at => v.occurred_at, p_payee => COALESCE(v.payee, ''),
    p_import_batch_id => v.import_batch_id, p_reimbursable => v.reimbursable
  );
END
$$;
REVOKE ALL ON FUNCTION public.waves_apply_resplit_version(uuid, uuid, text, jsonb, jsonb)
  FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.waves_resplit_departed(
  p_group_id uuid, p_member_id uuid, p_items jsonb, p_client_mutation_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
DECLARE
  v_member public.group_members;
  v_batch public.resplit_batches;
  v_actor uuid;
  v_item jsonb;
  v public.expense_versions;
  v_shares jsonb;
  v_count integer := 0;
  v_amount bigint := 0;
  v_share bigint;
  v_name text;
  v_actor_name text;
  v_group_name text;
  v_currency text;
  v_balance bigint;
BEGIN
  IF public.waves_current_profile_id() IS NULL OR NOT public.is_group_admin(p_group_id) THEN
    RAISE EXCEPTION 'NOT_ADMIN: only an admin can re-split shares' USING ERRCODE = 'insufficient_privilege';
  END IF;
  v_actor := public.waves_my_member_id_for(p_group_id, public.waves_current_profile_id());
  -- waves_remove_member serializes on this group_members row. Re-inviting and
  -- removing cannot race the departed check and the writes that follow it.
  SELECT * INTO v_member FROM public.group_members
    WHERE id = p_member_id AND group_id = p_group_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: no such member in this group' USING ERRCODE = 'no_data_found';
  END IF;
  IF p_client_mutation_id IS NULL THEN
    RAISE EXCEPTION 'NO_MUTATION_ID: a re-split needs a mutation id' USING ERRCODE = 'check_violation';
  END IF;
  INSERT INTO public.resplit_batches(group_id, member_id, actor_member_id, client_mutation_id)
    VALUES (p_group_id, p_member_id, v_actor, p_client_mutation_id)
    ON CONFLICT (client_mutation_id) DO NOTHING RETURNING * INTO v_batch;
  IF NOT FOUND THEN
    SELECT * INTO STRICT v_batch FROM public.resplit_batches WHERE client_mutation_id = p_client_mutation_id;
    IF v_batch.group_id <> p_group_id OR v_batch.member_id <> p_member_id
       OR v_batch.actor_member_id IS DISTINCT FROM v_actor THEN
      RAISE EXCEPTION 'BATCH_CONFLICT: that mutation belongs to another re-split' USING ERRCODE = 'insufficient_privilege';
    END IF;
    -- The immutable activity payload keeps original totals even after undo.
    RETURN (SELECT jsonb_build_object('batchId', v_batch.id, 'count', payload->'count',
      'amount', payload->'amount', 'replayed', true) FROM public.activity_log
      WHERE object_id = v_batch.id AND object_type = 'resplit_batch' AND verb = 'resplit');
  END IF;
  -- A replay remains a replay if the member has since been re-invited.
  IF v_member.left_at IS NULL AND v_member.removed_at IS NULL THEN
    RAISE EXCEPTION 'MEMBER_NOT_DEPARTED: the member must have left' USING ERRCODE = 'check_violation';
  END IF;
  IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'INVALID_ITEMS: items must be a list' USING ERRCODE = 'check_violation';
  END IF;
  IF jsonb_array_length(p_items) = 0 OR jsonb_array_length(p_items) > 500
     OR (SELECT count(DISTINCT value->>'expense_id') FROM jsonb_array_elements(p_items)) <> jsonb_array_length(p_items) THEN
    RAISE EXCEPTION 'INVALID_ITEMS: send 1 to 500 distinct expenses' USING ERRCODE = 'check_violation';
  END IF;
  -- Lock in deterministic order before reading a base version. All writes are
  -- in this transaction: one stale item rolls back the entire batch.
  PERFORM e.id FROM public.expenses e
    WHERE e.id IN (SELECT (value->>'expense_id')::uuid FROM jsonb_array_elements(p_items))
    ORDER BY e.id FOR UPDATE;
  PERFORM set_config('waves.resplit_batch', v_batch.id::text, true);
  PERFORM set_config('waves.resplit_action', 'apply', true);
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
    SELECT ev.* INTO v FROM public.expenses e JOIN public.expense_versions ev ON ev.id = e.current_version_id
      WHERE e.id = (v_item->>'expense_id')::uuid AND e.group_id = p_group_id AND e.deleted_at IS NULL;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'NOT_FOUND: no live expense in this group' USING ERRCODE = 'no_data_found';
    END IF;
    IF (v_item->>'base_version_no')::integer IS DISTINCT FROM v.version_no THEN
      RAISE EXCEPTION 'STALE_VERSION: an expense has changed' USING ERRCODE = 'check_violation';
    END IF;
    IF EXISTS (SELECT 1 FROM public.expense_payers WHERE expense_version_id = v.id AND member_id = p_member_id) THEN
      RAISE EXCEPTION 'DEPARTED_PAYER: cannot move a payer share' USING ERRCODE = 'check_violation';
    END IF;
    SELECT amount INTO v_share FROM public.expense_shares WHERE expense_version_id = v.id AND member_id = p_member_id;
    IF v_share IS NULL OR v_share <= 0 THEN
      RAISE EXCEPTION 'NO_SHARE: the departed member has no share' USING ERRCODE = 'check_violation';
    END IF;
    IF jsonb_typeof(v_item->'shares') IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'INVALID_SHARES: shares must be a list' USING ERRCODE = 'check_violation';
    END IF;
    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_item->'shares') s
      WHERE (s->>'member_id') IS NULL OR (s->>'amount_minor') IS NULL
        OR (s->>'amount_minor')::bigint < 0
        OR NOT EXISTS (SELECT 1 FROM public.group_members m
          WHERE m.id = (s->>'member_id')::uuid AND m.group_id = p_group_id
            AND m.id <> p_member_id AND m.left_at IS NULL AND m.removed_at IS NULL)
    ) OR (SELECT count(DISTINCT s->>'member_id') FROM jsonb_array_elements(v_item->'shares') s)
           <> jsonb_array_length(v_item->'shares')
      OR (SELECT sum((s->>'amount_minor')::bigint) FROM jsonb_array_elements(v_item->'shares') s) IS DISTINCT FROM v.amount::numeric THEN
      RAISE EXCEPTION 'INVALID_SHARES: unique remaining members must sum to the expense amount' USING ERRCODE = 'check_violation';
    END IF;
    SELECT jsonb_agg(jsonb_build_object('memberId', s->>'member_id', 'amount', s->>'amount_minor'))
      INTO v_shares FROM jsonb_array_elements(v_item->'shares') s;
    PERFORM public.waves_apply_resplit_version(v.id, v_actor, v_item->>'split_type', v_item->'split_params', v_shares);
    v_count := v_count + 1;
    v_amount := v_amount + v_share;
  END LOOP;
  PERFORM set_config('waves.resplit_batch', '', true);
  PERFORM set_config('waves.resplit_action', '', true);
  SELECT COALESCE(p.display_name, v_member.ghost_name, 'Departed member') INTO v_name
    FROM (SELECT 1) x LEFT JOIN public.profiles p ON p.id = v_member.profile_id;
  INSERT INTO public.activity_log(group_id, actor_member_id, verb, object_type, object_id, payload)
    VALUES (p_group_id, v_actor, 'resplit', 'resplit_batch', v_batch.id,
      jsonb_build_object('name', v_name, 'count', v_count, 'amount', v_amount::text, 'batchId', v_batch.id));
  SELECT display_name INTO v_actor_name FROM public.profiles WHERE id = public.waves_current_profile_id();
  SELECT name, default_currency INTO v_group_name, v_currency FROM public.groups WHERE id = p_group_id;
  SELECT COALESCE(sum(balance), 0) INTO v_balance FROM public.waves_group_balances_truth(p_group_id)
    WHERE member_id = p_member_id AND currency = v_currency;
  PERFORM public.waves_notify(v_member.profile_id, p_group_id, 'resplit',
    COALESCE(v_actor_name, 'Someone') || ' moved your expense shares',
    v_count::text || ' expenses in ' || v_group_name || ' were re-split',
    NULL, jsonb_build_object('counterparty', COALESCE(v_actor_name, 'Someone'), 'group', v_group_name,
      'count', v_count::text, 'amount', v_balance::text, 'currency', v_currency, 'batchId', v_batch.id),
    'resplit:' || v_batch.id::text);
  RETURN jsonb_build_object('batchId', v_batch.id, 'count', v_count, 'amount', v_amount::text, 'replayed', false);
END
$$;
REVOKE ALL ON FUNCTION public.waves_resplit_departed(uuid, uuid, jsonb, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.waves_resplit_departed(uuid, uuid, jsonb, uuid) TO authenticated;

CREATE FUNCTION public.waves_undo_resplit(p_batch_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
DECLARE
  v_batch public.resplit_batches;
  v_actor uuid;
  v public.expense_versions;
  v_old public.expense_versions;
  v_current uuid;
  v_deleted timestamptz;
  v_shares jsonb;
  v_restored integer := 0;
  v_skipped integer := 0;
BEGIN
  -- Match forward lock order: member, batch, then expenses ordered by id.
  SELECT * INTO v_batch FROM public.resplit_batches WHERE id = p_batch_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND: no such re-split' USING ERRCODE = 'no_data_found'; END IF;
  IF public.waves_current_profile_id() IS NULL OR NOT public.is_group_admin(v_batch.group_id) THEN
    RAISE EXCEPTION 'NOT_ADMIN: only an admin can undo a re-split' USING ERRCODE = 'insufficient_privilege';
  END IF;
  PERFORM 1 FROM public.group_members WHERE id = v_batch.member_id FOR UPDATE;
  SELECT * INTO v_batch FROM public.resplit_batches WHERE id = p_batch_id FOR UPDATE;
  v_actor := public.waves_my_member_id_for(v_batch.group_id, public.waves_current_profile_id());
  IF v_batch.undone_at IS NOT NULL THEN
    RETURN jsonb_build_object('restored', 0, 'skipped', 0);
  END IF;
  IF now() > v_batch.created_at + interval '7 days' THEN
    RAISE EXCEPTION 'RESPLIT_UNDO_EXPIRED: undo is only available for 7 days' USING ERRCODE = 'check_violation';
  END IF;
  PERFORM e.id FROM public.expenses e WHERE e.id IN
    (SELECT expense_id FROM public.expense_versions WHERE resplit_batch_id = p_batch_id)
    ORDER BY e.id FOR UPDATE;
  PERFORM set_config('waves.resplit_batch', p_batch_id::text, true);
  PERFORM set_config('waves.resplit_action', 'undo', true);
  FOR v IN SELECT * FROM public.expense_versions WHERE resplit_batch_id = p_batch_id ORDER BY expense_id LOOP
    SELECT current_version_id, deleted_at INTO v_current, v_deleted FROM public.expenses WHERE id = v.expense_id;
    IF v_current IS DISTINCT FROM v.id OR v_deleted IS NOT NULL THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;
    SELECT * INTO STRICT v_old FROM public.expense_versions
      WHERE expense_id = v.expense_id AND version_no = v.version_no - 1;
    SELECT jsonb_agg(jsonb_build_object('memberId', member_id, 'amount', amount::text) ORDER BY member_id)
      INTO v_shares FROM public.expense_shares WHERE expense_version_id = v_old.id;
    PERFORM public.waves_apply_resplit_version(v_old.id, v_actor, v_old.split_type::text, v_old.split_params, v_shares);
    v_restored := v_restored + 1;
  END LOOP;
  PERFORM set_config('waves.resplit_batch', '', true);
  PERFORM set_config('waves.resplit_action', '', true);
  UPDATE public.resplit_batches SET undone_at = now() WHERE id = p_batch_id;
  INSERT INTO public.activity_log(group_id, actor_member_id, verb, object_type, object_id, payload)
    VALUES (v_batch.group_id, v_actor, 'resplit_undone', 'resplit_batch', p_batch_id,
      jsonb_build_object('restored', v_restored, 'skipped', v_skipped, 'batchId', p_batch_id));
  RETURN jsonb_build_object('restored', v_restored, 'skipped', v_skipped);
END
$$;
REVOKE ALL ON FUNCTION public.waves_undo_resplit(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.waves_undo_resplit(uuid) TO authenticated;

-- Push keeps using the involves-me preference and group mute rules.
CREATE OR REPLACE FUNCTION public.waves_pref_key_for_kind(p_kind text) RETURNS text
    LANGUAGE sql IMMUTABLE
    SET search_path TO 'public', 'pg_temp'
    AS $$
  SELECT CASE p_kind
    WHEN 'expense_added'             THEN 'involvesMe'
    WHEN 'expense_edited'            THEN 'involvesMe'
    WHEN 'expense_deleted'           THEN 'involvesMe'
    WHEN 'you_owe'                   THEN 'involvesMe'
    WHEN 'expense_disputed'          THEN 'involvesMe'
    WHEN 'expense_dispute_resolved'  THEN 'involvesMe'
    WHEN 'ghost_claimed'             THEN 'involvesMe'
    WHEN 'ghost_claim_requested'     THEN 'involvesMe'
    WHEN 'ghost_claim_approved'      THEN 'involvesMe'
    WHEN 'ghost_claim_declined'      THEN 'involvesMe'
    WHEN 'member_link_requested'     THEN 'involvesMe'
    WHEN 'member_link_accepted'      THEN 'involvesMe'
    WHEN 'member_link_declined'      THEN 'involvesMe'
    WHEN 'member_linked'             THEN 'involvesMe'
    WHEN 'group_invite_accepted'     THEN 'involvesMe'
    WHEN 'group_added'               THEN 'involvesMe'
    WHEN 'settlement_initiated'      THEN 'settlementRequests'
    WHEN 'settlement_confirm_request' THEN 'settlementRequests'
    WHEN 'settlement_confirmed'      THEN 'settlementRequests'
    WHEN 'settlement_cancelled'      THEN 'settlementRequests'
    WHEN 'settlement_disputed'       THEN 'settlementRequests'
    WHEN 'nudge'                     THEN 'nudges'
    WHEN 'trip_nudge_morning'        THEN 'nudges'
    WHEN 'trip_nudge_evening'        THEN 'nudges'
    WHEN 'digest_daily'              THEN 'groupActivityDigest'
    WHEN 'digest_weekly'             THEN 'groupActivityDigest'
    WHEN 'resplit'                   THEN 'involvesMe'
    WHEN 'group_import'              THEN 'involvesMe'
    ELSE NULL
  END;
$$;

-- Re-splits are ledger mail: the normal email preference and unsubscribe
-- suppression apply, regardless of whether the push arrived.
CREATE OR REPLACE FUNCTION public.waves_claim_email_notifications(p_limit integer DEFAULT 100) RETURNS TABLE(id uuid, kind text, title text, body text, deep_link text, payload jsonb, locale text, address text, group_name text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_ids UUID[];
BEGIN
  WITH picked AS (
    SELECT n.id
    FROM public.notifications n
    WHERE n.email_status IS NULL
      -- Same two days as push — a mail about a reminder from Tuesday is
      -- worse than no mail.
      AND n.created_at > now() - interval '2 days'
      AND n.kind IN ('settlement_initiated', 'settlement_confirm_request',
                     'digest_daily', 'digest_weekly', 'nudge', 'group_added',
                     'new_device_login', 'resplit')
      AND (
        n.kind <> 'group_added'
        OR n.push_status = 'sent'
        OR (n.push_status = 'failed' AND n.push_next_retry_at IS NULL)
      )
    ORDER BY n.created_at
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  ),
  claimed AS (
    UPDATE public.notifications n
       SET email_status = 'queued'
      FROM picked
     WHERE n.id = picked.id
    RETURNING n.id
  )
  SELECT COALESCE(array_agg(claimed.id), '{}') INTO v_ids FROM claimed;

  -- No address is the end of it for every kind. The *preference* is not:
  -- turning off email means "stop telling me about ledgers", and nobody means
  -- it to include "and stop telling me when my account is opened somewhere".
  -- A hard suppression (bounce, complaint, unsubscribe) still wins below —
  -- that one is the mailbox refusing, not the person choosing.
  UPDATE public.notifications n
     SET email_status = 'suppressed'
   WHERE n.id = ANY(v_ids)
     AND (
       public.waves_email_for(n.profile_id) IS NULL
       OR (
         n.kind <> 'new_device_login'
         AND NOT COALESCE(
              (SELECT (p.notification_prefs ->> 'email')::boolean
               FROM public.profiles p WHERE p.id = n.profile_id),
              TRUE
            )
       )
     );

  UPDATE public.notifications n
     SET email_status = 'suppressed'
   WHERE n.id = ANY(v_ids)
     AND n.email_status = 'queued'
     AND public.waves_email_suppressed(public.waves_email_for(n.profile_id));

  -- TDR §7.4: a nudge goes by email only to somebody with no live device —
  -- everybody else already got a buzz about it. `new_device_login` is
  -- deliberately absent from this rule: the push goes to the devices, and the
  -- device is the thing in question.
  UPDATE public.notifications n
     SET email_status = 'suppressed'
   WHERE n.id = ANY(v_ids)
     AND n.email_status = 'queued'
     AND n.kind = 'nudge'
     AND EXISTS (
       SELECT 1 FROM public.push_tokens t
       WHERE t.profile_id = n.profile_id AND t.revoked_at IS NULL
     );

  UPDATE public.notifications n
     SET email_status = 'suppressed'
   WHERE n.id = ANY(v_ids)
     AND n.email_status = 'queued'
     AND n.kind = 'group_added'
     AND (
       n.push_status = 'sent'
       OR (
         EXISTS (
           SELECT 1 FROM public.push_tokens t
           WHERE t.profile_id = n.profile_id AND t.revoked_at IS NULL
         )
         AND NOT (n.push_status = 'failed' AND n.push_attempts >= 3)
       )
     );

  RETURN QUERY
  SELECT n.id, n.kind, n.title, n.body, n.deep_link, n.payload,
         COALESCE(p.locale, 'en'),
         public.waves_email_for(n.profile_id),
         g.name
  FROM public.notifications n
  LEFT JOIN public.profiles p ON p.id = n.profile_id
  LEFT JOIN public.groups g ON g.id = n.group_id
  WHERE n.id = ANY(v_ids) AND n.email_status = 'queued';
END
$$;

-- Service role only, exactly as the baseline had it: the fanout calls this, and
-- nobody signed in has any business claiming somebody else's mail.
REVOKE ALL ON FUNCTION public.waves_claim_email_notifications(p_limit integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.waves_claim_email_notifications(p_limit integer) TO service_role;

