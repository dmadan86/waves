/**
 * Loading a Splitwise CSV export into a Waves group (server side).
 *
 * This is the write-path companion to the pure parser in
 * `@waves/core` (`importSplitwiseCsv`): that one answers "what does this file
 * mean", this one answers "put it in the database". They share the same honest
 * premise (TDR §10, ADR-012) — a Splitwise export carries only each person's
 * **net** for a row (what they paid minus what they owed), so:
 *
 *   - balances are recovered exactly, to the paisa, and that is provable;
 *   - who paid is a deterministic *reconstruction*, not the truth from the
 *     original group. Anyone whose net was positive is treated as having paid,
 *     in proportion to that net (see {@link reconstruct}).
 *
 * What this module adds over the core parser is the two things the database
 * cares about that the core parser does not model:
 *
 *   1. **Settlements vs expenses.** A `Category == "Payment"` row is a payment
 *      from one member to another ("Hethu paid Madan D."), not a shared cost.
 *      It becomes a `settlements` row, never an `expenses` one — otherwise the
 *      history would show a dinner that never happened.
 *   2. **A real category.** Splitwise's category name, or failing that the
 *      free-text description, is mapped onto the app's ten-category system
 *      (TDR §8), falling back to null when nothing matches — the same "machine
 *      proposes" bargain the app makes everywhere else.
 *
 * The actual insert reuses the canonical `waves_import_ledger` RPC — the exact
 * function the app's own import path calls — so ghosts, idempotency, the
 * append-only version rows, the Σpayers = Σshares = amount constraint and the
 * derived-balance triggers are all exercised the way production exercises them,
 * rather than reproduced (and allowed to drift) here.
 *
 * Money is parsed digit by digit by core's `parseLooseAmount` (ADR-003). A CSV of
 * somebody's entire trip is precisely where a float quietly loses a paisa per
 * row and only shows up as a balance that will not settle.
 */

import { type CurrencyCode, draftFromSplitwise, draftProblems, resolveDraft } from '@waves/core';

// ── parse result ────────────────────────────────────────────────────────────

export enum SplitwiseRowKind {
  Expense = 'expense',
  Settlement = 'settlement',
}

export enum SplitwiseProblemKind {
  UnparseableRow = 'unparseable_row',
  UnknownCurrency = 'unknown_currency',
  TooManyDecimals = 'too_many_decimals',
  MixedDateFormats = 'mixed_date_formats',
  RowDoesNotBalance = 'row_does_not_balance',
  UnexpectedSettlement = 'unexpected_settlement',
  DuplicatePerson = 'duplicate_person',
  NonPositiveCost = 'non_positive_cost',
  NoPeople = 'no_people',
  NoRows = 'no_rows',
}

export interface SplitwiseProblem {
  readonly kind: SplitwiseProblemKind;
  /** 1-based line in the file, as a spreadsheet numbers it. Null for file-level problems. */
  readonly row: number | null;
  readonly message: string;
}

export interface ParsedExpense {
  readonly kind: SplitwiseRowKind.Expense;
  readonly row: number;
  readonly description: string;
  /** The app category guessed from the description (TDR §8), or null. */
  readonly category: string | null;
  /** The category string exactly as Splitwise wrote it (e.g. "Plane"), or null. */
  readonly rawCategory: string | null;
  /** ISO date, YYYY-MM-DD. */
  readonly date: string;
  readonly currency: CurrencyCode;
  /** Total, in minor units. */
  readonly amount: bigint;
  /** Reconstructed: who is treated as having paid, keyed by name. Sums to `amount`. */
  readonly payers: Readonly<Record<string, bigint>>;
  /** Exactly what each person owed, keyed by name. Sums to `amount`. */
  readonly shares: Readonly<Record<string, bigint>>;
}

export interface ParsedSettlement {
  readonly kind: SplitwiseRowKind.Settlement;
  readonly row: number;
  readonly description: string;
  readonly date: string;
  readonly currency: CurrencyCode;
  readonly amount: bigint;
  /** The member who made the payment (their net for the row is positive). */
  readonly from: string;
  /** The member who received it (their net is negative). */
  readonly to: string;
}

export interface SplitwiseParse {
  /** Everybody named in the file, in column order. */
  readonly people: readonly string[];
  readonly expenses: readonly ParsedExpense[];
  readonly settlements: readonly ParsedSettlement[];
  /** Rows that could not be imported. Everything else still is. */
  readonly errors: readonly SplitwiseProblem[];
  readonly currency: CurrencyCode;
  /**
   * Net position per person across every imported row (expenses and
   * settlements), in minor units. Positive means owed money. Sums to zero when
   * `errors` is empty, and equals what the derived balances will be.
   */
  readonly netByPerson: Readonly<Record<string, bigint>>;
}

/**
 * Read a Splitwise CSV export into structured expenses, settlements and the
 * errors for anything that would not reconcile.
 *
 * The reading is `@waves/core`'s (`draftFromSplitwise` + `resolveDraft`), the
 * same one the app uses, so the CLI and the phone can never disagree about a
 * file. Never throws. A file with three bad rows and forty good ones yields the
 * forty and names the three, because refusing the lot over one malformed row
 * would be the wrong trade for somebody moving years of history.
 */
export function parseSplitwiseCsv(csv: string): SplitwiseParse {
  const draft = draftFromSplitwise(csv);
  const resolved = resolveDraft(draft, {}, { groupCurrency: 'INR', members: [] });
  const byKey = new Map(draft.rows.map((row) => [row.key, row]));

  const errors: SplitwiseProblem[] = draftProblems(draft).map((problem) => ({
    kind: problem.kind as string as SplitwiseProblemKind,
    row: problem.row,
    message: problem.message,
  }));
  for (const { row, issues } of resolved.rejected) {
    for (const issue of issues.slice(row.issues.length)) {
      if (issue.severity === 'error') {
        errors.push({
          kind: issue.code as string as SplitwiseProblemKind,
          row: row.row,
          message: issue.message,
        });
      }
    }
  }
  errors.sort((a, b) => (a.row ?? 0) - (b.row ?? 0));

  const expenses: ParsedExpense[] = [];
  const settlements: ParsedSettlement[] = [];
  const netByPerson = new Map<string, bigint>(draft.people.map((person) => [person, 0n]));
  for (const row of resolved.rows) {
    const source = byKey.get(row.key);
    const line = row.row ?? 0;
    if (row.kind === 'expense') {
      expenses.push({
        kind: SplitwiseRowKind.Expense,
        row: line,
        description: row.description,
        category: row.category,
        rawCategory: source?.rawCategory ?? null,
        date: row.date,
        currency: row.currency,
        amount: row.amount,
        payers: row.payers,
        shares: row.shares,
      });
    } else {
      settlements.push({
        kind: SplitwiseRowKind.Settlement,
        row: line,
        description: row.description,
        date: row.date,
        currency: row.currency,
        amount: row.amount,
        from: row.from,
        to: row.to,
      });
    }
  }
  for (const book of Object.values(resolved.balances)) {
    for (const [person, value] of Object.entries(book)) {
      netByPerson.set(person, (netByPerson.get(person) ?? 0n) + value);
    }
  }

  const currency =
    [...draft.rows].reverse().find((row) => row.currency !== null)?.currency ?? 'INR';
  return {
    people: draft.people,
    expenses,
    settlements,
    errors,
    currency,
    netByPerson: Object.fromEntries(netByPerson),
  };
}

// ── write path ──────────────────────────────────────────────────────────────

/**
 * The slice of a `pg`-style client this module needs. Declared here so the
 * package's runtime code does not depend on `pg` (a dev/test dependency): any
 * client with a `query(text, params)` returning `{ rows }` will do.
 */
export interface Queryable {
  query(
    text: string,
    params?: readonly unknown[],
  ): Promise<{ rows: Array<Record<string, unknown>> }>;
}

export interface ImportPlanMember {
  readonly name: string;
  /** `real` is the account doing the import; `ghost` is a name-only placeholder. */
  readonly kind: 'real' | 'ghost';
}

export interface ImportPlan {
  readonly groupName: string;
  readonly currency: CurrencyCode;
  readonly members: readonly ImportPlanMember[];
  readonly expenseCount: number;
  readonly settlementCount: number;
  /** Total expense spend per app category (null category shown as "uncategorised"), minor units. */
  readonly categoryTotals: Readonly<Record<string, bigint>>;
  /** Each person's final net after the whole import, minor units. */
  readonly netByPerson: Readonly<Record<string, bigint>>;
  readonly errors: readonly SplitwiseProblem[];
}

export interface ImportOptions {
  readonly parse: SplitwiseParse;
  /** The profile id of the Waves account the import lands in. Must already exist. */
  readonly userId: string;
  /** That account's Splitwise column name (must be one of `parse.people`). */
  readonly userName: string;
  /** Defaults to "<userName>'s Splitwise". */
  readonly groupName?: string;
  /** Recorded on the activity-log entry. Defaults to "splitwise". */
  readonly origin?: string;
  /**
   * When true (the DEFAULT), nothing is written — the returned plan is what
   * *would* happen. Pass false to actually insert.
   */
  readonly dryRun?: boolean;
}

export interface ImportResult {
  readonly dryRun: boolean;
  readonly plan: ImportPlan;
  /** Set only when `dryRun` was false. */
  readonly groupId?: string;
  /** name → group_member id, set only when `dryRun` was false. */
  readonly memberIdByName?: Readonly<Record<string, string>>;
  /** The raw jsonb `waves_import_ledger` returned, when `dryRun` was false. */
  readonly ledgerResult?: Record<string, unknown>;
}

const UNCATEGORISED = 'uncategorised';

function buildPlan(options: ImportOptions): ImportPlan {
  const { parse, userName } = options;
  const groupName = options.groupName ?? `${userName}'s Splitwise`;

  const categoryTotals = new Map<string, bigint>();
  for (const expense of parse.expenses) {
    const key = expense.category ?? UNCATEGORISED;
    categoryTotals.set(key, (categoryTotals.get(key) ?? 0n) + expense.amount);
  }

  return {
    groupName,
    currency: parse.currency,
    members: parse.people.map((name) => ({
      name,
      kind: name === userName ? 'real' : 'ghost',
    })),
    expenseCount: parse.expenses.length,
    settlementCount: parse.settlements.length,
    categoryTotals: Object.fromEntries(categoryTotals),
    netByPerson: parse.netByPerson,
    errors: parse.errors,
  };
}

/** minor-unit bigints → the string-valued JSON `waves_import_ledger` reads. */
function amountMap(record: Readonly<Record<string, bigint>>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(record).map(([name, value]) => [name, value.toString()]),
  );
}

/**
 * Load a parsed Splitwise export into a fresh Waves group.
 *
 * Creates the group and the importing account's membership, then hands the
 * expenses, settlements and the other people to `waves_import_ledger` — the
 * canonical RPC — which mints a ghost member for each of the others, applies
 * every expense through the same `waves_apply_expense` the app uses, inserts the
 * settlements, and lets the derived-balance triggers do the rest. Everything
 * runs in one transaction: if any single row is rejected, nothing is written.
 *
 * With `dryRun` (the default) it touches nothing and returns the plan alone.
 */
export async function importSplitwiseLedger(
  client: Queryable,
  options: ImportOptions,
): Promise<ImportResult> {
  const { parse, userId, userName, origin = 'splitwise' } = options;
  const dryRun = options.dryRun ?? true;
  const plan = buildPlan(options);

  if (!parse.people.includes(userName)) {
    throw new Error(
      `The importing account's name "${userName}" is not one of the people in the file (${parse.people.join(', ')}).`,
    );
  }

  if (dryRun) {
    return { dryRun: true, plan };
  }

  const expensesJson = parse.expenses.map((expense) => ({
    description: expense.description,
    category: expense.category,
    date: expense.date,
    currency: expense.currency,
    amount: expense.amount.toString(),
    payers: amountMap(expense.payers),
    shares: amountMap(expense.shares),
  }));

  const settlementsJson = parse.settlements.map((settlement) => ({
    from: settlement.from,
    to: settlement.to,
    amount: settlement.amount.toString(),
    currency: settlement.currency,
    at: settlement.date,
    status: 'confirmed',
    method: 'other',
    note: settlement.description,
  }));

  await client.query('BEGIN');
  try {
    // The importer writes as the service, which the `groups` trigger does not
    // look at — so it asks the Free ceiling itself, as `waves_create_group`
    // would. A Free account that has started its ten groups cannot import an
    // eleventh; the refusal is FREE_GROUP_LIMIT, the same one the app shows.
    await client.query(`SELECT public.waves_assert_group_cap($1)`, [userId]);
    const groupRows = (
      await client.query(
        `INSERT INTO groups (name, type, default_currency, created_by)
         VALUES ($1, 'other', $2, $3) RETURNING id`,
        [plan.groupName, parse.currency, userId],
      )
    ).rows;
    const groupId = String(groupRows[0]?.id);

    const memberRows = (
      await client.query(
        `INSERT INTO group_members (group_id, profile_id, role, joined_via)
         VALUES ($1, $2, 'admin', 'creator') RETURNING id`,
        [groupId, userId],
      )
    ).rows;
    const realMemberId = String(memberRows[0]?.id);

    const peopleJson = parse.people.map((name) =>
      name === userName ? { name, memberId: realMemberId } : { name },
    );

    // Act as the importing user so the RPC's membership and authorship checks
    // pass; local to this transaction, undone on commit/rollback.
    await client.query(`SELECT set_config('request.jwt.claims', $1, true)`, [
      JSON.stringify({ sub: userId }),
    ]);

    const ledgerRows = (
      await client.query(
        `SELECT public.waves_import_ledger($1, $2::jsonb, $3::jsonb, $4::jsonb, $5) AS result`,
        [
          groupId,
          JSON.stringify(peopleJson),
          JSON.stringify(expensesJson),
          JSON.stringify(settlementsJson),
          origin,
        ],
      )
    ).rows;
    const ledgerResult = (ledgerRows[0]?.result ?? {}) as Record<string, unknown>;

    await client.query('COMMIT');

    const members = (ledgerResult.members ?? {}) as Record<string, string>;
    const memberIdByName: Record<string, string> = { ...members };
    memberIdByName[userName] = realMemberId;

    return { dryRun: false, plan, groupId, memberIdByName, ledgerResult };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

/**
 * A human-readable summary of what an import would do — the thing to eyeball
 * before running the real one. Pure; safe to print from a dry run.
 */
export function formatImportReport(result: ImportResult): string {
  const { plan } = result;
  const lines: string[] = [];
  const money = (minor: bigint): string => {
    const negative = minor < 0n;
    const abs = negative ? -minor : minor;
    const whole = abs / 100n;
    const frac = (abs % 100n).toString().padStart(2, '0');
    return `${negative ? '-' : ''}${whole.toString()}.${frac}`;
  };

  lines.push(`Splitwise import — ${plan.groupName} (${plan.currency})`);
  lines.push(
    `  ${result.dryRun ? 'DRY RUN — nothing written' : `written as group ${result.groupId}`}`,
  );
  lines.push('');
  lines.push(`Members (${plan.members.length}):`);
  for (const member of plan.members) {
    lines.push(`  - ${member.name}${member.kind === 'real' ? ' (you)' : ' (ghost)'}`);
  }
  lines.push('');
  lines.push(`Expenses:    ${plan.expenseCount}`);
  lines.push(`Settlements: ${plan.settlementCount}`);
  lines.push(`Errors:      ${plan.errors.length}`);
  lines.push('');
  lines.push('Spend by category:');
  for (const [category, total] of Object.entries(plan.categoryTotals).sort((a, b) =>
    b[1] > a[1] ? 1 : b[1] < a[1] ? -1 : 0,
  )) {
    lines.push(`  ${category.padEnd(16)} ${money(total)}`);
  }
  lines.push('');
  lines.push('Final net per member (positive = owed money):');
  for (const [name, net] of Object.entries(plan.netByPerson)) {
    lines.push(`  ${name.padEnd(20)} ${money(net)}`);
  }
  if (plan.errors.length > 0) {
    lines.push('');
    lines.push('Rows that did NOT reconcile:');
    for (const problem of plan.errors) {
      lines.push(`  [row ${problem.row ?? '-'}] ${problem.kind}: ${problem.message}`);
    }
  }
  return lines.join('\n');
}
