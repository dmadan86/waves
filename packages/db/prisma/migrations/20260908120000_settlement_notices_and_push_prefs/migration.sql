-- The two halves of M4 that were built but never joined up.
--
-- M4's acceptance criterion (TDR §10) is one sentence: "initiate UPI settle →
-- payee push with Confirm action → balances update". Every piece of that
-- sentence exists — the settle screen, the rails, the state machine, the
-- fan-out, the claim/finish protocol, the templates — except the one in the
-- middle. Nothing has ever written a `settlement_initiated` or a
-- `settlement_confirm_request` row. Those two kinds appear in
-- `waves_claim_email_notifications`'s whitelist, in the copy table in four
-- languages, and in `TEMPLATE_FOR_KIND`; no function in this database produces
-- either. The only settlement notice that exists at all is the one the
-- seven-day job writes when *nobody* answered, which is the branch you reach by
-- never having been told.
--
-- The same gap runs the other way. `waves_settlement_transition` polices
-- `cancelled` and `disputed` — ADR-007 calls them "deliberate mirror images,
-- one per party", and the point of them is that "neither party can silently
-- erase the other's record". Silently is exactly what they do: the payer
-- cancels and the payee is never told; the payee disputes and the payer is
-- never told. The transition is guarded and unheard.
--
-- And the preferences. `profiles.notification_prefs` carries four push
-- switches; the notifications screen renders all four with a "we will never
-- spam you" promise above them. `waves_claim_push_notifications` reads the
-- column not at all. `nudges` happens to work, because `waves_trip_nudges`
-- checks it before enqueuing — and only for trip nudges, not for a nudge
-- somebody sent by hand. `involvesMe`, `settlementRequests` and
-- `groupActivityDigest` are three switches wired to nothing: turning them off
-- has never stopped a single push. That is worse than not offering them.
--
-- Three changes, then: settlements tell the other party, transitions tell the
-- other party, and the push claim honours the switches the way the email claim
-- already honours its one.

-- ───────────────────────────────────────────────── the other party is told ──

-- Who to tell, and what to call everybody. Both notice paths below need the
-- same five facts (each side's profile, each side's name, the group's name),
-- and both have to cope with a party who is a ghost — a placeholder with a
-- `ghost_name` and no profile to notify. Resolving it once keeps the two from
-- drifting, and keeps `COALESCE(display_name, ghost_name)` written down in one
-- place rather than three.
--
-- STABLE, not VOLATILE: it only reads. SECURITY DEFINER because both callers
-- are, and because a payer looking up their payee's display name must not
-- depend on the payer's own RLS view of `profiles`.
CREATE OR REPLACE FUNCTION public.waves_settlement_parties(p_settlement_id uuid)
RETURNS TABLE(
  group_id uuid,
  group_name text,
  amount text,
  currency text,
  payer_profile uuid,
  payer_name text,
  payee_profile uuid,
  payee_name text
)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  SELECT s.group_id,
         g.name,
         -- Text, not bigint: the payload is JSON and a minor-unit amount that
         -- goes through a JSON number comes back as a float. `render.ts` parses
         -- it with BigInt for exactly this reason.
         s.amount::text,
         s.currency::text,
         payer.profile_id,
         COALESCE(payer_profile.display_name, payer.ghost_name),
         payee.profile_id,
         COALESCE(payee_profile.display_name, payee.ghost_name)
    FROM public.settlements s
    JOIN public.groups g            ON g.id = s.group_id
    JOIN public.group_members payer ON payer.id = s.from_member_id
    JOIN public.group_members payee ON payee.id = s.to_member_id
    LEFT JOIN public.profiles payer_profile ON payer_profile.id = payer.profile_id
    LEFT JOIN public.profiles payee_profile ON payee_profile.id = payee.profile_id
   WHERE s.id = p_settlement_id;
$$;

REVOKE ALL ON FUNCTION public.waves_settlement_parties(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.waves_settlement_parties(uuid) TO service_role;

-- Recording a settlement now taps the person on the other end.
--
-- Unchanged from `20260907140000_agent_writes_and_caps` except for the block
-- marked below. The whole body is restated because Postgres has no way to
-- amend a function in place.
--
-- Only the payer's recording notifies. When the *payee* records ("they gave me
-- cash"), the payer is not asked to confirm anything — the money already
-- reached the person who would be doing the confirming — so a push would be a
-- buzz with no action behind it. That side stays in the activity feed, which is
-- where a fact you do not have to answer belongs.
CREATE OR REPLACE FUNCTION public.waves_record_settlement(p_group_id uuid, p_from_member_id uuid, p_to_member_id uuid, p_amount bigint, p_method text, p_currency character DEFAULT NULL::bpchar, p_note text DEFAULT NULL::text, p_allocations jsonb DEFAULT '[]'::jsonb, p_client_mutation_id uuid DEFAULT NULL::uuid, p_rail text DEFAULT NULL::text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_settlement_id uuid;
  v_currency      char(3);
  v_actor         uuid;
  v_allocation    jsonb;
  v_rail          text := COALESCE(NULLIF(btrim(p_rail), ''), p_method);
  v_parties       record;
BEGIN
  IF NOT public.is_group_member(p_group_id) THEN
    RAISE EXCEPTION 'NOT_A_MEMBER: you are not in this group'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Resolve the caller's own member id up front: it is both the authorization
  -- check below and the actor on the activity entry further down.
  v_actor := public.waves_my_member_id(p_group_id);
  IF v_actor IS NULL OR v_actor NOT IN (p_from_member_id, p_to_member_id) THEN
    RAISE EXCEPTION 'NOT_A_PARTY: you can only record a settlement you are part of'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Both parties must be members of THIS group. The FKs only prove the ids are
  -- real `group_members` rows, not that they belong here — without this a member
  -- could name a party from another group, and auto-confirm would later write an
  -- offsetting balance against a member nobody in this group can see, erasing
  -- their own debt while the per-group sum still totals zero.
  IF NOT EXISTS (
        SELECT 1 FROM public.group_members gm
        WHERE gm.id = p_from_member_id AND gm.group_id = p_group_id
      )
     OR NOT EXISTS (
        SELECT 1 FROM public.group_members gm
        WHERE gm.id = p_to_member_id AND gm.group_id = p_group_id
      ) THEN
    RAISE EXCEPTION 'UNKNOWN_MEMBER: both parties must be members of this group'
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'INVALID_AMOUNT: settle a positive amount' USING ERRCODE = 'check_violation';
  END IF;

  -- Replaying the same mutation must not create a second settlement (ADR-005),
  -- and must not spend an agent's daily ceiling again.
  IF p_client_mutation_id IS NOT NULL THEN
    SELECT id INTO v_settlement_id
    FROM public.settlements WHERE client_mutation_id = p_client_mutation_id;
    IF v_settlement_id IS NOT NULL THEN
      RETURN v_settlement_id;
    END IF;
  END IF;

  SELECT COALESCE(p_currency, default_currency) INTO v_currency
  FROM public.groups WHERE id = p_group_id;

  PERFORM public.waves_assert_agent_cap(p_amount);

  INSERT INTO public.settlements
    (group_id, from_member_id, to_member_id, currency, amount, method, rail, status, note,
     client_mutation_id)
  VALUES
    (p_group_id, p_from_member_id, p_to_member_id, upper(v_currency), p_amount,
     CASE WHEN p_method IN ('upi', 'cash', 'bank', 'other') THEN p_method ELSE 'other' END
       ::"SettlementMethod",
     v_rail, 'initiated', p_note, p_client_mutation_id)
  RETURNING id INTO v_settlement_id;

  FOR v_allocation IN SELECT * FROM jsonb_array_elements(COALESCE(p_allocations, '[]'::jsonb))
  LOOP
    INSERT INTO public.settlement_allocations (settlement_id, expense_id, amount)
    VALUES (
      v_settlement_id,
      (v_allocation ->> 'expenseId')::uuid,
      (v_allocation ->> 'amount')::bigint
    )
    ON CONFLICT (settlement_id, expense_id)
    DO UPDATE SET amount = public.settlement_allocations.amount + EXCLUDED.amount;
  END LOOP;

  INSERT INTO public.activity_log (group_id, actor_member_id, verb, object_type, object_id, payload)
  VALUES (p_group_id, v_actor, 'settled', 'settlement', v_settlement_id,
          jsonb_build_object('amount', p_amount, 'currency', v_currency,
                             'method', p_method, 'rail', v_rail));

  PERFORM public.waves_record_agent_write(
    'settlement.record', p_group_id, v_settlement_id, p_amount, upper(v_currency)
  );

  -- ── new: the payee is asked to confirm ──────────────────────────────────
  --
  -- The dedupe key is the settlement id, so the offline queue replaying this
  -- mutation cannot buzz somebody twice — and neither can a retry that got as
  -- far as the INSERT. Deliberately after the writes: a notification that fails
  -- to be written must not lose the settlement, and `waves_notify` is a plain
  -- INSERT with `ON CONFLICT DO NOTHING`, so there is nothing here to fail on
  -- besides the ghost case it already returns NULL for.
  IF v_actor = p_from_member_id THEN
    SELECT * INTO v_parties FROM public.waves_settlement_parties(v_settlement_id);
    PERFORM public.waves_notify(
      v_parties.payee_profile,
      p_group_id,
      'settlement_confirm_request',
      COALESCE(v_parties.payer_name, 'Someone') || ' says they paid you',
      'Confirm it so your balance stays right',
      'waves://group/' || p_group_id::text,
      jsonb_build_object(
        'settlementId', v_settlement_id,
        'amount', v_parties.amount,
        'currency', v_parties.currency,
        'role', 'payee',
        'counterparty', v_parties.payer_name,
        'group', v_parties.group_name
      ),
      'settle_confirm_req:' || v_settlement_id::text
    );
  END IF;

  RETURN v_settlement_id;
END
$$;

REVOKE ALL ON FUNCTION public.waves_record_settlement(p_group_id uuid, p_from_member_id uuid, p_to_member_id uuid, p_amount bigint, p_method text, p_currency character, p_note text, p_allocations jsonb, p_client_mutation_id uuid, p_rail text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.waves_record_settlement(p_group_id uuid, p_from_member_id uuid, p_to_member_id uuid, p_amount bigint, p_method text, p_currency character, p_note text, p_allocations jsonb, p_client_mutation_id uuid, p_rail text) TO authenticated, service_role;

-- ───────────────────────────────────────────── and so does every transition ──

-- A trigger rather than three RPCs, because there are no three RPCs: the app
-- confirms, cancels and disputes by UPDATEing `settlements.status` directly
-- under RLS, and `waves_settlement_transition` is the BEFORE guard that decides
-- whether the move is legal. Anything that can legally change the status can
-- reach this, including the offline queue replaying a confirm and an import
-- confirming a row it named — which is the property that matters, because a
-- notice attached to one code path is a notice missing from the others.
--
-- `auto_confirmed` is deliberately absent. `waves_auto_confirm_settlements`
-- already writes both sides of that one, with wording ("nobody said otherwise
-- for a week") that this trigger has no way to reproduce; firing here as well
-- would be a second buzz saying less.
--
-- SECURITY DEFINER: the invoker is `authenticated`, and `waves_notify` is
-- service-role only. Without it every confirm would fail on a permission error
-- rather than send a notification.
CREATE OR REPLACE FUNCTION public.waves_settlement_notify() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_parties record;
BEGIN
  IF NEW.status = OLD.status THEN
    RETURN NEW;
  END IF;

  IF NEW.status NOT IN ('confirmed', 'cancelled', 'disputed') THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_parties FROM public.waves_settlement_parties(NEW.id);

  IF NEW.status = 'confirmed' THEN
    -- Only the payee can confirm, so the payer is the one who learns something.
    PERFORM public.waves_notify(
      v_parties.payer_profile,
      v_parties.group_id,
      'settlement_confirmed',
      'Settled',
      COALESCE(v_parties.payee_name, 'They') || ' confirmed your payment',
      'waves://group/' || v_parties.group_id::text,
      jsonb_build_object(
        'settlementId', NEW.id,
        'amount', v_parties.amount,
        'currency', v_parties.currency,
        'role', 'payer',
        'counterparty', v_parties.payee_name,
        'group', v_parties.group_name
      ),
      'settle_confirmed:' || NEW.id::text
    );

  ELSIF NEW.status = 'cancelled' THEN
    -- ADR-007: only the payer may cancel, and only while the claim is pending.
    -- The payee is the party whose pending "did you get it?" just disappeared,
    -- and a request that vanishes with no word is the thing this prevents.
    PERFORM public.waves_notify(
      v_parties.payee_profile,
      v_parties.group_id,
      'settlement_cancelled',
      'A payment claim was withdrawn',
      COALESCE(v_parties.payer_name, 'Someone') || ' took back what they said they paid',
      'waves://group/' || v_parties.group_id::text,
      jsonb_build_object(
        'settlementId', NEW.id,
        'amount', v_parties.amount,
        'currency', v_parties.currency,
        'role', 'payee',
        'counterparty', v_parties.payer_name,
        'group', v_parties.group_name
      ),
      'settle_cancelled:' || NEW.id::text
    );

  ELSE
    -- Disputed. The payee's answer to a payment they never received, so the
    -- payer is the one who has to do something about it.
    PERFORM public.waves_notify(
      v_parties.payer_profile,
      v_parties.group_id,
      'settlement_disputed',
      'Your payment was not recognised',
      COALESCE(v_parties.payee_name, 'They') || ' say they did not receive it',
      'waves://group/' || v_parties.group_id::text,
      jsonb_build_object(
        'settlementId', NEW.id,
        'amount', v_parties.amount,
        'currency', v_parties.currency,
        'role', 'payer',
        'counterparty', v_parties.payee_name,
        'group', v_parties.group_name
      ),
      'settle_disputed:' || NEW.id::text
    );
  END IF;

  RETURN NEW;
END
$$;

REVOKE ALL ON FUNCTION public.waves_settlement_notify() FROM PUBLIC;

DROP TRIGGER IF EXISTS settlements_transition_notify ON public.settlements;

-- AFTER, not BEFORE: the guard has to have accepted the move first, or a
-- refused transition would still have sent the mail about it.
--
-- Not `AFTER UPDATE OF status`: that fires on whether the *statement* named the
-- column, which is a property of how somebody happened to write their UPDATE
-- rather than of whether the status changed. The `NEW.status = OLD.status`
-- guard inside the function is the real test, and it costs one comparison.
CREATE TRIGGER settlements_transition_notify
    AFTER UPDATE ON public.settlements
    FOR EACH ROW EXECUTE FUNCTION public.waves_settlement_notify();

-- ──────────────────────────────────────── the switches are wired to something ──

-- Which preference governs which kind.
--
-- A function rather than a table: it is a constant, it belongs to the same
-- deploy as the claim that reads it, and a table would be one more thing for
-- Prisma to know about and for a migration to keep in step. It is separate from
-- the claim so a test can ask the mapping directly — "does turning off
-- settlement requests cover a dispute?" is a question with an answer, and the
-- answer should not require enqueuing a notification to find out.
--
-- NULL means "no preference silences this". A kind this function has never
-- heard of gets NULL too, which is the safe default: something added later
-- pushes until somebody decides which switch it belongs under, rather than
-- going quiet for reasons nobody can see.
--
-- `new_device_login` is NULL on purpose, for the same reason
-- `waves_claim_email_notifications` carves it out by name: turning
-- notifications off means "stop telling me about ledgers", and nobody means it
-- to include "and stop telling me when my account is opened somewhere".
CREATE OR REPLACE FUNCTION public.waves_pref_key_for_kind(p_kind text) RETURNS text
    LANGUAGE sql IMMUTABLE
    -- Pinned like everything else in this schema, and checked by
    -- `anon-surface.test.ts`. A pure CASE over a text literal reads nothing, so
    -- there is no path for a path to matter on — which is exactly the argument
    -- somebody makes right before the one function without a pin is the one
    -- that grows a table lookup.
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
    ELSE NULL
  END;
$$;

REVOKE ALL ON FUNCTION public.waves_pref_key_for_kind(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.waves_pref_key_for_kind(text) TO service_role;

-- The claim, now reading the switches.
--
-- Unchanged from the baseline except for the block marked below. `suppressed`
-- rather than `failed`: this is a decision, not a delivery that went wrong, and
-- the difference shows up the first time somebody asks why a person got no
-- push. It is also terminal — `push_next_retry_at` stays NULL — because a
-- preference does not come back on by itself.
--
-- The check is at claim time rather than at `waves_notify` time on purpose: a
-- notification row is the record that something happened, and the email half
-- may still want it (an unpushed nudge is precisely the one that gets mailed).
-- Suppressing the *delivery* leaves that intact; not writing the row would not.
CREATE OR REPLACE FUNCTION public.waves_claim_push_notifications(p_limit integer DEFAULT 200)
RETURNS TABLE(id uuid, kind text, title text, body text, deep_link text, payload jsonb, locale text, tokens text[])
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_ids UUID[];
BEGIN
  -- `FOR UPDATE SKIP LOCKED` is what lets two runs overlap harmlessly: the
  -- second finds the rows locked and moves on rather than sending them
  -- again. A first try (`push_status IS NULL`) and a retry (`failed`, under
  -- 3 attempts, backoff elapsed) are the same claim, differing only in which
  -- half of the WHERE let the row through.
  WITH picked AS (
    SELECT n.id
    FROM public.notifications n
    WHERE (
            n.push_status IS NULL
         OR (n.push_status = 'failed'
             AND n.push_attempts < 3
             AND n.push_next_retry_at IS NOT NULL
             AND n.push_next_retry_at <= now())
          )
      -- Anything older than this was missed while the fanout was down, and a
      -- buzz about a two-day-old reminder is worse than silence.
      AND n.created_at > now() - interval '2 days'
    ORDER BY n.created_at
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  ),
  claimed AS (
    UPDATE public.notifications n
       SET push_status = 'queued'
      FROM picked
     WHERE n.id = picked.id
    RETURNING n.id
  )
  SELECT COALESCE(array_agg(claimed.id), '{}') INTO v_ids FROM claimed;

  -- ── new: the four switches on the notifications screen ──────────────────
  --
  -- Absent key means on: `DEFAULT_NOTIFICATION_PREFS` has all four true, and a
  -- profile written before a switch existed must not be read as having turned
  -- it off. A kind with no mapping, and a kind mapped to NULL, both fall
  -- through untouched.
  UPDATE public.notifications n
     SET push_status = 'suppressed',
         push_next_retry_at = NULL
   WHERE n.id = ANY(v_ids)
     AND public.waves_pref_key_for_kind(n.kind) IS NOT NULL
     AND NOT COALESCE(
           (SELECT (p.notification_prefs ->> public.waves_pref_key_for_kind(n.kind))::boolean
              FROM public.profiles p WHERE p.id = n.profile_id),
           TRUE
         );

  -- A separate statement: Postgres will not apply two updates to the same
  -- row inside one statement, so folding this into the CTE above would
  -- silently do nothing.
  --
  -- No device is a decision, not a failure — closed out terminally
  -- (`push_next_retry_at` cleared, not just `push_status`) rather than left
  -- retryable, or it would sit in the claim's way on every future run.
  -- `push_attempts` is left alone: a new token showing up later is a
  -- different signal than time passing, and not this branch's business.
  UPDATE public.notifications n
     SET push_status = 'failed',
         push_next_retry_at = NULL
   WHERE n.id = ANY(v_ids)
     AND n.push_status = 'queued'
     AND NOT EXISTS (
       SELECT 1 FROM public.push_tokens t
       WHERE t.profile_id = n.profile_id AND t.revoked_at IS NULL
     );

  RETURN QUERY
  SELECT n.id, n.kind, n.title, n.body, n.deep_link, n.payload,
         COALESCE(p.locale, 'en'),
         ARRAY_AGG(t.expo_push_token)
  FROM public.notifications n
  LEFT JOIN public.profiles p ON p.id = n.profile_id
  JOIN public.push_tokens t
    ON t.profile_id = n.profile_id AND t.revoked_at IS NULL
  WHERE n.id = ANY(v_ids) AND n.push_status = 'queued'
  GROUP BY n.id, n.kind, n.title, n.body, n.deep_link, n.payload, p.locale;
END
$$;

REVOKE ALL ON FUNCTION public.waves_claim_push_notifications(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.waves_claim_push_notifications(integer) TO service_role;
