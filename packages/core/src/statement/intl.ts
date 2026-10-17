/**
 * Bank exports from the United States, the United Kingdom and Australia, read
 * without a model.
 *
 * Three things differ from the Indian layouts and each is handled here rather
 * than guessed at:
 *
 *   1. **Day and month order.** US exports are MM/DD/YYYY; UK and Australian
 *      ones are DD/MM/YYYY. A profile that knows its bank fixes the order. A
 *      layout that does not (a generic file) is decided from the file's own
 *      dates (a day above 12, a run in date order) and, failing that, flagged
 *      `dateAmbiguous` so the app asks instead of choosing silently.
 *   2. **How the amount is written.** One signed column (Chase, Barclays, Monzo),
 *      separate debit and credit columns (Lloyds, Westpac, Citi), or an amount
 *      plus a Debit/Credit word (Capital One bank). A trailing CR or DR wins over
 *      the sign when it is there.
 *   3. **No header row.** Some exports (Commonwealth Bank, ANZ, HSBC UK, Wells
 *      Fargo) are bare data. Those are recognised by the shape of their first
 *      rows, and said to be a "similar layout" in the result because the shape is
 *      all there is to go on.
 *
 * Like the Indian profiles, these were written from the banks' published formats
 * and synthetic fixtures, not live exports; the balance check is what catches a
 * column that is not what it seems.
 */

import { parseLooseAmount } from '../import/amount';
import { resolveDates, type ImportDateOrder } from '../import/date';
import { squashHeader } from '../import/layout';
import type { TableRead } from '../import/table';
import { applyBalanceCheck } from './balance';
import { referenceFor } from './narration';
import type { TableParseOptions, TableParseResult } from './profiles';
import type { StatementRow } from './types';

export type IntlProfileId =
  | 'chase_checking'
  | 'chase_card'
  | 'bofa'
  | 'citi'
  | 'capone_card'
  | 'capone_bank'
  | 'wells_fargo'
  | 'barclays'
  | 'hsbc_uk'
  | 'lloyds'
  | 'natwest'
  | 'monzo'
  | 'starling'
  | 'revolut'
  | 'commbank'
  | 'westpac'
  | 'anz'
  | 'nab'
  | 'emirates_nbd'
  | 'adcb'
  | 'fab'
  | 'mashreq'
  | 'dib';

export type StatementCurrency = 'USD' | 'GBP' | 'AUD' | 'AED' | 'INR';

interface IntlColumns {
  readonly date: readonly string[];
  /** Joined with a space, in order. */
  readonly description: readonly string[];
  readonly amount?: readonly string[];
  readonly debit?: readonly string[];
  readonly credit?: readonly string[];
  /** A Debit/Credit word beside an unsigned amount. */
  readonly kind?: readonly string[];
  readonly balance?: readonly string[];
  readonly ref?: readonly string[];
  readonly fee?: readonly string[];
  readonly state?: readonly string[];
  readonly currency?: readonly string[];
}

export interface IntlProfile {
  readonly id: IntlProfileId;
  readonly bank: string;
  readonly country: 'US' | 'GB' | 'AU' | 'AE';
  readonly currency: StatementCurrency;
  readonly order: ImportDateOrder;
  /** Squashed header names that must all be present. */
  readonly required: readonly string[];
  readonly columns: IntlColumns;
}

export const INTL_PROFILES: readonly IntlProfile[] = [
  {
    id: 'chase_checking',
    bank: 'Chase',
    country: 'US',
    currency: 'USD',
    order: 'mdy',
    required: ['details', 'postingdate', 'description', 'amount', 'type'],
    columns: {
      date: ['postingdate'],
      description: ['description'],
      amount: ['amount'],
      balance: ['balance'],
      ref: ['checkorslip'],
    },
  },
  {
    id: 'chase_card',
    bank: 'Chase',
    country: 'US',
    currency: 'USD',
    order: 'mdy',
    required: ['transactiondate', 'postdate', 'description', 'category', 'type', 'amount'],
    columns: { date: ['transactiondate'], description: ['description'], amount: ['amount'] },
  },
  {
    id: 'bofa',
    bank: 'Bank of America',
    country: 'US',
    currency: 'USD',
    order: 'mdy',
    required: ['date', 'description', 'amount', 'runningbal'],
    columns: {
      date: ['date'],
      description: ['description'],
      amount: ['amount'],
      balance: ['runningbal'],
    },
  },
  {
    id: 'capone_card',
    bank: 'Capital One',
    country: 'US',
    currency: 'USD',
    order: 'mdy',
    required: [
      'transactiondate',
      'posteddate',
      'cardno',
      'description',
      'category',
      'debit',
      'credit',
    ],
    columns: {
      date: ['transactiondate'],
      description: ['description'],
      debit: ['debit'],
      credit: ['credit'],
    },
  },
  {
    id: 'capone_bank',
    bank: 'Capital One',
    country: 'US',
    currency: 'USD',
    order: 'mdy',
    required: [
      'accountnumber',
      'transactiondescription',
      'transactiondate',
      'transactiontype',
      'transactionamount',
      'balance',
    ],
    columns: {
      date: ['transactiondate'],
      description: ['transactiondescription'],
      amount: ['transactionamount'],
      kind: ['transactiontype'],
      balance: ['balance'],
    },
  },
  {
    id: 'citi',
    bank: 'Citi',
    country: 'US',
    currency: 'USD',
    order: 'mdy',
    required: ['date', 'description', 'debit', 'credit'],
    columns: {
      date: ['date'],
      description: ['description'],
      debit: ['debit'],
      credit: ['credit'],
    },
  },
  {
    id: 'barclays',
    bank: 'Barclays',
    country: 'GB',
    currency: 'GBP',
    order: 'dmy',
    required: ['number', 'date', 'account', 'amount', 'subcategory', 'memo'],
    columns: { date: ['date'], description: ['memo'], amount: ['amount'] },
  },
  {
    id: 'lloyds',
    bank: 'Lloyds / Halifax',
    country: 'GB',
    currency: 'GBP',
    order: 'dmy',
    required: [
      'transactiondate',
      'transactiontype',
      'sortcode',
      'accountnumber',
      'transactiondescription',
      'debitamount',
      'creditamount',
      'balance',
    ],
    columns: {
      date: ['transactiondate'],
      description: ['transactiondescription'],
      debit: ['debitamount'],
      credit: ['creditamount'],
      balance: ['balance'],
    },
  },
  {
    id: 'natwest',
    bank: 'NatWest',
    country: 'GB',
    currency: 'GBP',
    order: 'dmy',
    required: ['date', 'type', 'description', 'value', 'balance', 'accountname', 'accountnumber'],
    columns: {
      date: ['date'],
      description: ['description'],
      amount: ['value'],
      balance: ['balance'],
    },
  },
  {
    id: 'monzo',
    bank: 'Monzo',
    country: 'GB',
    currency: 'GBP',
    order: 'dmy',
    required: ['transactionid', 'date', 'time', 'type', 'name', 'amount', 'currency'],
    columns: {
      date: ['date'],
      description: ['name', 'description'],
      amount: ['amount'],
      ref: ['transactionid'],
      currency: ['currency'],
    },
  },
  {
    id: 'starling',
    bank: 'Starling',
    country: 'GB',
    currency: 'GBP',
    order: 'dmy',
    required: ['date', 'counterparty', 'reference', 'type', 'amountgbp', 'balancegbp'],
    columns: {
      date: ['date'],
      description: ['counterparty', 'reference'],
      amount: ['amountgbp'],
      balance: ['balancegbp'],
    },
  },
  {
    id: 'revolut',
    bank: 'Revolut',
    country: 'GB',
    currency: 'GBP',
    order: 'dmy',
    required: [
      'type',
      'product',
      'starteddate',
      'completeddate',
      'description',
      'amount',
      'fee',
      'currency',
      'state',
      'balance',
    ],
    columns: {
      date: ['completeddate'],
      description: ['description'],
      amount: ['amount'],
      fee: ['fee'],
      balance: ['balance'],
      state: ['state'],
      currency: ['currency'],
    },
  },
  {
    id: 'westpac',
    bank: 'Westpac',
    country: 'AU',
    currency: 'AUD',
    order: 'dmy',
    required: ['bankaccount', 'date', 'narrative', 'debitamount', 'creditamount'],
    columns: {
      date: ['date'],
      description: ['narrative'],
      debit: ['debitamount'],
      credit: ['creditamount'],
      ref: ['serial'],
    },
  },
  {
    id: 'nab',
    bank: 'NAB',
    country: 'AU',
    currency: 'AUD',
    order: 'dmy',
    required: [
      'date',
      'amount',
      'accountnumber',
      'transactiontype',
      'transactiondetails',
      'balance',
    ],
    columns: {
      date: ['date'],
      description: ['transactiondetails'],
      amount: ['amount'],
      balance: ['balance'],
    },
  },
  {
    id: 'emirates_nbd',
    bank: 'Emirates NBD',
    country: 'AE',
    currency: 'AED',
    order: 'dmy',
    required: [
      'date|التاريخ',
      'narration|البيان',
      'chequeno|رقمالشيك',
      'debit|مدين',
      'credit|دائن',
      'balance|الرصيد',
    ],
    columns: {
      date: ['date|التاريخ'],
      description: ['narration|البيان'],
      debit: ['debit|مدين'],
      credit: ['credit|دائن'],
      balance: ['balance|الرصيد'],
      ref: ['chequeno|رقمالشيك'],
    },
  },
  {
    id: 'adcb',
    bank: 'ADCB',
    country: 'AE',
    currency: 'AED',
    order: 'dmy',
    required: [
      'transactiondate|تاريخالمعاملة',
      'valuedate|تاريخالقيمة',
      'description|التفاصيل',
      'debit|مدين',
      'credit|دائن',
      'balance|الرصيد',
    ],
    columns: {
      date: ['transactiondate|تاريخالمعاملة'],
      description: ['description|التفاصيل'],
      debit: ['debit|مدين'],
      credit: ['credit|دائن'],
      balance: ['balance|الرصيد'],
    },
  },
  {
    id: 'fab',
    bank: 'First Abu Dhabi Bank',
    country: 'AE',
    currency: 'AED',
    order: 'dmy',
    required: [
      'bookingdate|تاريخالقيد',
      'valuedate|تاريخالقيمة',
      'description|التفاصيل',
      'referencenumber|الرقمالمرجعي',
      'debit|مدين',
      'credit|دائن',
      'balance|الرصيد',
    ],
    columns: {
      date: ['bookingdate|تاريخالقيد'],
      description: ['description|التفاصيل'],
      ref: ['referencenumber|الرقمالمرجعي'],
      debit: ['debit|مدين'],
      credit: ['credit|دائن'],
      balance: ['balance|الرصيد'],
    },
  },
  {
    id: 'mashreq',
    bank: 'Mashreq',
    country: 'AE',
    currency: 'AED',
    order: 'dmy',
    required: [
      'date|التاريخ',
      'description|الوصف',
      'referenceno|رقمالمرجع',
      'withdrawals|سحوبات',
      'deposits|إيداعات',
      'balance|الرصيد',
    ],
    columns: {
      date: ['date|التاريخ'],
      description: ['description|الوصف'],
      ref: ['referenceno|رقمالمرجع'],
      debit: ['withdrawals|سحوبات'],
      credit: ['deposits|إيداعات'],
      balance: ['balance|الرصيد'],
    },
  },
  {
    id: 'dib',
    bank: 'Dubai Islamic Bank',
    country: 'AE',
    currency: 'AED',
    order: 'dmy',
    required: [
      'transactiondate|تاريخالعملية',
      'description|التفاصيل',
      'debit|مدين',
      'credit|دائن',
      'balance|الرصيد',
    ],
    columns: {
      date: ['transactiondate|تاريخالعملية'],
      description: ['description|التفاصيل'],
      debit: ['debit|مدين'],
      credit: ['credit|دائن'],
      balance: ['balance|الرصيد'],
    },
  },
];

/** The bare-data layouts, by the shape of their rows. */
interface Headerless {
  readonly id: IntlProfileId;
  readonly bank: string;
  readonly country: 'US' | 'GB' | 'AU' | 'AE';
  readonly currency: StatementCurrency;
  readonly order: ImportDateOrder;
  readonly width: number;
  readonly date: number;
  readonly amount: number;
  readonly description: number;
  readonly balance?: number;
  /** A column that must hold exactly this (Wells Fargo's `*`). */
  readonly marker?: { readonly column: number; readonly value: string };
}

const HEADERLESS: readonly Headerless[] = [
  {
    id: 'wells_fargo',
    bank: 'Wells Fargo',
    country: 'US',
    currency: 'USD',
    order: 'mdy',
    width: 5,
    date: 0,
    amount: 1,
    description: 4,
    marker: { column: 2, value: '*' },
  },
  {
    id: 'commbank',
    bank: 'Commonwealth Bank',
    country: 'AU',
    currency: 'AUD',
    order: 'dmy',
    width: 4,
    date: 0,
    amount: 1,
    description: 2,
    balance: 3,
  },
  {
    id: 'anz',
    bank: 'ANZ (or a similar three-column export)',
    country: 'AU',
    currency: 'AUD',
    order: 'dmy',
    width: 3,
    date: 0,
    amount: 1,
    description: 2,
  },
  {
    id: 'hsbc_uk',
    bank: 'HSBC UK (or a similar three-column export)',
    country: 'GB',
    currency: 'GBP',
    order: 'dmy',
    width: 3,
    date: 0,
    amount: 2,
    description: 1,
  },
];

const HEADER_SEARCH_ROWS = 40;

/**
 * Does a squashed header cell name this column? A name may carry an Arabic
 * alternative (`date|التاريخ`). UAE statements are often bilingual, with both
 * words in one cell ("Date / التاريخ"), so a cell naming both also counts.
 */
function cellMatches(cell: string, name: string): boolean {
  const [english, rawArabic] = name.split('|');
  if (!rawArabic) return cell === english;
  // Folded the way the header was, so a hamza or a diacritic cannot split a match.
  const arabic = squashHeader(rawArabic);
  return cell === english || cell === arabic || (cell.includes(english!) && cell.includes(arabic));
}
const DATE_LIKE =
  /^(?:\d{1,2}[-/. ]\d{1,2}[-/. ]\d{2,4}|\d{1,2}[-/. ](?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[-/. ,]+\d{2,4}|\d{4}-\d{2}-\d{2})/i;
const NUMBER_LIKE = /^[-+(]?[$£€]?\s?[\d,]+(?:\.\d{1,2})?\)?(?:\s?(?:cr|dr))?$/i;

/** `A$12.50`, `AU$12.50`, `US$12.50`: the prefix says which dollar, which the profile already knows. */
const stripDollarPrefix = (text: string): string => text.replace(/\b(?:A|AU|US|C|NZ)\$/gi, '$');

interface Signed {
  /** Unsigned. */
  readonly magnitude: bigint;
  readonly direction: 'debit' | 'credit';
}

/** One signed amount cell. A trailing CR or DR beats the sign. */
function readSigned(cell: string | undefined, currency: StatementCurrency): Signed | null {
  let text = stripDollarPrefix((cell ?? '').trim());
  if (text === '' || /^[-–—]+$/.test(text)) return null;
  const mark = /\b(cr|dr)\.?$/i.exec(text)?.[1]?.toLowerCase() ?? null;
  if (mark) text = text.replace(/\s*(?:cr|dr)\.?$/i, '');
  const parsed = parseLooseAmount(text, currency, 'dot');
  if (!parsed.ok) return null;
  const magnitude = parsed.minor < 0n ? -parsed.minor : parsed.minor;
  const direction = mark
    ? mark === 'cr'
      ? 'credit'
      : 'debit'
    : parsed.minor < 0n
      ? 'debit'
      : 'credit';
  return { magnitude, direction };
}

function readUnsigned(cell: string | undefined, currency: StatementCurrency): bigint | null {
  const read = readSigned(cell, currency);
  return read ? read.magnitude : null;
}

function readBalance(cell: string | undefined, currency: StatementCurrency): string | null {
  let text = stripDollarPrefix((cell ?? '').trim());
  if (text === '') return null;
  const mark = /\b(cr|dr)\.?$/i.exec(text)?.[1]?.toLowerCase() ?? null;
  if (mark) text = text.replace(/\s*(?:cr|dr)\.?$/i, '');
  const parsed = parseLooseAmount(text, currency, 'dot');
  if (!parsed.ok) return null;
  return (mark === 'dr' ? -parsed.minor : parsed.minor).toString();
}

interface Layout {
  readonly id: IntlProfileId;
  readonly bank: string;
  readonly currency: StatementCurrency;
  readonly order: ImportDateOrder;
  /** Index of the first data row. */
  readonly firstRow: number;
  readonly date: number;
  readonly description: readonly number[];
  readonly amount?: number;
  readonly debit?: number;
  readonly credit?: number;
  readonly kind?: number;
  readonly balance?: number;
  readonly ref?: number;
  readonly fee?: number;
  readonly state?: number;
  readonly currencyColumn?: number;
}

function matchHeader(table: TableRead): Layout | null {
  const limit = Math.min(table.rows.length, HEADER_SEARCH_ROWS);
  for (let headerRow = 0; headerRow < limit; headerRow += 1) {
    const squashed = table.rows[headerRow]!.map((cell) => squashHeader(cell));
    for (const profile of INTL_PROFILES) {
      if (!profile.required.every((name) => squashed.some((cell) => cellMatches(cell, name))))
        continue;
      const find = (names: readonly string[] | undefined): number | undefined => {
        for (const name of names ?? []) {
          const at = squashed.findIndex((cell) => cellMatches(cell, name));
          if (at >= 0) return at;
        }
        return undefined;
      };
      const c = profile.columns;
      const description = c.description
        .map((name) => squashed.findIndex((cell) => cellMatches(cell, name)))
        .filter((at) => at >= 0);
      const date = find(c.date);
      if (date === undefined || description.length === 0) continue;
      return {
        id: profile.id,
        bank: profile.bank,
        currency: profile.currency,
        order: profile.order,
        firstRow: headerRow + 1,
        date,
        description,
        amount: find(c.amount),
        debit: find(c.debit),
        credit: find(c.credit),
        kind: find(c.kind),
        balance: find(c.balance),
        ref: find(c.ref),
        fee: find(c.fee),
        state: find(c.state),
        currencyColumn: find(c.currency),
      };
    }
  }
  return null;
}

function matchHeaderless(table: TableRead): Layout | null {
  const sample = table.rows.slice(0, 12);
  if (sample.length === 0) return null;
  for (const shape of HEADERLESS) {
    const fits = sample.every((row) => {
      if (row.length !== shape.width) return false;
      if (!DATE_LIKE.test(row[shape.date] ?? '')) return false;
      if (!NUMBER_LIKE.test((row[shape.amount] ?? '').replace(/"/g, ''))) return false;
      if (shape.marker && row[shape.marker.column] !== shape.marker.value) return false;
      if (shape.balance !== undefined && !NUMBER_LIKE.test(row[shape.balance] ?? '')) return false;
      return (row[shape.description] ?? '').trim() !== '';
    });
    if (!fits) continue;
    return {
      id: shape.id,
      bank: shape.bank,
      currency: shape.currency,
      order: shape.order,
      firstRow: 0,
      date: shape.date,
      description: [shape.description],
      amount: shape.amount,
      balance: shape.balance,
    };
  }
  return null;
}

/** A header-only layout: a date, a description and one signed amount. */
const SIGNED_GENERIC: Readonly<
  Record<'date' | 'description' | 'amount' | 'balance', readonly string[]>
> = {
  date: ['date', 'transactiondate', 'postingdate', 'posteddate', 'bookingdate', 'valuedate'],
  description: ['description', 'details', 'narrative', 'memo', 'transactiondescription'],
  amount: ['amount', 'value', 'transactionamount'],
  balance: ['balance', 'runningbalance', 'runningbal', 'closingbalance'],
};

function matchSignedGeneric(table: TableRead, currency: StatementCurrency): Layout | null {
  const limit = Math.min(table.rows.length, HEADER_SEARCH_ROWS);
  for (let headerRow = 0; headerRow < limit; headerRow += 1) {
    const squashed = table.rows[headerRow]!.map((cell) => squashHeader(cell));
    const at = (names: readonly string[]): number => squashed.findIndex((n) => names.includes(n));
    const date = at(SIGNED_GENERIC.date);
    const description = at(SIGNED_GENERIC.description);
    const amount = at(SIGNED_GENERIC.amount);
    if (date < 0 || description < 0 || amount < 0) continue;
    const balance = at(SIGNED_GENERIC.balance);
    return {
      id: 'chase_checking' as IntlProfileId, // replaced below: a generic layout has no bank
      bank: '',
      currency,
      order: 'dmy',
      firstRow: headerRow + 1,
      date,
      description: [description],
      amount,
      balance: balance >= 0 ? balance : undefined,
    };
  }
  return null;
}

/** The currency a country's statements are in. */
export function currencyForStatementCountry(country: string | null | undefined): StatementCurrency {
  switch ((country ?? '').toUpperCase()) {
    case 'US':
      return 'USD';
    case 'GB':
    case 'UK':
      return 'GBP';
    case 'AU':
      return 'AUD';
    case 'AE':
      return 'AED';
    default:
      return 'INR';
  }
}

export interface IntlParse {
  readonly result: TableParseResult;
}

function readLayout(
  table: TableRead,
  layout: Layout,
  generic: boolean,
  options: TableParseOptions,
): TableParseResult {
  const body = table.rows.slice(layout.firstRow);
  const order = generic ? options.order : layout.order;
  const dates = resolveDates(
    body.map((row) => row[layout.date] ?? ''),
    {
      order,
      allowSerial: true,
      today: options.today,
      country: options.country ?? (layout.currency === 'USD' ? 'US' : undefined),
    },
  );

  const confidence = generic ? 0.7 : 0.9;
  const currency = layout.currency;
  const rows: StatementRow[] = [];
  let skipped = 0;
  let rowCurrency: string | null = null;

  body.forEach((cells, at) => {
    if (layout.state !== undefined) {
      const state = (cells[layout.state] ?? '').trim().toLowerCase();
      if (state !== '' && state !== 'completed') {
        skipped += 1;
        return;
      }
    }
    if (layout.currencyColumn !== undefined) {
      const code = (cells[layout.currencyColumn] ?? '').trim().toUpperCase();
      if (code !== '') {
        rowCurrency ??= code;
        if (code !== rowCurrency) {
          skipped += 1;
          return;
        }
      }
    }

    const iso = dates.cells[at]?.iso ?? null;
    const description = layout.description
      .map((i) => (cells[i] ?? '').trim())
      .filter((part) => part !== '')
      .join(' ');

    let magnitude: bigint | null = null;
    let direction: 'debit' | 'credit' | null = null;
    if (layout.amount !== undefined && layout.kind !== undefined) {
      magnitude = readUnsigned(cells[layout.amount], currency);
      const word = (cells[layout.kind] ?? '').trim().toLowerCase();
      direction = word.startsWith('d') ? 'debit' : word.startsWith('c') ? 'credit' : null;
    } else if (layout.amount !== undefined) {
      const signed = readSigned(cells[layout.amount], currency);
      if (signed) {
        magnitude = signed.magnitude;
        direction = signed.direction;
        // Revolut: the fee leaves the account with the payment.
        if (layout.fee !== undefined && direction === 'debit') {
          magnitude += readUnsigned(cells[layout.fee], currency) ?? 0n;
        } else if (layout.fee !== undefined && direction === 'credit') {
          magnitude -= readUnsigned(cells[layout.fee], currency) ?? 0n;
        }
      }
    } else {
      const debit = layout.debit !== undefined ? readUnsigned(cells[layout.debit], currency) : null;
      const credit =
        layout.credit !== undefined ? readUnsigned(cells[layout.credit], currency) : null;
      if (debit !== null && debit > 0n) {
        magnitude = debit;
        direction = 'debit';
      } else if (credit !== null && credit > 0n) {
        magnitude = credit;
        direction = 'credit';
      }
    }

    if (iso === null || magnitude === null || direction === null) {
      const previous = rows[rows.length - 1];
      if (
        previous &&
        (cells[layout.date] ?? '').trim() === '' &&
        magnitude === null &&
        description !== ''
      ) {
        rows[rows.length - 1] = {
          ...previous,
          description: `${previous.description} ${description}`,
        };
        return;
      }
      skipped += 1;
      return;
    }

    rows.push({
      index: rows.length,
      date: iso,
      description: description === '' ? 'Transaction' : description,
      amount: magnitude.toString(),
      direction,
      ref: referenceFor(layout.ref !== undefined ? cells[layout.ref] : null, description),
      balance: layout.balance !== undefined ? readBalance(cells[layout.balance], currency) : null,
      confidence,
      warnings: magnitude === 0n ? ['zero_amount'] : [],
    });
  });

  if (rows.length === 0) return { ok: false, reason: 'no_transactions' };
  const checked = applyBalanceCheck(rows);
  return {
    ok: true,
    profile: generic ? 'generic' : layout.id,
    bank: generic ? null : layout.bank,
    rows: checked.rows,
    skipped,
    balanceChecked: checked.checked,
    balanceFailed: checked.failed,
    currency: (rowCurrency as string | null) ?? currency,
    dateOrder: dates.order,
    dateAmbiguous: dates.ambiguous,
  };
}

/**
 * Read an export whose bank is recognised: by its header names, or, for the
 * bare-data ones, by the shape of its rows. Null means "not one of these".
 */
export function parseIntlNamed(
  table: TableRead,
  options: TableParseOptions = {},
): TableParseResult | null {
  const header = matchHeader(table);
  if (header) return readLayout(table, header, false, options);
  const bare = matchHeaderless(table);
  if (bare) return readLayout(table, bare, false, options);
  return null;
}

/** Any file with a date, a description and one signed amount column. Lower confidence. */
export function parseIntlGeneric(
  table: TableRead,
  options: TableParseOptions = {},
): TableParseResult | null {
  const generic = matchSignedGeneric(table, currencyForStatementCountry(options.country));
  return generic ? readLayout(table, generic, true, options) : null;
}
