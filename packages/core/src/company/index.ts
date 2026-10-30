export * from './tags';
export * from './phase4';
export * from './vendors';
export * from './workday';
export * from './moneyDates';
import { companyTagLabel, type CompanyTag } from './tags';
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

export type CompanyEntryKind =
  | 'expense'
  | 'advance'
  | 'allowance'
  | 'wages'
  | 'reimbursement'
  // Phase 4: manager pool movements (member = the manager) and a wage-run payment.
  | 'allocation'
  | 'pool_return'
  | 'pool_adjustment'
  | 'pool_request'
  | 'wage_payment';
export type CompanyEntryStatus = 'submitted' | 'approved' | 'rejected' | 'reimbursed';
export type CompanyCalcMode =
  'typed' | 'days_rate' | 'fixed_weekly' | 'fixed_monthly' | 'distance_rate';
export type CompanyDirection = 'company_to_employee' | 'employee_to_company';

export const COMPANY_ENTRY_KINDS: readonly CompanyEntryKind[] = [
  'expense',
  'allowance',
  'advance',
  'wages',
  'reimbursement',
];

/** Legacy builtin categories; custom format-valid keys are also accepted. */
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
  /** The employee; '' on a company-paid entry (no employee, never in any balance or statement). */
  readonly memberId: string;
  /** The company paid directly (materials, rent...): recorded by an owner or a manager, no employee. */
  readonly paidByCompany: boolean;
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
  /** The admin's note on an approval or rejection (a rejection always has one). */
  readonly reviewNote: string | null;
  /** Optional GST / vendor details (India, INR expenses only). */
  readonly vendor: string | null;
  readonly gstin: string | null;
  readonly invoiceNo: string | null;
  /** GST rate in basis points (1800 = 18%). */
  readonly gstRateBps: number | null;
  /** GST included in `amount`, minor units. */
  readonly gstAmount: bigint | null;
  /** Mileage: kilometres as typed ("12.5"); the rate is `rateMinor` per km. */
  readonly distanceKm: string | null;
  readonly fromText: string | null;
  readonly toText: string | null;
  /** The reimbursement entry that paid this entry (or, on a reimbursement, null). */
  readonly reimbursementId: string | null;
  /** True on a payment entry that covers claims (a bulk reimbursement): frozen, never a credit. */
  readonly coversClaims: boolean;
  /** Phase 4: the site this entry belongs to. */
  readonly projectId: string | null;
  /** Phase 4: the manager whose pool paid this (null = owners paid directly). */
  readonly fundingManagerId: string | null;
  /** Phase 4 wage_payment: gross = base + claims; recovery = advance taken back; amount = net. */
  readonly grossMinor: bigint | null;
  readonly claimsMinor: bigint | null;
  readonly recoveryMinor: bigint | null;
  readonly wageRunId: string | null;
  /** Phase 4 wage_payment: the days the payment covers (yyyy-mm-dd, inclusive). */
  readonly periodStart: string | null;
  readonly periodEnd: string | null;
  /** Row version: a review names the version it saw, so an edited entry cannot be approved blind. */
  readonly version: number;
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
  readonly member_id?: string | null;
  readonly paid_by_company?: boolean | null;
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
  readonly review_note?: string | null;
  readonly vendor?: string | null;
  readonly gstin?: string | null;
  readonly invoice_no?: string | null;
  readonly gst_rate_bps?: number | string | null;
  readonly gst_amount_minor?: string | number | null;
  readonly distance_km?: string | number | null;
  readonly from_text?: string | null;
  readonly to_text?: string | null;
  readonly reimbursement_id?: string | null;
  readonly reimbursement_details?: unknown;
  readonly project_id?: string | null;
  readonly funding_manager_id?: string | null;
  readonly gross_minor?: string | number | null;
  readonly claims_minor?: string | number | null;
  readonly recovery_minor?: string | number | null;
  readonly wage_run_id?: string | null;
  readonly period_start?: string | null;
  readonly period_end?: string | null;
  readonly version?: number | string | null;
  readonly created_at?: string | null;
  readonly created_by?: string | null;
  readonly deleted_at?: string | null;
  readonly pending?: boolean;
}

function optBig(v: string | number | null | undefined): bigint | null {
  return v === null || v === undefined ? null : BigInt(String(v));
}

export function companyEntryFromRow(row: CompanyEntryRow): CompanyEntry {
  return {
    id: row.id,
    groupId: row.group_id,
    memberId: row.member_id ?? '',
    paidByCompany: row.paid_by_company === true,
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
    reviewNote: row.review_note ?? null,
    vendor: row.vendor ?? null,
    gstin: row.gstin ?? null,
    invoiceNo: row.invoice_no ?? null,
    gstRateBps:
      row.gst_rate_bps === null || row.gst_rate_bps === undefined ? null : Number(row.gst_rate_bps),
    gstAmount:
      row.gst_amount_minor === null || row.gst_amount_minor === undefined
        ? null
        : BigInt(String(row.gst_amount_minor)),
    distanceKm:
      row.distance_km === null || row.distance_km === undefined ? null : String(row.distance_km),
    fromText: row.from_text ?? null,
    toText: row.to_text ?? null,
    reimbursementId: row.reimbursement_id ?? null,
    coversClaims: row.reimbursement_details !== null && row.reimbursement_details !== undefined,
    projectId: row.project_id ?? null,
    fundingManagerId: row.funding_manager_id ?? null,
    grossMinor: optBig(row.gross_minor),
    claimsMinor: optBig(row.claims_minor),
    recoveryMinor: optBig(row.recovery_minor),
    wageRunId: row.wage_run_id ?? null,
    periodStart: row.period_start ? String(row.period_start).slice(0, 10) : null,
    periodEnd: row.period_end ? String(row.period_end).slice(0, 10) : null,
    version: Number(row.version ?? 1),
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

// ───────────────────────────────────────────────────────────── mileage ──

/**
 * Typed numbers as the keyboard gives them: Arabic-Indic, Devanagari and Tamil
 * digits become 0-9, a comma becomes the point, anything else is dropped.
 */
export function normaliseDecimalInput(text: string): string {
  const bases = [0x0660, 0x06f0, 0x0966, 0x0be6];
  let out = '';
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    const base = bases.find((b) => code >= b && code <= b + 9);
    if (base !== undefined) out += String(code - base);
    else if (ch === ',' || ch === '\u066b' || ch === '\u066c') out += '.';
    else if ((ch >= '0' && ch <= '9') || ch === '.') out += ch;
  }
  return out;
}

/** Kilometres typed to at most two decimals, as hundredths; null when not a positive distance. */
export function parseDistance(text: string): bigint | null {
  const match = /^(\d{1,6})(?:\.(\d{1,2}))?$/.exec(text.trim());
  if (!match) return null;
  const hundredths =
    BigInt(match[1] ?? '0') * 100n + BigInt((match[2] ?? '').padEnd(2, '0') || '0');
  return hundredths > 0n ? hundredths : null;
}

/** km x rate per km, rounded once to the nearest minor unit, halves up (the bata rule). */
export function mileageAmount(distanceKm: string, rateMinor: bigint): bigint | null {
  const hundredths = parseDistance(distanceKm);
  if (hundredths === null || rateMinor < 0n) return null;
  return (hundredths * rateMinor + 50n) / 100n;
}

/** Entry rate, else the employee's, else the company's, else none. */
export function resolveMileageRate(
  entryRate: bigint | null,
  employeeRate: string | null | undefined,
  companyRate: string | null | undefined,
): bigint | null {
  if (entryRate !== null) return entryRate;
  if (employeeRate) return BigInt(employeeRate);
  return companyRate ? BigInt(companyRate) : null;
}

// ──────────────────────────────────────────────────────────── GST, vendor ──

const GST_STATE_CODES = new Set([
  ...Array.from({ length: 38 }, (_, i) => String(i + 1).padStart(2, '0')),
  '97',
  '99',
]);
const GSTIN_SHAPE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const BASE36 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** Upper-cased, trimmed; the form stored. */
export function normaliseGstin(text: string): string {
  return text.trim().toUpperCase();
}

/**
 * Format and checksum of a GSTIN: 2-digit state, PAN, entity digit, `Z`, check
 * character. It does not prove the number is registered.
 */
export function validateGstin(text: string): boolean {
  const value = normaliseGstin(text);
  if (!GSTIN_SHAPE.test(value) || !GST_STATE_CODES.has(value.slice(0, 2))) return false;
  let sum = 0;
  for (let i = 0; i < 14; i += 1) {
    const product = BASE36.indexOf(value[i] ?? '') * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(product / 36) + (product % 36);
  }
  return value[14] === BASE36[(36 - (sum % 36)) % 36];
}

/** The GST inside a GST-inclusive total at `rateBps`, rounded half up. */
export function gstFromInclusive(totalMinor: bigint, rateBps: number): bigint {
  const rate = BigInt(rateBps);
  return (2n * totalMinor * rate + (10000n + rate)) / (2n * (10000n + rate));
}

/** GST fields apply to India-based companies working in rupees. */
export function gstFieldsApply(country: string | null | undefined, currency: string): boolean {
  return currency === 'INR' && country === 'IN';
}

/** GST included in counted expenses in a period (each claim once, reimbursed ones too). */
export function companyGstTotal(
  entries: readonly CompanyEntry[],
  range: { readonly from: string; readonly to: string },
): bigint {
  let total = 0n;
  for (const entry of entries) {
    if (
      entry.kind === 'expense' &&
      counts(entry) &&
      entry.occurredOn >= range.from &&
      entry.occurredOn <= range.to
    )
      total += entry.gstAmount ?? 0n;
  }
  return total;
}

// ───────────────────────────────────────────────────────────── balance ──

function counts(entry: CompanyEntry): boolean {
  return !entry.deleted && (entry.status === 'approved' || entry.status === 'reimbursed');
}

/** The entry's effect on "company owes employee" (wages: none). */
export function entryDelta(entry: CompanyEntry): bigint {
  if (!counts(entry) || entry.paidByCompany) return 0n;
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
    // Pool movements belong to the manager's float, not an employee balance.
    case 'allocation':
    case 'pool_return':
    case 'pool_adjustment':
    case 'pool_request':
      return 0n;
    // Claims folded into the run are paid (-claims); advance taken back counts as returned (+recovery).
    case 'wage_payment':
      return (entry.recoveryMinor ?? 0n) - (entry.claimsMinor ?? 0n);
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
  /** GST included in counted expenses (entries that carry GST details). */
  readonly gst: bigint;
  /** Wage-run payments: gross, advance taken back, net paid. */
  readonly wageGross: bigint;
  readonly wageRecovery: bigint;
  readonly wageNet: bigint;
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
    byCategory: Object.create(null) as Record<string, bigint>,
    gst: 0n,
    wageGross: 0n,
    wageRecovery: 0n,
    wageNet: 0n,
  };
}

function addToTotals(totals: MutableTotals, entry: CompanyEntry): void {
  switch (entry.kind) {
    case 'expense':
      totals.expenses += entry.amount;
      totals.gst += entry.gstAmount ?? 0n;
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
    case 'wage_payment':
      totals.wages += (entry.grossMinor ?? entry.amount) - (entry.claimsMinor ?? 0n);
      totals.wageGross += entry.grossMinor ?? entry.amount;
      totals.wageRecovery += entry.recoveryMinor ?? 0n;
      totals.wageNet += entry.amount;
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
  const ids = options.memberIds ?? [
    ...new Set(entries.filter((entry) => !entry.paidByCompany).map((entry) => entry.memberId)),
  ];
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
    totals.gst += t.gst;
    totals.wageGross += t.wageGross;
    totals.wageRecovery += t.wageRecovery;
    totals.wageNet += t.wageNet;
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
  allocation: 'Allocation',
  pool_return: 'Pool return',
  pool_adjustment: 'Pool adjustment',
  pool_request: 'Budget request',
  wage_payment: 'Wages paid',
};

/**
 * A plain-text statement for the system share sheet (the way the family
 * statement is shared). English: it is a document for the employer, not UI.
 */
export function formatCompanyStatement(
  statement: CompanyStatement,
  options: {
    readonly tags?: readonly CompanyTag[];
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
          ? `${KIND_LABEL.expense} (${companyTagLabel(entry.category, options.tags ?? [])})`
          : entry.kind === 'reimbursement' && entry.direction === 'employee_to_company'
            ? 'Cash returned'
            : KIND_LABEL[entry.kind];
      const calc =
        entry.calcMode === 'days_rate' && entry.days
          ? ` [${entry.days} d]`
          : entry.calcMode === 'distance_rate' && entry.distanceKm
            ? ` [${entry.distanceKm} km${entry.fromText || entry.toText ? `, ${entry.fromText ?? ''} - ${entry.toText ?? ''}` : ''}]`
            : '';
      const note = entry.note ? ` - ${entry.note}` : '';
      const vendor = entry.vendor ? ` ${entry.vendor}` : '';
      const wageRun =
        entry.kind === 'wage_payment'
          ? ` [gross ${money(entry.grossMinor ?? entry.amount)}, advance taken back ${money(entry.recoveryMinor ?? 0n)}, net ${money(entry.amount)}]`
          : '';
      return `${entry.occurredOn}  ${what}${vendor}${calc}${wageRun}  ${money(entry.kind === 'wages' || entry.kind === 'wage_payment' ? entry.amount : delta)}${note}  (balance ${money(running)})`;
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

// ─────────────────────────────────────────────────────────────── policies ──

export type CompanyPolicyEffect = 'warn' | 'block';

/** `receipt_above` is a warning only; `period_limit` may block (the admin's choice). */
export type CompanyPolicyRule =
  | {
      readonly id: string;
      readonly type: 'receipt_above';
      readonly limitMinor: string;
      readonly effect: 'warn';
    }
  | {
      readonly id: string;
      readonly type: 'period_limit';
      /** An expense category, or `allowance` for bata. */
      readonly target: string;
      readonly period: 'day' | 'month';
      readonly limitMinor: string;
      readonly effect: CompanyPolicyEffect;
    };

export interface CompanyPolicies {
  readonly version: 1;
  readonly rules: readonly CompanyPolicyRule[];
}

export const EMPTY_COMPANY_POLICIES: CompanyPolicies = { version: 1, rules: [] };

export function parseCompanyPolicies(raw: unknown): CompanyPolicies {
  if (!raw || typeof raw !== 'object') return EMPTY_COMPANY_POLICIES;
  const rules = (raw as { rules?: unknown }).rules;
  if (!Array.isArray(rules)) return EMPTY_COMPANY_POLICIES;
  return {
    version: 1,
    rules: rules.filter(
      (r): r is CompanyPolicyRule => !!r && typeof r === 'object' && typeof r.id === 'string',
    ),
  };
}

export interface PolicyFlag {
  readonly ruleId: string;
  readonly code: 'RECEIPT' | 'PERIOD_LIMIT';
  readonly effect: CompanyPolicyEffect;
  readonly limitMinor: bigint;
  /** The total the rule saw (period limits) or the entry amount (receipts). */
  readonly actualMinor: bigint;
  readonly target?: string;
  readonly period?: 'day' | 'month';
}

export interface PolicySubject {
  /** Set when editing, so the entry does not count against itself. */
  readonly id?: string;
  readonly memberId: string;
  readonly kind: CompanyEntryKind;
  readonly category: string | null;
  readonly amount: bigint;
  readonly occurredOn: string;
}

function policyTarget(subject: { kind: CompanyEntryKind; category: string | null }): string | null {
  if (subject.kind === 'allowance') return 'allowance';
  return subject.kind === 'expense' ? (subject.category ?? 'other') : null;
}

function inPeriod(a: string, b: string, period: 'day' | 'month'): boolean {
  return period === 'day' ? a === b : a.slice(0, 7) === b.slice(0, 7);
}

/**
 * Which rules an entry crosses. Per employee, by the entry's own date; submitted,
 * approved and reimbursed claims count (rejected and voided do not), the entry
 * being edited does not count twice, and only going over a limit flags. Same
 * rule the server applies to `block` effects.
 */
export function evaluateCompanyPolicies(
  subject: PolicySubject,
  entries: readonly CompanyEntry[],
  policies: CompanyPolicies,
  options: { readonly hasReceipt: boolean },
): PolicyFlag[] {
  const flags: PolicyFlag[] = [];
  const target = policyTarget(subject);
  for (const rule of policies.rules) {
    if (rule.type === 'receipt_above') {
      const limit = BigInt(rule.limitMinor);
      if (subject.kind === 'expense' && subject.amount > limit && !options.hasReceipt)
        flags.push({
          ruleId: rule.id,
          code: 'RECEIPT',
          effect: 'warn',
          limitMinor: limit,
          actualMinor: subject.amount,
        });
    } else if (target !== null && rule.target === target) {
      const limit = BigInt(rule.limitMinor);
      let actual = subject.amount;
      for (const other of entries) {
        if (
          other.id !== subject.id &&
          !other.deleted &&
          other.status !== 'rejected' &&
          other.memberId === subject.memberId &&
          policyTarget(other) === target &&
          inPeriod(other.occurredOn, subject.occurredOn, rule.period)
        )
          actual += other.amount;
      }
      if (actual > limit)
        flags.push({
          ruleId: rule.id,
          code: 'PERIOD_LIMIT',
          effect: rule.effect,
          limitMinor: limit,
          actualMinor: actual,
          target: rule.target,
          period: rule.period,
        });
    }
  }
  return flags;
}

/** Flags on an existing entry, for the admin's list (the entry excludes itself). */
export function flagsForEntry(
  entry: CompanyEntry,
  entries: readonly CompanyEntry[],
  policies: CompanyPolicies,
  receiptEntryIds: ReadonlySet<string>,
): PolicyFlag[] {
  if (
    entry.deleted ||
    entry.status === 'rejected' ||
    (entry.kind !== 'expense' && entry.kind !== 'allowance')
  )
    return [];
  return evaluateCompanyPolicies(entry, entries, policies, {
    hasReceipt: receiptEntryIds.has(entry.id),
  });
}

/** A likely double entry: same employee, day, amount and category (or vendor + invoice). */
export function findDuplicateEntry(
  subject: PolicySubject & { readonly vendor?: string | null; readonly invoiceNo?: string | null },
  entries: readonly CompanyEntry[],
): CompanyEntry | null {
  return (
    entries.find(
      (e) =>
        e.id !== subject.id &&
        !e.deleted &&
        e.status !== 'rejected' &&
        e.memberId === subject.memberId &&
        e.kind === subject.kind &&
        ((e.occurredOn === subject.occurredOn &&
          e.amount === subject.amount &&
          e.category === subject.category) ||
          (!!subject.invoiceNo &&
            !!subject.vendor &&
            e.invoiceNo?.toLowerCase() === subject.invoiceNo.toLowerCase() &&
            e.vendor?.toLowerCase() === subject.vendor.toLowerCase())),
    ) ?? null
  );
}

// ───────────────────────────────────────────────────── bulk reimbursement ──

/** Claims that can be paid in bulk: approved expenses and bata not yet linked to a payment. */
export function isReimbursable(entry: CompanyEntry): boolean {
  return (
    !entry.deleted &&
    !entry.paidByCompany &&
    entry.status === 'approved' &&
    entry.reimbursementId === null &&
    (entry.kind === 'expense' || entry.kind === 'allowance')
  );
}

export interface ReimbursementPreview {
  readonly claims: readonly CompanyEntry[];
  /** Unlinked advances, earlier payouts and cash returns up to the cutoff, netted in. */
  readonly adjustments: readonly CompanyEntry[];
  readonly cutoff: string;
  readonly claimsMinor: bigint;
  /** Advances + earlier payouts - cash returned. */
  readonly creditsMinor: bigint;
  /** claims - credits; negative means the selection does not cover what the employee already got. */
  readonly payoutMinor: bigint;
}

/**
 * One employee's selection, or every claim due through `through`, plus the
 * unlinked advances and payouts up to the same date, so a payment never repeats
 * money already handed over. The list is frozen into the mutation.
 */
export function buildReimbursementPreview(
  entries: readonly CompanyEntry[],
  options: {
    readonly memberId: string;
    readonly ids?: readonly string[];
    readonly through?: string;
  },
): ReimbursementPreview {
  const mine = entries.filter((e) => e.memberId === options.memberId && !e.deleted);
  const picked = new Set(options.ids ?? []);
  const claims = mine
    .filter(isReimbursable)
    .filter((e) => (options.ids ? picked.has(e.id) : e.occurredOn <= (options.through ?? '')))
    .sort(byDate);
  const cutoff =
    options.ids === undefined || options.through !== undefined
      ? (options.through ?? '')
      : claims.reduce((max, e) => (e.occurredOn > max ? e.occurredOn : max), '');
  const adjustments = mine
    .filter(
      (e) =>
        e.status === 'approved' &&
        e.reimbursementId === null &&
        !e.coversClaims &&
        (e.kind === 'advance' || e.kind === 'reimbursement') &&
        e.occurredOn <= cutoff,
    )
    .sort(byDate);
  const claimsMinor = claims.reduce((sum, e) => sum + e.amount, 0n);
  // entryDelta of an adjustment is its effect on "company owes"; credits are the opposite.
  // Advance already taken back through wage runs is not a credit any more (the server nets it too).
  const recovered = mine
    .filter(
      (e) =>
        e.kind === 'wage_payment' &&
        e.reimbursementId === null &&
        (e.periodEnd ?? e.occurredOn) <= cutoff,
    )
    .reduce((sum, e) => sum + (e.recoveryMinor ?? 0n), 0n);
  const creditsMinor = adjustments.reduce((sum, e) => sum - entryDelta(e), 0n) - recovered;
  return {
    claims,
    adjustments,
    cutoff,
    claimsMinor,
    creditsMinor,
    payoutMinor: claimsMinor - creditsMinor,
  };
}

/** The date a claim was paid, from the reimbursement that covers it. */
export function reimbursedOn(entry: CompanyEntry, entries: readonly CompanyEntry[]): string | null {
  if (!entry.reimbursementId) return null;
  return entries.find((e) => e.id === entry.reimbursementId)?.occurredOn ?? null;
}

export interface ReimbursementOutcome {
  /** Selected claims this payment covered. */
  readonly paid: number;
  /** Selected claims someone else already paid, by who recorded that payment (null: unknown). */
  readonly alreadyPaid: readonly { readonly by: string | null; readonly count: number }[];
}

/**
 * What a bulk payment did once the server settled it: the server pays whatever of
 * the selection is still due, so claims another admin paid first just show as
 * theirs. Null while the payment is still queued on this phone.
 */
export function reimbursementOutcome(
  entries: readonly CompanyEntry[],
  pay: { readonly reimbursementId: string; readonly claimIds: readonly string[] },
): ReimbursementOutcome | null {
  const byId = new Map(entries.map((e) => [e.id, e]));
  if (byId.get(pay.reimbursementId)?.pending) return null;
  const by = new Map<string | null, number>();
  let paid = 0;
  for (const id of pay.claimIds) {
    const claim = byId.get(id);
    if (!claim) continue;
    if (claim.reimbursementId === pay.reimbursementId) paid += 1;
    else if (claim.reimbursementId) {
      const payer = byId.get(claim.reimbursementId)?.createdBy ?? null;
      by.set(payer, (by.get(payer) ?? 0) + 1);
    }
  }
  return { paid, alreadyPaid: [...by].map(([who, count]) => ({ by: who, count })) };
}

/** An employee ID as typed: trimmed, blank means none, at most 32 characters (null if too long). */
export const EMPLOYEE_ID_MAX = 32;
export function normaliseEmployeeId(raw: string | null | undefined): string | null {
  const v = (raw ?? '').trim();
  return v === '' ? null : v.slice(0, EMPLOYEE_ID_MAX);
}

/**
 * Is this ID already someone else's among the people still in the company? Case-insensitive,
 * like the server's unique index. A phone only sees the people it may read; the server check
 * (waves_company_employee_id_taken) covers the rest.
 */
export function employeeIdTaken(
  members: readonly {
    readonly id: string;
    readonly employee_id?: string | null;
    readonly left_at?: string | null;
  }[],
  raw: string | null | undefined,
  exceptMemberId?: string | null,
): boolean {
  const id = normaliseEmployeeId(raw)?.toLowerCase();
  if (!id) return false;
  return members.some(
    (m) => m.id !== exceptMemberId && !m.left_at && m.employee_id?.trim().toLowerCase() === id,
  );
}
export * from './documents';
