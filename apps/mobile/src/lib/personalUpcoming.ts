/**
 * What the Personal home's "Upcoming & Reminders" card lists: bills the
 * recurring rules expect soon, the Upcoming dates, and the setup to-do, merged
 * by date. Pure, so the merge and its limits are testable.
 */

import {
  addPlanDays,
  leaseEndsIn,
  occurrences,
  rentBalance,
  rentDues,
  monthRange,
  type PersonalInvestment,
  type PersonalProperty,
  type PersonalRecurring,
  type PersonalTenancy,
  type PersonalTxn,
  type UpcomingItem,
} from '@waves/core';

import {
  currentRentRule,
  nextDueOnOrAfter,
  paymentsOfTenancy,
  rulesOfTenancy,
  type RaisePrompt,
} from '@/lib/wealthPlan';

export type RowTone = 'brand' | 'positive' | 'negative' | 'warning';

export interface UpcomingRow {
  readonly key: string;
  readonly kind: 'bill' | 'date';
  readonly tone: RowTone;
  /** Days from today (negative once overdue); the to-do has none and sorts last. */
  readonly inDays: number;
  readonly date: string | null;
  readonly ruleId?: string;
  /** Where tapping the row goes, when it is not a rule's own page. */
  readonly href?: string;
  readonly title?: string;
  readonly category?: string | null;
  readonly amount?: bigint;
  readonly currency?: string;
  readonly item?: UpcomingItem;
  /** Bill only: an expected (not auto-posted) bill whose day has passed unpaid. */
  readonly overdue?: boolean;
  /** Recurring tab only: the rule brings money in. */
  readonly income?: boolean;
  /** A yearly rent increase waiting for Apply or Not now. */
  readonly raise?: RaisePrompt;
}

/** Rent still to collect, lease ends and maturities, as rows next to the bills. */
export function wealthRows(input: {
  investments: readonly PersonalInvestment[];
  properties: readonly PersonalProperty[];
  tenancies: readonly PersonalTenancy[];
  recurrings: readonly PersonalRecurring[];
  txns: readonly PersonalTxn[];
  today: string;
  horizonDays: number;
  raises?: readonly RaisePrompt[];
  titles: {
    rent: (name: string) => string;
    lease: (name: string) => string;
    maturity: (name: string) => string;
  };
}): UpcomingRow[] {
  const { today, horizonDays, titles } = input;
  const out: UpcomingRow[] = [];
  const limit = addPlanDays(today, horizonDays);
  for (const tn of input.tenancies) {
    if (tn.status !== 'active') continue;
    const prop = input.properties.find((p) => p.id === tn.propertyId);
    const name = tn.unit ?? prop?.name ?? '';
    const href = `/rentals/${tn.propertyId}`;
    const rules = rulesOfTenancy(input.recurrings, tn.id);
    const bal = rentBalance(rentDues(rules, today), paymentsOfTenancy(input.txns, rules), today);
    const open = bal.lines.find((l) => l.status !== 'paid');
    const rule = currentRentRule(rules, tn.id, today);
    const currency = rule?.currency ?? prop?.currency ?? '';
    if (open) {
      out.push({
        key: `rent:${tn.id}:${open.date}`,
        kind: 'bill',
        tone: open.status === 'overdue' ? 'negative' : 'positive',
        inDays: daysBetween(today, open.date),
        date: open.date,
        title: titles.rent(name),
        amount: open.amount - open.paid,
        currency,
        income: true,
        overdue: open.status === 'overdue',
        href,
      });
    } else if (rule) {
      const due = nextDueOnOrAfter(rule, today);
      if (due && due <= limit) {
        out.push({
          key: `rent:${tn.id}:${due}`,
          kind: 'bill',
          tone: 'positive',
          inDays: daysBetween(today, due),
          date: due,
          title: titles.rent(name),
          amount: rule.amount,
          currency,
          income: true,
          href,
        });
      }
    }
    if (tn.endDate && leaseEndsIn(tn.endDate, today, 60) !== null) {
      out.push({
        key: `lease:${tn.id}`,
        kind: 'bill',
        tone: 'warning',
        inDays: daysBetween(today, tn.endDate),
        date: tn.endDate,
        title: titles.lease(name),
        href,
      });
    }
  }
  for (const raise of input.raises ?? []) {
    out.push({
      key: `raise:${raise.key}`,
      kind: 'bill',
      tone: 'warning',
      inDays: daysBetween(today, raise.anniversary),
      date: raise.anniversary,
      raise,
      href: `/rentals/${raise.propertyId}`,
    });
  }
  for (const inv of input.investments) {
    if (inv.status !== 'active' || !inv.maturityDate) continue;
    const inDays = daysBetween(today, inv.maturityDate);
    if (inDays < 0 || inv.maturityDate > addPlanDays(today, Math.max(horizonDays, 60))) continue;
    out.push({
      key: `mat:${inv.id}`,
      kind: 'bill',
      tone: 'brand',
      inDays,
      date: inv.maturityDate,
      title: titles.maturity(inv.name),
      href: `/investments/${inv.id}`,
    });
  }
  return out;
}

/** Whole days from `from` to `to` (both YYYY-MM-DD). */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 864e5);
}

/** Expense rules' next occurrences inside the horizon, plus this month's overdue ones. */
export function billRows(
  txns: readonly PersonalTxn[],
  recurrings: readonly PersonalRecurring[],
  currency: string,
  today: string,
  horizonDays: number,
): UpcomingRow[] {
  const range = { from: `${today.slice(0, 7)}-01`, to: addPlanDays(today, horizonDays) };
  const out: UpcomingRow[] = [];
  for (const rule of recurrings) {
    if (!rule.active || rule.currency !== currency || rule.txnKind !== 'expense') continue;
    for (const o of occurrences(rule, txns, range, today)) {
      if (o.status === 'received') continue;
      out.push({
        key: `${rule.id}:${o.periodKey}`,
        kind: 'bill',
        tone: 'brand',
        inDays: daysBetween(today, o.dueDate),
        date: o.dueDate,
        ruleId: rule.id,
        title: rule.note?.trim() ?? '',
        category: rule.category,
        amount: o.expected,
        currency: rule.currency,
      });
    }
  }
  return out;
}

export function dateRows(items: readonly UpcomingItem[]): UpcomingRow[] {
  return items.map((item) => ({
    key: item.key,
    kind: 'date',
    tone:
      item.source === 'festival'
        ? 'positive'
        : item.kind === 'family_birthday' || item.kind === 'my_birthday'
          ? 'negative'
          : item.kind === 'work_anniversary'
            ? 'warning'
            : 'brand',
    inDays: item.inDays,
    date: item.date,
    item,
  }));
}

/** Sorted by date. A `limit` of 0 means no limit. */
export function mergeUpcoming(dated: readonly UpcomingRow[], limit: number): UpcomingRow[] {
  const sorted = [...dated].sort((a, b) => a.inDays - b.inDays || (a.key < b.key ? -1 : 1));
  return limit > 0 ? sorted.slice(0, limit) : sorted;
}

/** The bell's dot: something is due today, overdue, or tomorrow. */
export const hasDue = (rows: readonly UpcomingRow[]): boolean => rows.some((r) => r.inDays <= 1);

// ───────────────────────────────────────────── the full Upcoming screen ──

export type UpcomingTab = 'all' | 'bills' | 'reminders';

/** `month` (YYYY-MM) shifted by `n` months. */
export function addMonths(month: string, n: number): string {
  const total = Number(month.slice(0, 4)) * 12 + (Number(month.slice(5, 7)) - 1) + n;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`;
}

/** The months the dropdown offers: a little history, then most of a year ahead. */
export const monthOptions = (today: string, back = 2, ahead = 9): string[] =>
  Array.from({ length: back + ahead + 1 }, (_, i) => addMonths(today.slice(0, 7), i - back));

/**
 * Unpaid bills of one month. "Paid" is `occurrences()`' own rule: a txn carrying
 * the rule's `recurringId`, dated on/after the due date and before the next one,
 * claims the occurrence (the "Mark as paid" post writes exactly that). Overdue =
 * an unpaid occurrence of a manual (autoPost false) rule dated before today;
 * auto-post rules are not overdue, the catch-up posts them.
 */
export function billsInMonth(
  txns: readonly PersonalTxn[],
  recurrings: readonly PersonalRecurring[],
  currency: string,
  month: string,
  today: string,
): UpcomingRow[] {
  const range = monthRange(month);
  if (!range) return [];
  const out: UpcomingRow[] = [];
  for (const rule of recurrings) {
    if (!rule.active || rule.currency !== currency || rule.txnKind !== 'expense') continue;
    for (const o of occurrences(rule, txns, range, today)) {
      if (o.status === 'received') continue;
      const overdue = !rule.autoPost && o.dueDate < today;
      out.push({
        key: `${rule.id}:${o.periodKey}`,
        kind: 'bill',
        tone: overdue ? 'negative' : 'brand',
        inDays: daysBetween(today, o.dueDate),
        date: o.dueDate,
        ruleId: rule.id,
        title: rule.note?.trim() ?? '',
        category: rule.category,
        amount: o.expected,
        currency: rule.currency,
        overdue,
      });
    }
  }
  return out.sort(byDay);
}

const byDay = (a: UpcomingRow, b: UpcomingRow): number =>
  a.inDays - b.inDays || (a.key < b.key ? -1 : 1);

/** Every active rule (income and expense) with its next date, soonest first. */
export function recurringRows(
  recurrings: readonly PersonalRecurring[],
  currency: string,
  today: string,
): UpcomingRow[] {
  return recurrings
    .filter((r) => r.active && r.currency === currency)
    .map((r): UpcomingRow => ({
      key: `rule:${r.id}`,
      kind: 'bill',
      tone: r.txnKind === 'income' ? 'positive' : 'brand',
      inDays: daysBetween(today, r.nextDate),
      date: r.nextDate,
      ruleId: r.id,
      title: r.note?.trim() ?? '',
      category: r.category,
      amount: r.amount,
      currency: r.currency,
      income: r.txnKind === 'income',
    }))
    .sort(byDay);
}

export interface UpcomingView {
  readonly rows: readonly UpcomingRow[];
}

export type UpcomingSectionKey = 'overdue' | 'thisWeek' | 'laterThisMonth' | 'nextMonth';
export function groupUpcoming(
  rows: readonly UpcomingRow[],
  today: string,
): Record<UpcomingSectionKey, readonly UpcomingRow[]> {
  const next = addMonths(today.slice(0, 7), 1);
  const matching = rows.filter((r) => r.date && r.date.slice(0, 7) <= next);
  return {
    overdue: matching.filter((r) => r.date! < today),
    thisWeek: matching.filter((r) => r.date! >= today && r.inDays <= 7),
    laterThisMonth: matching.filter(
      (r) => r.inDays > 7 && r.date!.slice(0, 7) === today.slice(0, 7),
    ),
    nextMonth: matching.filter((r) => r.date!.slice(0, 7) === next && r.inDays > 7),
  };
}

/**
 * The full screen's date-ordered bills, income and reminders.
 */
export function upcomingView(input: {
  txns: readonly PersonalTxn[];
  recurrings: readonly PersonalRecurring[];
  currency: string;
  today: string;
  dates: readonly UpcomingRow[];
}): UpcomingView {
  const { txns, recurrings, currency, today } = input;
  const bills = recurrings.flatMap((rule) => {
    if (!rule.active || rule.currency !== currency) return [];
    return occurrences(
      rule,
      txns,
      { from: `${today.slice(0, 7)}-01`, to: addPlanDays(today, 60) },
      today,
    )
      .filter((o) => o.status !== 'received')
      .map((o): UpcomingRow => ({
        key: `${rule.id}:${o.periodKey}`,
        kind: 'bill',
        tone: 'brand',
        inDays: daysBetween(today, o.dueDate),
        date: o.dueDate,
        ruleId: rule.id,
        title: rule.note?.trim() ?? '',
        category: rule.category,
        amount: o.expected,
        currency: rule.currency,
        overdue: rule.txnKind === 'expense' && !rule.autoPost && o.dueDate < today,
        income: rule.txnKind === 'income',
      }));
  });
  return { rows: [...bills, ...input.dates].sort(byDay) };
}

/** Apply the compact list filter. */
export function filterUpcoming(view: UpcomingView, tab: UpcomingTab): readonly UpcomingRow[] {
  return tab === 'bills'
    ? view.rows.filter((r) => r.kind === 'bill' && !r.income)
    : tab === 'reminders'
      ? view.rows.filter((r) => r.kind === 'date')
      : view.rows;
}
