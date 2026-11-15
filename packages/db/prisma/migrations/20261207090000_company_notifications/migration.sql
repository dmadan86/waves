-- Company notifications: tell the right person when something in a company
-- needs them (leave, expense claims, payments, tasks, calendar, estimates and
-- bills, complaints, vendor payments and orders).
--
-- One AFTER trigger per table calls waves_company_notify_trigger(), which writes
-- `notifications` rows through waves_notify (so the fanout, the per-user
-- prefs, group mutes and the two-step gate all apply unchanged). Recipient
-- rules use the real roles: owner = 'admin', manager = 'manager' (employees
-- link via group_members.manager_id), employee = 'member'.
--
--   * The actor (the signed-in profile, else the row's own actor member) is
--     never notified, and recipients are deduped.
--   * A notification failure must never roll back the money/task write that
--     caused it, so the whole dispatcher swallows errors.
--   * Skipped on purpose: overdue tasks (no scheduler), complaint "escalated"
--     (derived from due_at, never stored), whole-company calendar events
--     (people = {} means everyone), vendor order replies.

-- ── the push preference for these kinds ───────────────────────────────────
-- Latest body: 20261102090000_departed_resplit; adds the company kinds under
-- one new switch, `companyUpdates`. An absent key still means "on".
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
    WHEN 'company_leave_requested'   THEN 'companyUpdates'
    WHEN 'company_leave_approved'    THEN 'companyUpdates'
    WHEN 'company_leave_rejected'    THEN 'companyUpdates'
    WHEN 'company_claim_submitted'   THEN 'companyUpdates'
    WHEN 'company_claim_approved'    THEN 'companyUpdates'
    WHEN 'company_claim_rejected'    THEN 'companyUpdates'
    WHEN 'company_claim_reimbursed'  THEN 'companyUpdates'
    WHEN 'company_payment'           THEN 'companyUpdates'
    WHEN 'company_task_assigned'     THEN 'companyUpdates'
    WHEN 'company_task_done'         THEN 'companyUpdates'
    WHEN 'company_task_blocked'      THEN 'companyUpdates'
    WHEN 'company_event'             THEN 'companyUpdates'
    WHEN 'company_estimate_accepted' THEN 'companyUpdates'
    WHEN 'company_estimate_declined' THEN 'companyUpdates'
    WHEN 'company_bill_paid'         THEN 'companyUpdates'
    WHEN 'company_ticket_assigned'   THEN 'companyUpdates'
    WHEN 'company_ticket_resolved'   THEN 'companyUpdates'
    WHEN 'company_vendor_payment'    THEN 'companyUpdates'
    WHEN 'company_vendor_order'      THEN 'companyUpdates'
    ELSE NULL
  END;
$$;

REVOKE ALL ON FUNCTION public.waves_pref_key_for_kind(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.waves_pref_key_for_kind(text) TO service_role;

-- ── helpers (internal; nobody signed in calls these) ──────────────────────

-- Who a request goes to: the employee's manager if they have one who is still
-- in the company, else every owner.
CREATE OR REPLACE FUNCTION public.waves_company_approvers(p_group_id uuid, p_member_id uuid) RETURNS uuid[]
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  SELECT COALESCE(
    (SELECT ARRAY[mg.id]
       FROM public.group_members e
       JOIN public.group_members mg ON mg.id = e.manager_id AND mg.group_id = e.group_id
      WHERE e.id = p_member_id AND e.group_id = p_group_id
        AND mg.profile_id IS NOT NULL AND mg.left_at IS NULL AND mg.removed_at IS NULL),
    (SELECT array_agg(a.id) FROM public.group_members a
      WHERE a.group_id = p_group_id AND a.role::text = 'admin'
        AND a.profile_id IS NOT NULL AND a.left_at IS NULL AND a.removed_at IS NULL),
    '{}'::uuid[]);
$$;

CREATE OR REPLACE FUNCTION public.waves_company_owners(p_group_id uuid) RETURNS uuid[]
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  SELECT COALESCE(array_agg(a.id), '{}'::uuid[]) FROM public.group_members a
   WHERE a.group_id = p_group_id AND a.role::text = 'admin'
     AND a.profile_id IS NOT NULL AND a.left_at IS NULL AND a.removed_at IS NULL;
$$;

CREATE OR REPLACE FUNCTION public.waves_company_member_name(p_member_id uuid) RETURNS text
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  SELECT COALESCE(NULLIF(p.display_name, ''), m.ghost_name, '')
    FROM public.group_members m LEFT JOIN public.profiles p ON p.id = m.profile_id
   WHERE m.id = p_member_id;
$$;

-- Writes one notification per distinct active recipient, never to the actor.
CREATE OR REPLACE FUNCTION public.waves_company_notify(
  p_group_id uuid, p_members uuid[], p_actor_member uuid, p_kind text,
  p_title text, p_body text, p_facts jsonb, p_key text
) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_actor      uuid;
  v_group_name text;
  v_actor_name text;
  r            record;
BEGIN
  -- The signed-in profile when there is one; else whoever the row says did it
  -- (service jobs and direct SQL carry no JWT).
  v_actor := COALESCE(
    public.waves_current_profile_id(),
    (SELECT m.profile_id FROM public.group_members m WHERE m.id = p_actor_member));

  SELECT g.name INTO v_group_name FROM public.groups g WHERE g.id = p_group_id;
  SELECT p.display_name INTO v_actor_name FROM public.profiles p WHERE p.id = v_actor;

  FOR r IN
    SELECT DISTINCT m.profile_id
      FROM public.group_members m
     WHERE m.group_id = p_group_id
       AND m.id = ANY(p_members)
       AND m.profile_id IS NOT NULL
       AND m.left_at IS NULL AND m.removed_at IS NULL AND m.merged_into_member_id IS NULL
       AND m.profile_id IS DISTINCT FROM v_actor
  LOOP
    PERFORM public.waves_notify(
      r.profile_id, p_group_id, p_kind, p_title, p_body,
      'waves://group/' || p_group_id::text,
      jsonb_build_object('group', COALESCE(v_group_name, ''), 'counterparty', COALESCE(v_actor_name, ''))
        || COALESCE(p_facts, '{}'::jsonb),
      p_key || ':' || r.profile_id::text);
  END LOOP;
END
$$;

-- ── the dispatcher ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.waves_company_notify_trigger() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_to     uuid[];
  v_name   text;
  v_desc   text;
  v_facts  jsonb;
  v_actor  uuid;
  v_kind   text;
  v_title  text;
  v_body   text;
  v_vendor uuid;
BEGIN
  BEGIN
    -- leave ----------------------------------------------------------------
    IF TG_TABLE_NAME = 'company_leave' THEN
      IF TG_OP = 'INSERT' THEN
        IF NEW.status = 'pending' THEN
          v_name := public.waves_company_member_name(NEW.member_id);
          PERFORM public.waves_company_notify(NEW.group_id,
            public.waves_company_approvers(NEW.group_id, NEW.member_id), NEW.created_by,
            'company_leave_requested', v_name || ' asked for leave', 'Tap to review',
            jsonb_build_object('name', v_name), 'company_leave_requested:' || NEW.id || ':' || NEW.updated_seq);
        END IF;
      ELSE
        v_kind := CASE NEW.status WHEN 'approved' THEN 'company_leave_approved' ELSE 'company_leave_rejected' END;
        PERFORM public.waves_company_notify(NEW.group_id, ARRAY[NEW.member_id], NEW.decided_by, v_kind,
          CASE NEW.status WHEN 'approved' THEN 'Your leave was approved' ELSE 'Your leave was declined' END,
          'Tap to open', '{}'::jsonb, v_kind || ':' || NEW.id || ':' || NEW.updated_seq);
      END IF;

    -- expense / payment entries --------------------------------------------
    ELSIF TG_TABLE_NAME = 'company_entries' THEN
      v_desc := COALESCE(NULLIF(NEW.note, ''), NEW.category, '');
      v_facts := jsonb_build_object('amount', NEW.amount::text, 'currency', NEW.currency, 'description', v_desc);
      IF NEW.member_id IS NOT NULL AND NEW.entry_kind IN ('expense', 'allowance')
         AND (TG_OP = 'INSERT' OR OLD.status = 'submitted' OR NEW.status = 'submitted') -- an edited, resubmitted claim needs review again
         AND NEW.status IN ('submitted', 'approved', 'rejected')
         AND (TG_OP = 'INSERT' OR NEW.status <> OLD.status) THEN
        IF NEW.status = 'submitted' THEN
          v_name := public.waves_company_member_name(NEW.member_id);
          PERFORM public.waves_company_notify(NEW.group_id,
            public.waves_company_approvers(NEW.group_id, NEW.member_id), NEW.created_by,
            'company_claim_submitted', v_name || ' submitted an expense', 'Waiting for your approval',
            v_facts || jsonb_build_object('name', v_name), 'company_claim_submitted:' || NEW.id || ':' || NEW.updated_seq);
        ELSIF TG_OP = 'UPDATE' THEN
          v_kind := CASE NEW.status WHEN 'approved' THEN 'company_claim_approved' ELSE 'company_claim_rejected' END;
          PERFORM public.waves_company_notify(NEW.group_id, ARRAY[NEW.member_id], NEW.reviewed_by, v_kind,
            CASE NEW.status WHEN 'approved' THEN 'Your expense was approved' ELSE 'Your expense was declined' END,
            v_desc, v_facts, v_kind || ':' || NEW.id || ':' || NEW.updated_seq);
        END IF;
      ELSIF NEW.member_id IS NOT NULL AND NEW.status = 'approved'
            AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'approved')
            AND (NEW.entry_kind IN ('advance', 'wages', 'wage_payment')
                 OR (NEW.entry_kind = 'reimbursement' AND NEW.direction = 'company_to_employee')) THEN
        v_kind := CASE WHEN NEW.entry_kind = 'reimbursement' THEN 'company_claim_reimbursed' ELSE 'company_payment' END;
        PERFORM public.waves_company_notify(NEW.group_id, ARRAY[NEW.member_id], NEW.updated_by, v_kind,
          CASE WHEN v_kind = 'company_payment' THEN 'A payment was recorded for you' ELSE 'You were reimbursed' END,
          'Tap to open', v_facts, v_kind || ':' || NEW.id);
      END IF;

    -- tasks ----------------------------------------------------------------
    ELSIF TG_TABLE_NAME = 'company_work_tasks' THEN
      v_facts := jsonb_build_object('description', NEW.title);
      IF TG_OP = 'INSERT' THEN
        v_to := ARRAY[NEW.member_id] || NEW.helper_ids;
      ELSE
        v_to := (CASE WHEN NEW.member_id IS DISTINCT FROM OLD.member_id THEN ARRAY[NEW.member_id] ELSE '{}'::uuid[] END)
                || ARRAY(SELECT h FROM unnest(NEW.helper_ids) h WHERE h <> ALL (OLD.helper_ids));
      END IF;
      IF cardinality(v_to) > 0 THEN
        PERFORM public.waves_company_notify(NEW.group_id, v_to, NEW.created_by, 'company_task_assigned',
          'You were given a task', NEW.title, v_facts, 'company_task_assigned:' || NEW.id || ':' || NEW.updated_seq);
      END IF;
      IF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status AND NEW.status IN ('done', 'blocked') THEN
        -- Whoever assigned it hears; if that is the assignee themself, the owners do.
        v_kind := 'company_task_' || NEW.status;
        PERFORM public.waves_company_notify(NEW.group_id,
          CASE WHEN NEW.created_by = NEW.member_id THEN public.waves_company_owners(NEW.group_id)
               ELSE ARRAY[NEW.created_by] END,
          NEW.member_id, v_kind,
          CASE NEW.status WHEN 'done' THEN 'A task was finished' ELSE 'A task is blocked' END,
          NEW.title, v_facts, v_kind || ':' || NEW.id || ':' || NEW.updated_seq);
      END IF;

    -- calendar -------------------------------------------------------------
    ELSIF TG_TABLE_NAME = 'company_events' THEN
      IF TG_OP = 'INSERT'
         OR NEW.title IS DISTINCT FROM OLD.title OR NEW.day IS DISTINCT FROM OLD.day
         OR NEW.at_time IS DISTINCT FROM OLD.at_time THEN
        v_to := NEW.people;
      ELSE
        v_to := ARRAY(SELECT p FROM unnest(NEW.people) p WHERE p <> ALL (OLD.people));
      END IF;
      IF cardinality(v_to) > 0 THEN
        PERFORM public.waves_company_notify(NEW.group_id, v_to, NEW.created_by, 'company_event',
          'Calendar: ' || NEW.title, to_char(NEW.day, 'DD Mon') || COALESCE(' ' || NEW.at_time, ''),
          jsonb_build_object('description', NEW.title), 'company_event:' || NEW.id || ':' || NEW.updated_seq);
      END IF;

    -- estimates and bills --------------------------------------------------
    ELSIF TG_TABLE_NAME = 'company_documents' THEN
      v_facts := jsonb_build_object('description', NEW.customer_name, 'amount', NEW.total_minor::text, 'currency', NEW.currency);
      IF NEW.doc_type = 'estimate' THEN
        v_kind := 'company_estimate_' || NEW.status;
        PERFORM public.waves_company_notify(NEW.group_id,
          ARRAY[NEW.created_by] || public.waves_company_owners(NEW.group_id), NEW.updated_by, v_kind,
          'Estimate ' || NEW.status, NEW.customer_name, v_facts, v_kind || ':' || NEW.id || ':' || NEW.updated_seq);
      ELSE
        PERFORM public.waves_company_notify(NEW.group_id, ARRAY[NEW.created_by], NEW.updated_by,
          'company_bill_paid', 'A bill was paid in full', NEW.customer_name, v_facts,
          'company_bill_paid:' || NEW.id || ':' || NEW.updated_seq);
      END IF;

    -- complaints (tickets) -------------------------------------------------
    ELSIF TG_TABLE_NAME = 'company_tickets' THEN
      v_facts := jsonb_build_object('description', NEW.title);
      IF TG_OP = 'INSERT' OR NEW.assignee_member_id IS DISTINCT FROM OLD.assignee_member_id THEN
        PERFORM public.waves_company_notify(NEW.group_id, ARRAY[NEW.assignee_member_id], NEW.updated_by,
          'company_ticket_assigned', 'A complaint was assigned to you', NEW.title, v_facts,
          'company_ticket_assigned:' || NEW.id || ':' || NEW.updated_seq);
      END IF;
      IF TG_OP = 'UPDATE' AND NEW.status IN ('resolved', 'closed') AND OLD.status NOT IN ('resolved', 'closed') THEN
        PERFORM public.waves_company_notify(NEW.group_id, ARRAY[NEW.created_by], NEW.updated_by,
          'company_ticket_resolved', 'Your complaint was resolved', NEW.title, v_facts,
          'company_ticket_resolved:' || NEW.id || ':' || NEW.updated_seq);
      END IF;

    -- vendors (only a vendor with a login can be told) ---------------------
    ELSIF TG_TABLE_NAME = 'company_vendor_entries' THEN
      SELECT v.member_id INTO v_vendor FROM public.company_vendors v WHERE v.id = NEW.vendor_id;
      IF v_vendor IS NOT NULL THEN
        PERFORM public.waves_company_notify(NEW.group_id, ARRAY[v_vendor], NEW.created_by,
          'company_vendor_payment', 'A payment was recorded for you', 'Tap to open',
          jsonb_build_object('amount', NEW.amount::text, 'currency', (SELECT g.default_currency FROM public.groups g WHERE g.id = NEW.group_id)),
          'company_vendor_payment:' || NEW.id);
      END IF;
    ELSIF TG_TABLE_NAME = 'company_vendor_orders' THEN
      SELECT v.member_id INTO v_vendor FROM public.company_vendors v WHERE v.id = NEW.vendor_id;
      IF v_vendor IS NOT NULL THEN
        PERFORM public.waves_company_notify(NEW.group_id, ARRAY[v_vendor], NEW.created_by,
          'company_vendor_order', 'You have a new order', 'Order #' || NEW.order_no, '{}'::jsonb,
          'company_vendor_order:' || NEW.id);
      END IF;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    -- A notification must never undo the write that caused it.
    RAISE WARNING 'waves_company_notify_trigger %: %', TG_TABLE_NAME, SQLERRM;
  END;
  RETURN NULL;
END
$$;

REVOKE ALL ON FUNCTION public.waves_company_approvers(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.waves_company_owners(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.waves_company_member_name(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.waves_company_notify(uuid, uuid[], uuid, text, text, text, jsonb, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.waves_company_notify_trigger() FROM PUBLIC, anon, authenticated;

-- ── the triggers ──────────────────────────────────────────────────────────
-- Named zz_ so they run after the BEFORE stamps and the block guards. The WHEN
-- clauses keep sync re-writes of an unchanged row from notifying anyone.
CREATE TRIGGER zz_company_leave_notify_ins AFTER INSERT ON public.company_leave
  FOR EACH ROW WHEN (NEW.deleted_at IS NULL) EXECUTE FUNCTION public.waves_company_notify_trigger();
CREATE TRIGGER zz_company_leave_notify_upd AFTER UPDATE ON public.company_leave
  FOR EACH ROW WHEN (NEW.deleted_at IS NULL AND OLD.status = 'pending' AND NEW.status IN ('approved', 'rejected'))
  EXECUTE FUNCTION public.waves_company_notify_trigger();

CREATE TRIGGER zz_company_entries_notify_ins AFTER INSERT ON public.company_entries
  FOR EACH ROW WHEN (NEW.deleted_at IS NULL) EXECUTE FUNCTION public.waves_company_notify_trigger();
CREATE TRIGGER zz_company_entries_notify_upd AFTER UPDATE ON public.company_entries
  FOR EACH ROW WHEN (NEW.deleted_at IS NULL AND OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION public.waves_company_notify_trigger();

CREATE TRIGGER zz_company_work_tasks_notify_ins AFTER INSERT ON public.company_work_tasks
  FOR EACH ROW WHEN (NEW.deleted_at IS NULL) EXECUTE FUNCTION public.waves_company_notify_trigger();
CREATE TRIGGER zz_company_work_tasks_notify_upd AFTER UPDATE ON public.company_work_tasks
  FOR EACH ROW WHEN (NEW.deleted_at IS NULL AND (OLD.status IS DISTINCT FROM NEW.status
    OR OLD.member_id IS DISTINCT FROM NEW.member_id OR OLD.helper_ids IS DISTINCT FROM NEW.helper_ids))
  EXECUTE FUNCTION public.waves_company_notify_trigger();

CREATE TRIGGER zz_company_events_notify_ins AFTER INSERT ON public.company_events
  FOR EACH ROW WHEN (NEW.deleted_at IS NULL AND cardinality(NEW.people) > 0)
  EXECUTE FUNCTION public.waves_company_notify_trigger();
CREATE TRIGGER zz_company_events_notify_upd AFTER UPDATE ON public.company_events
  FOR EACH ROW WHEN (NEW.deleted_at IS NULL AND cardinality(NEW.people) > 0 AND (OLD.title IS DISTINCT FROM NEW.title
    OR OLD.day IS DISTINCT FROM NEW.day OR OLD.at_time IS DISTINCT FROM NEW.at_time OR OLD.people IS DISTINCT FROM NEW.people))
  EXECUTE FUNCTION public.waves_company_notify_trigger();

CREATE TRIGGER zz_company_documents_notify_upd AFTER UPDATE ON public.company_documents
  FOR EACH ROW WHEN (NEW.deleted_at IS NULL AND OLD.status IS DISTINCT FROM NEW.status
    AND ((NEW.doc_type = 'estimate' AND NEW.status IN ('accepted', 'declined')) OR (NEW.doc_type = 'bill' AND NEW.status = 'paid')))
  EXECUTE FUNCTION public.waves_company_notify_trigger();

CREATE TRIGGER zz_company_tickets_notify_ins AFTER INSERT ON public.company_tickets
  FOR EACH ROW WHEN (NEW.deleted_at IS NULL) EXECUTE FUNCTION public.waves_company_notify_trigger();
CREATE TRIGGER zz_company_tickets_notify_upd AFTER UPDATE ON public.company_tickets
  FOR EACH ROW WHEN (NEW.deleted_at IS NULL AND (OLD.assignee_member_id IS DISTINCT FROM NEW.assignee_member_id
    OR OLD.status IS DISTINCT FROM NEW.status))
  EXECUTE FUNCTION public.waves_company_notify_trigger();

CREATE TRIGGER zz_company_vendor_entries_notify_ins AFTER INSERT ON public.company_vendor_entries
  FOR EACH ROW WHEN (NEW.deleted_at IS NULL AND NEW.kind IN ('advance', 'payment') AND NEW.status = 'approved')
  EXECUTE FUNCTION public.waves_company_notify_trigger();
CREATE TRIGGER zz_company_vendor_orders_notify_ins AFTER INSERT ON public.company_vendor_orders
  FOR EACH ROW WHEN (NEW.deleted_at IS NULL AND NEW.status = 'sent')
  EXECUTE FUNCTION public.waves_company_notify_trigger();
