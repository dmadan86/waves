/**
 * Importing a company's people and parties from a table of strings.
 *
 * Source (file, contacts, a Google Sheet) -> rows of strings -> `matchColumns`
 * (header names in English / Hindi / Tamil, then the person's override) ->
 * `buildImportRows` (validate, normalise, dedupe) -> the app writes the `new`
 * rows through its normal mutations. Pure: no clock, no device, no network.
 * A later source (Tally, Vyapar...) only has to produce the same rows of text.
 */

import { normalisePhoneInRegion } from '../auth/identity';
import { deterministicId } from '../ids';
import { parseLooseAmount } from '../import/amount';
import type { CurrencyCode } from '../money/currency';
import { normaliseForParsing } from '../text/digits';

export type ImportEntity = 'employee' | 'client' | 'vendor';
export type ImportFieldKey =
  | 'name'
  | 'phone'
  | 'employeeId'
  | 'department'
  | 'manager'
  | 'joinedOn'
  | 'dailyRate'
  | 'need'
  | 'source'
  | 'address'
  | 'expectedValue'
  | 'stage'
  | 'category'
  | 'openingBalance';

/** Header words per field, in the shape `headerKey` produces. */
const ALIASES: Record<ImportFieldKey, readonly string[]> = {
  name: [
    'name',
    'fullname',
    'employeename',
    'clientname',
    'customername',
    'vendorname',
    'suppliername',
    'partyname',
    'party',
    'particulars',
    'ledgername',
    'contactname',
    'staffname',
    'नाम',
    'पूरानाम',
    'कर्मचारीकानाम',
    'ग्राहककानाम',
    'विक्रेताकानाम',
    'पार्टीनाम',
    'பெயர்',
    'முழுபெயர்',
    'ஊழியர்பெயர்',
    'வாடிக்கையாளர்பெயர்',
    'விற்பனையாளர்பெயர்',
  ],
  phone: [
    'mobile',
    'mobileno',
    'mobilenumber',
    'phone',
    'phoneno',
    'phonenumber',
    'contact',
    'contactno',
    'contactnumber',
    'whatsapp',
    'cell',
    'tel',
    'telephone',
    'फ़ोन',
    'फोन',
    'मोबाइल',
    'मोबाइलनंबर',
    'संपर्क',
    'फ़ोननंबर',
    'फोननंबर',
    'தொலைபேசி',
    'மொபைல்',
    'கைபேசி',
    'தொடர்புஎண்',
    'தொலைபேசிஎண்',
  ],
  employeeId: [
    'empid',
    'employeeid',
    'employeecode',
    'empcode',
    'staffid',
    'staffcode',
    'id',
    'code',
    'कर्मचारीआईडी',
    'कर्मचारीकोड',
    'ஊழியர்எண்',
    'ஊழியர்அடையாளஎண்',
  ],
  department: ['department', 'dept', 'division', 'section', 'विभाग', 'துறை'],
  manager: [
    'manager',
    'managername',
    'reportsto',
    'reportingmanager',
    'supervisor',
    'teamlead',
    'मैनेजर',
    'प्रबंधक',
    'पर्यवेक्षक',
    'மேலாளர்',
  ],
  joinedOn: [
    'joiningdate',
    'dateofjoining',
    'doj',
    'joinedon',
    'joined',
    'joindate',
    'startdate',
    'जॉइनिंगतिथि',
    'ज्वाइनिंगतिथि',
    'ज्वाइनिंगदिनांक',
    'சேர்ந்ததேதி',
    'பணியில்சேர்ந்ததேதி',
  ],
  dailyRate: [
    'dailyrate',
    'dailywage',
    'perdayrate',
    'rateperday',
    'wageperday',
    'daywage',
    'dailysalary',
    'bata',
    'dailybata',
    'दैनिकदर',
    'दैनिकमजदूरी',
    'दैनिकवेतन',
    'தினசரிஊதியம்',
    'தினக்கூலி',
  ],
  need: [
    'need',
    'requirement',
    'requirements',
    'enquiry',
    'inquiry',
    'interest',
    'product',
    'service',
    'details',
    'ज़रूरत',
    'जरूरत',
    'आवश्यकता',
    'தேவை',
  ],
  source: ['source', 'leadsource', 'via', 'स्रोत', 'மூலம்'],
  address: ['address', 'location', 'city', 'पता', 'முகவரி'],
  expectedValue: [
    'expectedvalue',
    'value',
    'budget',
    'dealvalue',
    'amount',
    'अपेक्षितमूल्य',
    'बजट',
    'மதிப்பு',
  ],
  stage: ['stage', 'status', 'leadstatus', 'चरण', 'स्थिति', 'நிலை'],
  category: ['category', 'type', 'group', 'श्रेणी', 'वर्ग', 'வகை'],
  openingBalance: [
    'openingbalance',
    'opening',
    'balance',
    'currentbalance',
    'topay',
    'amountdue',
    'outstanding',
    'payable',
    'due',
    'बकाया',
    'शेष',
    'ओपनिंगबैलेंस',
    'நிலுவை',
    'இருப்பு',
  ],
};

export const ENTITY_FIELDS: Record<ImportEntity, readonly ImportFieldKey[]> = {
  employee: ['name', 'phone', 'employeeId', 'department', 'manager', 'joinedOn', 'dailyRate'],
  client: ['name', 'phone', 'need', 'source', 'address', 'expectedValue', 'stage'],
  vendor: ['name', 'phone', 'category', 'openingBalance'],
};

/** A header as comparable letters: case, spaces and punctuation gone, Indic marks kept. */
export function headerKey(raw: string): string {
  return raw
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}]/gu, '');
}

export type ColumnMapping = Partial<Record<ImportFieldKey, number>>;

/** Which column holds which field: exact header names first, then "<something> name" for the name. */
export function matchColumns(headers: readonly string[], entity: ImportEntity): ColumnMapping {
  const keys = headers.map(headerKey);
  const mapping: ColumnMapping = {};
  const used = new Set<number>();
  const take = (field: ImportFieldKey, test: (h: string) => boolean): void => {
    if (mapping[field] !== undefined) return;
    const at = keys.findIndex((h, i) => h !== '' && !used.has(i) && test(h));
    if (at >= 0) {
      mapping[field] = at;
      used.add(at);
    }
  };
  for (const field of ENTITY_FIELDS[entity]) take(field, (h) => ALIASES[field].includes(h));
  take('name', (h) => h.endsWith('name'));
  return mapping;
}

// ── value parsers ───────────────────────────────────────────────────────────

/** dd/mm/yyyy, dd-mm-yyyy, dd.mm.yyyy and yyyy-mm-dd (also with a time) to ISO; null if unreadable. */
export function parseImportDate(raw: string): string | null {
  const text = normaliseForParsing(raw).trim();
  let y: number;
  let m: number;
  let d: number;
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s].*)?$/.exec(text);
  const dmy = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/.exec(text);
  if (iso) {
    [y, m, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  } else if (dmy) {
    [d, m] = [Number(dmy[1]), Number(dmy[2])];
    y = Number(dmy[3]);
    if (y < 100) y += 2000;
  } else return null;
  const probe = new Date(Date.UTC(y, m - 1, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== m - 1 || probe.getUTCDate() !== d) {
    return null;
  }
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

const collapse = (s: string): string => s.normalize('NFKC').trim().replace(/\s+/g, ' ');
const nameKey = (s: string): string => collapse(s).toLowerCase();

type Stage = 'inquiry' | 'quoted' | 'client' | 'lost';
type Source = 'walk_in' | 'call' | 'whatsapp' | 'referral' | 'other';
const STAGES: Record<string, Stage> = {
  inquiry: 'inquiry',
  enquiry: 'inquiry',
  lead: 'inquiry',
  new: 'inquiry',
  open: 'inquiry',
  quote: 'quoted',
  quoted: 'quoted',
  quotation: 'quoted',
  client: 'client',
  customer: 'client',
  won: 'client',
  active: 'client',
  converted: 'client',
  lost: 'lost',
  closed: 'lost',
  dead: 'lost',
};
const SOURCES: Record<string, Source> = {
  walkin: 'walk_in',
  call: 'call',
  phone: 'call',
  whatsapp: 'whatsapp',
  referral: 'referral',
  reference: 'referral',
  referred: 'referral',
};

// ── rows ────────────────────────────────────────────────────────────────────

export type RowProblem =
  | 'name_missing'
  | 'phone_invalid'
  | 'date_invalid'
  | 'amount_invalid'
  | 'amount_negative'
  | 'duplicate_in_file'
  | 'duplicate_existing';
export type RowWarning =
  'department_unknown' | 'manager_unknown' | 'employee_id_taken' | 'stage_unknown';

export interface ImportValues {
  name: string;
  phone: string | null;
  employeeId: string | null;
  departmentId: string | null;
  managerId: string | null;
  joinedOn: string | null;
  dailyRateMinor: bigint | null;
  need: string | null;
  source: Source;
  address: string | null;
  expectedValueMinor: bigint | null;
  stage: Stage;
  category: string | null;
  openingBalanceMinor: bigint | null;
}

export interface ImportRow {
  /** The row's line in the file, as the person sees it. */
  readonly line: number;
  readonly cells: readonly string[];
  readonly status: 'new' | 'duplicate' | 'error';
  readonly problem?: RowProblem;
  readonly warnings: readonly RowWarning[];
  readonly values?: ImportValues;
  /** Same person, same id, on every run. */
  readonly id?: string;
}

export interface ImportContext {
  readonly entity: ImportEntity;
  readonly groupId: string;
  readonly currency: CurrencyCode;
  /** e.g. '+91': the region a bare local number is read in. */
  readonly dialCode: string | null;
  readonly existing: readonly { readonly name: string; readonly phone: string | null }[];
  readonly existingEmployeeIds?: readonly string[];
  readonly departments?: readonly { readonly id: string; readonly name: string }[];
  readonly people?: readonly { readonly id: string; readonly name: string }[];
}

function phoneOf(raw: string, dial: string | null): string | null {
  try {
    return normalisePhoneInRegion(raw, dial);
  } catch {
    return null;
  }
}

/** Validate, normalise and dedupe every data row. `lines[i]` numbers `rows[i]`. */
export function buildImportRows(
  rows: readonly (readonly string[])[],
  lines: readonly number[],
  mapping: ColumnMapping,
  ctx: ImportContext,
): ImportRow[] {
  const cell = (r: readonly string[], k: ImportFieldKey): string => {
    const at = mapping[k];
    return at === undefined ? '' : collapse(r[at] ?? '');
  };
  const seenPhones = new Set(
    ctx.existing.flatMap((e) => (e.phone ? [phoneOf(e.phone, ctx.dialCode) ?? e.phone] : [])),
  );
  // A name decides alone only when no number is on one side: two Rameshes with different phones are two people.
  const namesWithoutPhone = new Set(
    ctx.existing.filter((e) => !e.phone).map((e) => nameKey(e.name)),
  );
  const namesAll = new Set(ctx.existing.map((e) => nameKey(e.name)));
  const takenIds = new Set((ctx.existingEmployeeIds ?? []).map((s) => s.toLowerCase()));
  const dept = new Map((ctx.departments ?? []).map((d) => [nameKey(d.name), d.id]));
  const people = new Map((ctx.people ?? []).map((p) => [nameKey(p.name), p.id]));
  const inFile = new Set<string>();

  return rows.map((r, i): ImportRow => {
    const line = lines[i] ?? i + 2;
    const bad = (problem: RowProblem, status: 'error' | 'duplicate' = 'error'): ImportRow => ({
      line,
      cells: r,
      status,
      problem,
      warnings: [],
    });
    const warnings: RowWarning[] = [];
    const name = cell(r, 'name').slice(0, 80);
    if (!name) return bad('name_missing');

    const phoneRaw = cell(r, 'phone');
    const phone = phoneRaw ? phoneOf(phoneRaw, ctx.dialCode) : null;
    if (phoneRaw && !phone) return bad('phone_invalid');

    let joinedOn: string | null = null;
    if (cell(r, 'joinedOn')) {
      joinedOn = parseImportDate(cell(r, 'joinedOn'));
      if (!joinedOn) return bad('date_invalid');
    }
    const money = (k: ImportFieldKey): bigint | null | 'bad' | 'neg' => {
      const text = cell(r, k);
      if (!text) return null;
      const a = parseLooseAmount(text, ctx.currency);
      if (!a.ok) return a.reason === 'empty' ? null : 'bad';
      return a.minor < 0n ? 'neg' : a.minor;
    };
    const rate = money('dailyRate');
    const value = money('expectedValue');
    const opening = money('openingBalance');
    for (const m of [rate, value, opening]) {
      if (m === 'bad') return bad('amount_invalid');
      if (m === 'neg') return bad('amount_negative');
    }

    // Dedupe: phone first, then name; against what exists and against earlier rows.
    const nk = nameKey(name);
    if (phone ? seenPhones.has(phone) || namesWithoutPhone.has(nk) : namesAll.has(nk)) {
      return bad('duplicate_existing', 'duplicate');
    }
    const fileKey = phone ?? `n:${nk}`;
    if (inFile.has(fileKey)) return bad('duplicate_in_file', 'duplicate');
    inFile.add(fileKey);

    let employeeId: string | null = cell(r, 'employeeId').slice(0, 32) || null;
    if (employeeId && takenIds.has(employeeId.toLowerCase())) {
      warnings.push('employee_id_taken');
      employeeId = null;
    } else if (employeeId) takenIds.add(employeeId.toLowerCase());
    const dName = cell(r, 'department');
    const departmentId = dName ? (dept.get(nameKey(dName)) ?? null) : null;
    if (dName && !departmentId) warnings.push('department_unknown');
    const mName = cell(r, 'manager');
    const managerId = mName ? (people.get(nameKey(mName)) ?? null) : null;
    if (mName && !managerId) warnings.push('manager_unknown');
    const stageText = cell(r, 'stage').toLowerCase();
    if (stageText && !STAGES[stageText]) warnings.push('stage_unknown');

    const zeroToNull = (m: bigint | null | 'bad' | 'neg'): bigint | null =>
      typeof m === 'bigint' && m > 0n ? m : null;
    const values: ImportValues = {
      name,
      phone,
      employeeId,
      departmentId,
      managerId,
      joinedOn,
      dailyRateMinor: zeroToNull(rate),
      need: cell(r, 'need') || null,
      source:
        SOURCES[
          cell(r, 'source')
            .toLowerCase()
            .replace(/[\s_-]/g, '')
        ] ?? 'other',
      address: cell(r, 'address') || null,
      expectedValueMinor: zeroToNull(value),
      // A file of existing customers is mostly clients; an explicit status says otherwise.
      stage: STAGES[stageText] ?? 'client',
      category: cell(r, 'category') || null,
      openingBalanceMinor: zeroToNull(opening),
    };
    return {
      line,
      cells: r,
      status: 'new',
      warnings,
      values,
      id: deterministicId(`companyimport:${ctx.groupId}:${ctx.entity}:${fileKey}`),
    };
  });
}

export function countRows(rows: readonly ImportRow[]): {
  added: number;
  duplicates: number;
  errors: number;
} {
  const n = (s: ImportRow['status']): number => rows.filter((r) => r.status === s).length;
  return { added: n('new'), duplicates: n('duplicate'), errors: n('error') };
}

// ── CSV out (templates, the error rows) ─────────────────────────────────────

/** A cell safe to open in a spreadsheet: a leading = + - @ would run as a formula. */
function csvCell(raw: string): string {
  const value = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
  return /["\n\r,;]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}
export const toCsv = (rows: readonly (readonly string[])[]): string =>
  rows.map((r) => r.map(csvCell).join(',')).join('\n');

const TEMPLATES: Record<ImportEntity, readonly (readonly string[])[]> = {
  employee: [
    ['Name', 'Mobile', 'Employee ID', 'Department', 'Manager', 'Joining date', 'Daily rate'],
    ['Ravi Kumar', '9876543210', 'EMP-001', 'Sales', '', '15/01/2026', '600'],
  ],
  client: [
    ['Name', 'Mobile', 'Requirement', 'Source', 'Address', 'Expected value', 'Status'],
    ['Anita Traders', '9876500000', 'Monthly supply', 'Referral', 'Salem', '25000', 'Client'],
  ],
  vendor: [
    ['Name', 'Mobile', 'Category', 'Opening balance'],
    ['Sri Murugan Suppliers', '9876511111', 'Raw material', '12500'],
  ],
};
export const templateCsv = (entity: ImportEntity): string => toCsv(TEMPLATES[entity]);

// ── Google Sheets (public, no sign-in) ──────────────────────────────────────

/**
 * The CSV export address for a pasted Google Sheets link, or null. Only
 * https://docs.google.com/spreadsheets/d/<id>/... is accepted; the address is
 * rebuilt from the id and gid, so nothing else in the pasted text is fetched.
 */
export function sheetCsvUrl(pasted: string): string | null {
  let u: URL;
  try {
    u = new URL(pasted.trim());
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' || u.hostname !== 'docs.google.com' || u.username || u.password) {
    return null;
  }
  if (u.port && u.port !== '443') return null;
  const id = /^\/spreadsheets\/d\/([A-Za-z0-9_-]{20,100})(?:\/|$)/.exec(u.pathname)?.[1];
  if (!id) return null;
  const gid = /(?:^|[?&#])gid=(\d{1,12})(?:$|[&#])/.exec(`${u.search}${u.hash}`)?.[1] ?? '0';
  return `https://docs.google.com/spreadsheets/d/${id}/export?format=csv&gid=${gid}`;
}

/** Hosts a public export may redirect through. */
export function isGoogleHost(host: string): boolean {
  return /(^|\.)(google\.com|googleusercontent\.com)$/.test(host);
}
