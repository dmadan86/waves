/**
 * Dates out of a spreadsheet column.
 *
 * `03/04/2026` is the third of April in Chennai and the fourth of March in
 * Chicago, and nothing in the cell says which. So the order is decided once per
 * file, from every value in the column, not once per row:
 *
 *   1. a first part above 12 means day-first, a second part above 12 means
 *      month-first, and either settles the whole file;
 *   2. otherwise, if only one reading keeps the rows in date order (a ledger
 *      exported in sequence), that one;
 *   3. otherwise the group's country decides (US, PH and CA read month-first),
 *      and the result is flagged as ambiguous so a screen can show the choice.
 */

export type ImportDateOrder = 'dmy' | 'mdy';

/** How the order was settled, strongest evidence first. */
export type DateBasis = 'chosen' | 'forced' | 'monotonic' | 'country' | 'unambiguous';

export type DateFailure = 'unreadable' | 'impossible' | 'mixed';

export interface DateCell {
  /** YYYY-MM-DD, or null when the cell could not be read. */
  readonly iso: string | null;
  readonly failure: DateFailure | null;
}

export interface ResolvedDates {
  /** Null when the file mixes both orders and there is no single answer. */
  readonly order: ImportDateOrder | null;
  readonly basis: DateBasis;
  /** The order was a guess from the country: worth asking about. */
  readonly ambiguous: boolean;
  /** Some cells can only be day-first and others only month-first. */
  readonly mixed: boolean;
  readonly cells: readonly DateCell[];
}

const MONTH_FIRST_COUNTRIES = new Set(['US', 'PH', 'CA']);

export function defaultDateOrder(country: string | null | undefined): ImportDateOrder {
  return country && MONTH_FIRST_COUNTRIES.has(country.toUpperCase()) ? 'mdy' : 'dmy';
}

const MONTHS: Readonly<Record<string, number>> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};

type RawDate =
  | { readonly t: 'ymd'; readonly y: number; readonly m: number; readonly d: number }
  | { readonly t: 'pair'; readonly a: number; readonly b: number; readonly y: number }
  | { readonly t: 'bad' };

const pad = (n: number, width = 2): string => String(n).padStart(width, '0');

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function validIso(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1 || y < 1900 || y > 2200) return null;
  return d <= daysInMonth(y, m) ? `${pad(y, 4)}-${pad(m)}-${pad(d)}` : null;
}

/** Excel's day 1 is 1900-01-01 and it counts a 1900-02-29 that never existed, so day 0 is 1899-12-30. */
export function excelSerialToIso(serial: number): string | null {
  if (!Number.isFinite(serial) || serial < 20000 || serial >= 80000) return null;
  const date = new Date(Date.UTC(1899, 11, 30) + Math.floor(serial) * 86_400_000);
  return `${pad(date.getUTCFullYear(), 4)}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

/** Two-digit years are 20xx unless that is more than a year ahead, then 19xx. */
function fullYear(text: string, currentYear: number): number {
  const year = Number(text);
  if (text.length === 4) return year;
  return 2000 + year <= currentYear + 1 ? 2000 + year : 1900 + year;
}

function parseRaw(text: string, allowSerial: boolean, currentYear: number): RawDate | 'serial' {
  const value = text.trim().replace(/\s+/g, ' ');
  let match = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T ].*)?$/.exec(value);
  if (match) return { t: 'ymd', y: Number(match[1]), m: Number(match[2]), d: Number(match[3]) };

  // `20260208`: the compact form corporate exports (Westpac, OFX) use.
  match = /^((?:19|20)\d{2})(\d{2})(\d{2})$/.exec(value);
  if (match) return { t: 'ymd', y: Number(match[1]), m: Number(match[2]), d: Number(match[3]) };

  match = /^(\d{1,2})(?:st|nd|rd|th)?[-/. ]+([A-Za-z]{3,9})\.?,?[-/. ]+(\d{2}|\d{4})(?: .*)?$/.exec(
    value,
  );
  const dayFirstMonth = match && MONTHS[match[2]!.toLowerCase()];
  if (match && dayFirstMonth) {
    return { t: 'ymd', y: fullYear(match[3]!, currentYear), m: dayFirstMonth, d: Number(match[1]) };
  }

  match = /^([A-Za-z]{3,9})\.? (\d{1,2})(?:st|nd|rd|th)?,? (\d{2}|\d{4})(?: .*)?$/.exec(value);
  const monthFirstMonth = match && MONTHS[match[1]!.toLowerCase()];
  if (match && monthFirstMonth) {
    return {
      t: 'ymd',
      y: fullYear(match[3]!, currentYear),
      m: monthFirstMonth,
      d: Number(match[2]),
    };
  }

  match = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4}|\d{2})(?:[T ].*)?$/.exec(value);
  if (match) {
    return {
      t: 'pair',
      a: Number(match[1]),
      b: Number(match[2]),
      y: fullYear(match[3]!, currentYear),
    };
  }

  if (allowSerial && /^\d{5}(?:\.\d+)?$/.test(value)) return 'serial';
  return { t: 'bad' };
}

const isMonotonic = (days: readonly string[]): boolean => {
  let up = true;
  let down = true;
  for (let index = 1; index < days.length; index += 1) {
    if (days[index]! < days[index - 1]!) up = false;
    if (days[index]! > days[index - 1]!) down = false;
  }
  return up || down;
};

export interface ResolveDatesOptions {
  /** The group's country, for the day/month default. */
  readonly country?: string | null;
  /** Read a bare 5-digit number as an Excel serial date. Only when the column is known to be dates. */
  readonly allowSerial?: boolean;
  /** Force an order (the person's choice), skipping detection. */
  readonly order?: ImportDateOrder;
  /** `YYYY-MM-DD`; only its year is used, for two-digit years. Defaults to now. */
  readonly today?: string;
}

/**
 * Read a whole column of dates, deciding the day/month order once for all of
 * them. Never throws; a cell it cannot read comes back with a `failure`.
 */
export function resolveDates(
  values: readonly string[],
  options: ResolveDatesOptions = {},
): ResolvedDates {
  const currentYear = options.today
    ? Number(options.today.slice(0, 4))
    : new Date().getUTCFullYear();
  const parsed = values.map((value) => {
    const raw = parseRaw(value, options.allowSerial ?? false, currentYear);
    return raw === 'serial'
      ? ({ t: 'iso', iso: excelSerialToIso(Number(value.trim())) } as const)
      : raw;
  });

  const pairs = parsed.filter((cell): cell is Extract<RawDate, { t: 'pair' }> => cell.t === 'pair');
  const dayFirstOnly = pairs.some((cell) => cell.a > 12 && cell.b <= 12);
  const monthFirstOnly = pairs.some((cell) => cell.b > 12 && cell.a <= 12);
  const guessable = pairs.some((cell) => cell.a <= 12 && cell.b <= 12 && cell.a !== cell.b);

  const readAs = (cell: (typeof parsed)[number], order: ImportDateOrder | null): DateCell => {
    if (cell.t === 'iso') {
      return cell.iso ? { iso: cell.iso, failure: null } : { iso: null, failure: 'unreadable' };
    }
    if (cell.t === 'bad') return { iso: null, failure: 'unreadable' };
    if (cell.t === 'ymd') {
      const iso = validIso(cell.y, cell.m, cell.d);
      return iso ? { iso, failure: null } : { iso: null, failure: 'impossible' };
    }
    // A pair that can only be read one way reads that way regardless of the file.
    // (Unless the person chose an order: then a cell that disagrees is wrong, not reinterpreted.)
    const forced = options.order
      ? null
      : cell.a > 12 && cell.b <= 12
        ? 'dmy'
        : cell.b > 12 && cell.a <= 12
          ? 'mdy'
          : null;
    const effective = forced ?? order;
    if (effective === null) {
      return cell.a === cell.b
        ? readAs({ t: 'pair', a: cell.a, b: cell.b, y: cell.y }, 'dmy')
        : { iso: null, failure: 'mixed' };
    }
    const iso =
      effective === 'dmy' ? validIso(cell.y, cell.b, cell.a) : validIso(cell.y, cell.a, cell.b);
    return iso ? { iso, failure: null } : { iso: null, failure: 'impossible' };
  };

  let order: ImportDateOrder | null;
  let basis: DateBasis;
  let ambiguous = false;
  const mixed = !options.order && dayFirstOnly && monthFirstOnly;

  if (options.order) {
    order = options.order;
    basis = 'chosen';
  } else if (mixed) {
    order = null;
    basis = 'forced';
  } else if (dayFirstOnly || monthFirstOnly) {
    order = dayFirstOnly ? 'dmy' : 'mdy';
    basis = 'forced';
  } else if (guessable) {
    const sequence = (candidate: ImportDateOrder): string[] =>
      parsed.flatMap((cell) => {
        const read = readAs(cell, candidate);
        return read.iso ? [read.iso] : [];
      });
    const dmy = isMonotonic(sequence('dmy'));
    const mdy = isMonotonic(sequence('mdy'));
    if (dmy !== mdy) {
      order = dmy ? 'dmy' : 'mdy';
      basis = 'monotonic';
    } else {
      order = defaultDateOrder(options.country);
      basis = 'country';
      ambiguous = true;
    }
  } else {
    order = defaultDateOrder(options.country);
    basis = 'unambiguous';
  }

  return { order, basis, ambiguous, mixed, cells: parsed.map((cell) => readAs(cell, order)) };
}
