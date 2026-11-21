/**
 * The household home (a couple's or a family's group screen): which groups get
 * it, what a bill costs per month, the month's summary and the merged
 * "upcoming" list. Pure and bigint throughout; `today` is always an argument.
 */
import { addPlanDays } from '../personal/plan';
import type { Cadence } from '../personal/types';
import { isPoolGroup } from './ledgerMode';

/** Group types that always open on the household home. */
export const HOUSEHOLD_HOME_TYPES: readonly string[] = ['couple', 'home'];

/** Couples, homes and any pooled ("Share it") group, such as a family. */
export function hasHouseholdHome(
  group: { type?: string | null; ledger_mode?: string | null } | null | undefined,
): boolean {
  if (!group) return false;
  return HOUSEHOLD_HOME_TYPES.includes(group.type ?? '') || isPoolGroup(group);
}

/** Round-half-up integer division for non-negative values. */
function divRound(numerator: bigint, denominator: bigint): bigint {
  return (numerator * 2n + denominator) / (denominator * 2n);
}

/** What a repeating bill costs in an average month. */
export function monthlyEquivalent(rule: {
  readonly amount: bigint;
  readonly cadence: Cadence;
  readonly interval: number;
}): bigint {
  const n = BigInt(Math.max(1, rule.interval));
  switch (rule.cadence) {
    case 'weekly':
      return divRound(rule.amount * 52n, 12n * n);
    case 'semimonthly':
      return rule.amount * 2n;
    case 'yearly':
      return divRound(rule.amount, 12n * n);
    default:
      return divRound(rule.amount, n);
  }
}

/** Sum of the monthly equivalents of the active bills in `currency`. */
export function billsMonthlyTotal(
  rules: readonly {
    readonly amount: bigint;
    readonly cadence: Cadence;
    readonly interval: number;
    readonly currency: string;
    readonly status: string;
  }[],
  currency: string,
): bigint {
  let total = 0n;
  for (const rule of rules)
    if (rule.status === 'active' && rule.currency === currency) total += monthlyEquivalent(rule);
  return total;
}

// ───────────────────────────────────────────────────── the bill picker ──

export type BillPresetId =
  | 'rent'
  | 'emi'
  | 'electricity'
  | 'water'
  | 'gas'
  | 'wifi'
  | 'mobile'
  | 'ott'
  | 'maintenance'
  | 'maid'
  | 'cook'
  | 'driver'
  | 'groceries'
  | 'petrol'
  | 'school'
  | 'insurance'
  | 'milk'
  | 'sip';

export interface BillPreset {
  readonly id: BillPresetId;
  /** An Ionicons glyph name. */
  readonly icon: string;
  /** The built-in expense category the bill files under. */
  readonly category: string;
  readonly day: number;
  readonly every: 'month' | 'quarter' | 'year';
  /** An estimate becomes a category budget, not an auto-posting bill. */
  readonly estimate: boolean;
}

export const BILL_PRESETS: readonly BillPreset[] = [
  { id: 'rent', icon: 'home-outline', category: 'home', day: 1, every: 'month', estimate: false },
  {
    id: 'emi',
    icon: 'business-outline',
    category: 'home',
    day: 5,
    every: 'month',
    estimate: false,
  },
  {
    id: 'electricity',
    icon: 'flash-outline',
    category: 'home',
    day: 10,
    every: 'month',
    estimate: false,
  },
  {
    id: 'water',
    icon: 'water-outline',
    category: 'home',
    day: 10,
    every: 'month',
    estimate: false,
  },
  { id: 'gas', icon: 'flame-outline', category: 'home', day: 15, every: 'month', estimate: false },
  {
    id: 'wifi',
    icon: 'wifi-outline',
    category: 'entertainment',
    day: 5,
    every: 'month',
    estimate: false,
  },
  {
    id: 'mobile',
    icon: 'phone-portrait-outline',
    category: 'entertainment',
    day: 8,
    every: 'month',
    estimate: false,
  },
  {
    id: 'ott',
    icon: 'tv-outline',
    category: 'entertainment',
    day: 12,
    every: 'month',
    estimate: false,
  },
  {
    id: 'maintenance',
    icon: 'construct-outline',
    category: 'home',
    day: 5,
    every: 'month',
    estimate: false,
  },
  {
    id: 'maid',
    icon: 'sparkles-outline',
    category: 'home',
    day: 1,
    every: 'month',
    estimate: false,
  },
  {
    id: 'cook',
    icon: 'restaurant-outline',
    category: 'home',
    day: 1,
    every: 'month',
    estimate: false,
  },
  { id: 'driver', icon: 'car-outline', category: 'home', day: 1, every: 'month', estimate: false },
  {
    id: 'groceries',
    icon: 'basket-outline',
    category: 'groceries',
    day: 1,
    every: 'month',
    estimate: true,
  },
  {
    id: 'petrol',
    icon: 'speedometer-outline',
    category: 'travel',
    day: 1,
    every: 'month',
    estimate: true,
  },
  {
    id: 'school',
    icon: 'school-outline',
    category: 'other',
    day: 5,
    every: 'quarter',
    estimate: false,
  },
  {
    id: 'insurance',
    icon: 'shield-checkmark-outline',
    category: 'health',
    day: 1,
    every: 'year',
    estimate: false,
  },
  {
    id: 'milk',
    icon: 'cafe-outline',
    category: 'groceries',
    day: 1,
    every: 'month',
    estimate: false,
  },
  {
    id: 'sip',
    icon: 'trending-up-outline',
    category: 'other',
    day: 5,
    every: 'month',
    estimate: false,
  },
];

export interface PickedBill {
  readonly preset: BillPresetId;
  readonly amount: bigint;
  /** 1-28. */
  readonly day: number;
  readonly payerId: string;
}

/** Picks that can be saved: an amount and a payer. Estimates are budgets and need no payer. */
export function savablePicks<T extends { preset: BillPresetId; amount: bigint; payerId: string }>(
  picks: readonly T[],
): { bills: T[]; budgets: T[] } {
  const estimate = new Set(BILL_PRESETS.filter((p) => p.estimate).map((p) => p.id));
  const ok = picks.filter((p) => p.amount > 0n);
  return {
    bills: ok.filter((p) => !estimate.has(p.preset) && p.payerId !== ''),
    budgets: ok.filter((p) => estimate.has(p.preset)),
  };
}

/** First date on or after `today` that falls on `day` of a month (day clamped to 1-28). */
export function nextDayOfMonth(today: string, day: number): string {
  const d = Math.min(28, Math.max(1, Math.trunc(day)));
  const dd = String(d).padStart(2, '0');
  const thisMonth = `${today.slice(0, 7)}-${dd}`;
  if (thisMonth >= today) return thisMonth;
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7));
  const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
  return `${next}-${dd}`;
}

// ─────────────────────────────────────────────────────── income plans ──

export const INCOME_KINDS = ['salary', 'pension', 'business', 'rent', 'other'] as const;
export type IncomeKind = (typeof INCOME_KINDS)[number];

export interface IncomePlanLike {
  readonly memberId: string;
  readonly amount: bigint;
  readonly currency: string;
  readonly active: boolean;
}

/** Planned monthly income in `currency` (paused plans do not count). Never touches balances. */
export function incomeTotal(plans: readonly IncomePlanLike[], currency: string): bigint {
  let total = 0n;
  for (const plan of plans) if (plan.active && plan.currency === currency) total += plan.amount;
  return total;
}

export function incomeByMember(
  plans: readonly IncomePlanLike[],
  currency: string,
): Map<string, bigint> {
  const out = new Map<string, bigint>();
  for (const plan of plans)
    if (plan.active && plan.currency === currency)
      out.set(plan.memberId, (out.get(plan.memberId) ?? 0n) + plan.amount);
  return out;
}

// ─────────────────────────────────────────────────── the month summary ──

export function shiftMonthKey(month: string, delta: number): string {
  const index = Number(month.slice(0, 4)) * 12 + (Number(month.slice(5, 7)) - 1) + delta;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`;
}

/** Spend per month for the last `months` months ending at `today`'s month, oldest first. */
export function monthlySpend(
  expenses: readonly { date: string; amount: bigint; currency: string }[],
  currency: string,
  today: string,
  months = 6,
): { month: string; total: bigint }[] {
  const current = today.slice(0, 7);
  const out = Array.from({ length: months }, (_, i) => ({
    month: shiftMonthKey(current, i - (months - 1)),
    total: 0n,
  }));
  for (const e of expenses) {
    if (e.currency !== currency) continue;
    const slot = out.find((o) => o.month === e.date.slice(0, 7));
    if (slot) slot.total += e.amount;
  }
  return out;
}

export interface HouseholdSummary {
  readonly spent: bigint;
  readonly income: bigint;
  /** Income minus spend; negative once spending is past the plan. */
  readonly left: bigint;
  /** Whole percent against last month; null when last month had no spend. */
  readonly changePct: number | null;
}

export function householdSummary(input: {
  readonly spent: bigint;
  readonly lastMonthSpent: bigint;
  readonly income: bigint;
}): HouseholdSummary {
  const { spent, lastMonthSpent, income } = input;
  return {
    spent,
    income,
    left: income - spent,
    changePct:
      lastMonthSpent > 0n ? Number(((spent - lastMonthSpent) * 100n) / lastMonthSpent) : null,
  };
}

/** Roughly what can be spent a day for the rest of the month (today included). 0 when nothing is left. */
export function perDayLeft(left: bigint, today: string): bigint {
  if (left <= 0n) return 0n;
  const last = new Date(Date.UTC(+today.slice(0, 4), +today.slice(5, 7), 0)).getUTCDate();
  const days = BigInt(Math.max(1, last - Number(today.slice(8, 10)) + 1));
  return left / days;
}

// ───────────────────────────────────────────────────────── upcoming ──

export interface HouseholdUpcoming {
  readonly key: string;
  readonly kind: 'bill' | 'goal';
  readonly title: string;
  readonly date: string;
  /** Days from today; negative once overdue. */
  readonly inDays: number;
  readonly amount: bigint;
  readonly currency: string;
  readonly ruleId?: string;
  readonly goalId?: string;
  /** Who pays a bill (member id), when known. */
  readonly payerId?: string | null;
}

export function daysFromTo(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 864e5);
}

/** Active bills whose next date is on or before `today + horizonDays` (overdue ones included). */
export function billUpcoming(
  rules: readonly {
    id: string;
    description: string;
    amount: bigint;
    currency: string;
    nextDate: string;
    status: string;
    payers: Readonly<Record<string, bigint>>;
  }[],
  today: string,
  horizonDays: number,
): HouseholdUpcoming[] {
  const limit = addPlanDays(today, horizonDays);
  return rules
    .filter((r) => r.status === 'active' && r.nextDate <= limit)
    .map((r) => {
      let payerId: string | null = null;
      let top = 0n;
      for (const [member, paid] of Object.entries(r.payers))
        if (paid > top) {
          top = paid;
          payerId = member;
        }
      return {
        key: `bill:${r.id}:${r.nextDate}`,
        kind: 'bill' as const,
        title: r.description,
        date: r.nextDate,
        inDays: daysFromTo(today, r.nextDate),
        amount: r.amount,
        currency: r.currency,
        ruleId: r.id,
        payerId,
      };
    });
}

/**
 * Goals with a monthly plan: the plan's total is due on the 1st. Shown only
 * when the 1st (this month's if today is the 1st, else next month's) is inside
 * the horizon. Finished and archived goals are not asked for more.
 */
export function goalUpcoming(
  goals: readonly {
    id: string;
    name: string;
    currency: string;
    status: string;
    monthlyPlan: Readonly<Record<string, bigint>>;
  }[],
  today: string,
  horizonDays: number,
): HouseholdUpcoming[] {
  const first = nextDayOfMonth(today, 1);
  const inDays = daysFromTo(today, first);
  if (inDays > horizonDays) return [];
  const out: HouseholdUpcoming[] = [];
  for (const g of goals) {
    if (g.status !== 'active') continue;
    const amount = Object.values(g.monthlyPlan).reduce((a, b) => a + b, 0n);
    if (amount <= 0n) continue;
    out.push({
      key: `goal:${g.id}:${first}`,
      kind: 'goal',
      title: g.name,
      date: first,
      inDays,
      amount,
      currency: g.currency,
      goalId: g.id,
    });
  }
  return out;
}

/** Merge by date (overdue first), then title; `limit` 0 keeps everything. */
export function mergeHouseholdUpcoming(
  lists: readonly (readonly HouseholdUpcoming[])[],
  limit: number,
): HouseholdUpcoming[] {
  const all = lists
    .flat()
    .sort((a, b) =>
      a.date === b.date ? a.title.localeCompare(b.title) : a.date < b.date ? -1 : 1,
    );
  return limit > 0 ? all.slice(0, limit) : all;
}
