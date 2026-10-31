/**
 * The local mirror and how server changes fold into it (TDR §4 steps 3–4).
 *
 * The client keeps two layers, never one:
 *
 *   **server**  — exactly what the server last told us, addressed by the
 *                 per-group `updated_seq` cursor.
 *   **pending** — the mutation queue, replayed on top at read time.
 *
 * Keeping them apart is what makes "UI reads local-first, always" (ADR-005)
 * survive a pull. If optimistic edits were written into the server layer, a
 * pull that arrived before our own mutation was applied would revert the screen
 * under the user's finger. Here the pull only ever replaces the server layer,
 * and the pending edits are re-applied over the top, so the number on screen
 * only moves when the server actually disagrees.
 */

import type { GroupUnits } from '../group/units';
import { computeShares } from '../split/computeShares';
import { resolvePayee } from '../expense/payee';
import type { MemberId, SplitParams, SplitType } from '../split/types';
import type { CurrencyCode } from '../money/currency';
import {
  billStatus,
  computeDocTotals,
  type CompanyDocStatus,
  type CompanyDocType,
  type DocPayment,
} from '../company/documents';
import type { ExpenseSnapshot } from '../balances/types';

import {
  categoryTagsScope,
  groupMutesScope,
  MutationKind,
  packInstallsScope,
  parseAmount,
  personalScope,
  SyncTable,
} from './protocol';
import type { CategoryMeta } from '../category/catalog';
import type {
  PackInstallPayload,
  PackUninstallPayload,
  CaptureAssignPayload,
  CaptureCreatePayload,
  CaptureDeletePayload,
  ExpenseCreatePayload,
  ExpenseDeletePayload,
  ExpenseLocation,
  GroupMuteClearPayload,
  GroupMuteSetPayload,
  CompanyEntryCreatePayload,
  CompanyEntryUpdatePayload,
  CompanyEntryVoidPayload,
  CompanyEntryTransitionPayload,
  CompanyReimbursePayload,
  CompanyWagePayPayload,
  CompanyPoolPostPayload,
  CompanyProjectSetPayload,
  CompanyMemberDepartmentSetPayload,
  CompanyMemberEmployeeIdSetPayload,
  CompanyDocSavePayload,
  CompanyDocStatusPayload,
  CompanyDocConvertPayload,
  CompanyDocPaymentPayload,
  CompanyDocVoidPayload,
  CompanyAttendanceSetPayload,
  CompanyWorkSetPayload,
  CompanyWorkRemovePayload,
  CompanyHolidaySetPayload,
  CompanyHolidayRemovePayload,
  CompanyLeaveSetPayload,
  CompanyLeaveDecidePayload,
  CompanyLeaveRemovePayload,
  CompanyEventSetPayload,
  CompanyEventRemovePayload,
  CompanyDatesSetPayload,
  LeaveKind,
  CompanyMemberProjectsSetPayload,
  GroupRecurringCreatePayload,
  GroupRecurringUpdatePayload,
  MemberBudgetSetPayload,
  MutationEnvelope,
  PersonalDeletePayload,
  PersonalRecordKind,
  PersonalUpsertPayload,
  PlanItemCreatePayload,
  PlanItemDeletePayload,
  PlanItemUpdatePayload,
  SyncChange,
  TagDeletePayload,
  TagUpsertPayload,
} from './protocol';
import type { QueuedMutation } from './queue';
import { byNewest, byOldest, compareStampsDesc } from '../time/iso';
import { allowanceAmount, mileageAmount, normaliseEmployeeId } from '../company/index';
import { firstOccurrenceOnOrAfter, nextOccurrenceAfter } from '../group/recurring';

/** A row as the server sends it: snake_case, amounts as decimal strings. */
export type MirrorRow = Readonly<Record<string, unknown>>;

export interface MirrorState {
  /** Highest `updated_seq` we have applied, per group. */
  readonly cursors: Readonly<Record<string, number>>;
  readonly tables: Readonly<Record<SyncTable, Readonly<Record<string, MirrorRow>>>>;
}

const UNSAFE_IDS: ReadonlySet<string> = new Set(['__proto__', 'constructor', 'prototype']);

const TABLES: readonly SyncTable[] = [
  SyncTable.Groups,
  SyncTable.GroupMembers,
  SyncTable.Expenses,
  SyncTable.ExpenseVersions,
  SyncTable.ExpensePayers,
  SyncTable.ExpenseShares,
  SyncTable.Settlements,
  SyncTable.SettlementAllocations,
  SyncTable.ActivityLog,
  SyncTable.Captures,
  SyncTable.GhostMerges,
  SyncTable.CategoryTags,
  SyncTable.TripPlanItems,
  SyncTable.GroupRecurringExpenses,
  SyncTable.CompanyEntries,
  SyncTable.CompanyEntryAttachments,
  SyncTable.CompanyProjects,
  SyncTable.CompanyProjectMembers,
  SyncTable.CompanyProjectBudgets,
  SyncTable.CompanyWageSplits,
  SyncTable.CompanyVendors,
  SyncTable.CompanyVendorEntries,
  SyncTable.CompanyVendorEntryAttachments,
  SyncTable.CompanyWorkTaskAttachments,
  SyncTable.CompanyDocuments,
  SyncTable.CompanyAttendance,
  SyncTable.CompanyWorkTasks,
  SyncTable.CompanyHolidays,
  SyncTable.CompanyLeave,
  SyncTable.CompanyEvents,
  SyncTable.CompanyMemberDates,
  SyncTable.TripMemberBudgets,
  SyncTable.SettlementProofs,
  SyncTable.ExpenseAttachments,
  SyncTable.ExpenseComments,
  SyncTable.ExpenseImageEvents,
  SyncTable.PersonalRecords,
  SyncTable.GroupPins,
  SyncTable.GroupMutes,
  SyncTable.PackInstalls,
];

export function emptyMirror(): MirrorState {
  const tables = {} as Record<SyncTable, Record<string, MirrorRow>>;
  for (const table of TABLES) tables[table] = {};
  return { cursors: {}, tables };
}

export interface ReconcileResult {
  readonly state: MirrorState;
  /** Changes that actually advanced the mirror after stale rows were ignored. */
  readonly applied: readonly SyncChange[];
  /** Changes ignored because we already had them — surfaced so tests can assert replay is free. */
  readonly skipped: number;
}

/**
 * Fold a pull into the mirror.
 *
 * Changes at or below the cursor are dropped: the server is allowed to resend
 * them (Realtime and the pull overlap by design) and re-applying must be a
 * no-op. Within a batch the highest `seq` wins, so an out-of-order response
 * cannot resurrect an older row.
 */
export function reconcile(state: MirrorState, changes: readonly SyncChange[]): ReconcileResult {
  const cursors: Record<string, number> = { ...state.cursors };
  const tables = {} as Record<SyncTable, Record<string, MirrorRow>>;
  for (const table of TABLES) tables[table] = { ...state.tables[table] };

  // Track the winning seq per row so a batch containing two versions of the
  // same row resolves the same way regardless of the order it arrived in.
  const winningSeq = new Map<string, number>();
  const applied: SyncChange[] = [];
  let skipped = 0;

  for (const change of [...changes].sort((a, b) => a.seq - b.seq)) {
    const cursor = state.cursors[change.groupId] ?? 0;
    if (change.seq <= cursor) {
      skipped += 1;
      continue;
    }

    const id = idOf(change.row);
    // Server-supplied keys: never let them reach Object.prototype or an unknown table.
    if (id === undefined || UNSAFE_IDS.has(id) || !Object.hasOwn(tables, change.table)) continue;

    const key = `${change.table}:${id}`;
    if ((winningSeq.get(key) ?? -1) > change.seq) continue;
    winningSeq.set(key, change.seq);

    if (change.deleted === true) {
      delete tables[change.table][id];
    } else {
      tables[change.table][id] = change.row;
    }
    cursors[change.groupId] = Math.max(cursors[change.groupId] ?? 0, change.seq);
    applied.push(change);
  }

  return { state: { cursors, tables }, applied, skipped };
}

function idOf(row: MirrorRow): string | undefined {
  return typeof row.id === 'string' ? row.id : undefined;
}

export function rowsFor(state: MirrorState, table: SyncTable, groupId?: string): MirrorRow[] {
  const all = Object.values(state.tables[table]);
  return groupId === undefined ? all : all.filter((row) => row.group_id === groupId);
}

// ────────────────────────────────────────── the pending overlay ──

/** The expense shape the app reads, identical to the server's embed. */
export interface MirrorExpense extends MirrorRow {
  readonly id: string;
  readonly group_id: string;
  readonly deleted_at: string | null;
  readonly created_at: string;
  readonly currentVersion: {
    readonly id: string;
    readonly version_no: number;
    readonly description: string;
    readonly category: string | null;
    readonly category_meta: CategoryMeta | null;
    readonly expense_date: string;
    readonly currency: string;
    readonly amount: string;
    readonly split_type: SplitType;
    readonly split_params: SplitParams;
    readonly author_member_id: string | null;
    readonly notes: string | null;
    readonly payment_method: string | null;
    readonly receipt_share_url: string | null;
    readonly location: ExpenseLocation | null;
    /**
     * The saved conversion record (server `expense_versions.fx`) and the linked
     * receipt. Optional because a synced row carries them as plain columns; a
     * pending version must carry them too, or the next edit built from it would
     * write them back as empty.
     */
    readonly fx?: unknown;
    readonly receipt_id?: string | null;
    /** Which sub-event this spend belongs to (`event-organizer.md`), or null.
     *  Optional for the same reason `fx` is — a row mirrored before this shipped
     *  does not carry the column. */
    readonly sub_event_id?: string | null;
    /** A vendor deposit with a balance still owing, and what/when
     *  (`event-organizer.md`). Optional for the same reason as `sub_event_id`. */
    readonly is_deposit?: boolean;
    readonly balance_due_minor?: string | null;
    readonly balance_due_date?: string | null;
    /** The chosen time of day (ISO instant); null on a row from before it existed. */
    readonly occurred_at?: string | null;
    /** "Paid to", or null; optional because a row mirrored before it existed
     *  does not carry the column. */
    readonly payee?: string | null;
    /** "Work expense (to claim)"; optional because a row mirrored before it
     *  existed does not carry the column (read as false). */
    readonly reimbursable?: boolean;
    readonly created_at: string;
    readonly payers: readonly { member_id: string; amount: string }[];
    readonly shares: readonly { member_id: string; amount: string }[];
  } | null;
  /** True while this row exists only in the queue. The UI marks it "not synced yet". */
  readonly pending?: boolean;
}

export interface MaterialiseOptions {
  readonly groupId: string;
  /** Whose membership authored the queued edits. */
  readonly authorMemberId?: string | null;
}

/**
 * The expenses to render: the server's rows with the queue replayed on top.
 *
 * Shares are recomputed here with the same function and the same seed the
 * server uses, so an offline expense shows the exact numbers it will have once
 * it syncs — no correction flicker when the network comes back.
 */
export function materialiseExpenses(
  state: MirrorState,
  queue: readonly QueuedMutation[],
  options: MaterialiseOptions,
): MirrorExpense[] {
  return overlayPending(
    rowsFor(state, SyncTable.Expenses, options.groupId) as MirrorExpense[],
    queue,
    options,
  );
}

/**
 * The same overlay, over any list of expense rows rather than the mirror.
 *
 * The mirror is one source of server rows; a cached network response is
 * another. Both need the queue replayed on top or the app shows an expense the
 * user has just entered as missing, which looks exactly like data loss.
 */
export function overlayPending(
  expenses: readonly MirrorExpense[],
  queue: readonly QueuedMutation[],
  options: MaterialiseOptions,
): MirrorExpense[] {
  const byId = new Map<string, MirrorExpense>();
  for (const expense of expenses) byId.set(expense.id, expense);

  for (const mutation of [...queue].sort((a, b) => a.seq - b.seq)) {
    if (mutation.groupId !== options.groupId) continue;
    // Per mutation, because this runs inside a render-time useMemo and the
    // queue is the one input nothing has validated. `pendingShares` reparses a
    // payload written by an older build (or a truncated one), and a `MoneyError`
    // thrown here propagates out of the component, through the error boundary,
    // and — since the payload is on disk — again on every restart. One
    // unmaterialisable mutation is one row missing from the list until it syncs
    // or the user discards it; the rest of the ledger still renders.
    try {
      applyPending(byId, mutation, options);
    } catch {
      continue;
    }
  }

  return [...byId.values()].sort((a, b) =>
    compareStampsDesc(String(a.created_at), String(b.created_at)),
  );
}

function applyPending(
  byId: Map<string, MirrorExpense>,
  mutation: MutationEnvelope,
  options: MaterialiseOptions,
): void {
  switch (mutation.kind) {
    case 'expense.create':
    case 'expense.update': {
      const payload = mutation.payload as ExpenseCreatePayload;
      const existing = byId.get(payload.expenseId);
      byId.set(payload.expenseId, {
        id: payload.expenseId,
        group_id: mutation.groupId,
        deleted_at: null,
        created_at: existing?.created_at ?? mutation.clientCreatedAt,
        pending: true,
        currentVersion: {
          id: `pending:${mutation.clientMutationId}`,
          version_no: (existing?.currentVersion?.version_no ?? 0) + 1,
          description: payload.description,
          category: payload.category ?? null,
          category_meta: payload.categoryMeta ?? null,
          expense_date: payload.expenseDate,
          currency: payload.currency,
          amount: payload.amount,
          split_type: payload.splitParams.kind as SplitType,
          split_params: payload.splitParams,
          author_member_id: options.authorMemberId ?? null,
          notes: payload.notes ?? null,
          payment_method: payload.paymentMethod ?? null,
          receipt_share_url: payload.receiptShareUrl ?? null,
          location: payload.location ?? null,
          // Carried through, so an edit made on top of this still-queued one
          // does not load a version without them and send `fx: null` /
          // no receipt — silently dropping the rate and unlinking the bill.
          fx: (payload as { fx?: unknown }).fx ?? null,
          receipt_id: payload.receiptId ?? null,
          sub_event_id: payload.subEventId ?? null,
          is_deposit: payload.isDeposit ?? false,
          balance_due_minor: payload.balanceDueMinor ?? null,
          balance_due_date: payload.balanceDueDate ?? null,
          occurred_at: payload.occurredAt ?? null,
          // An older queued payload has no payee: keep the one the version it
          // replaces carries, exactly as the server will.
          payee: resolvePayee(payload.payee, existing?.currentVersion?.payee),
          // Same carry-forward: a payload that does not say keeps the old flag.
          reimbursable: payload.reimbursable ?? existing?.currentVersion?.reimbursable ?? false,
          created_at: mutation.clientCreatedAt,
          payers: Object.entries(payload.payers).map(([member_id, amount]) => ({
            member_id,
            amount,
          })),
          shares: pendingShares(payload),
        },
      });
      return;
    }
    case 'expense.delete': {
      const { expenseId } = mutation.payload as ExpenseDeletePayload;
      const existing = byId.get(expenseId);
      if (existing) {
        byId.set(expenseId, { ...existing, deleted_at: mutation.clientCreatedAt, pending: true });
      }
      return;
    }
    case 'expense.restore': {
      const { expenseId } = mutation.payload as ExpenseDeletePayload;
      const existing = byId.get(expenseId);
      if (existing) byId.set(expenseId, { ...existing, deleted_at: null, pending: true });
      return;
    }
    default:
      // Members, groups and settlements do not change an expense row. They have
      // their own overlays below, because they can all be created offline now.
      return;
  }
}

function pendingShares(payload: ExpenseCreatePayload): { member_id: string; amount: string }[] {
  const shares = computeShares({
    amount: parseAmount(payload.amount),
    currency: payload.currency as CurrencyCode,
    params: payload.splitParams,
    participants: payload.participants as readonly MemberId[],
    // Same seed the server uses, so the remainder lands on the same person.
    seed: payload.expenseId,
  });
  return [...shares].map(([member_id, amount]) => ({ member_id, amount: amount.toString() }));
}

/** Non-deleted expenses only — what balances are computed from. */
export function liveExpenses(expenses: readonly MirrorExpense[]): MirrorExpense[] {
  return expenses.filter((expense) => expense.deleted_at === null && expense.currentVersion);
}

/**
 * Wire row → the shape `computeNetBalances` wants. Amounts cross the network as
 * decimal strings (JSON has no integers this size) and become bigint here, once.
 */
export function toExpenseSnapshot(expense: MirrorExpense): ExpenseSnapshot | null {
  const version = expense.currentVersion;
  if (!version) return null;
  // A malformed amount on one row must hide that row, not crash the whole list
  // as it materialises. parseAmount raises a typed MoneyError we swallow here.
  try {
    return {
      id: expense.id,
      currency: version.currency as CurrencyCode,
      amount: parseAmount(version.amount),
      payers: Object.fromEntries(
        version.payers.map((row) => [row.member_id, parseAmount(row.amount)]),
      ),
      shares: Object.fromEntries(
        version.shares.map((row) => [row.member_id, parseAmount(row.amount)]),
      ),
      date: version.expense_date,
      deletedAt: expense.deleted_at,
      // Unvalidated on purpose: `toSettleExpense` decides whether it is a usable
      // rate, by the same rule Postgres applies.
      fx: (version.fx ?? null) as ExpenseSnapshot['fx'],
    };
  } catch {
    return null;
  }
}

// ─────────────────────────────── settlements, members and groups ──
//
// Expenses were the only thing the app could create offline, so they were the
// only thing overlaid. Now that every mutation queues, the rest need the same
// treatment: a settlement recorded in a basement, a friend added on a plane and
// a group started in a tunnel all have to appear the moment they are made.
// Without this they sit in the queue, invisible, and the app looks like it
// dropped them — the failure ADR-005 exists to prevent.
//
// All three mark `pending` so a screen can say the row has not left the phone.

export interface MirrorSettlement extends MirrorRow {
  readonly id: string;
  readonly group_id: string;
  readonly from_member_id: string;
  readonly to_member_id: string;
  readonly currency: string;
  readonly amount: string;
  readonly status: string;
  readonly initiated_at: string;
  readonly confirmed_at: string | null;
  /** The day the money moved (YYYY-MM-DD). Absent on a mirror pulled before the column existed. */
  readonly paid_at?: string | null;
  /** When the payer last asked the payee to confirm; null if never. */
  readonly reminded_at?: string | null;
  readonly allocations?: readonly { expense_id: string; amount: string }[];
  readonly pending?: boolean;
}

export function materialiseSettlements(
  state: MirrorState,
  queue: readonly QueuedMutation[],
  options: { readonly groupId: string },
): MirrorSettlement[] {
  const byId = new Map<string, MirrorSettlement>();
  for (const row of rowsFor(state, SyncTable.Settlements, options.groupId) as MirrorSettlement[]) {
    byId.set(row.id, row);
  }

  for (const mutation of [...queue].sort((a, b) => a.seq - b.seq)) {
    if (mutation.groupId !== options.groupId) continue;

    if (mutation.kind === 'settlement.create') {
      const payload = mutation.payload as {
        settlementId?: string;
        from: string;
        to: string;
        currency?: string | null;
        amount: string;
        note?: string | null;
        paidAt?: string | null;
        allocations?: readonly { expenseId: string; amount: string }[];
      };
      // Falling back to the mutation id keeps the row addressable even for a
      // client that did not choose an id — two different queued settlements can
      // never collide, because the mutation id is the idempotency key.
      const id = payload.settlementId ?? `pending:${mutation.clientMutationId}`;
      byId.set(id, {
        id,
        group_id: mutation.groupId,
        from_member_id: payload.from,
        to_member_id: payload.to,
        currency: payload.currency ?? 'INR',
        amount: payload.amount,
        // `initiated`, not `confirmed`: the other person has still not agreed,
        // and a settlement that counts itself confirmed on the way out would
        // clear a debt nobody acknowledged.
        status: 'initiated',
        initiated_at: mutation.clientCreatedAt,
        confirmed_at: null,
        paid_at: payload.paidAt ?? null,
        reminded_at: null,
        note: payload.note ?? null,
        allocations: (payload.allocations ?? []).map((allocation) => ({
          expense_id: allocation.expenseId,
          amount: allocation.amount,
        })),
        pending: true,
      });
      continue;
    }

    if (mutation.kind === 'settlement.transition') {
      // `to` is the target status (confirmed | cancelled | disputed). Older
      // queued mutations predate the field and only ever meant confirm, so a
      // missing `to` still resolves to 'confirmed' — the one thing transition
      // used to do.
      const { settlementId, to } = mutation.payload as {
        settlementId: string;
        to?: string;
      };
      const next = to ?? 'confirmed';
      // The server speaks only these three targets (see the sync edge). An
      // unknown value would be rejected there, so recording it optimistically
      // here would only invent a state the ledger never reaches — skip it.
      if (next !== 'confirmed' && next !== 'cancelled' && next !== 'disputed') {
        continue;
      }
      const existing = byId.get(settlementId);
      if (existing) {
        byId.set(settlementId, {
          ...existing,
          status: next,
          // Only a confirmation stamps a confirmed_at; cancel and dispute leave
          // whatever was there (null for a still-pending row). A client only ever
          // targets confirmed/cancelled/disputed — auto_confirmed is the cron's,
          // never a queued mutation, so it cannot appear here.
          confirmed_at: next === 'confirmed' ? mutation.clientCreatedAt : existing.confirmed_at,
          pending: true,
        });
      }
    }
  }

  return [...byId.values()].sort((a, b) =>
    compareStampsDesc(String(a.initiated_at), String(b.initiated_at)),
  );
}

export interface MirrorMember extends MirrorRow {
  readonly id: string;
  readonly group_id: string;
  readonly profile_id: string | null;
  readonly ghost_name: string | null;
  readonly left_at: string | null;
  readonly employment_ended_on?: string | null;
  readonly employment_note?: string | null;
  /** Company: the manager this employee reports to (null = the owners). */
  readonly manager_id?: string | null;
  /** Company: the free-text employee ID (null/absent = none). */
  readonly employee_id?: string | null;
  /** Company: the department (an id in the group's company_departments), null/absent = none. */
  readonly department_id?: string | null;
  readonly pending?: boolean;
}

export function materialiseMembers(
  state: MirrorState,
  queue: readonly QueuedMutation[],
  options: {
    readonly groupId: string;
    /**
     * Keep people who left or were removed. Off by default: pickers for a NEW
     * expense, split or settle-up must only offer who is in the group now. On
     * for anything that reads the past — a bill, a balance, a history line still
     * points at a departed member's id, and without the row it has no name.
     */
    readonly includeLeft?: boolean;
  },
): MirrorMember[] {
  const byId = new Map<string, MirrorMember>();
  for (const row of rowsFor(state, SyncTable.GroupMembers, options.groupId) as MirrorMember[]) {
    byId.set(row.id, row);
  }

  for (const mutation of [...queue].sort((a, b) => a.seq - b.seq)) {
    if (mutation.groupId !== options.groupId) continue;

    // A group created offline must show its creator as a member at once, with
    // the id the client chose — so an expense queued behind it in the same
    // breath can already name who paid, and matches once the server (which now
    // honours the same id) has applied it. Without this the creator would be
    // invisible until the create synced back.
    if (mutation.kind === 'group.create') {
      const payload = mutation.payload as {
        creatorMemberId?: string | null;
        creatorProfileId?: string | null;
      };
      const id = payload.creatorMemberId ?? `pending:${mutation.clientMutationId}`;
      if (!byId.has(id)) {
        byId.set(id, {
          id,
          group_id: mutation.groupId,
          profile_id: payload.creatorProfileId ?? null,
          ghost_name: null,
          left_at: null,
          invite_email: null,
          invite_phone: null,
          role: 'admin',
          pending: true,
        });
      }
      continue;
    }

    // A queued "reports to" change reads as made at once, over a row the server sent.
    if (mutation.kind === 'company_member.assign') {
      if (mutation.rejection) continue;
      const assign = mutation.payload as { memberId: string; managerId: string | null };
      const existing = byId.get(assign.memberId);
      if (existing)
        byId.set(assign.memberId, { ...existing, manager_id: assign.managerId ?? null });
      continue;
    }

    // Likewise a queued employee-ID change.
    if (mutation.kind === 'company_member.employee_id_set') {
      if (mutation.rejection) continue;
      const set = mutation.payload as unknown as CompanyMemberEmployeeIdSetPayload;
      const existing = byId.get(set.memberId);
      if (existing)
        byId.set(set.memberId, { ...existing, employee_id: normaliseEmployeeId(set.employeeId) });
      continue;
    }

    if (mutation.kind === 'company_member.department_set') {
      if (mutation.rejection) continue;
      const set = mutation.payload as unknown as CompanyMemberDepartmentSetPayload;
      const existing = byId.get(set.memberId);
      if (existing) byId.set(set.memberId, { ...existing, department_id: set.departmentId });
      continue;
    }

    if (mutation.kind !== 'member.add_ghost') continue;
    const payload = mutation.payload as {
      memberId?: string;
      name: string;
      email?: string | null;
      phone?: string | null;
      profileId?: string | null;
    };
    const id = payload.memberId ?? `pending:${mutation.clientMutationId}`;
    if (byId.has(id)) continue;
    byId.set(id, {
      id,
      group_id: mutation.groupId,
      // A known account (a member cloned from another group) is on Waves from
      // the first render; the name stands in until their profile row arrives.
      profile_id: payload.profileId ?? null,
      ghost_name: payload.name,
      left_at: null,
      invite_email: payload.email ?? null,
      invite_phone: payload.phone ?? null,
      role: 'member',
      pending: true,
    });
  }

  const all = [...byId.values()];
  return options.includeLeft ? all : all.filter((member) => member.left_at === null);
}

export interface MirrorGroup extends MirrorRow {
  readonly company_tags?: readonly import('../company/tags').CompanyTag[];
  readonly company_departments?: readonly { readonly id: string; readonly name: string }[];
  readonly company_industry?: import('../company/tags').CompanyIndustry | null;
  readonly id: string;
  readonly name: string | null;
  /** What the group is for, in the maker's own words — or NULL. Optional here
   *  because the row the `group.create` overlay builds has never carried one:
   *  a description is written by the `group.update` that rides behind the
   *  create, which the overlay below spreads onto the row the moment it queues. */
  readonly description?: string | null;
  readonly default_currency: string;
  readonly created_at: string;
  readonly archived_at: string | null;
  /** A group-wide tombstone (A49): an admin deleted a settled group for everyone.
   *  A deleted group is hidden from BOTH the active list and the archive — the
   *  rows stay (ADR-004), the group simply stops being shown. */
  readonly deleted_at: string | null;
  readonly budget_minor?: string | null;
  readonly budget_currency?: string | null;
  /** Per-category caps, keyed by category id. Group-visible, admin-set. */
  readonly category_budgets?: Record<string, { amountMinor: string; currency: string }> | null;
  /** The trip's pinned rates, keyed by the currency paid in; each converts to
   *  this group's `default_currency`. Group-visible, admin-set. */
  readonly fx_rates?: Record<
    string,
    { num: string; den: string; ts: string; source: string }
  > | null;
  /** Whether a foreign bill with a stored rate counts in `default_currency`
   *  (ADR-003 amendment). Absent on a row mirrored before the column existed,
   *  which is exactly a group that has not opted in. */
  readonly convert_to_group_currency?: boolean;
  /** The families inside the group (`group/units.ts`), or null for none.
   *  Group-visible, admin-set, member-shaped like `category_budgets`. */
  readonly units?: GroupUnits | null;
  readonly pending?: boolean;
}

function buildGroups(state: MirrorState, queue: readonly QueuedMutation[]): MirrorGroup[] {
  const byId = new Map<string, MirrorGroup>();
  for (const row of rowsFor(state, SyncTable.Groups) as MirrorGroup[]) byId.set(row.id, row);

  for (const mutation of [...queue].sort((a, b) => a.seq - b.seq)) {
    if (mutation.kind === 'group.create') {
      const payload = mutation.payload as {
        name?: string | null;
        type?: string;
        currency?: string;
        emoji?: string | null;
        simplify?: boolean;
        country?: string | null;
      };
      // The id is the group id the client already chose, which is why the
      // expenses queued behind it can name it before the server has heard of it.
      byId.set(mutation.groupId, {
        id: mutation.groupId,
        name: payload.name ?? null,
        type: payload.type ?? 'other',
        default_currency: payload.currency ?? 'INR',
        cover_emoji: payload.emoji ?? null,
        simplify_debts: payload.simplify !== false,
        country_code: payload.country ?? null,
        // `waves_create_group` opts every new group in; the overlay says the
        // same so an offline group's balances do not change when it syncs.
        convert_to_group_currency: true,
        created_at: mutation.clientCreatedAt,
        archived_at: null,
        deleted_at: null,
        pending: true,
      });
      continue;
    }

    if (mutation.kind === 'company_departments.set') {
      const existing = byId.get(mutation.groupId);
      if (existing) {
        const payload =
          mutation.payload as unknown as import('./protocol').CompanyDepartmentsSetPayload;
        byId.set(mutation.groupId, {
          ...existing,
          company_departments: payload.departments.map((d) => ({ ...d })),
          pending: true,
        });
      }
    }

    if (mutation.kind === 'company_tag.add' || mutation.kind === 'company_tags.set') {
      const existing = byId.get(mutation.groupId);
      if (existing) {
        const stored = existing.company_tags ?? [];
        if (mutation.kind === 'company_tags.set') {
          const payload = mutation.payload as unknown as import('./protocol').CompanyTagsSetPayload;
          byId.set(mutation.groupId, {
            ...existing,
            company_tags: payload.tags.map((tag) => ({ ...tag })),
            company_industry: payload.industry,
            pending: true,
          });
        } else {
          const payload = mutation.payload as unknown as import('./protocol').CompanyTagAddPayload;
          if (
            stored.length < 50 &&
            !stored.some(
              (tag) =>
                tag.key === payload.key || tag.label.toLowerCase() === payload.label.toLowerCase(),
            )
          ) {
            byId.set(mutation.groupId, {
              ...existing,
              company_tags: [...stored, { ...payload }],
              pending: true,
            });
          }
        }
      }
    }

    if (mutation.kind === 'group.update') {
      const existing = byId.get(mutation.groupId);
      if (existing) {
        byId.set(mutation.groupId, {
          ...existing,
          ...(mutation.payload as Record<string, unknown>),
          id: existing.id,
          pending: true,
        });
      }
    }

    // The overall trip budget is a column on the group row (A23), so an
    // optimistic set shows on the group at once; a null amount clears it.
    if (mutation.kind === 'group_budget.set') {
      const existing = byId.get(mutation.groupId);
      if (existing) {
        const payload = mutation.payload as {
          amountMinor: string | null;
          currency?: string | null;
        };
        byId.set(mutation.groupId, {
          ...existing,
          budget_minor: payload.amountMinor,
          budget_currency: payload.amountMinor === null ? null : (payload.currency ?? null),
          pending: true,
        });
      }
    }

    // A per-category cap patches the group row's category_budgets map at once; a
    // null amount removes that category's cap. Same optimistic path as the
    // overall budget above.
    if (mutation.kind === 'category_budget.set') {
      const existing = byId.get(mutation.groupId);
      if (existing) {
        const payload = mutation.payload as {
          category: string;
          amountMinor: string | null;
          currency?: string | null;
        };
        const map = { ...(existing.category_budgets ?? {}) };
        if (payload.amountMinor === null) {
          delete map[payload.category];
        } else {
          map[payload.category] = {
            amountMinor: payload.amountMinor,
            currency: payload.currency ?? existing.default_currency,
          };
        }
        byId.set(mutation.groupId, { ...existing, category_budgets: map, pending: true });
      }
    }

    // A trip rate patches the group row's fx_rates map one currency at a time; a
    // null ratio removes that currency's entry. Same optimistic path as the
    // budgets above, so a rate an admin pins shows on the group before the sync
    // lands.
    if (mutation.kind === 'group_fx_rate.set') {
      const existing = byId.get(mutation.groupId);
      if (existing) {
        const payload = mutation.payload as {
          from: string;
          num: string | null;
          den: string | null;
          source?: string;
          ifAbsent?: boolean;
        };
        const map = { ...(existing.fx_rates ?? {}) };
        if (payload.ifAbsent && map[payload.from]) {
          // Insert-only: an existing pin stands.
        } else if (payload.num === null || payload.den === null) {
          delete map[payload.from];
        } else {
          map[payload.from] = {
            num: payload.num,
            den: payload.den,
            ts: new Date().toISOString(),
            source: payload.source ?? 'manual',
          };
        }
        byId.set(mutation.groupId, { ...existing, fx_rates: map, pending: true });
      }
    }
  }

  return [...byId.values()];
}

/**
 * The active groups — everything not archived, newest first. The dashboard and
 * every summary read through here, so archiving a group drops it out of all of
 * them at once.
 */
export function materialiseGroups(
  state: MirrorState,
  queue: readonly QueuedMutation[],
): MirrorGroup[] {
  return buildGroups(state, queue)
    .filter((group) => !group.archived_at && !group.deleted_at)
    .sort(byNewest((row) => String(row.created_at)));
}

/**
 * Every group whose ledger still counts — archived included, deleted not.
 *
 * The difference between this and {@link materialiseGroups} is the difference
 * between two questions. "What is going on now" is the dashboard's question, and
 * a trip you have put away is not part of the answer. "What do I owe Priya" is
 * not about trips at all, and archiving one does not settle a debt: the money is
 * real, nobody left the group, and one tap of Unarchive brings it back.
 *
 * So the person-to-person balances sum through here. The server's
 * `waves_people_i_owe` draws the line in the same place, and it has to — the
 * Friends list is read from the mirror and the person screen behind it from that
 * RPC, so a number that changed depending on which one answered would be its own
 * bug (and was: the mirror dropped archived groups while the RPC counted them).
 *
 * A deleted group is on neither list. It is a tombstone (ADR-004) that rides the
 * sync pull so every device learns the group is gone, which is exactly why its
 * rows are still here to be filtered out.
 */
export function materialiseLedgerGroups(
  state: MirrorState,
  queue: readonly QueuedMutation[],
): MirrorGroup[] {
  return buildGroups(state, queue)
    .filter((group) => !group.deleted_at)
    .sort(byNewest((row) => String(row.created_at)));
}

export function materialiseLedgerGroupIds(
  state: MirrorState,
  queue: readonly QueuedMutation[],
): ReadonlySet<string> {
  return new Set(materialiseLedgerGroups(state, queue).map((group) => group.id));
}

/**
 * One group by id, archived or not. `materialiseGroups` hides archived groups so
 * they leave the dashboard, but a per-group screen (the plan, its budget) still
 * opens on an archived trip and must see its row — including a queued
 * `group_budget.set` that has not synced yet.
 */
export function materialiseGroup(
  state: MirrorState,
  queue: readonly QueuedMutation[],
  groupId: string,
): MirrorGroup | undefined {
  return buildGroups(state, queue).find((group) => group.id === groupId);
}

/**
 * The archived groups — the ones `materialiseGroups` hides — newest-archived
 * first, so the archive reads as a most-recent-on-top history. Unarchiving is
 * an ordinary group.update clearing `archived_at`, so the same queue overlay
 * moves a group back into the active list the instant the row is tapped.
 */
export function materialiseArchivedGroups(
  state: MirrorState,
  queue: readonly QueuedMutation[],
): MirrorGroup[] {
  return buildGroups(state, queue)
    .filter((group) => Boolean(group.archived_at) && !group.deleted_at)
    .sort(byNewest((row) => row.archived_at));
}

// ───────────────────────────────────────────────── captures (A34) ──
//
// The personal inbox needs the same server+pending treatment as everything
// else: a capture made offline is only in the queue, and without the overlay it
// would be invisible until it synced — the same data-loss illusion ADR-005
// exists to prevent. Captures ride a *personal* scope, so the envelope's
// `groupId` slot holds the owner's user id rather than a group.

export interface MirrorCapture extends MirrorRow {
  readonly id: string;
  readonly owner_user_id: string;
  readonly description: string;
  readonly category: string | null;
  readonly category_meta: CategoryMeta | null;
  readonly expense_date: string;
  readonly currency: string;
  readonly amount: string;
  readonly notes: string | null;
  readonly photo_path: string | null;
  readonly raw_text: string | null;
  readonly parsed: Record<string, unknown> | null;
  readonly payment_method: string | null;
  readonly target_group_id: string | null;
  readonly location: ExpenseLocation | null;
  readonly status: 'open' | 'assigned';
  readonly assigned_expense_id: string | null;
  readonly assigned_group_id: string | null;
  readonly created_at: string;
  readonly deleted_at: string | null;
  readonly pending?: boolean;
}

/**
 * The captures to render: the server's rows with the queue replayed on top.
 *
 * `ownerId` is the personal scope — the caller's own user id, which is what
 * every queued capture mutation carries in place of a group id.
 */
export function materialiseCaptures(
  state: MirrorState,
  queue: readonly QueuedMutation[],
  options: { readonly ownerId: string },
): MirrorCapture[] {
  const byId = new Map<string, MirrorCapture>();
  // Scope the server rows to this owner too: if the mirror ever holds another
  // account's captures (a shared device, an account switch), the inbox must not
  // show them just because the queue overlay below is the only thing filtered.
  for (const row of rowsFor(state, SyncTable.Captures) as MirrorCapture[]) {
    if (row.owner_user_id !== options.ownerId) continue;
    // PostgREST sends the BIGINT amount as a JSON number; the type (and every
    // screen) says string. Made one here, where server rows enter.
    byId.set(row.id, { ...row, amount: String(row.amount) });
  }

  for (const mutation of [...queue].sort((a, b) => a.seq - b.seq)) {
    if (mutation.groupId !== options.ownerId) continue;

    switch (mutation.kind) {
      case 'capture.create':
      case 'capture.update': {
        const payload = mutation.payload as CaptureCreatePayload;
        const existing = byId.get(payload.captureId);
        byId.set(payload.captureId, {
          id: payload.captureId,
          owner_user_id: options.ownerId,
          description: payload.description,
          category: payload.category ?? null,
          category_meta:
            'categoryMeta' in payload
              ? (payload.categoryMeta ?? null)
              : (existing?.category_meta ?? null),
          expense_date: payload.expenseDate,
          currency: payload.currency,
          amount: payload.amount,
          notes: payload.notes ?? null,
          photo_path: payload.photoPath ?? null,
          raw_text: payload.rawText ?? null,
          parsed: payload.parsed ?? null,
          // An edit that omits these keeps what the server had; an edit that
          // sends them — null included — is a deliberate clear, so `in` decides
          // rather than `??`, which would swallow an explicit null.
          payment_method:
            'paymentMethod' in payload
              ? (payload.paymentMethod ?? null)
              : (existing?.payment_method ?? null),
          target_group_id:
            'targetGroupId' in payload
              ? (payload.targetGroupId ?? null)
              : (existing?.target_group_id ?? null),
          location:
            'location' in payload ? (payload.location ?? null) : (existing?.location ?? null),
          // An edit never un-assigns; only assignment sets it, below.
          status: existing?.status ?? 'open',
          assigned_expense_id: existing?.assigned_expense_id ?? null,
          assigned_group_id: existing?.assigned_group_id ?? null,
          created_at: existing?.created_at ?? mutation.clientCreatedAt,
          deleted_at: existing?.deleted_at ?? null,
          pending: true,
        });
        break;
      }
      case 'capture.delete': {
        const { captureId } = mutation.payload as CaptureDeletePayload;
        const existing = byId.get(captureId);
        if (existing) {
          byId.set(captureId, { ...existing, deleted_at: mutation.clientCreatedAt, pending: true });
        }
        break;
      }
      case 'capture.assign': {
        const payload = mutation.payload as CaptureAssignPayload;
        const existing = byId.get(payload.captureId);
        if (existing) {
          byId.set(payload.captureId, {
            ...existing,
            status: 'assigned',
            assigned_group_id: payload.groupId,
            assigned_expense_id: payload.expenseId,
            pending: true,
          });
        }
        break;
      }
      default:
        break;
    }
  }

  return [...byId.values()].sort((a, b) =>
    compareStampsDesc(String(a.created_at), String(b.created_at)),
  );
}

/** The inbox: open, not deleted. What has been assigned or removed is gone from it. */
export function openCaptures(captures: readonly MirrorCapture[]): MirrorCapture[] {
  return captures.filter((capture) => capture.status === 'open' && capture.deleted_at === null);
}

// ─────────────────────────────────────── the category-tag catalog ──
// Personal scope, exactly like captures, but under its own cursor key
// (`categoryTagsScope`). A tag made offline is only in the queue, so the same
// server+pending overlay applies or a freshly created tag would be invisible
// until it synced.

export interface MirrorCategoryTag extends MirrorRow {
  readonly id: string;
  readonly owner_user_id: string;
  readonly builtin_id: string | null;
  readonly label: string | null;
  readonly icon: string | null;
  readonly tint: string | null;
  /** Which picker the tag belongs in; absent on rows written before it existed. */
  readonly axis?: string | null;
  /** The pack it arrived from, for provenance. */
  readonly pack_id?: string | null;
  readonly sort_order: number;
  readonly hidden: boolean;
  readonly deleted_at: string | null;
}

/**
 * The catalog rows to read: the server's rows for this owner, with the queue
 * replayed on top. `ownerId` is the personal scope; every queued tag mutation
 * carries `categoryTagsScope(ownerId)` in the envelope's group slot.
 */
export function materialiseCategoryTags(
  state: MirrorState,
  queue: readonly QueuedMutation[],
  options: { readonly ownerId: string },
): MirrorCategoryTag[] {
  const scope = categoryTagsScope(options.ownerId);
  const byId = new Map<string, MirrorCategoryTag>();
  for (const row of rowsFor(state, SyncTable.CategoryTags) as MirrorCategoryTag[]) {
    if (row.owner_user_id !== options.ownerId) continue;
    byId.set(row.id, row);
  }

  for (const mutation of [...queue].sort((a, b) => a.seq - b.seq)) {
    if (mutation.groupId !== scope) continue;

    switch (mutation.kind) {
      case 'tag.create':
      case 'tag.update': {
        const payload = mutation.payload as TagUpsertPayload;
        const existing = byId.get(payload.tagId);
        byId.set(payload.tagId, {
          id: payload.tagId,
          owner_user_id: options.ownerId,
          builtin_id: payload.builtinId ?? existing?.builtin_id ?? null,
          label: payload.label ?? existing?.label ?? null,
          icon: payload.icon ?? existing?.icon ?? null,
          tint: payload.tint ?? existing?.tint ?? null,
          axis: payload.axis ?? existing?.axis ?? 'expense',
          pack_id: payload.packId ?? existing?.pack_id ?? null,
          sort_order: payload.sortOrder,
          hidden: payload.hidden,
          deleted_at: existing?.deleted_at ?? null,
        });
        break;
      }
      case 'tag.delete': {
        const { tagId } = mutation.payload as TagDeletePayload;
        const existing = byId.get(tagId);
        if (existing) {
          byId.set(tagId, { ...existing, deleted_at: mutation.clientCreatedAt });
        }
        break;
      }
      default:
        break;
    }
  }

  return [...byId.values()].filter((tag) => tag.deleted_at === null);
}

// ─────────────────────────────────────── the personal-finance ledger ──
// Personal scope (A48), exactly like captures/tags but under `personalScope`.
// One generic row per record; `record_kind` says which of the four it is and
// `data` carries that kind's fields (money as minor-unit strings). A record made
// offline is only in the queue, so the same server+pending overlay applies.

export interface MirrorPersonalRecord extends MirrorRow {
  readonly id: string;
  readonly owner_user_id: string;
  readonly record_kind: PersonalRecordKind;
  readonly data: Record<string, unknown>;
  readonly created_at: string;
  readonly deleted_at: string | null;
  readonly pending?: boolean;
}

/**
 * The personal-finance records to read: the server's rows for this owner with
 * the queue replayed on top. `ownerId` is the personal scope; every queued
 * personal mutation carries `personalScope(ownerId)` in the envelope's group
 * slot. Deleted rows are dropped — the caller sees only live records.
 *
 * `includeDeleted` keeps the tombstones. One caller wants them: a restore from
 * a cloud backup, which has to know that a record it is about to bring back was
 * deleted here on purpose. Everything that renders a list wants the default.
 */
export function materialisePersonalRecords(
  state: MirrorState,
  queue: readonly QueuedMutation[],
  options: { readonly ownerId: string; readonly includeDeleted?: boolean },
): MirrorPersonalRecord[] {
  const scope = personalScope(options.ownerId);
  const byId = new Map<string, MirrorPersonalRecord>();
  for (const row of rowsFor(state, SyncTable.PersonalRecords) as MirrorPersonalRecord[]) {
    if (row.owner_user_id !== options.ownerId) continue;
    byId.set(row.id, row);
  }

  for (const mutation of [...queue].sort((a, b) => a.seq - b.seq)) {
    if (mutation.groupId !== scope) continue;

    switch (mutation.kind) {
      case 'personal.upsert': {
        const payload = mutation.payload as PersonalUpsertPayload;
        const existing = byId.get(payload.recordId);
        byId.set(payload.recordId, {
          id: payload.recordId,
          owner_user_id: options.ownerId,
          record_kind: payload.recordKind,
          data: { ...payload.data },
          created_at: existing?.created_at ?? mutation.clientCreatedAt,
          // The server clears `deleted_at` on every upsert (an edit after a
          // remove un-deletes the record), so the overlay does too: an offline
          // undo that re-upserts the original id must show at once.
          deleted_at: null,
          pending: true,
        });
        break;
      }
      case 'personal.delete': {
        const { recordId } = mutation.payload as PersonalDeletePayload;
        const existing = byId.get(recordId);
        if (existing) {
          byId.set(recordId, { ...existing, deleted_at: mutation.clientCreatedAt, pending: true });
        }
        break;
      }
      default:
        break;
    }
  }

  const all = [...byId.values()];
  return options.includeDeleted ? all : all.filter((record) => record.deleted_at === null);
}

/**
 * A viewer's ghost merge, as it lands in the mirror (A38). Pull-only — the
 * client never writes these — so there is no pending overlay, unlike captures.
 * `id` is the synthetic key the edge injects (the member_id), since the table's
 * real key is the composite (owner, member_id).
 */
export interface MirrorGhostMerge extends MirrorRow {
  readonly id: string;
  readonly owner: string;
  readonly member_id: string;
  readonly person_id: string;
  readonly display_name: string;
}

/** The viewer's ghost merges from the mirror; read-only, no overlay. */
export function ghostMerges(state: MirrorState): MirrorGhostMerge[] {
  return rowsFor(state, SyncTable.GhostMerges) as MirrorGhostMerge[];
}

// ─────────────────────────────────────────────── trip plan + budgets (A23) ──
//
// The plan is a group's shared list, not money (no balance ever reads it), so
// it gets the same server+pending overlay as everything else: an item added in
// a dead zone is only in the queue until it syncs, and without the overlay it
// would look lost. Delete is soft (a `deleted_at` the seq pull carries), so the
// mirror filters it out rather than a hard removal a second device never sees.

export interface MirrorPlanItem extends MirrorRow {
  readonly id: string;
  readonly group_id: string;
  readonly day: string;
  readonly starts_at: string | null;
  readonly title: string;
  readonly note: string | null;
  readonly category: string | null;
  readonly planned_minor: string | null;
  readonly currency: string;
  readonly done_at: string | null;
  readonly expense_id: string | null;
  readonly position: number;
  readonly deleted_at: string | null;
  readonly pending?: boolean;
  /** Queue order for a pending create the server has not positioned yet, so two
   *  items added back-to-back sort in the order they were typed, not by UUID. */
  readonly pending_rank?: number;
}

/** The plan of one group: server rows with queued create/update/delete on top. */
export function materialisePlanItems(
  state: MirrorState,
  queue: readonly QueuedMutation[],
  options: { readonly groupId: string },
): MirrorPlanItem[] {
  const byId = new Map<string, MirrorPlanItem>();
  for (const row of rowsFor(state, SyncTable.TripPlanItems, options.groupId) as MirrorPlanItem[]) {
    byId.set(row.id, row);
  }

  for (const mutation of [...queue].sort((a, b) => a.seq - b.seq)) {
    if (mutation.groupId !== options.groupId) continue;

    switch (mutation.kind) {
      case 'plan_item.create': {
        const payload = mutation.payload as PlanItemCreatePayload;
        if (byId.has(payload.itemId)) break;
        byId.set(payload.itemId, {
          id: payload.itemId,
          group_id: mutation.groupId,
          day: payload.day,
          starts_at: payload.startsAt ?? null,
          title: payload.title,
          note: payload.note ?? null,
          category: payload.category ?? null,
          planned_minor: payload.plannedMinor ?? null,
          currency: payload.currency ?? 'INR',
          done_at: null,
          expense_id: null,
          // The server sets the real position (last within its day); until then
          // sort a fresh item after the known ones, tie-broken by queue order.
          position: Number.MAX_SAFE_INTEGER,
          pending_rank: mutation.seq,
          deleted_at: null,
          pending: true,
        });
        break;
      }
      case 'plan_item.update': {
        const payload = mutation.payload as PlanItemUpdatePayload;
        const existing = byId.get(payload.itemId);
        if (!existing) break;
        const cleared = new Set(payload.clear ?? []);
        byId.set(payload.itemId, {
          ...existing,
          day: payload.day ?? existing.day,
          title: payload.title ?? existing.title,
          starts_at: cleared.has('starts_at') ? null : (payload.startsAt ?? existing.starts_at),
          note: cleared.has('note') ? null : (payload.note ?? existing.note),
          category: cleared.has('category') ? null : (payload.category ?? existing.category),
          planned_minor: cleared.has('planned_minor')
            ? null
            : (payload.plannedMinor ?? existing.planned_minor),
          expense_id: cleared.has('expense_id') ? null : (payload.expenseId ?? existing.expense_id),
          done_at:
            payload.done === undefined
              ? existing.done_at
              : payload.done
                ? (existing.done_at ?? mutation.clientCreatedAt)
                : null,
          pending: true,
        });
        break;
      }
      case 'plan_item.delete': {
        const { itemId } = mutation.payload as PlanItemDeletePayload;
        const existing = byId.get(itemId);
        if (existing) {
          byId.set(itemId, { ...existing, deleted_at: mutation.clientCreatedAt, pending: true });
        }
        break;
      }
      default:
        break;
    }
  }

  return [...byId.values()].sort((a, b) => {
    if (a.day !== b.day) return a.day.localeCompare(b.day);
    if (a.position !== b.position) return a.position - b.position;
    // Same position means two not-yet-positioned pending creates; keep the order
    // they were queued in before falling back to a (stable but arbitrary) id.
    if (a.pending_rank !== undefined && b.pending_rank !== undefined) {
      return a.pending_rank - b.pending_rank;
    }
    return String(a.id).localeCompare(String(b.id));
  });
}

// ───────────────────────────────────── private / party-only attachments ──
//
// Pull-only: the write is a direct RPC (the bytes need an online upload anyway),
// so there is no queue overlay — the mirror holds exactly what the party-scoped
// pull returned. The pull reads as the caller, so a non-party never receives
// these rows in the first place; a live read here just drops tombstones.

/** A settlement's payment proof, as the mirror holds it (party-filtered rows). */
export interface MirrorSettlementProof extends MirrorRow {
  readonly id: string;
  readonly settlement_id: string;
  readonly group_id: string;
  readonly storage_path: string;
  readonly uploader_member_id: string;
  readonly created_at: string | null;
  readonly deleted_at: string | null;
}

/**
 * The live proofs for a settlement, oldest first (a payment holds up to two).
 * Ties on the timestamp fall back to the id so the order is the same on every
 * device.
 */
export function materialiseSettlementProofs(
  state: MirrorState,
  options: { readonly settlementId: string },
): MirrorSettlementProof[] {
  const live: MirrorSettlementProof[] = [];
  for (const row of rowsFor(state, SyncTable.SettlementProofs) as MirrorSettlementProof[]) {
    if (row.settlement_id === options.settlementId && row.deleted_at === null) live.push(row);
  }
  return live.sort(
    (a, b) => (a.created_at ?? '').localeCompare(b.created_at ?? '') || a.id.localeCompare(b.id),
  );
}

/** The first live proof for a settlement, or null. */
export function materialiseSettlementProof(
  state: MirrorState,
  options: { readonly settlementId: string },
): MirrorSettlementProof | null {
  return materialiseSettlementProofs(state, options)[0] ?? null;
}

/** An image attached to an expense (group- or party-visible). */
export interface MirrorExpenseAttachment extends MirrorRow {
  readonly id: string;
  readonly expense_id: string;
  readonly group_id: string;
  readonly storage_path: string;
  readonly visibility: string;
  readonly uploader_member_id: string;
  /** Non-destructive pen/text markup (jsonb), or null. Shape parsed at the UI. */
  readonly annotations: unknown;
  /**
   * A tiny blurred stand-in for the image, as a `data:` URI — enough to draw
   * something the instant this row is read, while the real bytes are still
   * being signed for and fetched. Optional rather than nullable: a mirror
   * pulled before the column existed has no such key at all, and every receipt
   * stored before it has null.
   */
  readonly preview?: string | null;
  readonly created_at: string | null;
  readonly deleted_at: string | null;
}

/** The live attachments for one expense, newest first. Whatever the pull
 *  returned is already RLS-filtered — a `parties` row a non-party cannot see
 *  never reached the mirror. */
export function materialiseExpenseAttachments(
  state: MirrorState,
  options: { readonly expenseId: string },
): MirrorExpenseAttachment[] {
  return (rowsFor(state, SyncTable.ExpenseAttachments) as MirrorExpenseAttachment[])
    .filter((row) => row.expense_id === options.expenseId && row.deleted_at === null)
    .sort(byNewest((row) => row.created_at));
}

export interface MirrorExpenseComment extends MirrorRow {
  readonly id: string;
  readonly group_id: string;
  readonly expense_id: string;
  readonly author_member_id: string | null;
  readonly body: string;
  readonly edited_at: string | null;
  readonly flagged_at: string | null;
  readonly flagged_by: string | null;
  readonly created_at: string | null;
  readonly deleted_at: string | null;
}

/** The live comments on one expense, oldest first — a thread reads top-down.
 *  A deleted comment is a tombstone in the mirror; it is filtered out here so a
 *  removal (by the author or an admin) reaches every device as a disappearance. */
export function materialiseExpenseComments(
  state: MirrorState,
  options: { readonly expenseId: string },
): MirrorExpenseComment[] {
  return (rowsFor(state, SyncTable.ExpenseComments) as MirrorExpenseComment[])
    .filter((row) => row.expense_id === options.expenseId && row.deleted_at === null)
    .sort(byOldest((row) => row.created_at));
}

export interface MirrorExpenseImageEvent extends MirrorRow {
  readonly id: string;
  readonly group_id: string;
  readonly expense_id: string;
  readonly actor_member_id: string | null;
  readonly kind: string;
  readonly action: string;
  readonly visibility: string;
  readonly created_at: string | null;
}

/** The image audit for one expense — who added/removed a receipt or attachment,
 *  oldest first, so the trail reads top-down like the version history beside it.
 *  Append-only: there is no tombstone to filter (a correction is another line).
 *  A `parties` row only reaches a device the pull deemed a party, so nothing to
 *  hide here. */
export function materialiseExpenseImageEvents(
  state: MirrorState,
  options: { readonly expenseId: string },
): MirrorExpenseImageEvent[] {
  return (rowsFor(state, SyncTable.ExpenseImageEvents) as MirrorExpenseImageEvent[])
    .filter((row) => row.expense_id === options.expenseId)
    .sort(byOldest((row) => row.created_at));
}

/** The plan to render: what has not been removed. */
export function openPlanItems(items: readonly MirrorPlanItem[]): MirrorPlanItem[] {
  return items.filter((item) => item.deleted_at === null);
}

// ───────────────────────────────────────── repeating group expenses ──
//
// A rule made or paused in a dead zone must read as made or paused straight away,
// so the queue is replayed over the pulled rows like everything else. Only the
// rule is overlaid: the expenses it posts come from the server generator and
// arrive as ordinary expense rows, so there is nothing to predict for them here.

export interface MirrorGroupRecurring extends MirrorRow {
  readonly id: string;
  readonly group_id: string;
  readonly created_by: string;
  readonly description: string;
  readonly category: string | null;
  readonly currency: string;
  readonly amount: string;
  readonly split_type: string;
  readonly split_params: unknown;
  readonly payers: readonly { readonly memberId: string; readonly amount: string }[];
  readonly shares: readonly { readonly memberId: string; readonly amount: string }[];
  readonly notes: string | null;
  readonly cadence: 'weekly' | 'semimonthly' | 'monthly' | 'yearly';
  readonly interval: number;
  readonly second_day: number | null;
  readonly anchor_date: string;
  readonly next_date: string;
  readonly end_date: string | null;
  readonly status: 'active' | 'paused' | 'stopped';
  readonly last_generated_on: string | null;
  readonly pending?: boolean;
}

/**
 * The rules of one group: server rows with queued create / edit / pause / stop on
 * top, newest first. `today` (the app's own date string, never read from a clock
 * in here) lets a queued schedule edit or resume show the date the server will
 * pick — the first occurrence from today, with nothing back-paid.
 */
export function materialiseGroupRecurring(
  state: MirrorState,
  queue: readonly QueuedMutation[],
  options: {
    readonly groupId: string;
    readonly myMemberId?: string | null;
    readonly today?: string;
  },
): MirrorGroupRecurring[] {
  const byId = new Map<string, MirrorGroupRecurring>();
  for (const row of rowsFor(
    state,
    SyncTable.GroupRecurringExpenses,
    options.groupId,
  ) as MirrorGroupRecurring[]) {
    byId.set(row.id, row);
  }

  for (const mutation of [...queue].sort((a, b) => a.seq - b.seq)) {
    if (mutation.groupId !== options.groupId) continue;

    if (mutation.kind === 'group_recurring.create') {
      const payload = mutation.payload as unknown as GroupRecurringCreatePayload;
      if (byId.has(payload.ruleId)) continue;
      byId.set(payload.ruleId, {
        id: payload.ruleId,
        group_id: mutation.groupId,
        created_by: options.myMemberId ?? '',
        description: payload.description,
        category: payload.category ?? null,
        currency: payload.currency,
        amount: payload.amount,
        split_type: payload.splitType,
        split_params: payload.splitParams,
        payers: payload.payers,
        shares: payload.shares,
        notes: payload.notes ?? null,
        cadence: payload.cadence,
        interval: payload.interval,
        second_day: payload.cadence === 'semimonthly' ? (payload.secondDay ?? null) : null,
        anchor_date: payload.anchorDate,
        next_date: payload.skipFirst
          ? nextOccurrenceAfter(
              {
                cadence: payload.cadence,
                interval: payload.interval,
                secondDay: payload.secondDay ?? null,
                anchorDate: payload.anchorDate,
              },
              payload.anchorDate,
            )
          : payload.anchorDate,
        end_date: payload.endDate ?? null,
        status: 'active',
        last_generated_on: payload.skipFirst ? payload.anchorDate : null,
        created_at: mutation.clientCreatedAt,
        pending: true,
      });
    } else if (mutation.kind === 'group_recurring.update') {
      const { ruleId, patch } = mutation.payload as unknown as GroupRecurringUpdatePayload;
      const existing = byId.get(ruleId);
      // A stopped rule is final; the server refuses the change, so do not show it.
      if (!existing || existing.status === 'stopped') continue;
      const next: Record<string, unknown> = { ...existing, pending: true };
      for (const [key, value] of Object.entries(patch)) {
        if (value !== undefined) next[key] = value;
      }
      const merged = next as unknown as MirrorGroupRecurring;
      if (merged.cadence !== 'semimonthly')
        (next as { second_day: number | null }).second_day = null;
      const scheduleChanged =
        merged.cadence !== existing.cadence ||
        merged.interval !== existing.interval ||
        merged.second_day !== existing.second_day ||
        merged.anchor_date !== existing.anchor_date;
      const resumed = existing.status === 'paused' && merged.status === 'active';
      if (options.today && (scheduleChanged || (resumed && existing.next_date < options.today))) {
        next.next_date = firstOccurrenceOnOrAfter(
          {
            cadence: merged.cadence,
            interval: merged.interval,
            secondDay: merged.second_day,
            anchorDate: merged.anchor_date,
          },
          scheduleChanged && options.today < merged.anchor_date
            ? merged.anchor_date
            : options.today,
        );
      }
      byId.set(ruleId, next as unknown as MirrorGroupRecurring);
    }
  }

  return [...byId.values()].sort((a, b) => {
    const left = String(a.created_at ?? '');
    const right = String(b.created_at ?? '');
    return left === right ? String(a.id).localeCompare(String(b.id)) : right.localeCompare(left);
  });
}

// ───────────────────────────────────────────────────── company entries ──
//
// An entry typed in a dead zone must read as recorded straight away, so the
// queue is replayed over the pulled rows. The server stays authoritative: it
// recomputes bata and may refuse, in which case the queue item fails and the
// overlay disappears with it.

export interface MirrorCompanyEntry extends MirrorRow {
  readonly id: string;
  readonly group_id: string;
  readonly member_id: string | null;
  readonly paid_by_company?: boolean;
  readonly entry_kind: string;
  readonly category: string | null;
  readonly amount: string;
  readonly currency: string;
  readonly calc_mode: string;
  readonly days: string | null;
  readonly rate_minor: string | null;
  readonly occurred_on: string;
  readonly direction: string | null;
  readonly status: string;
  readonly note: string | null;
  readonly review_note?: string | null;
  readonly vendor?: string | null;
  readonly gstin?: string | null;
  readonly invoice_no?: string | null;
  readonly gst_rate_bps?: number | null;
  readonly gst_amount_minor?: string | null;
  readonly distance_km?: string | null;
  readonly from_text?: string | null;
  readonly to_text?: string | null;
  readonly reimbursement_id?: string | null;
  readonly reimbursement_details?: unknown;
  readonly project_id?: string | null;
  readonly funding_manager_id?: string | null;
  readonly gross_minor?: string | null;
  readonly claims_minor?: string | null;
  readonly recovery_minor?: string | null;
  readonly wage_run_id?: string | null;
  readonly period_start?: string | null;
  readonly period_end?: string | null;
  readonly deleted_at: string | null;
  readonly pending?: boolean;
}

/** A photo on a company entry, as the mirror holds it (read as the caller, so owner/admin only). */
export interface MirrorCompanyEntryAttachment extends MirrorRow {
  readonly id: string;
  readonly entry_id: string;
  readonly group_id: string;
  readonly storage_path: string;
  readonly uploader_member_id: string;
  readonly preview?: string | null;
  readonly created_at: string | null;
  readonly deleted_at: string | null;
}

/** The live photos on one entry, vendor ledger line or work task (ids never collide), oldest first. */
export function materialiseCompanyEntryAttachments(
  state: MirrorState,
  options: { readonly entryId: string },
): MirrorCompanyEntryAttachment[] {
  return (
    [
      ...rowsFor(state, SyncTable.CompanyEntryAttachments),
      ...rowsFor(state, SyncTable.CompanyVendorEntryAttachments),
      ...rowsFor(state, SyncTable.CompanyWorkTaskAttachments),
    ] as MirrorCompanyEntryAttachment[]
  )
    .filter((row) => row.entry_id === options.entryId && row.deleted_at === null)
    .sort(
      (a, b) => (a.created_at ?? '').localeCompare(b.created_at ?? '') || a.id.localeCompare(b.id),
    );
}

/** The entries of one group the viewer can read, with queued changes on top. */
export function materialiseCompanyEntries(
  state: MirrorState,
  queue: readonly QueuedMutation[],
  options: {
    readonly groupId: string;
    /** The group currency: a queued entry shows in it. */
    readonly currency: string;
    /** The viewer's member id: the author of a queued entry. */
    readonly myMemberId?: string | null;
    /** The viewer is a manager: their queued company-paid entries come out of their pool. */
    readonly myIsManager?: boolean;
    /** The company needs approval: a queued entry reads as submitted, not approved. */
    readonly approvalsEnabled?: boolean;
  },
): MirrorCompanyEntry[] {
  const byId = new Map<string, MirrorCompanyEntry>();
  for (const row of rowsFor(
    state,
    SyncTable.CompanyEntries,
    options.groupId,
  ) as MirrorCompanyEntry[]) {
    byId.set(row.id, row);
  }

  for (const mutation of [...queue].sort((a, b) => a.seq - b.seq)) {
    // A refused change stays queued for the retry / discard banner but must not
    // keep changing what the ledger shows.
    if (mutation.groupId !== options.groupId || mutation.rejection) continue;

    if (mutation.kind === 'company_entry.create') {
      const payload = mutation.payload as unknown as CompanyEntryCreatePayload;
      if (byId.has(payload.entryId)) continue;
      const data = payload.data;
      const calc = data.calcMode ?? (payload.entryKind === 'allowance' ? 'days_rate' : 'typed');
      const computed =
        calc === 'days_rate' && data.days && data.rateMinor
          ? allowanceAmount(data.days, BigInt(data.rateMinor))
          : calc === 'distance_rate' && data.distanceKm && data.rateMinor
            ? mileageAmount(data.distanceKm, BigInt(data.rateMinor))
            : null;
      byId.set(payload.entryId, {
        id: payload.entryId,
        group_id: mutation.groupId,
        member_id: payload.memberId,
        paid_by_company: data.paidByCompany === true,
        entry_kind: payload.entryKind,
        category: payload.entryKind === 'expense' ? (data.category ?? null) : null,
        amount: computed !== null ? computed.toString() : (data.amount ?? '0'),
        currency: options.currency,
        calc_mode: calc,
        days: data.days ?? null,
        rate_minor: data.rateMinor ?? null,
        vendor: data.vendor ?? null,
        gstin: data.gstin ?? null,
        invoice_no: data.invoiceNo ?? null,
        gst_rate_bps: data.gstRateBps ?? null,
        gst_amount_minor: data.gstAmountMinor ?? null,
        distance_km: data.distanceKm ?? null,
        from_text: data.fromText ?? null,
        to_text: data.toText ?? null,
        reimbursement_id: null,
        project_id: data.projectId ?? null,
        funding_manager_id:
          data.paidByCompany === true
            ? options.myIsManager
              ? (options.myMemberId ?? null)
              : null
            : (data.fundingManagerId ?? null),
        occurred_on: data.occurredOn ?? mutation.clientCreatedAt.slice(0, 10),
        direction:
          payload.entryKind === 'reimbursement' ? (data.direction ?? 'company_to_employee') : null,
        status: options.approvalsEnabled && data.paidByCompany !== true ? 'submitted' : 'approved',
        note: data.note ?? null,
        deleted_at: null,
        created_by: options.myMemberId ?? null,
        created_at: mutation.clientCreatedAt,
        pending: true,
      });
    } else if (mutation.kind === 'company_entry.update') {
      const { entryId, patch } = mutation.payload as unknown as CompanyEntryUpdatePayload;
      const existing = byId.get(entryId);
      if (!existing || existing.deleted_at) continue;
      const next: Record<string, unknown> = { ...existing, pending: true };
      if (patch.amount !== undefined) next.amount = patch.amount;
      if (patch.category !== undefined) next.category = patch.category;
      if (patch.days !== undefined) next.days = patch.days;
      if (patch.rateMinor !== undefined) next.rate_minor = patch.rateMinor;
      if (patch.calcMode !== undefined) next.calc_mode = patch.calcMode;
      if (patch.vendor !== undefined) next.vendor = patch.vendor;
      if (patch.gstin !== undefined) next.gstin = patch.gstin;
      if (patch.invoiceNo !== undefined) next.invoice_no = patch.invoiceNo;
      if (patch.gstRateBps !== undefined) next.gst_rate_bps = patch.gstRateBps;
      if (patch.gstAmountMinor !== undefined) next.gst_amount_minor = patch.gstAmountMinor;
      if (patch.distanceKm !== undefined) next.distance_km = patch.distanceKm;
      if (patch.fromText !== undefined) next.from_text = patch.fromText;
      if (patch.toText !== undefined) next.to_text = patch.toText;
      if (patch.occurredOn !== undefined) next.occurred_on = patch.occurredOn;
      if (patch.note !== undefined) next.note = patch.note;
      if (patch.direction !== undefined) next.direction = patch.direction;
      if (options.approvalsEnabled && next.status !== 'submitted') {
        next.status = 'submitted';
        next.review_note = null;
      }
      if (next.calc_mode === 'days_rate' && next.days && next.rate_minor) {
        const computed = allowanceAmount(String(next.days), BigInt(String(next.rate_minor)));
        if (computed !== null) next.amount = computed.toString();
      }
      if (next.calc_mode === 'distance_rate' && next.distance_km && next.rate_minor) {
        const computed = mileageAmount(String(next.distance_km), BigInt(String(next.rate_minor)));
        if (computed !== null) next.amount = computed.toString();
      }
      byId.set(entryId, next as unknown as MirrorCompanyEntry);
    } else if (mutation.kind === 'company_entry.void') {
      const { entryId } = mutation.payload as unknown as CompanyEntryVoidPayload;
      const existing = byId.get(entryId);
      if (!existing) continue;
      byId.set(entryId, { ...existing, deleted_at: mutation.clientCreatedAt, pending: true });
    } else if (mutation.kind === 'company_entry.transition') {
      const { entryId, to, note } = mutation.payload as unknown as CompanyEntryTransitionPayload;
      const existing = byId.get(entryId);
      if (!existing || existing.status !== 'submitted') continue;
      byId.set(entryId, {
        ...existing,
        status: to,
        review_note: note ?? null,
        pending: true,
      });
    } else if (mutation.kind === 'company.reimburse') {
      // One payment entry, and the claims it covers read as paid at once.
      const p = mutation.payload as unknown as CompanyReimbursePayload;
      if (byId.has(p.reimbursementId)) continue;
      for (const { entryId } of p.claims) {
        const covered = byId.get(entryId);
        if (covered)
          byId.set(entryId, {
            ...covered,
            status: 'reimbursed',
            reimbursement_id: p.reimbursementId,
            pending: true,
          });
      }
      for (const { entryId } of p.adjustments) {
        const covered = byId.get(entryId);
        if (covered)
          byId.set(entryId, {
            ...covered,
            reimbursement_id: p.reimbursementId,
            pending: true,
          });
      }
      byId.set(p.reimbursementId, {
        id: p.reimbursementId,
        group_id: mutation.groupId,
        member_id: p.memberId,
        entry_kind: 'reimbursement',
        category: null,
        amount: p.expectedAmountMinor,
        currency: options.currency,
        calc_mode: 'typed',
        days: null,
        rate_minor: null,
        occurred_on: p.paidOn,
        direction: 'company_to_employee',
        status: 'approved',
        note: p.note,
        reimbursement_details: {},
        deleted_at: null,
        created_by: options.myMemberId ?? null,
        created_at: mutation.clientCreatedAt,
        pending: true,
      });
    } else if (mutation.kind === 'company_pool.post') {
      const p = mutation.payload as unknown as CompanyPoolPostPayload;
      if (byId.has(p.entryId)) continue;
      byId.set(p.entryId, {
        id: p.entryId,
        group_id: mutation.groupId,
        member_id: p.managerId,
        entry_kind: p.kind,
        category: null,
        amount: p.amountMinor,
        currency: options.currency,
        calc_mode: 'typed',
        days: null,
        rate_minor: null,
        occurred_on: p.occurredOn,
        direction: null,
        status: 'approved',
        note: p.reason,
        project_id: p.projectId,
        funding_manager_id: p.managerId,
        deleted_at: null,
        created_by: options.myMemberId ?? null,
        created_at: mutation.clientCreatedAt,
        pending: true,
      });
    } else if (mutation.kind === 'company_wage.pay') {
      // Each line is one payment entry; the claims it folds in read as paid at once.
      const p = mutation.payload as unknown as CompanyWagePayPayload;
      for (const line of p.lines) {
        if (byId.has(line.paymentEntryId)) continue;
        for (const { entryId } of line.claimIds) {
          const covered = byId.get(entryId);
          if (covered)
            byId.set(entryId, {
              ...covered,
              status: 'reimbursed',
              reimbursement_id: line.paymentEntryId,
              pending: true,
            });
        }
        byId.set(line.paymentEntryId, {
          id: line.paymentEntryId,
          group_id: mutation.groupId,
          member_id: line.memberId,
          entry_kind: 'wage_payment',
          category: null,
          amount: line.expectedNetMinor,
          currency: options.currency,
          calc_mode: line.calcMode,
          days: line.days,
          rate_minor: line.rateMinor,
          occurred_on: p.paidOn,
          direction: null,
          status: 'approved',
          note: line.note,
          project_id: line.projectId,
          funding_manager_id: line.fundingManagerId,
          gross_minor: line.expectedGrossMinor,
          recovery_minor: line.expectedRecoveryMinor,
          claims_minor: line.claimIds
            .reduce(
              (sum, { entryId }) => sum + BigInt(String(byId.get(entryId)?.amount ?? '0')),
              0n,
            )
            .toString(),
          wage_run_id: p.runId,
          period_start: p.periodStart,
          period_end: p.periodEnd,
          deleted_at: null,
          created_by: options.myMemberId ?? null,
          created_at: mutation.clientCreatedAt,
          pending: true,
        });
      }
    }
  }

  return [...byId.values()];
}

export interface MirrorMemberBudget extends MirrorRow {
  readonly id: string;
  readonly group_id: string;
  readonly member_id: string;
  readonly amount_minor: string;
  readonly currency: string;
  readonly visibility: 'private' | 'group';
  readonly deleted_at: string | null;
  readonly pending?: boolean;
}

/**
 * The personal budgets visible to the caller, server rows with the caller's own
 * queued set/clear on top. The queue only ever writes the caller's own budget,
 * so the pending row is keyed by their member id (`myMemberId`), which the
 * payload does not carry — the RPC derives it server-side.
 */
export function materialiseMemberBudgets(
  state: MirrorState,
  queue: readonly QueuedMutation[],
  options: { readonly groupId: string; readonly myMemberId: string | null },
): MirrorMemberBudget[] {
  const byMember = new Map<string, MirrorMemberBudget>();
  for (const row of rowsFor(
    state,
    SyncTable.TripMemberBudgets,
    options.groupId,
  ) as MirrorMemberBudget[]) {
    byMember.set(row.member_id, row);
  }

  const mine = options.myMemberId;
  if (mine) {
    for (const mutation of [...queue].sort((a, b) => a.seq - b.seq)) {
      if (mutation.groupId !== options.groupId) continue;

      if (mutation.kind === 'member_budget.set') {
        const payload = mutation.payload as MemberBudgetSetPayload;
        const existing = byMember.get(mine);
        byMember.set(mine, {
          id: existing?.id ?? `pending:${mutation.clientMutationId}`,
          group_id: mutation.groupId,
          member_id: mine,
          amount_minor: payload.amountMinor,
          currency: payload.currency ?? existing?.currency ?? 'INR',
          visibility: payload.visibility,
          deleted_at: null,
          pending: true,
        });
      } else if (mutation.kind === 'member_budget.clear') {
        const existing = byMember.get(mine);
        if (existing) {
          byMember.set(mine, { ...existing, deleted_at: mutation.clientCreatedAt, pending: true });
        }
      }
    }
  }

  return [...byMember.values()].filter((budget) => budget.deleted_at === null);
}

/** One row of `pack_installs`, as the mirror holds it. */
export interface MirrorPackInstall extends MirrorRow {
  readonly id: string;
  readonly owner_user_id: string;
  readonly pack_id: string;
  readonly version: number;
  readonly deleted_at: string | null;
  readonly pending?: boolean;
}

/**
 * The packs this person has installed, with the queue replayed on top — so a
 * pack installed with no signal shows as installed straight away, and stays that
 * way through the flush.
 *
 * The packs *themselves* are not mirrored. A catalogue of what we publish is not
 * the user's data, and holding a copy would make every visit to the shelf an
 * offline read of a stale shelf; it is a network read with an empty state.
 */
export function materialisePackInstalls(
  state: MirrorState,
  queue: readonly QueuedMutation[],
  options: { readonly ownerId: string },
): MirrorPackInstall[] {
  const scope = packInstallsScope(options.ownerId);
  const byId = new Map<string, MirrorPackInstall>();
  for (const row of rowsFor(state, SyncTable.PackInstalls) as unknown as MirrorPackInstall[]) {
    if (row.owner_user_id !== options.ownerId) continue;
    byId.set(row.id, row);
  }

  for (const mutation of [...queue].sort((a, b) => a.seq - b.seq)) {
    if (mutation.groupId !== scope) continue;
    if (mutation.kind === MutationKind.PackInstall) {
      const payload = mutation.payload as unknown as PackInstallPayload;
      byId.set(payload.installId, {
        id: payload.installId,
        owner_user_id: options.ownerId,
        pack_id: payload.packId,
        version: payload.version,
        deleted_at: null,
        pending: true,
      });
    } else if (mutation.kind === MutationKind.PackUninstall) {
      const { installId } = mutation.payload as unknown as PackUninstallPayload;
      const existing = byId.get(installId);
      if (existing) {
        byId.set(installId, { ...existing, deleted_at: mutation.clientCreatedAt, pending: true });
      }
    }
  }

  return [...byId.values()].filter((row) => row.deleted_at === null);
}

/** One row of `group_mutes`, as the mirror holds it. */
export interface MirrorGroupMute extends MirrorRow {
  readonly id: string;
  readonly owner_user_id: string;
  readonly group_id: string;
  readonly deleted_at: string | null;
  readonly pending?: boolean;
}

/**
 * The groups this person has muted, with the queue replayed on top — so a mute
 * shows as on from the tap, with or without signal. The pin overlay's twin,
 * with its safety argument: it reads and writes `group_mutes` rows and nothing
 * else, so the worst a refused mute can cost is the mute.
 */
export function materialiseGroupMutes(
  state: MirrorState,
  queue: readonly QueuedMutation[],
  options: { readonly ownerId: string },
): MirrorGroupMute[] {
  const scope = groupMutesScope(options.ownerId);
  const byId = new Map<string, MirrorGroupMute>();
  for (const row of rowsFor(state, SyncTable.GroupMutes) as unknown as MirrorGroupMute[]) {
    if (row.owner_user_id !== options.ownerId) continue;
    byId.set(row.id, row);
  }

  for (const mutation of [...queue].sort((a, b) => a.seq - b.seq)) {
    if (mutation.groupId !== scope) continue;
    if (mutation.kind === MutationKind.GroupMuteSet) {
      const payload = mutation.payload as unknown as GroupMuteSetPayload;
      byId.set(payload.muteId, {
        id: payload.muteId,
        owner_user_id: options.ownerId,
        group_id: payload.groupId,
        deleted_at: null,
        pending: true,
      });
    } else if (mutation.kind === MutationKind.GroupMuteClear) {
      const { muteId } = mutation.payload as unknown as GroupMuteClearPayload;
      const existing = byId.get(muteId);
      // Only tombstones a mute it can see, so a replayed queue stays idempotent.
      if (existing) {
        byId.set(muteId, { ...existing, deleted_at: mutation.clientCreatedAt, pending: true });
      }
    }
  }

  return [...byId.values()].filter((row) => row.deleted_at === null);
}

/** Just the muted group ids — the question every reader asks is "is this one muted?". */
export function mutedGroupIds(
  state: MirrorState,
  queue: readonly QueuedMutation[],
  options: { readonly ownerId: string },
): Set<string> {
  return new Set(materialiseGroupMutes(state, queue, options).map((row) => row.group_id));
}

// ───────────────────────────────────────────────────── company projects ──

export interface MirrorCompanyProject extends MirrorRow {
  readonly id: string;
  readonly group_id: string;
  readonly name: string;
  readonly archived_at: string | null;
  readonly deleted_at: string | null;
  /** Owners only (a separate owner-readable table); null when none or not visible. */
  readonly budget_minor: string | null;
  readonly pending?: boolean;
}

/** The sites of one company with the viewer's queued create/edit on top. Archived ones stay listed. */
export function materialiseCompanyProjects(
  state: MirrorState,
  queue: readonly QueuedMutation[],
  options: { readonly groupId: string },
): MirrorCompanyProject[] {
  const budgets = new Map<string, string>();
  for (const row of rowsFor(state, SyncTable.CompanyProjectBudgets, options.groupId) as unknown as {
    project_id: string;
    budget_minor: string | null;
    deleted_at?: string | null;
  }[]) {
    if (row.budget_minor !== null && !row.deleted_at) budgets.set(row.project_id, row.budget_minor);
  }
  const byId = new Map<string, MirrorCompanyProject>();
  for (const row of rowsFor(
    state,
    SyncTable.CompanyProjects,
    options.groupId,
  ) as unknown as MirrorCompanyProject[]) {
    if (row.deleted_at) continue;
    byId.set(row.id, { ...row, budget_minor: budgets.get(row.id) ?? null });
  }
  for (const mutation of [...queue].sort((a, b) => a.seq - b.seq)) {
    if (
      mutation.groupId !== options.groupId ||
      mutation.rejection ||
      mutation.kind !== 'company_project.set'
    )
      continue;
    const p = mutation.payload as unknown as CompanyProjectSetPayload;
    const existing = byId.get(p.projectId);
    byId.set(p.projectId, {
      ...(existing ?? { group_id: options.groupId, deleted_at: null }),
      id: p.projectId,
      name: p.name,
      budget_minor: p.budgetMinor,
      archived_at: p.archived ? (existing?.archived_at ?? mutation.clientCreatedAt) : null,
      pending: true,
    } as MirrorCompanyProject);
  }
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** Employee id -> site ids, with this phone's queued "which sites" changes laid over the pulled rows. */
export function materialiseProjectMembers(
  state: MirrorState,
  queue: readonly QueuedMutation[],
  options: { readonly groupId: string },
): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const row of rowsFor(state, SyncTable.CompanyProjectMembers, options.groupId) as unknown as {
    member_id: string;
    project_id: string;
    deleted_at: string | null;
  }[]) {
    if (!row.deleted_at)
      out.set(row.member_id, [...(out.get(row.member_id) ?? []), row.project_id]);
  }
  for (const mutation of [...queue].sort((a, b) => a.seq - b.seq)) {
    if (
      mutation.groupId !== options.groupId ||
      mutation.rejection ||
      mutation.kind !== 'company_member.projects_set'
    )
      continue;
    const p = mutation.payload as unknown as CompanyMemberProjectsSetPayload;
    if (p.projectIds.length === 0) out.delete(p.memberId);
    else out.set(p.memberId, [...new Set(p.projectIds)]);
  }
  return out;
}

export interface MirrorAttendance {
  readonly memberId: string;
  readonly day: string;
  readonly status: 'present' | 'half' | 'absent';
  readonly note: string | null;
}

/** Attendance marks of one company, keyed `${memberId}|${day}`, with this phone's queued marks on top. */
export function materialiseAttendance(
  state: MirrorState,
  queue: readonly QueuedMutation[],
  options: { readonly groupId: string },
): Map<string, MirrorAttendance> {
  const out = new Map<string, MirrorAttendance>();
  for (const row of rowsFor(state, SyncTable.CompanyAttendance, options.groupId) as unknown as {
    member_id: string;
    day: string;
    status: MirrorAttendance['status'];
    note: string | null;
    deleted_at: string | null;
  }[]) {
    if (!row.deleted_at)
      out.set(`${row.member_id}|${row.day}`, {
        memberId: row.member_id,
        day: row.day,
        status: row.status,
        note: row.note,
      });
  }
  for (const mutation of [...queue].sort((a, b) => a.seq - b.seq)) {
    if (
      mutation.groupId !== options.groupId ||
      mutation.rejection ||
      mutation.kind !== 'company_attendance.set'
    )
      continue;
    const p = mutation.payload as unknown as CompanyAttendanceSetPayload;
    const key = `${p.memberId}|${p.day}`;
    if (p.status === null) out.delete(key);
    else out.set(key, { memberId: p.memberId, day: p.day, status: p.status, note: p.note });
  }
  return out;
}

export interface MirrorWorkTask {
  readonly id: string;
  readonly memberId: string;
  readonly day: string;
  readonly title: string;
  readonly projectId: string | null;
  readonly status: CompanyWorkSetPayload['status'];
  readonly blockedReason: string | null;
  readonly note: string | null;
  readonly dueTime: string | null;
  readonly pending?: boolean;
}

/** Daily tasks of one company (pulled rows plus this phone's queued adds, edits and removals), oldest first. */
export function materialiseWorkTasks(
  state: MirrorState,
  queue: readonly QueuedMutation[],
  options: { readonly groupId: string },
): MirrorWorkTask[] {
  const byId = new Map<string, MirrorWorkTask>();
  for (const row of rowsFor(state, SyncTable.CompanyWorkTasks, options.groupId) as unknown as {
    id: string;
    member_id: string;
    day: string;
    title: string;
    project_id: string | null;
    status: MirrorWorkTask['status'];
    blocked_reason: string | null;
    note: string | null;
    due_time?: string | null;
    created_at: string;
    deleted_at: string | null;
  }[]) {
    if (row.deleted_at) continue;
    byId.set(row.id, {
      id: row.id,
      memberId: row.member_id,
      day: row.day,
      title: row.title,
      projectId: row.project_id,
      status: row.status,
      blockedReason: row.blocked_reason,
      note: row.note,
      dueTime: row.due_time?.slice(0, 5) ?? null,
    });
  }
  for (const mutation of [...queue].sort((a, b) => a.seq - b.seq)) {
    if (mutation.groupId !== options.groupId || mutation.rejection) continue;
    if (mutation.kind === 'company_work.set') {
      const p = mutation.payload as unknown as CompanyWorkSetPayload;
      byId.set(p.taskId, {
        id: p.taskId,
        memberId: p.memberId,
        day: p.day,
        title: p.title,
        projectId: p.projectId,
        status: p.status,
        blockedReason: p.status === 'blocked' ? p.blockedReason : null,
        note: p.note,
        dueTime: p.dueTime === undefined ? (byId.get(p.taskId)?.dueTime ?? null) : p.dueTime,
        pending: true,
      });
    } else if (mutation.kind === 'company_work.remove') {
      byId.delete((mutation.payload as unknown as CompanyWorkRemovePayload).taskId);
    }
  }
  return [...byId.values()].sort((a, b) => a.day.localeCompare(b.day) || a.id.localeCompare(b.id));
}

export interface MirrorHoliday {
  readonly id: string;
  readonly startDay: string;
  readonly endDay: string;
  readonly name: string;
}
export interface MirrorLeave {
  readonly id: string;
  readonly memberId: string;
  readonly startDay: string;
  readonly endDay: string;
  readonly halfDay: boolean;
  readonly kind: LeaveKind;
  readonly reason: string | null;
  readonly status: 'pending' | 'approved' | 'rejected';
  readonly decisionNote: string | null;
  readonly pending?: boolean;
}
export interface MirrorEvent {
  readonly id: string;
  readonly title: string;
  readonly day: string;
  readonly time: string | null;
  readonly projectId: string | null;
  readonly people: readonly string[];
}
export interface MirrorMemberDates {
  readonly memberId: string;
  readonly birthDay: number | null;
  readonly birthMonth: number | null;
  readonly joinedOn: string | null;
  readonly showBirthday: boolean;
}
export interface MirrorCalendar {
  readonly holidays: readonly MirrorHoliday[];
  readonly leave: readonly MirrorLeave[];
  readonly events: readonly MirrorEvent[];
  readonly dates: ReadonlyMap<string, MirrorMemberDates>;
}

/**
 * Holidays, leave, events and birthday/joining dates of one company: pulled rows (already filtered by RLS)
 * with this phone's queued changes on top. A queued request shows as pending until the server answers.
 */
export function materialiseCalendar(
  state: MirrorState,
  queue: readonly QueuedMutation[],
  /** `meId`: leave queued for someone else is an owner/manager record, which the server approves at once. */
  options: { readonly groupId: string; readonly meId?: string | null },
): MirrorCalendar {
  type Row = Record<string, unknown> & { deleted_at: string | null };
  const live = (table: SyncTable): Row[] =>
    (rowsFor(state, table, options.groupId) as unknown as Row[]).filter((r) => !r.deleted_at);
  const holidays = new Map<string, MirrorHoliday>();
  for (const r of live(SyncTable.CompanyHolidays))
    holidays.set(r.id as string, {
      id: r.id as string,
      startDay: r.start_day as string,
      endDay: r.end_day as string,
      name: r.name as string,
    });
  const leave = new Map<string, MirrorLeave>();
  for (const r of live(SyncTable.CompanyLeave))
    leave.set(r.id as string, {
      id: r.id as string,
      memberId: r.member_id as string,
      startDay: r.start_day as string,
      endDay: r.end_day as string,
      halfDay: r.half_day === true,
      kind: r.kind as LeaveKind,
      reason: (r.reason as string | null) ?? null,
      status: r.status as MirrorLeave['status'],
      decisionNote: (r.decision_note as string | null) ?? null,
    });
  const events = new Map<string, MirrorEvent>();
  for (const r of live(SyncTable.CompanyEvents))
    events.set(r.id as string, {
      id: r.id as string,
      title: r.title as string,
      day: r.day as string,
      time: (r.at_time as string | null) ?? null,
      projectId: (r.project_id as string | null) ?? null,
      people: (r.people as string[] | null) ?? [],
    });
  const dates = new Map<string, MirrorMemberDates>();
  for (const r of live(SyncTable.CompanyMemberDates))
    dates.set(r.member_id as string, {
      memberId: r.member_id as string,
      birthDay: (r.birth_day as number | null) ?? null,
      birthMonth: (r.birth_month as number | null) ?? null,
      joinedOn: (r.joined_on as string | null) ?? null,
      showBirthday: r.show_birthday === true,
    });
  for (const m of [...queue].sort((a, b) => a.seq - b.seq)) {
    if (m.groupId !== options.groupId || m.rejection) continue;
    const p = m.payload as unknown;
    if (m.kind === 'company_holiday.set') {
      const h = p as CompanyHolidaySetPayload;
      holidays.set(h.id, { id: h.id, startDay: h.startDay, endDay: h.endDay, name: h.name });
    } else if (m.kind === 'company_holiday.remove')
      holidays.delete((p as CompanyHolidayRemovePayload).id);
    else if (m.kind === 'company_leave.set') {
      const l = p as CompanyLeaveSetPayload;
      leave.set(l.id, {
        ...l,
        status: options.meId && l.memberId !== options.meId ? 'approved' : 'pending',
        decisionNote: null,
        pending: true,
      });
    } else if (m.kind === 'company_leave.decide') {
      const d = p as CompanyLeaveDecidePayload;
      const l = leave.get(d.id);
      if (l)
        leave.set(d.id, {
          ...l,
          status: d.approve ? 'approved' : 'rejected',
          decisionNote: d.note,
        });
    } else if (m.kind === 'company_leave.remove') leave.delete((p as CompanyLeaveRemovePayload).id);
    else if (m.kind === 'company_event.set') {
      const e = p as CompanyEventSetPayload;
      events.set(e.id, {
        id: e.id,
        title: e.title,
        day: e.day,
        time: e.time,
        projectId: e.projectId,
        people: e.people,
      });
    } else if (m.kind === 'company_event.remove')
      events.delete((p as CompanyEventRemovePayload).id);
    else if (m.kind === 'company_dates.set') {
      const d = p as CompanyDatesSetPayload;
      if (d.birthDay === null && d.joinedOn === null) dates.delete(d.memberId);
      else dates.set(d.memberId, { ...d, showBirthday: d.showBirthday });
    }
  }
  const byDay = <T extends { id: string }>(a: T, b: T, ka: string, kb: string): number =>
    ka.localeCompare(kb) || a.id.localeCompare(b.id);
  return {
    holidays: [...holidays.values()].sort((a, b) => byDay(a, b, a.startDay, b.startDay)),
    leave: [...leave.values()].sort((a, b) => byDay(a, b, a.startDay, b.startDay)),
    events: [...events.values()].sort((a, b) => byDay(a, b, a.day, b.day)),
    dates,
  };
}

export interface MirrorWageSplit {
  readonly projectId: string;
  readonly amountMinor: bigint;
}

/** Wage payment id -> how its base is divided across sites (pulled rows plus queued wage runs). */
export function materialiseWageSplits(
  state: MirrorState,
  queue: readonly QueuedMutation[],
  options: { readonly groupId: string },
): Map<string, MirrorWageSplit[]> {
  const out = new Map<string, MirrorWageSplit[]>();
  for (const row of rowsFor(state, SyncTable.CompanyWageSplits, options.groupId) as unknown as {
    entry_id: string;
    project_id: string;
    amount_minor: string;
    deleted_at: string | null;
  }[]) {
    if (row.deleted_at) continue;
    out.set(row.entry_id, [
      ...(out.get(row.entry_id) ?? []),
      { projectId: row.project_id, amountMinor: BigInt(row.amount_minor) },
    ]);
  }
  for (const mutation of queue) {
    if (
      mutation.groupId !== options.groupId ||
      mutation.rejection ||
      mutation.kind !== 'company_wage.pay'
    )
      continue;
    for (const line of (mutation.payload as unknown as CompanyWagePayPayload).lines) {
      if (!line.splits?.length || out.has(line.paymentEntryId)) continue;
      out.set(
        line.paymentEntryId,
        line.splits.map((x) => ({ projectId: x.projectId, amountMinor: BigInt(x.amountMinor) })),
      );
    }
  }
  return out;
}

// ───────────────────────────────────────────── company estimates & bills ──

export interface MirrorDocItem {
  readonly description: string;
  readonly qtyMilli: bigint;
  readonly rateMinor: bigint;
  readonly amountMinor: bigint;
}
export interface MirrorCompanyDoc {
  readonly id: string;
  readonly groupId: string;
  readonly docType: CompanyDocType;
  /** Null until the server numbers it (created offline). */
  readonly number: number | null;
  readonly customerName: string;
  readonly customerPhone: string | null;
  readonly docDate: string;
  readonly items: readonly MirrorDocItem[];
  readonly discountMinor: bigint;
  readonly totalMinor: bigint;
  readonly currency: string;
  readonly notes: string | null;
  readonly status: CompanyDocStatus;
  readonly payments: readonly DocPayment[];
  readonly paidMinor: bigint;
  readonly convertedTo: string | null;
  readonly convertedFrom: string | null;
  readonly createdBy: string;
  readonly deleted: boolean;
  readonly pending: boolean;
}

const big = (v: unknown): bigint => BigInt(String(v ?? 0));

function docFromRow(r: Record<string, unknown>): MirrorCompanyDoc {
  const items = ((r.items as Record<string, unknown>[] | null) ?? []).map((i) => ({
    description: String(i.description ?? ''),
    qtyMilli: big(i.qtyMilli),
    rateMinor: big(i.rateMinor),
    amountMinor: big(i.amountMinor),
  }));
  return {
    id: r.id as string,
    groupId: r.group_id as string,
    docType: r.doc_type as CompanyDocType,
    number: (r.number as number | null) ?? null,
    customerName: String(r.customer_name ?? ''),
    customerPhone: (r.customer_phone as string | null) ?? null,
    docDate: String(r.doc_date ?? '').slice(0, 10),
    items,
    discountMinor: big(r.discount_minor),
    totalMinor: big(r.total_minor),
    currency: String(r.currency ?? ''),
    notes: (r.notes as string | null) ?? null,
    status: r.status as CompanyDocStatus,
    payments: ((r.payments as Record<string, unknown>[] | null) ?? []).map((p) => ({
      id: String(p.id),
      amountMinor: big(p.amountMinor),
      paidOn: String(p.paidOn).slice(0, 10),
    })),
    paidMinor: big(r.paid_minor),
    convertedTo: (r.converted_to as string | null) ?? null,
    convertedFrom: (r.converted_from as string | null) ?? null,
    createdBy: r.created_by as string,
    deleted: !!r.deleted_at,
    pending: false,
  };
}

/**
 * The estimates and bills this phone may see (the server already filters: owners all, a manager their own),
 * with the viewer's queued writes on top. Removed ones are dropped. Newest first.
 */
export function materialiseCompanyDocs(
  state: MirrorState,
  queue: readonly QueuedMutation[],
  options: { readonly groupId: string; readonly currency: string; readonly viewerMemberId: string },
): MirrorCompanyDoc[] {
  const byId = new Map<string, MirrorCompanyDoc>();
  for (const row of rowsFor(state, SyncTable.CompanyDocuments, options.groupId)) {
    const d = docFromRow(row as unknown as Record<string, unknown>);
    byId.set(d.id, d);
  }
  const rebill = (d: MirrorCompanyDoc, over: Partial<MirrorCompanyDoc>): MirrorCompanyDoc => {
    const m = { ...d, ...over, pending: true };
    return m.docType === 'bill' ? { ...m, status: billStatus(m.totalMinor, m.paidMinor) } : m;
  };
  for (const mutation of [...queue].sort((a, b) => a.seq - b.seq)) {
    if (mutation.groupId !== options.groupId || mutation.rejection) continue;
    const k = mutation.kind as string;
    if (k === 'company_doc.save') {
      const p = mutation.payload as unknown as CompanyDocSavePayload;
      const items = p.data.items.map((i) => ({
        description: i.description.trim(),
        qtyMilli: BigInt(i.qtyMilli),
        rateMinor: BigInt(i.rateMinor),
      }));
      const t = computeDocTotals(items, BigInt(p.data.discountMinor));
      const full = items.map((i, n) => ({ ...i, amountMinor: t.lines[n]! }));
      const ex = byId.get(p.docId);
      const fields = {
        customerName: p.data.customerName.trim(),
        customerPhone: p.data.customerPhone,
        docDate: p.data.docDate,
        items: full,
        discountMinor: BigInt(p.data.discountMinor),
        totalMinor: t.totalMinor,
        notes: p.data.notes,
      };
      byId.set(
        p.docId,
        ex
          ? rebill(ex, fields)
          : rebill(
              {
                ...fields,
                id: p.docId,
                groupId: options.groupId,
                docType: p.data.docType,
                number: null,
                currency: options.currency,
                status: p.data.docType === 'estimate' ? 'draft' : 'unpaid',
                payments: [],
                paidMinor: 0n,
                convertedTo: null,
                convertedFrom: null,
                createdBy: options.viewerMemberId,
                deleted: false,
                pending: true,
              },
              {},
            ),
      );
    } else if (k === 'company_doc.status') {
      const p = mutation.payload as unknown as CompanyDocStatusPayload;
      const ex = byId.get(p.docId);
      if (ex) byId.set(p.docId, { ...ex, status: p.status, pending: true });
    } else if (k === 'company_doc.convert') {
      const p = mutation.payload as unknown as CompanyDocConvertPayload;
      const ex = byId.get(p.docId);
      if (ex && !byId.has(p.billId)) {
        byId.set(p.docId, {
          ...ex,
          convertedTo: p.billId,
          status: ex.status === 'draft' || ex.status === 'sent' ? 'accepted' : ex.status,
          pending: true,
        });
        byId.set(p.billId, {
          ...ex,
          id: p.billId,
          docType: 'bill',
          docDate: mutation.clientCreatedAt.slice(0, 10),
          number: null,
          status: 'unpaid',
          payments: [],
          paidMinor: 0n,
          convertedTo: null,
          convertedFrom: ex.id,
          createdBy: options.viewerMemberId,
          pending: true,
        });
      }
    } else if (k === 'company_doc.payment') {
      const p = mutation.payload as unknown as CompanyDocPaymentPayload;
      const ex = byId.get(p.docId);
      if (ex && !ex.payments.some((x) => x.id === p.paymentId)) {
        const amountMinor = BigInt(p.amountMinor);
        byId.set(
          p.docId,
          rebill(ex, {
            payments: [...ex.payments, { id: p.paymentId, amountMinor, paidOn: p.paidOn }],
            paidMinor: ex.paidMinor + amountMinor,
          }),
        );
      }
    } else if (k === 'company_doc.void') {
      const p = mutation.payload as unknown as CompanyDocVoidPayload;
      const ex = byId.get(p.docId);
      if (ex) byId.set(p.docId, { ...ex, deleted: true, pending: true });
    }
  }
  return [...byId.values()]
    .filter((d) => !d.deleted)
    .sort((a, b) => b.docDate.localeCompare(a.docDate) || (b.number ?? 1e9) - (a.number ?? 1e9));
}

/**
 * A non-owner's phone after an employee moved to another manager (or the viewer lost a role): the server lists the
 * members this caller may still read, so anyone not on it loses their cached entries,
 * photos, sites and split wages here. Never empties a company (an empty list is ignored).
 */
export function purgeCompanyInvisible(
  state: MirrorState,
  visible: Readonly<Record<string, readonly string[]>>,
  /** Per company: the birthday-row and event ids the caller can read now. RLS hides a row without a tombstone
   *  (a birthday switched off, someone removed from an event), so anything not listed is dropped here. */
  calendar: Readonly<Record<string, { dates: readonly string[]; events: readonly string[] }>> = {},
): { state: MirrorState; removed: { table: SyncTable; id: string }[] } {
  const tables = { ...state.tables };
  const removed: { table: SyncTable; id: string }[] = [];
  const drop = (table: SyncTable, gone: (row: Record<string, unknown>) => boolean): Set<string> => {
    const kept: Record<string, MirrorRow> = {};
    const dropped = new Set<string>();
    for (const [id, row] of Object.entries(tables[table] ?? {})) {
      if (gone(row as Record<string, unknown>)) dropped.add(id);
      else kept[id] = row;
    }
    if (dropped.size > 0) {
      tables[table] = kept;
      for (const id of dropped) removed.push({ table, id });
    }
    return dropped;
  };
  for (const [groupId, ids] of Object.entries(calendar)) {
    const dates = new Set(ids.dates);
    const events = new Set(ids.events);
    drop(
      SyncTable.CompanyMemberDates,
      (row) => row.group_id === groupId && !dates.has(row.id as string),
    );
    drop(
      SyncTable.CompanyEvents,
      (row) => row.group_id === groupId && !events.has(row.id as string),
    );
  }
  for (const [groupId, ids] of Object.entries(visible)) {
    if (ids.length === 0) continue;
    const ok = new Set(ids);
    const mine = (row: Record<string, unknown>): boolean => row.group_id === groupId;
    drop(SyncTable.GroupMembers, (row) => mine(row) && !ok.has(row.id as string));
    drop(SyncTable.CompanyProjectMembers, (row) => mine(row) && !ok.has(row.member_id as string));
    // A company-paid entry has no employee: it stays while its recorder (always readable by its reader) does.
    const entries = drop(
      SyncTable.CompanyEntries,
      (row) =>
        mine(row) &&
        !ok.has((row.paid_by_company === true ? row.created_by : row.member_id) as string),
    );
    const orphan = (row: Record<string, unknown>): boolean =>
      mine(row) && entries.has(row.entry_id as string);
    drop(SyncTable.CompanyEntryAttachments, orphan);
    drop(SyncTable.CompanyWageSplits, orphan);
    // Documents are private to their creator (and owners): a phone that lost that visibility drops them.
    drop(SyncTable.CompanyDocuments, (row) => mine(row) && !ok.has(row.created_by as string));
    drop(SyncTable.CompanyAttendance, (row) => mine(row) && !ok.has(row.member_id as string));
    const tasks = drop(
      SyncTable.CompanyWorkTasks,
      (row) => mine(row) && !ok.has(row.member_id as string),
    );
    // A task's photo previews are as private as the task: they go with it.
    drop(
      SyncTable.CompanyWorkTaskAttachments,
      (row) => mine(row) && tasks.has(row.entry_id as string),
    );
    drop(SyncTable.CompanyLeave, (row) => mine(row) && !ok.has(row.member_id as string));
    // A colleague's birthday stays only while they allow it to be shown.
    drop(
      SyncTable.CompanyMemberDates,
      (row) => mine(row) && !ok.has(row.member_id as string) && row.show_birthday !== true,
    );
  }
  return removed.length === 0 ? { state, removed } : { state: { ...state, tables }, removed };
}
