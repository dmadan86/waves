/**
 * The "Set up Personal" interview: which questions, what an answer is, and the
 * personal records each answer becomes. Nothing here touches React.
 *
 * Everything an answer creates is *expected* money (`autoPost: false`): a
 * recurring rule the person confirms, a budget. Setup never invents a
 * transaction. Every record id is derived from the account and the answer's
 * slot, so redoing a step edits the record it made before instead of adding a
 * second one.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  addToDate,
  budgetStep,
  CategoryId,
  dayDelta,
  deterministicId,
  encodeBudget,
  encodeRecurring,
  IncomeSourceId,
  nextRecurring,
  type CurrencyCode,
  type PersonalRecordKind,
  type PersonalRecurring,
} from '@waves/core';

export const SETUP_STEPS = ['income', 'home', 'bills', 'emi', 'eatOut', 'savings', 'cap'] as const;
export type SetupStep = (typeof SETUP_STEPS)[number];

export type IncomeKind = 'salary' | 'business' | 'freelance' | 'pension';
export type HomeKind = 'rent' | 'emi';
export type LoanKind = 'car' | 'personal' | 'gold' | 'education' | 'card';
export type EatFreq = 'rarely' | 'week12' | 'week34' | 'daily';
export type SavingsBand = 'none' | 'under1' | '1to3' | '3to6' | '6plus';

interface Bill {
  readonly category: CategoryId;
  /** Months between payments. */
  readonly every: 1 | 3 | 12;
}
export const BILLS = {
  electricity: { category: CategoryId.Home, every: 1 },
  mobile: { category: CategoryId.Home, every: 1 },
  wifi: { category: CategoryId.Home, every: 1 },
  gas: { category: CategoryId.Home, every: 1 },
  help: { category: CategoryId.Home, every: 1 },
  school: { category: CategoryId.Other, every: 3 },
  society: { category: CategoryId.Home, every: 1 },
  insurance: { category: CategoryId.Health, every: 12 },
  sip: { category: CategoryId.Other, every: 1 },
} as const satisfies Record<string, Bill>;
export type BillId = keyof typeof BILLS;
export const BILL_IDS = Object.keys(BILLS) as BillId[];

/** `none` = answered "not regular" / "neither": the step is done, nothing is made. */
export interface IncomeAnswer {
  kind: IncomeKind | 'none';
  amount: bigint;
  day: number;
}
export interface HomeAnswer {
  kind: HomeKind | 'none';
  amount: bigint;
  day: number;
}
export interface BillAnswer {
  id: BillId;
  amount: bigint;
  day: number;
}
export interface EmiAnswer {
  kind: LoanKind | 'none';
  emi: bigint;
  day: number;
  monthsLeft: number;
}
export interface EatOutAnswer {
  freq: EatFreq;
  each: bigint;
  /** The monthly figure, as the person left it (editable). */
  monthly: bigint;
}
export interface SetupAnswers {
  income?: IncomeAnswer;
  home?: HomeAnswer;
  bills?: BillAnswer[];
  emi?: EmiAnswer;
  eatOut?: EatOutAnswer;
  savings?: SavingsBand;
  /** Everyday-spending cap, minor units. */
  cap?: bigint;
}

export interface SetupContext {
  ownerId: string;
  currency: CurrencyCode;
  /** Local YYYY-MM-DD. */
  today: string;
  /** The words a record is named with, already in the person's language. */
  label: (key: string) => string;
}

export interface SetupRecord {
  recordId: string;
  recordKind: PersonalRecordKind;
  data: Record<string, unknown>;
}

const pad = (n: number): string => String(n).padStart(2, '0');
const daysIn = (y: number, m: number): number => new Date(Date.UTC(y, m, 0)).getUTCDate();

/** The next date on or after `today` that falls on `day` (clamped to short months). */
export function nextDayOfMonth(today: string, day: number): string {
  const [y, m] = today.split('-').map(Number) as [number, number];
  const thisMonth = `${y}-${pad(m)}-${pad(Math.min(day, daysIn(y, m)))}`;
  if (thisMonth >= today) return thisMonth;
  const next = addToDate(`${y}-${pad(m)}-01`, 'monthly', 1);
  const [ny, nm] = next.split('-').map(Number) as [number, number];
  return `${ny}-${pad(nm)}-${pad(Math.min(day, daysIn(ny, nm)))}`;
}

const EAT_TENTHS_PER_WEEK: Record<EatFreq, bigint> = {
  rarely: 3n,
  week12: 15n,
  week34: 35n,
  daily: 60n,
};

/** times a week × 4.3 weeks × the amount, rounded onto the budget stepper's grid. */
export function eatOutMonthly(freq: EatFreq, each: bigint, currency: CurrencyCode): bigint {
  const raw = (each * EAT_TENTHS_PER_WEEK[freq] * 43n) / 100n;
  if (raw <= 0n) return 0n;
  const step = budgetStep(raw, currency);
  return ((raw + step / 2n) / step) * step;
}

const slot = (ctx: SetupContext, key: string): string =>
  deterministicId(`psetup:${ctx.ownerId}:${key}`);

function rule(
  ctx: SetupContext,
  key: string,
  r: {
    txnKind: 'income' | 'expense';
    amount: bigint;
    category: string;
    note: string;
    day: number;
    every?: number;
    cadence?: 'monthly' | 'yearly';
    endDate?: string | null;
  },
): SetupRecord {
  // shortcut: a quarterly/yearly bill starts at its next day-of-month, not its real due month; the person edits it in Recurring.
  const nextDate = nextDayOfMonth(ctx.today, r.day);
  return {
    recordId: slot(ctx, key),
    recordKind: 'recurring',
    data: encodeRecurring({
      txnKind: r.txnKind,
      amount: r.amount,
      currency: ctx.currency,
      category: r.category,
      note: r.note,
      cadence: r.cadence ?? 'monthly',
      interval: r.every ?? 1,
      secondDay: null,
      anchorDate: nextDate,
      nextDate,
      endDate: r.endDate ?? null,
      autoPost: false,
      active: true,
    }),
  };
}

const budget = (ctx: SetupContext, key: string, category: string | null, limit: bigint) => ({
  recordId: slot(ctx, key),
  recordKind: 'budget' as const,
  data: encodeBudget({ category, limit, currency: ctx.currency }),
});

/** The records for whichever answers are present. Idempotent: same answers, same ids. */
export function answersToRecords(a: SetupAnswers, ctx: SetupContext): SetupRecord[] {
  const out: SetupRecord[] = [];
  const { income, home, emi, eatOut } = a;
  if (income && income.kind !== 'none' && income.amount > 0n) {
    out.push(
      rule(ctx, 'income', {
        txnKind: 'income',
        amount: income.amount,
        category:
          IncomeSourceId[
            (
              {
                salary: 'Salary',
                business: 'Business',
                freelance: 'Freelance',
                pension: 'Pension',
              } as const
            )[income.kind]
          ],
        note: ctx.label(`income:${income.kind}`),
        day: income.day,
      }),
    );
  }
  if (home && home.kind !== 'none' && home.amount > 0n) {
    out.push(
      rule(ctx, 'home', {
        txnKind: 'expense',
        amount: home.amount,
        category: CategoryId.Home,
        note: ctx.label(`home:${home.kind}`),
        day: home.day,
      }),
    );
  }
  for (const bill of a.bills ?? []) {
    if (bill.amount <= 0n) continue;
    const def: Bill = BILLS[bill.id];
    out.push(
      rule(ctx, `bill:${bill.id}`, {
        txnKind: 'expense',
        amount: bill.amount,
        category: def.category,
        note: ctx.label(`bill:${bill.id}`),
        day: bill.day,
        every: def.every === 12 ? 1 : def.every,
        cadence: def.every === 12 ? 'yearly' : 'monthly',
      }),
    );
  }
  if (emi && emi.kind !== 'none' && emi.emi > 0n) {
    const first = nextDayOfMonth(ctx.today, emi.day);
    out.push(
      rule(ctx, `emi:${emi.kind}`, {
        txnKind: 'expense',
        amount: emi.emi,
        category: CategoryId.Other,
        note: ctx.label(`loan:${emi.kind}`),
        day: emi.day,
        // The last payment is the one `monthsLeft - 1` months after the first.
        endDate: addToDate(first, 'monthly', Math.max(1, emi.monthsLeft) - 1),
      }),
    );
  }
  if (eatOut && eatOut.monthly > 0n) {
    out.push(budget(ctx, 'budget:food', CategoryId.Food, eatOut.monthly));
  }
  if (a.cap !== undefined && a.cap > 0n) out.push(budget(ctx, 'budget:overall', null, a.cap));
  return out;
}

/** A rule's cost per month: quarterly ÷ 3, yearly ÷ 12, weekly × 52 ÷ 12, twice a month × 2. */
export function monthlyEquivalent(r: PersonalRecurring): bigint {
  const every = BigInt(Math.max(1, r.interval));
  switch (r.cadence) {
    case 'semimonthly':
      return r.amount * 2n;
    case 'weekly':
      return (r.amount * 52n) / (12n * every);
    case 'yearly':
      return r.amount / (12n * every);
    default:
      return r.amount / every;
  }
}

export interface SetupSummary {
  comingIn: bigint;
  fixedTotal: bigint;
  fixedCount: number;
  free: bigint;
  perDay: bigint;
  next: { name: string; days: number } | null;
}

/** The reveal: monthly income against fixed bills, and what is left to spend. */
export function setupSummary(
  recurrings: readonly PersonalRecurring[],
  today: string,
  currency: CurrencyCode,
): SetupSummary {
  const live = recurrings.filter((r) => r.active && r.currency === currency);
  const sum = (kind: 'income' | 'expense'): bigint =>
    live.filter((r) => r.txnKind === kind).reduce((s, r) => s + monthlyEquivalent(r), 0n);
  const bills = live.filter((r) => r.txnKind === 'expense');
  const comingIn = sum('income');
  const fixedTotal = sum('expense');
  const free = comingIn > fixedTotal ? comingIn - fixedTotal : 0n;
  const [y, m] = today.split('-').map(Number) as [number, number];
  const next = nextRecurring(bills, today);
  return {
    comingIn,
    fixedTotal,
    fixedCount: bills.length,
    free,
    perDay: free / BigInt(daysIn(y, m)),
    next: next
      ? { name: next.rule.note ?? '', days: Math.max(0, dayDelta(today, next.date)) }
      : null,
  };
}

// ───────────────────────────────────────────────────────── local progress ──

export interface SetupState {
  /** Steps answered (an answer of "none" counts; a skip does not). */
  done: SetupStep[];
  /** Set once setup has been opened, so the "finish" card only follows people who began. */
  started: boolean;
  savings: SavingsBand | null;
}

const EMPTY_STATE: SetupState = { done: [], started: false, savings: null };
const key = (ownerId: string): string => `waves.personal_setup.${ownerId}`;

/** What setup has recorded on this phone for an account (savings band, answered steps). Never rejects. */
export async function personalSetupAnswers(ownerId: string): Promise<SetupState> {
  try {
    const raw = await AsyncStorage.getItem(key(ownerId));
    if (!raw) return EMPTY_STATE;
    const p = JSON.parse(raw) as Partial<SetupState>;
    return {
      done: (p.done ?? []).filter((s): s is SetupStep =>
        (SETUP_STEPS as readonly string[]).includes(s),
      ),
      started: !!p.started,
      savings: p.savings ?? null,
    };
  } catch {
    return EMPTY_STATE;
  }
}

/** Merge a change into the stored state. Never rejects. */
export async function rememberSetup(
  ownerId: string,
  change: { step?: SetupStep; savings?: SavingsBand },
): Promise<SetupState> {
  const cur = await personalSetupAnswers(ownerId);
  const next: SetupState = {
    started: true,
    done: change.step && !cur.done.includes(change.step) ? [...cur.done, change.step] : cur.done,
    savings: change.savings ?? cur.savings,
  };
  try {
    await AsyncStorage.setItem(key(ownerId), JSON.stringify(next));
  } catch {
    // Costs one repeat of a question, not the answers already saved as records.
  }
  return next;
}
