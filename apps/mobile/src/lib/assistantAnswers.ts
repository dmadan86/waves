/**
 * On-device answers to money questions ("how much did I spend on food this
 * month", "kal kitna kharch hua", "how much food budget is left").
 *
 * The server cannot see the personal ledger (it is an encoded blob), so these
 * are answered here, offline, from the ledger plus the person's own share of
 * every group expense on the phone. The parsing and the arithmetic are pure and
 * live in `@waves/core` (`voice/spendQuery`); this module is the app half:
 *
 *   - reduce the local mirror to "my share" rows (`groupExpensesForViewer`),
 *   - run the query (`answerMoneyQuestion`),
 *   - say the result in the person's language from `t.voice.sq*`, composing
 *     from structure (never from the English sentence core also returns),
 *   - offer the period chips and the "Show in Spending" route.
 *
 * Nothing here reads the clock, a hook or the network: the caller passes
 * `today`, the strings and the data, so the whole thing is testable in node.
 */

import {
  answerSpendQuery,
  format,
  formatParts,
  money,
  parseSpendQuery,
  withPeriod,
  type PersonalBudget,
  type PersonalTxn,
  type SpendAnswer,
  type SpendCatalogEntry,
  type SpendGroupExpense,
  type SpendPeriodKey,
  type SpendQuery,
} from '@waves/core';

import { fill, type UiStrings } from '@/i18n';

// ───────────────────────────────────────────────────── local mirror → rows ──

/** One expense as the mirror holds it, reduced to what a money answer reads. */
export interface AnswerExpenseInput {
  readonly id: string;
  readonly deleted: boolean;
  readonly description: string;
  readonly notes: string | null;
  readonly payee: string | null;
  readonly category: string | null;
  /** A custom tag's label snapshot, or null for a built-in. */
  readonly categoryLabel: string | null;
  readonly date: string;
  readonly currency: string;
  /** Per-member shares, amounts as the wire's decimal strings. */
  readonly shares: readonly { readonly memberId: string; readonly amount: string }[];
  readonly memberNames: readonly string[];
}

export interface AnswerGroupInput {
  readonly id: string;
  readonly name: string;
  readonly archived: boolean;
  /** The member ids that are me in this group (normally one). */
  readonly myMemberIds: readonly string[];
  readonly expenses: readonly AnswerExpenseInput[];
}

function parseMinor(value: string): bigint {
  try {
    return BigInt(value);
  } catch {
    return 0n;
  }
}

/**
 * My share of every live expense, one row per expense. A group the person has
 * archived still counts (the money was spent); a deleted expense never does.
 * An expense with no share for me is kept at zero so the count a question
 * reports can ignore it deliberately rather than by omission.
 */
export function groupExpensesForViewer(groups: readonly AnswerGroupInput[]): SpendGroupExpense[] {
  const rows: SpendGroupExpense[] = [];
  for (const group of groups) {
    const mine = new Set(group.myMemberIds);
    if (mine.size === 0) continue;
    for (const expense of group.expenses) {
      if (expense.deleted) continue;
      let share = 0n;
      for (const s of expense.shares) {
        if (mine.has(s.memberId)) share += parseMinor(s.amount);
      }
      if (share <= 0n) continue;
      rows.push({
        id: expense.id,
        groupId: group.id,
        groupName: group.name,
        description: expense.description,
        note: expense.notes,
        payee: expense.payee,
        category: expense.category,
        categoryLabel: expense.categoryLabel,
        date: expense.date,
        currency: expense.currency,
        myShareMinor: share,
        participantNames: expense.memberNames,
      });
    }
  }
  return rows;
}

// ─────────────────────────────────────────────────────────────── answering ──

export type AnswerStrings = UiStrings['voice'];

export interface AnswerData {
  readonly txns: readonly PersonalTxn[];
  readonly budgets: readonly PersonalBudget[];
  readonly groups: readonly AnswerGroupInput[];
  /** The effective category catalog (built-ins + custom tags). */
  readonly catalog: readonly SpendCatalogEntry[];
}

export interface AnswerContext {
  /** Local calendar date, YYYY-MM-DD. */
  readonly today: string;
  readonly locale: string;
  readonly strings: AnswerStrings;
  /** `t.categories`: the translated built-in labels. */
  readonly categoryNames: Readonly<Record<string, string>>;
  readonly data: AnswerData;
  readonly viewerId?: string;
}

export interface PeriodChip {
  readonly key: SpendPeriodKey;
  readonly label: string;
  readonly selected: boolean;
}

export interface SpendingLink {
  readonly kind: 'spending' | 'budget';
  readonly label: string;
  readonly pathname: '/personal/transactions' | '/personal/budgets';
  readonly params: Record<string, string>;
}

export interface AssistantAnswer {
  readonly text: string;
  readonly status: SpendAnswer['status'] | 'noGroup';
  readonly query: SpendQuery;
  readonly chips: readonly PeriodChip[];
  readonly link: SpendingLink | null;
}

/** The parser, bound to the app's calendar. Null when it is not a spend question. */
export function parseMoneyQuestion(text: string, today: string): SpendQuery | null {
  return parseSpendQuery(text, today);
}

/** "₹12,400", not "₹12,400.00": a sentence, not a column. */
export function compactMoney(minor: bigint, currency: string, locale: string): string {
  const parts = formatParts(money(minor, currency), { locale });
  return /^[.,٫]?[0٠]*$/u.test(parts.fraction)
    ? `${parts.lead}${parts.trail}`
    : format(money(minor, currency), { locale });
}

function utcDate(iso: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))) : null;
}

function safeIntl(
  locale: string,
  options: Intl.DateTimeFormatOptions,
  date: Date,
  fallback: string,
): string {
  try {
    return new Intl.DateTimeFormat(locale, { ...options, timeZone: 'UTC' }).format(date);
  } catch {
    return fallback;
  }
}

/** "19 Oct" in the person's locale, from a calendar date with no timezone shift. */
export function shortDate(iso: string, locale: string): string {
  const date = utcDate(iso);
  return date ? safeIntl(locale, { day: 'numeric', month: 'short' }, date, iso) : iso;
}

function monthWord(iso: string, today: string, locale: string): string {
  const date = utcDate(iso);
  if (!date) return iso;
  const sameYear = iso.slice(0, 4) === today.slice(0, 4);
  return safeIntl(
    locale,
    sameYear ? { month: 'long' } : { month: 'long', year: 'numeric' },
    date,
    iso.slice(0, 7),
  );
}

const WHEN_KEYS = {
  today: 'sqWhenToday',
  yesterday: 'sqWhenYesterday',
  thisWeek: 'sqWhenThisWeek',
  lastWeek: 'sqWhenLastWeek',
  thisMonth: 'sqWhenThisMonth',
  lastMonth: 'sqWhenLastMonth',
  thisYear: 'sqWhenThisYear',
  lastYear: 'sqWhenLastYear',
  last7: 'sqWhenLast7',
  last30: 'sqWhenLast30',
} as const;

const CHIP_KEYS = {
  today: 'sqChipToday',
  yesterday: 'sqChipYesterday',
  thisWeek: 'sqChipThisWeek',
  lastWeek: 'sqChipLastWeek',
  thisMonth: 'sqChipThisMonth',
  lastMonth: 'sqChipLastMonth',
  thisYear: 'sqChipThisYear',
  lastYear: 'sqChipLastYear',
  last7: 'sqChipLast7',
  last30: 'sqChipLast30',
} as const;

type FixedPeriod = keyof typeof WHEN_KEYS;

/** The period as a phrase inside a sentence ("this month", "in September"). */
export function periodPhrase(query: SpendQuery, ctx: AnswerContext): string {
  const s = ctx.strings;
  if (query.periodKey === 'month') {
    return fill(s.sqWhenInMonth, { month: monthWord(query.period.from, ctx.today, ctx.locale) });
  }
  if (query.periodKey === 'year') {
    return fill(s.sqWhenInYear, { year: query.period.from.slice(0, 4) });
  }
  return s[WHEN_KEYS[query.periodKey as FixedPeriod]];
}

function periodLabel(query: SpendQuery, ctx: AnswerContext): string {
  if (query.periodKey === 'month') return monthWord(query.period.from, ctx.today, ctx.locale);
  if (query.periodKey === 'year') return query.period.from.slice(0, 4);
  return ctx.strings[CHIP_KEYS[query.periodKey as FixedPeriod]];
}

const PAIRS: Readonly<Partial<Record<SpendPeriodKey, SpendPeriodKey>>> = {
  thisMonth: 'lastMonth',
  lastMonth: 'thisMonth',
  thisWeek: 'lastWeek',
  lastWeek: 'thisWeek',
  today: 'yesterday',
  yesterday: 'today',
  thisYear: 'lastYear',
  lastYear: 'thisYear',
};

const PAST: ReadonlySet<SpendPeriodKey> = new Set([
  'lastMonth',
  'lastWeek',
  'yesterday',
  'lastYear',
]);

/**
 * The chip for the period that was answered, plus its natural neighbour (this
 * month ↔ last month, today ↔ yesterday...). A question that named no period
 * was answered for this month, and the chips are how "This month or last?"
 * gets asked without a second spoken turn.
 */
export function periodChips(query: SpendQuery, ctx: AnswerContext): PeriodChip[] {
  const chosen: PeriodChip = {
    key: query.periodKey,
    label: periodLabel(query, ctx),
    selected: true,
  };
  const other = PAIRS[query.periodKey];
  if (!other) return [chosen];
  const alt: PeriodChip = {
    key: other,
    label: periodLabel(withPeriod(query, other, ctx.today), ctx),
    selected: false,
  };
  // The earlier period reads first, left to right, like a calendar.
  return PAST.has(query.periodKey) ? [chosen, alt] : [alt, chosen];
}

function categoryName(query: SpendQuery, answer: SpendAnswer, ctx: AnswerContext): string | null {
  if (!query.category) return null;
  return ctx.categoryNames[query.category] ?? answer.categoryLabel ?? query.category;
}

function joinAnd(items: readonly string[], ctx: AnswerContext): string {
  if (items.length <= 1) return items[0] ?? '';
  const head = items.slice(0, -1).join(', ');
  return fill(ctx.strings.sqAnd, { a: head, b: items[items.length - 1] ?? '' });
}

function whenPhrase(query: SpendQuery, groupName: string | null, ctx: AnswerContext): string {
  const base = periodPhrase(query, ctx);
  return groupName ? `${base} ${fill(ctx.strings.sqInGroup, { group: groupName })}` : base;
}

function resolveGroup(wanted: string, groups: readonly AnswerGroupInput[]): string | null {
  const needle = wanted.trim().toLocaleLowerCase();
  if (!needle) return null;
  const live = groups.filter((g) => !g.archived);
  const pool = [...live, ...groups.filter((g) => g.archived)];
  const exact = pool.find((g) => g.name.trim().toLocaleLowerCase() === needle);
  if (exact) return exact.name;
  const partial = pool.find((g) => g.name.toLocaleLowerCase().includes(needle));
  return partial ? partial.name : null;
}

function catalogKeyFor(query: SpendQuery, catalog: readonly SpendCatalogEntry[]): string | null {
  if (!query.category) return null;
  const wanted = query.category.toLocaleLowerCase();
  const hit = catalog.find(
    (entry) =>
      entry.key.toLocaleLowerCase() === wanted || entry.label.toLocaleLowerCase() === wanted,
  );
  return hit?.key ?? query.category;
}

/** Answer one parsed question, in words, with its chips and its link. */
export function answerMoneyQuestion(query: SpendQuery, ctx: AnswerContext): AssistantAnswer {
  const s = ctx.strings;
  const { data } = ctx;

  let groupName: string | null = null;
  let effective = query;
  if (query.group) {
    groupName = resolveGroup(query.group, data.groups);
    if (!groupName) {
      return {
        text: fill(s.sqNoGroup, { group: query.group }),
        status: 'noGroup',
        query,
        chips: [],
        link: null,
      };
    }
    effective = { ...query, group: groupName };
  }

  const answer = answerSpendQuery(
    effective,
    { txns: data.txns, budgets: data.budgets },
    groupExpensesForViewer(data.groups),
    { catalog: data.catalog, ...(ctx.viewerId ? { viewerId: ctx.viewerId } : null) },
  );

  const category = categoryName(effective, answer, ctx);
  const when = whenPhrase(effective, groupName, ctx);
  const amount = (minor: bigint, currency: string): string =>
    compactMoney(minor, currency, ctx.locale);

  let text: string;
  let link: SpendingLink | null = null;

  if (answer.metric === 'budgetLeft') {
    if (answer.status === 'noBudget' || answer.budgets.length === 0) {
      text = category ? fill(s.sqNoBudgetCat, { category }) : s.sqNoBudgetAny;
      link = {
        kind: 'budget',
        label: s.sqSetOne,
        pathname: '/personal/budgets',
        params: {},
      };
    } else {
      text = answer.budgets
        .map((line) =>
          line.remaining >= 0n
            ? fill(s.sqBudgetLeft, {
                left: amount(line.remaining, line.currency),
                limit: amount(line.limit, line.currency),
                category: category ?? s.sqOverall,
                when,
              })
            : fill(s.sqBudgetOver, {
                over: amount(-line.remaining, line.currency),
                limit: amount(line.limit, line.currency),
                category: category ?? s.sqOverall,
                when,
              }),
        )
        .join(' · ');
    }
  } else if (answer.status === 'empty') {
    text = category ? fill(s.sqNothingCat, { category, when }) : fill(s.sqNothingAll, { when });
  } else if (answer.metric === 'max' && answer.biggest) {
    const big = answer.biggest;
    text = fill(s.sqBiggest, {
      amount: amount(big.minor, big.currency),
      // core labels a note-less personal entry "Expense"; that is English, so leave it out.
      what: big.description.trim() === 'Expense' ? '' : big.description.trim(),
      date: shortDate(big.date, ctx.locale),
    })
      .replace(/\s{2,}/g, ' ')
      .replace(/\s+([,،])/g, '$1');
  } else if (answer.metric === 'count') {
    const count = answer.totals.reduce((sum, t) => sum + t.count, 0);
    text = category
      ? fill(s.sqCountCat, { category, when, count })
      : fill(s.sqCountAll, { when, count });
  } else {
    const spent = joinAnd(
      answer.totals.map((t) => amount(t.minor, t.currency)),
      ctx,
    );
    text = category
      ? fill(s.sqSumCat, { amount: spent, category, when })
      : fill(s.sqSumAll, { amount: spent, when });
  }

  // "Show in Spending" lands on the ledger, which holds the personal entries
  // only, so a question about a group's share has nothing there to show.
  if (!link && !groupName && answer.metric !== 'budgetLeft') {
    const key = catalogKeyFor(effective, data.catalog);
    link = {
      kind: 'spending',
      label: s.sqShow,
      pathname: '/personal/transactions',
      params: {
        kind: 'expense',
        from: effective.period.from,
        to: effective.period.to,
        ...(key ? { category: key } : null),
      },
    };
  }

  return {
    text,
    status: answer.status,
    query: effective,
    chips: periodChips(effective, ctx),
    link,
  };
}

/** The chip the person tapped: the same question for another period. */
export function answerForPeriod(
  query: SpendQuery,
  period: SpendPeriodKey,
  ctx: AnswerContext,
): AssistantAnswer {
  return answerMoneyQuestion(withPeriod(query, period, ctx.today), ctx);
}
