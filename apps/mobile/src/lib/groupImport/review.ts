/**
 * The Review step, as data.
 *
 * Everything the screen shows about a row is decided here, in pure code: whether
 * it will import, whether it looks like something already in the group, what it
 * does to each person's balance, and, once the person says go, the exact wire
 * payload. The screen only draws it. That split is what lets the rules (an error
 * row can never be ticked, a likely duplicate starts unticked, the payload holds
 * only what is ticked) be tests rather than things to remember on a device.
 */

import {
  findDuplicates,
  resolveDraft,
  type CurrencyCode,
  type DedupeRow,
  type ExistingExpense,
  type GroupMemberRef,
  type ImportDraft,
  type ImportDraftRow,
  type ImportDuplicateMatch,
  type ImportIssue,
  type ResolvedExpense,
  type ResolvedRow,
} from '@waves/core';

import type { ImportExpense, ImportPerson, ImportSettlement } from '@/data/api';
import type { ExpenseRow } from '@/data/types';

// ── editing one row ─────────────────────────────────────────────────────────

/** What the row sheet can change. Anything absent is left as the file said it. */
export interface RowEdit {
  description?: string;
  amount?: bigint;
  /** YYYY-MM-DD. */
  date?: string;
  /** A name from the file. */
  payer?: string;
  /** Names from the file; the cost is split equally between them. */
  participants?: readonly string[];
  category?: string | null;
}

const errorsOn = (issues: readonly ImportIssue[], fixed: ReadonlySet<string>): ImportIssue[] =>
  issues.filter((issue) => !(issue.severity === 'error' && issue.field && fixed.has(issue.field)));

/** The draft row with the person's edit applied. An edited field's errors are cleared with it. */
export function applyRowEdit(row: ImportDraftRow, edit: RowEdit): ImportDraftRow {
  const fixed = new Set<string>();
  let next: ImportDraftRow = row;

  if (edit.description !== undefined && edit.description.trim() !== '') {
    next = { ...next, description: edit.description.trim() };
  }
  if (edit.category !== undefined) next = { ...next, category: edit.category };
  if (edit.date !== undefined) {
    next = { ...next, date: edit.date };
    fixed.add('date');
  }
  if (edit.amount !== undefined && edit.amount > 0n) {
    next = { ...next, amount: edit.amount };
    fixed.add('amount');
    // A split or a list of payers written in the old amount no longer adds up to
    // the new one. Fall back to the plainest reading of it: whoever paid most
    // paid it all, and the same people share it equally.
    const split = next.split;
    if (split && (split.kind === 'exact' || split.kind === 'net')) {
      const names = Object.keys(split.kind === 'exact' ? split.amounts : split.nets);
      next = { ...next, split: { kind: 'equal', among: names } };
    }
    const payers = next.payers;
    if (payers && !('single' in payers)) {
      const [largest] = Object.entries(payers).sort((a, b) => (b[1] > a[1] ? 1 : -1));
      if (largest) next = { ...next, payers: { single: largest[0] } };
    }
  }
  if (edit.payer !== undefined) {
    next = { ...next, payers: { single: edit.payer } };
    fixed.add('payers');
  }
  if (edit.participants !== undefined) {
    next = { ...next, split: { kind: 'equal', among: edit.participants } };
    fixed.add('split');
  }
  return next === row ? row : { ...next, issues: errorsOn(next.issues, fixed) };
}

/** The draft with every row's edit applied. */
export function applyEdits(
  draft: ImportDraft,
  edits: Readonly<Record<string, RowEdit>>,
): ImportDraft {
  if (Object.keys(edits).length === 0) return draft;
  return {
    ...draft,
    rows: draft.rows.map((row) => {
      const edit = edits[row.key];
      return edit ? applyRowEdit(row, edit) : row;
    }),
  };
}

// ── what is already in the group ────────────────────────────────────────────

/** The group's live expenses, in the shape the duplicate check wants. */
export function existingFromExpenses(rows: readonly ExpenseRow[]): ExistingExpense[] {
  const existing: ExistingExpense[] = [];
  for (const row of rows) {
    const version = row.currentVersion;
    if (row.deleted_at || !version) continue;
    try {
      existing.push({
        id: row.id,
        date: version.expense_date,
        currency: version.currency,
        amount: BigInt(version.amount),
        description: version.description,
      });
    } catch {
      // An amount that is not an integer cannot be compared; leave it out.
    }
  }
  return existing;
}

// ── the review model ────────────────────────────────────────────────────────

export type RowStatus = 'ok' | 'attention' | 'wont' | 'duplicate';
export type ReviewFilter = 'all' | 'attention' | 'wont' | 'duplicates';

export interface ReviewRow {
  readonly key: string;
  /** 1-based line in the file. */
  readonly line: number | null;
  readonly kind: 'expense' | 'settlement';
  readonly date: string | null;
  readonly description: string;
  readonly amount: bigint | null;
  readonly currency: string;
  readonly status: RowStatus;
  /** An error row cannot be ticked. */
  readonly selectable: boolean;
  readonly ticked: boolean;
  /** Who paid (a settlement: who sent it). */
  readonly payers: readonly string[];
  /** Who it is split between (a settlement: who received it). */
  readonly sharers: readonly string[];
  readonly issues: readonly ImportIssue[];
  readonly duplicate: { level: ImportDuplicateMatch['level']; existing: ExistingExpense } | null;
  /** In a currency other than the group's. */
  readonly foreign: boolean;
  readonly edited: boolean;
}

export interface BalanceChange {
  readonly name: string;
  /** Null for somebody who will be added as a new person. */
  readonly memberId: string | null;
  readonly net: bigint;
}

export interface ReviewSummary {
  readonly expenses: number;
  readonly settlements: number;
  /** Ticked expenses in the group's currency. */
  readonly total: bigint;
  /** Ticked expenses in some other currency. */
  readonly otherCurrency: number;
  readonly firstDate: string | null;
  readonly lastDate: string | null;
  readonly newPeople: number;
  /** Rows in the file that will not be imported. */
  readonly left: number;
}

export interface ReviewModel {
  readonly rows: readonly ReviewRow[];
  readonly summary: ReviewSummary;
  readonly changes: readonly BalanceChange[];
  readonly counts: Readonly<Record<ReviewFilter, number>>;
  /** Resolved rows that are ticked, in file order. */
  readonly selected: readonly ResolvedRow[];
  readonly people: readonly { name: string; memberId: string | null }[];
  /** Keys of rows the file said were split equally. */
  readonly equal: ReadonlySet<string>;
}

export interface ReviewInput {
  readonly draft: ImportDraft;
  readonly edits: Readonly<Record<string, RowEdit>>;
  /** File name to member id or `'ghost'`. */
  readonly mapping: Readonly<Record<string, string>>;
  readonly members: readonly GroupMemberRef[];
  readonly groupCurrency: CurrencyCode;
  readonly importerMemberId: string | null;
  readonly existing: readonly ExistingExpense[];
  /** The person's own ticks and unticks. */
  readonly ticks: Readonly<Record<string, boolean>>;
}

const names = (record: Readonly<Record<string, bigint>>): string[] => Object.keys(record);

export function buildReview(input: ReviewInput): ReviewModel {
  const draft = applyEdits(input.draft, input.edits);
  const resolved = resolveDraft(draft, input.mapping, {
    groupCurrency: input.groupCurrency,
    members: input.members,
    importerMemberId: input.importerMemberId,
  });

  const accepted = new Map<string, ResolvedRow>(resolved.rows.map((row) => [row.key, row]));
  const rejected = new Map(resolved.rejected.map((row) => [row.row.key, row]));
  const splitOf = new Map(draft.rows.map((row) => [row.key, row.split] as const));

  const forDuplicates: DedupeRow[] = resolved.rows
    .filter((row): row is ResolvedExpense => row.kind === 'expense')
    .map((row) => ({
      key: row.key,
      date: row.date,
      currency: row.currency,
      amount: row.amount,
      description: row.description,
    }));
  const report = findDuplicates(forDuplicates, input.existing);
  const existingById = new Map(input.existing.map((expense) => [expense.id, expense]));

  const rows: ReviewRow[] = [];
  for (const source of draft.rows) {
    const edited = input.edits[source.key] !== undefined;
    const fail = rejected.get(source.key);
    if (fail) {
      rows.push({
        key: source.key,
        line: source.row,
        kind: source.kind,
        date: source.date,
        description: source.description,
        amount: source.amount,
        currency: source.currency ?? input.groupCurrency,
        status: 'wont',
        selectable: false,
        ticked: false,
        payers: [],
        sharers: [],
        issues: fail.issues,
        duplicate: null,
        foreign: false,
        edited,
      });
      continue;
    }
    const row = accepted.get(source.key);
    if (!row) continue;

    const match = report.existing.get(row.key);
    const found = match ? existingById.get(match.expenseId) : undefined;
    const duplicate = match && found ? { level: match.level, existing: found } : null;
    const foreign = row.currency !== input.groupCurrency;
    const warned = row.issues.some((issue) => issue.severity === 'warning') || foreign;
    const status: RowStatus = duplicate ? 'duplicate' : warned ? 'attention' : 'ok';
    const ticked = input.ticks[row.key] ?? duplicate?.level !== 'likely';

    rows.push({
      key: row.key,
      line: row.row,
      kind: row.kind,
      date: row.date,
      description: row.description,
      amount: row.amount,
      currency: row.currency,
      status,
      selectable: true,
      ticked,
      payers: row.kind === 'expense' ? names(row.payers) : [row.from],
      sharers: row.kind === 'expense' ? names(row.shares) : [row.to],
      issues: row.issues,
      duplicate,
      foreign,
      edited,
    });
  }

  const selected = resolved.rows.filter(
    (row) => rows.find((shown) => shown.key === row.key)?.ticked === true,
  );
  const selectedKeys = new Set(selected.map((row) => row.key));

  // What the import does to each person: what they paid less what they owe, over
  // the ticked rows in the group's currency. Another currency has no place on one
  // bar, and the summary says how many rows it left out.
  const net = new Map<string, bigint>();
  const bump = (name: string, by: bigint): void => {
    net.set(name, (net.get(name) ?? 0n) + by);
  };
  let total = 0n;
  let otherCurrency = 0;
  let expenses = 0;
  let settlements = 0;
  const dates: string[] = [];
  for (const row of selected) {
    dates.push(row.date);
    if (row.kind === 'expense') expenses += 1;
    else settlements += 1;
    if (row.currency !== input.groupCurrency) {
      if (row.kind === 'expense') otherCurrency += 1;
      continue;
    }
    if (row.kind === 'expense') {
      total += row.amount;
      for (const [name, paid] of Object.entries(row.payers)) bump(name, paid);
      for (const [name, owed] of Object.entries(row.shares)) bump(name, -owed);
    } else {
      bump(row.from, row.amount);
      bump(row.to, -row.amount);
    }
  }

  const memberOf = new Map(resolved.people.map((person) => [person.name, person.memberId]));
  const changes: BalanceChange[] = [...net.entries()]
    .map(([name, value]) => ({ name, memberId: memberOf.get(name) ?? null, net: value }))
    .sort((a, b) => {
      const gap = (b.net < 0n ? -b.net : b.net) - (a.net < 0n ? -a.net : a.net);
      return gap === 0n ? a.name.localeCompare(b.name) : gap > 0n ? 1 : -1;
    });

  const used = new Set<string>();
  for (const row of selected) {
    if (row.kind === 'expense') {
      for (const name of [...names(row.payers), ...names(row.shares)]) used.add(name);
    } else {
      used.add(row.from).add(row.to);
    }
  }
  const people = resolved.people
    .filter((person) => used.has(person.name))
    .map((person) => ({ name: person.name, memberId: person.memberId }));

  const sorted = [...dates].sort();
  const counts: Record<ReviewFilter, number> = {
    all: rows.length,
    attention: rows.filter((row) => row.status === 'attention').length,
    wont: rows.filter((row) => row.status === 'wont').length,
    duplicates: rows.filter((row) => row.status === 'duplicate').length,
  };

  return {
    rows,
    summary: {
      expenses,
      settlements,
      total,
      otherCurrency,
      firstDate: sorted[0] ?? null,
      lastDate: sorted[sorted.length - 1] ?? null,
      newPeople: people.filter((person) => person.memberId === null).length,
      left: rows.length - selectedKeys.size,
    },
    changes,
    counts,
    selected,
    people,
    equal: new Set(
      rows.filter((row) => splitOf.get(row.key)?.kind === 'equal').map((row) => row.key),
    ),
  };
}

/** The rows a filter chip shows. */
export function rowsFor(model: ReviewModel, filter: ReviewFilter): readonly ReviewRow[] {
  switch (filter) {
    case 'attention':
      return model.rows.filter((row) => row.status === 'attention');
    case 'wont':
      return model.rows.filter((row) => row.status === 'wont');
    case 'duplicates':
      return model.rows.filter((row) => row.status === 'duplicate');
    default:
      return model.rows;
  }
}

// ── the write ───────────────────────────────────────────────────────────────

export interface ImportPayload {
  readonly people: ImportPerson[];
  readonly expenses: ImportExpense[];
  readonly settlements: ImportSettlement[];
}

/** A mutation id for every key, keeping the ones already chosen: a retry must replay, not duplicate. */
export function ensureIds(
  keys: readonly string[],
  existing: Readonly<Record<string, string>>,
  make: () => string,
): Record<string, string> {
  const ids: Record<string, string> = { ...existing };
  for (const key of keys) ids[key] ??= make();
  return ids;
}

/**
 * The ticked rows as `waves_import_into_group` wants them. People the ticked rows
 * never mention are left out, so unticking the only row a stranger appears in
 * does not leave a ghost behind.
 */
export function buildPayload(
  model: ReviewModel,
  ids: Readonly<Record<string, string>>,
  make: () => string,
): ImportPayload {
  const idFor = (key: string): string => ids[key] ?? make();
  const expenses: ImportExpense[] = [];
  const settlements: ImportSettlement[] = [];
  for (const row of model.selected) {
    if (row.kind === 'expense') {
      expenses.push({
        clientMutationId: idFor(row.key),
        description: row.description,
        category: row.category,
        date: row.date,
        currency: row.currency,
        amount: row.amount,
        payers: { ...row.payers },
        shares: { ...row.shares },
        ...(model.equal.has(row.key) ? { splitHint: 'equal' as const } : {}),
      });
    } else {
      settlements.push({
        clientMutationId: idFor(row.key),
        from: row.from,
        to: row.to,
        currency: row.currency,
        amount: row.amount,
        method: 'other',
        status: 'confirmed',
        note: row.description,
        at: row.date,
      });
    }
  }
  return {
    people: model.people.map((person) => ({ name: person.name, memberId: person.memberId })),
    expenses,
    settlements,
  };
}
