/** Pure on-device spend questions. Dates are inclusive calendar dates; money stays in minor units. */
import { CATEGORIES, guessCategory } from '../category/categories';
import { format } from '../money/format';
import { money } from '../money/money';
import { personalBudgetProgress } from '../personal/compute';
import type { PersonalBudget, PersonalTxn } from '../personal/types';

export interface SpendPeriod {
  from: string;
  to: string;
}
export type SpendPeriodKey =
  | 'today'
  | 'yesterday'
  | 'thisWeek'
  | 'lastWeek'
  | 'thisMonth'
  | 'lastMonth'
  | 'thisYear'
  | 'lastYear'
  | 'last7'
  | 'last30'
  | 'month'
  | 'year';
export interface SpendQuery {
  metric: 'sum' | 'max' | 'count' | 'budgetLeft';
  category?: string;
  period: SpendPeriod;
  periodKey: SpendPeriodKey;
  assumedPeriod: boolean;
  group?: string;
  merchant?: string;
  person?: string;
}
export interface SpendGroupExpense {
  id: string;
  groupId: string;
  groupName: string;
  description: string;
  note?: string | null;
  payee?: string | null;
  category: string | null;
  categoryLabel?: string | null;
  date: string;
  currency: string;
  myShareMinor: bigint;
  participantNames?: readonly string[];
}
export interface SpendCatalogEntry {
  key: string;
  label: string;
  builtinId: string | null;
}
export interface SpendLedger {
  txns: readonly PersonalTxn[];
  budgets: readonly PersonalBudget[];
}
export interface SpendOptions {
  catalog?: readonly SpendCatalogEntry[];
  viewerId?: string;
}
export interface SpendTotal {
  currency: string;
  minor: bigint;
  count: number;
}
export interface SpendBiggest {
  currency: string;
  minor: bigint;
  description: string;
  date: string;
  source: 'personal' | 'group';
  groupName?: string;
}
export interface SpendBudgetLine {
  currency: string;
  limit: bigint;
  spent: bigint;
  remaining: bigint;
}
export interface SpendAnswer {
  metric: SpendQuery['metric'];
  status: 'ok' | 'empty' | 'noBudget';
  totals: SpendTotal[];
  biggest: SpendBiggest | null;
  budgets: SpendBudgetLine[];
  categoryLabel: string | null;
  periodKey: SpendPeriodKey;
  assumedPeriod: boolean;
  period: SpendPeriod;
  text: string;
}

const DAY = 86_400_000;
const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
const norm = (text: string): string =>
  text
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^\p{L}\p{M}\p{N}&-]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const iso = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
function stamp(date: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return NaN;
  const y = Number(date.slice(0, 4));
  // Date.UTC treats years 0..99 specially; reject those rather than silently rolling centuries.
  if (y < 100) return NaN;
  const ms = Date.UTC(y, Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)));
  return iso(ms) === date ? ms : NaN;
}
function monthPeriod(y: number, m: number): SpendPeriod {
  return { from: iso(Date.UTC(y, m, 1)), to: iso(Date.UTC(y, m + 1, 1) - DAY) };
}
function periodFor(key: SpendPeriodKey, today: string): SpendPeriod {
  const ms = stamp(today);
  if (!Number.isFinite(ms)) throw new RangeError('Invalid today date');
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7)) - 1;
  const monday = ms - ((new Date(ms).getUTCDay() + 6) % 7) * DAY;
  switch (key) {
    case 'today':
      return { from: today, to: today };
    case 'yesterday':
      return { from: iso(ms - DAY), to: iso(ms - DAY) };
    case 'thisWeek':
      return { from: iso(monday), to: iso(monday + 6 * DAY) };
    case 'lastWeek':
      return { from: iso(monday - 7 * DAY), to: iso(monday - DAY) };
    case 'last7':
    case 'last30':
      return { from: iso(ms - (key === 'last7' ? 6 : 29) * DAY), to: today };
    case 'lastMonth':
      return monthPeriod(y, m - 1);
    case 'thisYear':
    case 'year':
      return { from: `${y}-01-01`, to: `${y}-12-31` };
    case 'lastYear':
      return { from: `${y - 1}-01-01`, to: `${y - 1}-12-31` };
    default:
      return monthPeriod(y, m);
  }
}
/** Relative keys use today; explicit month/year keys retain the query's calendar anchor. */
export function withPeriod(
  query: SpendQuery,
  periodKey: SpendPeriodKey,
  today: string,
): SpendQuery {
  return {
    ...query,
    periodKey,
    period: periodFor(
      periodKey,
      periodKey === 'month' || periodKey === 'year' ? query.period.from : today,
    ),
    assumedPeriod: false,
  };
}
export function lastMonthOf(query: SpendQuery, today: string): SpendQuery {
  return withPeriod(query, 'lastMonth', today);
}
const PERIODS: readonly (readonly [SpendPeriodKey, RegExp])[] = [
  ['last30', /\blast 30 days\b/],
  ['last7', /\blast 7 days\b/],
  ['lastMonth', /\b(?:last month|(?:pichhle|pichle|last) mahine|kadantha maasam)\b|पिछले महीने/],
  ['thisMonth', /\b(?:this month|is mahine|iss mahine|indha maasam)\b|इस महीने|இந்த மாதம்/],
  ['lastWeek', /\b(?:last week|pichhle hafte|pichle hafte)\b/],
  ['thisWeek', /\b(?:this week|is hafte|iss hafte)\b/],
  ['lastYear', /\blast year\b/],
  ['thisYear', /\b(?:this year|is saal)\b/],
  ['yesterday', /\b(?:yesterday|kal|naetru)\b|कल/],
  ['today', /\b(?:today|aaj|inru)\b|आज/],
];
function category(text: string): string | undefined {
  const t = norm(text);
  const label = CATEGORIES.find((c) =>
    [norm(c.label), c.id].some((word) => ` ${t} `.includes(` ${word} `)),
  );
  if (label) return label.id;
  if (/\b(?:khaana|khane|khana|khaane|saapadu|sappadu)\b|खाने/.test(t)) return 'food';
  if (/\b(?:cabs|safar)\b/.test(t)) return 'travel';
  if (/\bkapde\b/.test(t)) return 'shopping';
  return guessCategory(t) ?? undefined;
}
/** Merchant names must not become category clauses merely because the keyword table knows them. */
function categoryClause(text: string): string | undefined {
  const t = norm(text);
  if (
    /^(?:swiggy|starbucks|zomato|amazon|flipkart|myntra|bigbasket|dmart|blinkit|zepto|netflix|spotify)$/.test(
      t,
    )
  )
    return undefined;
  return category(t);
}
export function parseSpendQuery(text: string, today: string): SpendQuery | null {
  if (!Number.isFinite(stamp(today))) return null;
  let t = norm(text);
  if (
    /\b(?:owes?|settled|balance)\b/.test(t) ||
    /^(?:(?:please|i)\s+)?(?:add|paid|split|remind|record|create|mark)\b/.test(t)
  )
    return null;
  // A figure in the sentence ("spent 500 on lunch", "chai pe 50 kharch hua") is an expense
  // being added, never a question about totals; only period numbers ("last 7 days", "2025") pass.
  if (/\p{N}/u.test(t.replace(/\blast (?:7|30) days\b/g, ' ').replace(/\b(?:19|20)\d{2}\b/g, ' ')))
    return null;
  if (
    !/\b(?:spend|spent|spending|kharch|selavu|expenses?|cost|gaya|hua|biggest|largest|highest|costliest|how many|sabse bada|budget|bachat|bacha)\b|खर्च|செலவு/.test(
      t,
    )
  )
    return null;
  const metric: SpendQuery['metric'] =
    /\b(?:budget|bachat|bacha)\b/.test(t) && /\b(?:left|remaining|bacha|baaki|bachat)\b/.test(t)
      ? 'budgetLeft'
      : /\b(?:biggest|largest|highest|costliest|sabse bada)\b/.test(t)
        ? 'max'
        : /\bhow many\b/.test(t)
          ? 'count'
          : 'sum';
  let periodKey: SpendPeriodKey = 'thisMonth';
  let assumedPeriod = true;
  let period = periodFor(periodKey, today);
  for (const [key, re] of PERIODS) {
    if (!re.test(t)) continue;
    periodKey = key;
    period = periodFor(key, today);
    assumedPeriod = false;
    t = t.replace(re, ' ').trim();
    break;
  }
  if (assumedPeriod) {
    const named = MONTHS.findIndex((m) => new RegExp(`\\b${m.toLowerCase()}\\b`).test(t));
    if (named >= 0) {
      const explicit = /\b(\d{4})\b/.exec(t);
      const y = explicit
        ? Number(explicit[1])
        : Number(today.slice(0, 4)) - (named + 1 > Number(today.slice(5, 7)) ? 1 : 0);
      periodKey = 'month';
      period = monthPeriod(y, named);
      assumedPeriod = false;
      t = t
        .replace(new RegExp(`\\b(?:in\\s+)?${MONTHS[named]!.toLowerCase()}(?:\\s+\\d{4})?\\b`), '')
        .trim();
    } else {
      const year = /\b(?:in\s+)?(\d{4})\b/.exec(t);
      if (year) {
        periodKey = 'year';
        period = { from: `${year[1]}-01-01`, to: `${year[1]}-12-31` };
        assumedPeriod = false;
        t = t.replace(year[0], '');
      }
    }
  }
  const query: SpendQuery = { metric, period, periodKey, assumedPeriod };
  // Capture clauses up to the next preposition; period words were removed above.
  // Walks words rather than using a lazy regex, which is polynomial on long input.
  const words = t.split(/\s+/).filter(Boolean);
  const isPrep = (w: string): boolean => CLAUSE_PREPS.has(w.replace(/[^\p{L}]/gu, ''));
  const kept: string[] = [];
  for (let i = 0; i < words.length;) {
    const prep = words[i]!.replace(/[^\p{L}]/gu, '');
    if (!isPrep(words[i]!) || i + 1 >= words.length || isPrep(words[i + 1]!)) {
      kept.push(words[i]!);
      i++;
      continue;
    }
    let j = i + 1;
    while (j < words.length && !isPrep(words[j]!)) j++;
    const value = words
      .slice(i + 1, j)
      .join(' ')
      .replace(/\b(?:my|the)\b/g, '')
      .replace(/\bbudget(?: left| remaining)?\b/g, '')
      .trim();
    i = j;
    if (!value) continue;
    if (prep === 'with') query.person = value;
    else if (prep === 'in' || prep === 'for') {
      const c = categoryClause(value);
      if (c && metric === 'budgetLeft') query.category = c;
      else query.group = value;
    } else {
      const c = categoryClause(value);
      if (c) query.category = c;
      else query.merchant = value;
    }
  }
  const residual = kept.join(' ');
  query.category ??= category(residual);
  if (!query.category && !query.merchant) {
    const raw = /\b(?:on|for)\s+([\p{L}\p{M}-]+)\b/u.exec(t);
    if (raw && !query.group) query.category = raw[1];
    const budgetTag = /\b([\p{L}\p{M}-]+)\s+budget\b/u.exec(t);
    if (budgetTag && !['my', 'the', 'much'].includes(budgetTag[1]!)) query.category = budgetTag[1];
  }
  return query;
}

const CLAUSE_PREPS = new Set(['on', 'at', 'from', 'in', 'for', 'with']);

const amount = (minor: bigint, currency: string): string =>
  format(money(minor, currency), { locale: 'en-IN' }).replace(/\.0+(?=\D*$)/, '');
function phrase(query: SpendQuery): string {
  const phrases: Partial<Record<SpendPeriodKey, string>> = {
    today: 'today',
    yesterday: 'yesterday',
    thisWeek: 'this week',
    lastWeek: 'last week',
    thisMonth: 'this month',
    lastMonth: 'last month',
    thisYear: 'this year',
    lastYear: 'last year',
    last7: 'in the last 7 days',
    last30: 'in the last 30 days',
  };
  return (
    phrases[query.periodKey] ??
    (query.periodKey === 'year'
      ? `in ${query.period.from.slice(0, 4)}`
      : `in ${MONTHS[Number(query.period.from.slice(5, 7)) - 1]} ${query.period.from.slice(0, 4)}`)
  );
}
export function answerSpendQuery(
  query: SpendQuery,
  ledger: SpendLedger,
  mirror: readonly SpendGroupExpense[],
  options: SpendOptions = {},
): SpendAnswer {
  const catalog = [...(options.catalog ?? [])].sort(
    (a, b) => cmp(a.key, b.key) || cmp(a.label, b.label),
  );
  const requested = query.category ? norm(query.category) : null;
  const entry = catalog.find((c) =>
    [c.key, c.label, c.builtinId].some((v) => v !== null && norm(v) === requested),
  );
  const builtin = CATEGORIES.find(
    (c) => c.id === requested || norm(c.label) === requested || c.id === entry?.builtinId,
  );
  const aliases = new Set(
    [requested, entry?.key, entry?.label, entry?.builtinId, builtin?.id, builtin?.label]
      .filter((v): v is string => typeof v === 'string')
      .map(norm),
  );
  const matchesCategory = (key: string | null, label?: string | null): boolean =>
    !requested || [key, label].some((v) => v != null && aliases.has(norm(v)));
  const snapshot = [...mirror]
    .filter((e) => matchesCategory(e.category, e.categoryLabel) && e.categoryLabel)
    .sort((a, b) => cmp(a.id, b.id))[0]?.categoryLabel;
  const categoryLabel = requested
    ? (entry?.label ?? builtin?.label ?? snapshot ?? query.category!)
    : null;
  const spokenCategory = builtin?.id ?? categoryLabel?.toLowerCase();
  const suffix = `${spokenCategory ? ` on ${spokenCategory}` : ''}${query.merchant ? ` at ${query.merchant}` : ''}${query.group ? ` in ${query.group}` : ''}${query.person ? ` with ${query.person}` : ''} ${phrase(query)}`;
  const answer: SpendAnswer = {
    metric: query.metric,
    status: 'empty',
    totals: [],
    biggest: null,
    budgets: [],
    categoryLabel,
    periodKey: query.periodKey,
    assumedPeriod: query.assumedPeriod,
    period: { ...query.period },
    text: `Nothing${suffix}`,
  };
  if (query.metric === 'budgetLeft') {
    const budgets = ledger.budgets
      .filter((b) => (requested ? matchesCategory(b.category) : b.category === null))
      .sort((a, b) => cmp(a.currency, b.currency) || cmp(a.id, b.id));
    answer.budgets = budgets.map((b) => {
      const { limit, spent, remaining } = personalBudgetProgress(
        b,
        ledger.txns,
        query.period.from.slice(0, 7),
      );
      return { currency: b.currency, limit, spent, remaining };
    });
    answer.status = budgets.length ? 'ok' : 'noBudget';
    const name = spokenCategory ? `${spokenCategory} budget` : 'budget';
    answer.text = budgets.length
      ? answer.budgets
          .map((b) =>
            b.remaining < 0n
              ? `${amount(-b.remaining, b.currency)} over your ${amount(b.limit, b.currency)} ${name}`
              : `${amount(b.remaining, b.currency)} left of ${amount(b.limit, b.currency)} ${name} ${phrase({ ...query, periodKey: query.periodKey === 'thisMonth' || query.periodKey === 'lastMonth' ? query.periodKey : 'month' })}`,
          )
          .join(' and ')
      : `No ${name} set · Set one`;
    return answer;
  }
  type Row = SpendBiggest & { id: string };
  const rows: Row[] = [];
  const inPeriod = (date: string): boolean => date >= query.period.from && date <= query.period.to;
  const merchantMatch = (text: string): boolean =>
    !query.merchant || norm(text).includes(norm(query.merchant));
  if (!query.group && !query.person)
    for (const txn of ledger.txns) {
      if (
        txn.kind !== 'expense' ||
        txn.loanId !== null ||
        !inPeriod(txn.date) ||
        !matchesCategory(txn.category) ||
        !merchantMatch(txn.note ?? '')
      )
        continue;
      rows.push({
        id: txn.id,
        currency: txn.currency,
        minor: txn.amount,
        description: txn.note ?? 'Expense',
        date: txn.date,
        source: 'personal',
      });
    }
  for (const e of mirror) {
    if (e.myShareMinor <= 0n || !inPeriod(e.date) || !matchesCategory(e.category, e.categoryLabel))
      continue;
    if (query.group && !norm(e.groupName).includes(norm(query.group))) continue;
    if (query.person && !e.participantNames?.some((p) => norm(p).includes(norm(query.person!))))
      continue;
    if (!merchantMatch([e.description, e.note, e.payee].filter(Boolean).join(' '))) continue;
    rows.push({
      id: e.id,
      currency: e.currency,
      minor: e.myShareMinor,
      description: e.description,
      date: e.date,
      source: 'group',
      groupName: e.groupName,
    });
  }
  rows.sort((a, b) =>
    a.minor > b.minor
      ? -1
      : a.minor < b.minor
        ? 1
        : cmp(a.currency, b.currency) ||
          cmp(a.id, b.id) ||
          cmp(a.source, b.source) ||
          cmp(a.groupName ?? '', b.groupName ?? '') ||
          cmp(a.date, b.date) ||
          cmp(a.description, b.description),
  );
  if (!rows.length) return answer;
  answer.status = 'ok';
  if (query.metric === 'max') {
    const first = rows[0]!;
    const { id: _id, ...biggest } = first;
    answer.biggest = biggest;
    answer.text = `Biggest: ${amount(first.minor, first.currency)} ${first.description} on ${Number(first.date.slice(8, 10))} ${MONTHS[Number(first.date.slice(5, 7)) - 1]!.slice(0, 3)}`;
    return answer;
  }
  const totals = new Map<string, SpendTotal>();
  for (const row of rows) {
    const total = totals.get(row.currency) ?? { currency: row.currency, minor: 0n, count: 0 };
    total.minor += row.minor;
    total.count++;
    totals.set(row.currency, total);
  }
  answer.totals = [...totals.values()].sort((a, b) =>
    a.minor > b.minor ? -1 : a.minor < b.minor ? 1 : cmp(a.currency, b.currency),
  );
  answer.text =
    query.metric === 'count'
      ? `You had ${rows.length} expenses${suffix}`
      : `You spent ${answer.totals.map((t) => amount(t.minor, t.currency)).join(' and ')}${suffix}`;
  return answer;
}
