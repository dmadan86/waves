import {
  allowanceAmount,
  entryDelta as entryDeltaOf,
  type CompanyEntry,
  type CompanyCalcMode,
} from './index';

/**
 * Company expenses Phase 4: roles, manager pools (floats) and the wage run.
 * Money is bigint minor units; the server recomputes every figure and these
 * functions only preview and overlay it offline, so the two must agree.
 */

export type CompanyRole = 'owner' | 'manager' | 'employee';

/** group_members.role -> company role. */
export function companyRole(memberRole: string | null | undefined): CompanyRole {
  return memberRole === 'admin' ? 'owner' : memberRole === 'manager' ? 'manager' : 'employee';
}

export interface CompanyPerson {
  readonly memberId: string;
  readonly name: string;
  readonly role: CompanyRole;
  readonly managerId: string | null;
  /** False: names only (an owner or manager shown for context). */
  readonly detail: boolean;
}

/** What the viewer may do; the UI hides everything else so a sync never meets a server rule. */
export interface CompanyCapabilities {
  readonly review: boolean;
  readonly recordAdvance: boolean;
  readonly payWages: boolean;
  readonly manageTeam: boolean;
  readonly promote: boolean;
  readonly allocate: boolean;
  readonly projects: boolean;
}

export function companyCapabilities(role: CompanyRole): CompanyCapabilities {
  const owner = role === 'owner';
  const manager = role === 'manager';
  return {
    review: owner || manager,
    recordAdvance: owner || manager,
    payWages: owner || manager,
    manageTeam: owner || manager,
    promote: owner,
    allocate: owner,
    projects: owner,
  };
}

/** Whom the viewer may record a money entry for: owners any person, managers only their own team. */
export function manageableMemberIds(
  people: readonly CompanyPerson[],
  viewer: { readonly memberId: string; readonly role: CompanyRole },
): string[] {
  if (viewer.role === 'owner')
    return people.filter((p) => p.role !== 'owner').map((p) => p.memberId);
  if (viewer.role === 'manager')
    return people
      .filter((p) => p.role === 'employee' && p.managerId === viewer.memberId)
      .map((p) => p.memberId);
  return [];
}

// ───────────────────────────────────────────────────────────── pools ──

const live = (e: CompanyEntry): boolean => !e.deleted && e.status !== 'rejected';
const counted = (e: CompanyEntry): boolean =>
  !e.deleted && (e.status === 'approved' || e.status === 'reimbursed');

export interface PoolBalance {
  readonly allocated: bigint;
  readonly returned: bigint;
  readonly adjusted: bigint;
  readonly advances: bigint;
  readonly reimbursed: bigint;
  readonly wages: bigint;
  readonly ownSpend: bigint;
  readonly cashReturned: bigint;
  /** allocated + adjusted - returned - advances - reimbursed - wages - ownSpend + cashReturned. */
  readonly balance: bigint;
}

/**
 * A manager's float from the entries the viewer can read. The server's
 * `waves_company_pool_balance` is authoritative (it also sees employees who have
 * since moved to another team); this is the offline overlay and the test oracle.
 */
export function poolBalance(entries: readonly CompanyEntry[], managerId: string): PoolBalance {
  let allocated = 0n;
  let returned = 0n;
  let adjusted = 0n;
  let advances = 0n;
  let reimbursed = 0n;
  let wages = 0n;
  let ownSpend = 0n;
  let cashReturned = 0n;
  for (const e of entries) {
    if (e.deleted) continue;
    if (e.memberId === managerId) {
      // The manager's own pool movements and own approved spend.
      if (e.kind === 'allocation') allocated += e.amount;
      else if (e.kind === 'pool_return') returned += e.amount;
      else if (e.kind === 'pool_adjustment') adjusted += e.amount;
      else if ((e.kind === 'expense' || e.kind === 'allowance') && counted(e)) ownSpend += e.amount;
      continue;
    }
    if (e.fundingManagerId !== managerId) continue;
    if (e.kind === 'advance' && counted(e)) advances += e.amount;
    else if (e.kind === 'reimbursement' && counted(e)) {
      if (e.direction === 'employee_to_company') cashReturned += e.amount;
      else reimbursed += e.amount;
    } else if ((e.kind === 'wage_payment' || e.kind === 'wages') && live(e)) wages += e.amount;
  }
  return {
    allocated,
    returned,
    adjusted,
    advances,
    reimbursed,
    wages,
    ownSpend,
    cashReturned,
    balance:
      allocated + adjusted - returned - advances - reimbursed - wages - ownSpend + cashReturned,
  };
}

/** A return or manual adjustment needs a written reason (1-500 characters after trimming). */
export function validPoolReason(reason: string): boolean {
  const t = reason.trim();
  return t.length >= 1 && t.length <= 500;
}

// ─────────────────────────────────────────────────────────── wage run ──

/** Advances still to recover from an employee, as of `through` (inclusive). */
export function outstandingAdvance(
  entries: readonly CompanyEntry[],
  memberId: string,
  through: string,
): bigint {
  let advanced = 0n;
  let recovered = 0n;
  for (const e of entries) {
    if (e.memberId !== memberId || e.deleted) continue;
    // Advances netted into a Phase 3 payment are already settled, and so are the recoveries
    // that payment counted (it links them too).
    if (
      e.kind === 'advance' &&
      e.status === 'approved' &&
      e.reimbursementId === null &&
      e.occurredOn <= through
    )
      advanced += e.amount;
    else if (e.kind === 'wage_payment' && e.reimbursementId === null)
      recovered += e.recoveryMinor ?? 0n;
    // Cash the employee handed back reduces what they still owe.
    else if (
      e.kind === 'reimbursement' &&
      e.direction === 'employee_to_company' &&
      e.status === 'approved' &&
      e.reimbursementId === null &&
      !e.coversClaims &&
      e.occurredOn <= through
    )
      recovered += e.amount;
  }
  return advanced > recovered ? advanced - recovered : 0n;
}

export interface WageLineInput {
  readonly calcMode: CompanyCalcMode;
  /** days_rate: "2.5" days at `rateMinor`; fixed_*: `fixedMinor`; typed: `fixedMinor` as typed. */
  readonly days?: string | null;
  readonly rateMinor?: bigint | null;
  readonly fixedMinor?: bigint | null;
  /** Approved, unpaid bata / mileage folded into this payment. */
  readonly claimsMinor: bigint;
  readonly outstandingAdvanceMinor: bigint;
}

export interface WageLine {
  readonly base: bigint;
  readonly claims: bigint;
  readonly gross: bigint;
  /** Advance taken back, capped so net is never below zero. */
  readonly recovery: bigint;
  readonly net: bigint;
  /** Advance still to recover in a later period. */
  readonly carry: bigint;
}

/** Null when the inputs are not a valid wage (bad days, negative amount). */
export function wageLine(input: WageLineInput): WageLine | null {
  let base: bigint;
  if (input.calcMode === 'days_rate') {
    const b = allowanceAmount(input.days ?? '', input.rateMinor ?? -1n);
    if (b === null) return null;
    base = b;
  } else {
    base = input.fixedMinor ?? -1n;
  }
  if (base < 0n || input.claimsMinor < 0n || input.outstandingAdvanceMinor < 0n) return null;
  const gross = base + input.claimsMinor;
  const recovery = input.outstandingAdvanceMinor < gross ? input.outstandingAdvanceMinor : gross;
  return {
    base,
    claims: input.claimsMinor,
    gross,
    recovery,
    net: gross - recovery,
    carry: input.outstandingAdvanceMinor - recovery,
  };
}

export const isWageClaim = (e: CompanyEntry): boolean =>
  !e.deleted &&
  e.status === 'approved' &&
  e.reimbursementId === null &&
  (e.kind === 'allowance' || (e.kind === 'expense' && e.calcMode === 'distance_rate'));

/** Unpaid approved bata / mileage up to `through`: what a wage run folds in as "owed". */
export function wageClaims(
  entries: readonly CompanyEntry[],
  memberId: string,
  through: string,
): CompanyEntry[] {
  return entries.filter(
    (e) => e.memberId === memberId && isWageClaim(e) && e.occurredOn <= through,
  );
}

export interface WageRunDraftLine extends WageLine {
  readonly memberId: string;
  readonly calcMode: CompanyCalcMode;
  readonly days: string | null;
  readonly rateMinor: bigint | null;
  readonly fixedMinor: bigint | null;
  readonly claimIds: readonly { readonly entryId: string; readonly expectedVersion: number }[];
  readonly outstanding: bigint;
}

export interface WageTerms {
  readonly calcMode: CompanyCalcMode;
  readonly days?: string | null;
  readonly rateMinor?: bigint | null;
  readonly fixedMinor?: bigint | null;
}

/**
 * The reviewable list for one period: a line per employee with terms, advance
 * recovery and the net to pay. Employees without terms yet are skipped.
 */
export function buildWageRun(
  entries: readonly CompanyEntry[],
  terms: ReadonlyMap<string, WageTerms>,
  periodEnd: string,
): WageRunDraftLine[] {
  const out: WageRunDraftLine[] = [];
  for (const [memberId, t] of terms) {
    const claims = wageClaims(entries, memberId, periodEnd);
    const outstanding = outstandingAdvance(entries, memberId, periodEnd);
    const line = wageLine({
      calcMode: t.calcMode,
      days: t.days ?? null,
      rateMinor: t.rateMinor ?? null,
      fixedMinor: t.fixedMinor ?? null,
      claimsMinor: claims.reduce((s, c) => s + c.amount, 0n),
      outstandingAdvanceMinor: outstanding,
    });
    if (!line) continue;
    out.push({
      ...line,
      memberId,
      calcMode: t.calcMode,
      days: t.days ?? null,
      rateMinor: t.rateMinor ?? null,
      fixedMinor: t.fixedMinor ?? null,
      claimIds: claims.map((c) => ({ entryId: c.id, expectedVersion: c.version })),
      outstanding,
    });
  }
  return out;
}

export function wageRunTotals(lines: readonly WageRunDraftLine[]): {
  gross: bigint;
  recovery: bigint;
  net: bigint;
} {
  return lines.reduce(
    (t, l) => ({ gross: t.gross + l.gross, recovery: t.recovery + l.recovery, net: t.net + l.net }),
    { gross: 0n, recovery: 0n, net: 0n },
  );
}

// ─────────────────────────────────────────────────────────── projects ──

/** Approved spend per project: expense + bata + wage base + legacy wages (advances are cash, not spend). */
export function projectSpend(entries: readonly CompanyEntry[]): Map<string, bigint> {
  const out = new Map<string, bigint>();
  for (const e of entries) {
    if (!e.projectId || e.deleted) continue;
    let add = 0n;
    if ((e.kind === 'expense' || e.kind === 'allowance') && counted(e)) add = e.amount;
    else if (e.kind === 'wages') add = e.amount;
    else if (e.kind === 'wage_payment') add = (e.grossMinor ?? e.amount) - (e.claimsMinor ?? 0n);
    if (add !== 0n) out.set(e.projectId, (out.get(e.projectId) ?? 0n) + add);
  }
  return out;
}

/** True when the employee already has a wage payment overlapping [start, end] (the server refuses a second). */
export function wagePaidInPeriod(
  entries: readonly CompanyEntry[],
  memberId: string,
  start: string,
  end: string,
): boolean {
  return entries.some(
    (e) =>
      e.memberId === memberId &&
      !e.deleted &&
      e.kind === 'wage_payment' &&
      e.periodStart !== null &&
      e.periodEnd !== null &&
      e.periodStart <= end &&
      start <= e.periodEnd,
  );
}

// ──────────────────────────────────────────────────────────── dashboard ──

export interface DashboardStats {
  /** Sum of what the company owes each person (never netted against what others owe it). */
  readonly owes: bigint;
  /** Approved claims not yet paid. */
  readonly pendingPayments: number;
  readonly paidThisMonth: bigint;
  readonly paidLastMonth: bigint;
  /** Percent change vs last month, whole number; null when last month had nothing. */
  readonly paidChangePct: number | null;
  readonly advancesOutstanding: bigint;
  readonly advanceHolders: number;
}

const monthOf = (iso: string): string => iso.slice(0, 7);
function prevMonth(month: string): string {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

/** What the viewer's numbers say: money out this month (net payments, reimbursements, wages), owed, advances. */
export function dashboardStats(
  entries: readonly CompanyEntry[],
  memberIds: readonly string[],
  today: string,
): DashboardStats {
  const ids = new Set(memberIds);
  const mine = entries.filter((e) => ids.has(e.memberId) && !e.deleted);
  const thisMonth = monthOf(today);
  const lastMonth = prevMonth(thisMonth);
  let owes = 0n;
  let pending = 0;
  let paid = 0n;
  let paidLast = 0n;
  let advances = 0n;
  let holders = 0;
  for (const id of ids) {
    let net = 0n;
    for (const e of mine) {
      if (e.memberId !== id) continue;
      if (counted(e)) net += entryDeltaOf(e);
    }
    if (net > 0n) owes += net;
    const out = outstandingAdvance(mine, id, '9999-12-31');
    if (out > 0n) {
      advances += out;
      holders += 1;
    }
  }
  for (const e of mine) {
    if (
      isWageClaim(e) ||
      (e.kind === 'expense' && e.status === 'approved' && e.reimbursementId === null)
    )
      pending += 1;
    const payment =
      e.kind === 'wage_payment' ||
      e.kind === 'wages' ||
      (e.kind === 'reimbursement' && e.direction !== 'employee_to_company');
    if (!payment) continue;
    if (monthOf(e.occurredOn) === thisMonth) paid += e.amount;
    else if (monthOf(e.occurredOn) === lastMonth) paidLast += e.amount;
  }
  return {
    owes,
    pendingPayments: pending,
    paidThisMonth: paid,
    paidLastMonth: paidLast,
    paidChangePct: paidLast === 0n ? null : Number(((paid - paidLast) * 100n) / paidLast),
    advancesOutstanding: advances,
    advanceHolders: holders,
  };
}

/** An advance a wage run has already taken back against cannot be edited or voided (the server refuses it). */
export function advanceRecovered(entries: readonly CompanyEntry[], advance: CompanyEntry): boolean {
  return (
    advance.kind === 'advance' &&
    entries.some(
      (w) =>
        w.memberId === advance.memberId &&
        !w.deleted &&
        w.kind === 'wage_payment' &&
        (w.recoveryMinor ?? 0n) > 0n &&
        w.reimbursementId === null &&
        (w.periodEnd ?? w.occurredOn) >= advance.occurredOn,
    )
  );
}
