/**
 * Company expenses (Phase 1): an employer records what each employee spent,
 * was advanced, earned as bata and was paid in wages. No splitting — every entry
 * belongs to one employee and the company.
 *
 * Money rules, all in minor units (bigint), no floats:
 *   net due (positive: company owes employee) =
 *       expenses + allowance (bata) − advances − payouts + cash returned
 *   wages paid are recorded for totals but never move that balance.
 * Only approved / reimbursed entries count; submitted and rejected ones are
 * listed apart. Voided (deleted) entries are ignored.
 *
 * The statement and summary are computed from the rows the viewer can read —
 * the server's row-level security gives an employee only their own — so the same
 * math is correct for both without a second privacy layer here.
 */

export type CompanyEntryKind = 'expense' | 'advance' | 'allowance' | 'wages' | 'reimbursement';
export type CompanyEntryStatus = 'submitted' | 'approved' | 'rejected' | 'reimbursed';
export type CompanyCalcMode = 'typed' | 'days_rate' | 'fixed_weekly';
export type CompanyDirection = 'company_to_employee' | 'employee_to_company';

export const COMPANY_ENTRY_KINDS: readonly CompanyEntryKind[] = [
  'expense',
  'allowance',
  'advance',
  'wages',
  'reimbursement',
];

/** Categories offered for an expense; free-text is not allowed so totals group cleanly. */
export const COMPANY_EXPENSE_CATEGORIES = [
  'fuel',
  'transport',
  'travel',
  'food',
  'office',
  'other',
] as const;
export type CompanyExpenseCategory = (typeof COMPANY_EXPENSE_CATEGORIES)[number];

/** What an employee may enter for themselves; the rest are the company's records. */
export const EMPLOYEE_ENTRY_KINDS: readonly CompanyEntryKind[] = ['expense', 'allowance'];

/** One entry as the app reads it (the `company_entries` row, camel-cased). */
export interface CompanyEntry {
  readonly id: string;
  readonly groupId: string;
  readonly memberId: string;
  readonly kind: CompanyEntryKind;
  readonly category: string | null;
  readonly amount: bigint;
  readonly currency: string;
  readonly calcMode: CompanyCalcMode;
  readonly days: string | null;
  readonly rateMinor: bigint | null;
  /** yyyy-mm-dd */
  readonly occurredOn: string;
  readonly direction: CompanyDirection | null;
  readonly status: CompanyEntryStatus;
  readonly note: string | null;
  readonly createdAt: string;
  /** The member who recorded it (an employee may only withdraw their own). */
  readonly createdBy: string | null;
  readonly deleted: boolean;
  /** Queued on this phone and not yet confirmed by the server. */
  readonly pending?: boolean;
}

/** The server row, snake_case, as the sync pull delivers it. */
export interface CompanyEntryRow {
  readonly id: string;
  readonly group_id: string;
  readonly member_id: string;
  readonly entry_kind: string;
  readonly category?: string | null;
  readonly amount: string | number;
  readonly currency: string;
  readonly calc_mode?: string | null;
  readonly days?: string | number | null;
  readonly rate_minor?: string | number | null;
  readonly occurred_on: string;
  readonly direction?: string | null;
  readonly status?: string | null;
  readonly note?: string | null;
  readonly created_at?: string | null;
  readonly created_by?: string | null;
  readonly deleted_at?: string | null;
  readonly pending?: boolean;
}

export function companyEntryFromRow(row: CompanyEntryRow): CompanyEntry {
  return {
    id: row.id,
    groupId: row.group_id,
    memberId: row.member_id,
    kind: row.entry_kind as CompanyEntryKind,
    category: row.category ?? null,
    amount: BigInt(String(row.amount)),
    currency: row.currency,
    calcMode: (row.calc_mode as CompanyCalcMode | null | undefined) ?? 'typed',
    days: row.days === null || row.days === undefined ? null : String(row.days),
    rateMinor:
      row.rate_minor === null || row.rate_minor === undefined
        ? null
        : BigInt(String(row.rate_minor)),
    occurredOn: String(row.occurred_on).slice(0, 10),
    direction: (row.direction as CompanyDirection | null | undefined) ?? null,
    status: (row.status as CompanyEntryStatus | null | undefined) ?? 'approved',
    note: row.note ?? null,
    createdAt: row.created_at ?? '',
    createdBy: row.created_by ?? null,
    deleted: row.deleted_at !== null && row.deleted_at !== undefined,
    ...(row.pending ? { pending: true } : {}),
  };
}

// ────────────────────────────────────────────────────────── bata maths ──

/** Days are typed to at most two decimals ("2", "2.5", "0.25"); null when not. */
export function parseDays(text: string): bigint | null {
  const match = /^(\d{1,4})(?:\.(\d{1,2}))?$/.exec(text.trim());
  if (!match) return null;
  const hundredths =
    BigInt(match[1] ?? '0') * 100n + BigInt((match[2] ?? '').padEnd(2, '0') || '0');
  return hundredths > 0n ? hundredths : null;
}

/**
 * days × daily rate, rounded once to the nearest minor unit, halves up. The
 * server applies the same rule; the client uses it for the preview and the
 * offline overlay. Null when the days are not a valid count.
 */
export function allowanceAmount(days: string, rateMinor: bigint): bigint | null {
  const hundredths = parseDays(days);
  if (hundredths === null || rateMinor < 0n) return null;
  return (hundredths * rateMinor + 50n) / 100n;
}

// ───────────────────────────────────────────────────────────── balance ──

function counts(entry: CompanyEntry): boolean {
  return !entry.deleted && (entry.status === 'approved' || entry.status === 'reimbursed');
}

/** The entry's effect on "company owes employee" (wages: none). */
export function entryDelta(entry: CompanyEntry): bigint {
  if (!counts(entry)) return 0n;
  switch (entry.kind) {
    case 'expense':
    case 'allowance':
      return entry.amount;
    case 'advance':
      return -entry.amount;
    case 'reimbursement':
      return entry.direction === 'employee_to_company' ? entry.amount : -entry.amount;
    case 'wages':
      return 0n;
  }
}

export type NetSide = 'company_owes' | 'employee_owes' | 'settled';

export function netSide(net: bigint): NetSide {
  return net > 0n ? 'company_owes' : net < 0n ? 'employee_owes' : 'settled';
}

export interface CompanyStatementRow {
  readonly entry: CompanyEntry;
  readonly delta: bigint;
  /** Running net after this row, including the opening balance. */
  readonly running: bigint;
}

export interface CompanyStatementTotals {
  readonly expenses: bigint;
  readonly allowance: bigint;
  readonly allowanceDays: bigint; // hundredths of a day
  readonly advances: bigint;
  readonly wages: bigint;
  /** Company paid the employee (reimbursement). */
  readonly paidOut: bigint;
  /** Employee returned cash to the company. */
  readonly returned: bigint;
  readonly byCategory: Record<string, bigint>;
}

export interface CompanyStatement {
  readonly memberId: string;
  readonly from: string;
  readonly to: string;
  /** Net before `from`. */
  readonly opening: bigint;
  readonly rows: readonly CompanyStatementRow[];
  readonly totals: CompanyStatementTotals;
  readonly closing: bigint;
  readonly side: NetSide;
  /** Submitted or rejected claims in the range: shown, not counted. */
  readonly pending: readonly CompanyEntry[];
}

function byDate(a: CompanyEntry, b: CompanyEntry): number {
  return a.occurredOn === b.occurredOn
    ? a.createdAt === b.createdAt
      ? a.id.localeCompare(b.id)
      : a.createdAt.localeCompare(b.createdAt)
    : a.occurredOn.localeCompare(b.occurredOn);
}

type MutableTotals = { -readonly [K in keyof CompanyStatementTotals]: CompanyStatementTotals[K] };

function emptyTotals(): MutableTotals {
  return {
    expenses: 0n,
    allowance: 0n,
    allowanceDays: 0n,
    advances: 0n,
    wages: 0n,
    paidOut: 0n,
    returned: 0n,
    byCategory: {},
  };
}

function addToTotals(totals: MutableTotals, entry: CompanyEntry): void {
  switch (entry.kind) {
    case 'expense':
      totals.expenses += entry.amount;
      {
        const key = entry.category ?? 'other';
        totals.byCategory[key] = (totals.byCategory[key] ?? 0n) + entry.amount;
      }
      break;
    case 'allowance':
      totals.allowance += entry.amount;
      totals.allowanceDays += entry.days ? (parseDays(entry.days) ?? 0n) : 0n;
      break;
    case 'advance':
      totals.advances += entry.amount;
      break;
    case 'wages':
      totals.wages += entry.amount;
      break;
    case 'reimbursement':
      if (entry.direction === 'employee_to_company') totals.returned += entry.amount;
      else totals.paidOut += entry.amount;
      break;
  }
}

/**
 * One employee's statement for an inclusive date range. Entries of other
 * employees (an admin passes the whole company's rows) are ignored.
 */
export function companyStatement(
  entries: readonly CompanyEntry[],
  options: { readonly memberId: string; readonly from: string; readonly to: string },
): CompanyStatement {
  const mine = entries
    .filter((entry) => entry.memberId === options.memberId && !entry.deleted)
    .sort(byDate);

  let opening = 0n;
  const inRange: CompanyEntry[] = [];
  for (const entry of mine) {
    if (entry.occurredOn < options.from) opening += entryDelta(entry);
    else if (entry.occurredOn <= options.to) inRange.push(entry);
  }

  const totals = emptyTotals();
  const rows: CompanyStatementRow[] = [];
  const pending: CompanyEntry[] = [];
  let running = opening;
  for (const entry of inRange) {
    if (!counts(entry)) {
      if (entry.status === 'submitted' || entry.status === 'rejected') pending.push(entry);
      continue;
    }
    const delta = entryDelta(entry);
    running += delta;
    addToTotals(totals, entry);
    rows.push({ entry, delta, running });
  }

  return {
    memberId: options.memberId,
    from: options.from,
    to: options.to,
    opening,
    rows,
    totals,
    closing: running,
    side: netSide(running),
    pending,
  };
}

export interface CompanySummaryRow {
  readonly memberId: string;
  readonly statement: CompanyStatement;
}

export interface CompanySummary {
  readonly rows: readonly CompanySummaryRow[];
  /** Sum of what the company owes employees (gross; never netted against the opposite). */
  readonly companyOwes: bigint;
  /** Sum of what employees owe the company. */
  readonly employeesOwe: bigint;
  readonly totals: CompanyStatementTotals;
}

/** Per-employee statements plus gross totals for a period (admin view). */
export function companySummary(
  entries: readonly CompanyEntry[],
  options: { readonly memberIds?: readonly string[]; readonly from: string; readonly to: string },
): CompanySummary {
  const ids = options.memberIds ?? [...new Set(entries.map((entry) => entry.memberId))];
  const rows: CompanySummaryRow[] = ids
    .map((memberId) => ({
      memberId,
      statement: companyStatement(entries, { memberId, from: options.from, to: options.to }),
    }))
    .filter(
      ({ statement }) =>
        statement.rows.length > 0 || statement.pending.length > 0 || statement.opening !== 0n,
    );

  let companyOwes = 0n;
  let employeesOwe = 0n;
  const totals = emptyTotals();
  for (const { statement } of rows) {
    if (statement.closing > 0n) companyOwes += statement.closing;
    else employeesOwe -= statement.closing;
    const t = statement.totals;
    totals.expenses += t.expenses;
    totals.allowance += t.allowance;
    totals.allowanceDays += t.allowanceDays;
    totals.advances += t.advances;
    totals.wages += t.wages;
    totals.paidOut += t.paidOut;
    totals.returned += t.returned;
    for (const [key, value] of Object.entries(t.byCategory)) {
      totals.byCategory[key] = (totals.byCategory[key] ?? 0n) + value;
    }
  }
  return { rows, companyOwes, employeesOwe, totals };
}

// ─────────────────────────────────────────────────────────── share text ──

const KIND_LABEL: Record<CompanyEntryKind, string> = {
  expense: 'Expense',
  allowance: 'Bata',
  advance: 'Advance',
  wages: 'Wages paid',
  reimbursement: 'Reimbursement',
};

/**
 * A plain-text statement for the system share sheet (the way the family
 * statement is shared). English: it is a document for the employer, not UI.
 */
export function formatCompanyStatement(
  statement: CompanyStatement,
  options: {
    readonly company: string;
    readonly employee: string;
    readonly money: (minor: bigint) => string;
  },
): string {
  const { money } = options;
  const lines = [
    `${options.company} - statement for ${options.employee}`,
    `${statement.from} to ${statement.to}`,
    '',
    `Opening balance: ${money(statement.opening)}`,
    ...statement.rows.map(({ entry, delta, running }) => {
      const what =
        entry.kind === 'expense' && entry.category
          ? `${KIND_LABEL.expense} (${entry.category})`
          : entry.kind === 'reimbursement' && entry.direction === 'employee_to_company'
            ? 'Cash returned'
            : KIND_LABEL[entry.kind];
      const calc = entry.calcMode === 'days_rate' && entry.days ? ` [${entry.days} d]` : '';
      const note = entry.note ? ` - ${entry.note}` : '';
      return `${entry.occurredOn}  ${what}${calc}  ${money(entry.kind === 'wages' ? entry.amount : delta)}${note}  (balance ${money(running)})`;
    }),
    '',
    `Expenses: ${money(statement.totals.expenses)}`,
    `Bata: ${money(statement.totals.allowance)}`,
    `Advances: ${money(statement.totals.advances)}`,
    `Wages paid: ${money(statement.totals.wages)}`,
    `Paid out: ${money(statement.totals.paidOut)}`,
    `Cash returned: ${money(statement.totals.returned)}`,
    '',
    statement.side === 'company_owes'
      ? `Company owes ${options.employee}: ${money(statement.closing)}`
      : statement.side === 'employee_owes'
        ? `${options.employee} owes the company: ${money(-statement.closing)}`
        : 'Settled',
  ];
  return lines.join('\n');
}
