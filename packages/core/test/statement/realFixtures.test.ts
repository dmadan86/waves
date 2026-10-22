/**
 * Real-format statements, read end to end.
 *
 * `fixtures/statement/real/` holds sample exports copied from permissively
 * licensed repositories (see NOTICE.md there): the exact header, preamble,
 * quoting and date conventions of each bank's export, with made-up rows.
 * `fixtures/statement/specimen-shaped/` holds hand-written files in the shape
 * of bank-published specimens that could not be vendored.
 *
 * Every fixture is pinned to its row count, each row's direction and amount,
 * its first and last dates, and, where the export prints balances, a passing
 * balance check. A bank changing its export, or a parser change that quietly
 * drops a row, fails here first.
 */

import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  decodeBytes,
  looksLikeOfx,
  parseOfx,
  parseStatementTable,
  parseStatementText,
  readTable,
  type StatementRow,
  type TableParseOptions,
} from '../../src';

const read = (name: string): string =>
  decodeBytes(
    new Uint8Array(readFileSync(new URL(`../fixtures/statement/${name}`, import.meta.url))),
  ).text;

/** `D 4520` per row: direction and unsigned minor units. */
const signed = (rows: readonly StatementRow[]): string =>
  rows.map((r) => `${r.direction === 'debit' ? 'D' : 'C'} ${r.amount}`).join(' ');

interface TableCase {
  readonly file: string;
  readonly profile: string;
  readonly currency: string;
  readonly order: 'dmy' | 'mdy';
  readonly rows: string;
  readonly first: string;
  readonly last: string;
  /** Rows carry balances and they add up; `[checked, failed]`. */
  readonly balance?: readonly [number, number];
  readonly skipped?: number;
  readonly options?: TableParseOptions;
}

const TABLES: readonly TableCase[] = [
  // --- India: the five banks' own exports, as other projects captured them ---
  {
    file: 'real/mentria-ai-website/in-icici.csv',
    profile: 'icici',
    currency: 'INR',
    order: 'dmy',
    rows: 'C 18500000 D 4200000 D 45650 D 231000 D 500000 C 123400',
    first: '2026-08-01',
    last: '2026-08-30',
    balance: [5, 0],
    skipped: 2, // "Legends Used in Account Statement", "INT - Interest"
  },
  {
    file: 'real/mentria-ai-website/in-axis.csv',
    profile: 'axis',
    currency: 'INR',
    order: 'dmy',
    rows: 'C 12000000 D 45650 D 1500000',
    first: '2026-09-01',
    last: '2026-09-13',
    balance: [2, 0],
    skipped: 1,
  },
  {
    file: 'real/mentria-ai-website/in-kotak.csv',
    profile: 'kotak',
    currency: 'INR',
    order: 'dmy',
    rows: 'C 12000000 D 3200000 D 149900 D 500000 C 29900',
    first: '2026-09-01',
    last: '2026-09-25',
    balance: [4, 0],
  },
  {
    file: 'real/mentria-ai-website/in-sbi.txt',
    profile: 'sbi',
    currency: 'INR',
    order: 'dmy',
    rows: 'C 14500000 D 3200000 D 500000 C 123400',
    first: '2026-09-01',
    last: '2026-09-30',
    balance: [3, 0],
    skipped: 1,
  },
  {
    file: 'real/mentria-ai-website/in-drcr.csv',
    profile: 'generic',
    currency: 'INR',
    order: 'dmy',
    rows: 'C 12000000 D 3200000 D 149900 C 29900',
    first: '2026-09-01',
    last: '2026-09-25',
    balance: [3, 0],
  },
  {
    file: 'real/KanveerMadan-Vaulta/axis.csv',
    profile: 'axis',
    currency: 'INR',
    order: 'dmy',
    rows: 'D 184525 D 1200000 C 500000 D 64900',
    first: '2024-06-01',
    last: '2024-06-04',
    balance: [3, 0],
  },
  {
    file: 'real/KanveerMadan-Vaulta/icici.csv',
    profile: 'icici',
    currency: 'INR',
    order: 'dmy',
    rows: 'D 61200 D 150000 D 79900 C 6000000 D 125000',
    first: '2024-04-01',
    last: '2024-04-05',
    balance: [4, 0],
  },
  {
    file: 'real/KanveerMadan-Vaulta/kotak.csv',
    profile: 'kotak',
    currency: 'INR',
    order: 'dmy',
    rows: 'D 38200 C 45000 D 523000',
    first: '2024-07-05',
    last: '2024-07-07',
    balance: [2, 0],
  },
  {
    file: 'real/KanveerMadan-Vaulta/sbi.csv',
    profile: 'sbi',
    currency: 'INR',
    order: 'dmy',
    rows: 'D 32500 C 80000 D 300000 D 99900',
    first: '2024-05-15',
    last: '2024-05-18',
    balance: [3, 0],
  },
  {
    // A bad date and a 0.00 reversal are dropped; the balance check then catches
    // that the dropped row carried money (one mismatch), as it should.
    file: 'real/KanveerMadan-Vaulta/hdfc.csv',
    profile: 'hdfc',
    currency: 'INR',
    order: 'dmy',
    rows: 'D 45000 D 120000 C 8500000 D 200000 D 10000 D 234550 D 29900',
    first: '2024-03-05',
    last: '2024-03-12',
    balance: [6, 1],
    skipped: 2,
  },
  {
    file: 'real/CaptainAni187-residual/statement_axis.csv',
    profile: 'axis',
    currency: 'INR',
    order: 'dmy',
    rows: 'C 12690700 C 9814530 D 82600',
    first: '2026-03-02',
    last: '2026-03-04',
    balance: [2, 0],
  },
  {
    file: 'real/CaptainAni187-residual/statement_icici.csv',
    profile: 'icici',
    currency: 'INR',
    order: 'dmy',
    rows: 'C 12690700 C 9814530 D 82600',
    first: '2026-03-02',
    last: '2026-03-04',
    balance: [2, 0],
  },
  {
    file: 'real/CaptainAni187-residual/statement_sbi.csv',
    profile: 'sbi',
    currency: 'INR',
    order: 'dmy',
    rows: 'C 12690700 C 9814530 D 82600',
    first: '2026-03-02',
    last: '2026-03-04',
    balance: [2, 0],
  },
  // --- US ---
  {
    file: 'real/mentria-ai-website/us-chase-checking.csv',
    profile: 'chase_checking',
    currency: 'USD',
    order: 'mdy',
    rows: 'D 4500 C 285000 D 1549 D 12000 D 1200 C 25000 D 6000 D 8437 D 50000 D 7352 C 285000 D 61240',
    first: '2026-09-30',
    last: '2026-09-15',
    balance: [11, 0],
  },
  {
    file: 'real/mentria-ai-website/us-chase-card.csv',
    profile: 'chase_card',
    currency: 'USD',
    order: 'mdy',
    rows: 'D 3499 D 3900 C 61240 D 2317 C 1250 D 1199 D 481',
    first: '2026-09-28',
    last: '2026-09-05',
  },
  {
    file: 'real/mentria-ai-website/us-bofa.csv',
    profile: 'bofa',
    currency: 'USD',
    order: 'mdy',
    rows: 'C 280000 D 8999 D 179500 D 5233 C 280000 D 8999 D 179500 D 123456',
    first: '2026-07-01',
    last: '2026-08-31',
    balance: [7, 0],
    skipped: 1,
  },
  {
    file: 'real/mentria-ai-website/us-wellsfargo.csv',
    profile: 'wells_fargo',
    currency: 'USD',
    order: 'mdy',
    rows: 'D 475 C 214055 D 165000 D 6218 D 825 D 475',
    first: '2026-09-30',
    last: '2026-09-02',
  },
  {
    file: 'real/openaccountant-wilson/bofa-checking-standard.csv',
    profile: 'bofa',
    currency: 'USD',
    order: 'mdy',
    rows: 'D 4267 D 12850 D 35000 C 320000 D 8000 D 4500 D 240000',
    first: '2026-01-03',
    last: '2026-01-28',
    balance: [6, 0],
    skipped: 2, // "Beginning balance" and "Ending balance" rows carry no amount
  },
  {
    file: 'real/openaccountant-wilson/bofa-checking-edge-cases.csv',
    profile: 'bofa',
    currency: 'USD',
    order: 'mdy',
    rows: 'C 5000000 D 1 D 50000 D 3500 C 3500 C 45 C 320000 D 75000 C 20000 D 1200 C 1200 D 1000000 D 50000',
    first: '2026-01-02',
    last: '2026-01-28',
    balance: [12, 0],
    skipped: 2,
  },
  {
    file: 'real/openaccountant-wilson/chase-standard.csv',
    profile: 'chase_card',
    currency: 'USD',
    order: 'mdy',
    rows: 'D 4267 D 12850 D 4999 C 320000 D 575 D 18930 C 18930 D 240000 D 1842',
    first: '2026-01-03',
    last: '2026-02-05',
  },
  {
    file: 'real/openaccountant-wilson/chase-edge-cases.csv',
    profile: 'chase_card',
    currency: 'USD',
    order: 'mdy',
    rows: 'D 9342 D 575 D 1599 D 2250 D 8500 D 1 C 0 C 5000000 D 1499 C 1499 D 6789 D 2500 D 15000 D 150000 C 83',
    first: '2026-01-05',
    last: '2026-01-31',
  },
  {
    file: 'real/openaccountant-wilson/generic-debit-credit-cols.csv',
    profile: 'generic',
    currency: 'USD',
    order: 'mdy',
    rows: 'D 4267 D 12850 D 4999 C 320000 D 575 D 20000 C 15000 D 8930 D 240000 C 45',
    first: '2026-01-03',
    last: '2026-02-05',
    options: { country: 'US' },
  },
  {
    file: 'real/openaccountant-wilson/generic-edge-cases.csv',
    profile: 'generic',
    currency: 'USD',
    order: 'mdy',
    rows: 'D 4267 D 12850 D 4530 D 1200 D 5500 D 1899 C 320000 D 2500 D 1000 D 9999 D 1 C 0 D 2500000',
    first: '2026-01-03',
    last: '2026-01-30',
    options: { country: 'US' },
  },
  {
    file: 'real/Maxed-OSS-statement-normalizer/chase_checking.csv',
    profile: 'chase_checking',
    currency: 'USD',
    order: 'mdy',
    rows: 'D 4520 C 250000 D 6240 D 120000 C 3310',
    first: '2024-01-05',
    last: '2024-01-15',
    balance: [4, 0],
  },
  {
    file: 'real/Maxed-OSS-statement-normalizer/bofa_checking.csv',
    profile: 'bofa',
    currency: 'USD',
    order: 'mdy',
    rows: 'D 4520 C 250000 D 6240 D 11822 C 3310',
    first: '2024-01-05',
    last: '2024-01-15',
    balance: [4, 0],
  },
  {
    // A header a tool added to Wells Fargo's bare export: read by its words, not as the bank.
    file: 'real/Maxed-OSS-statement-normalizer/wells_fargo_checking.csv',
    profile: 'generic',
    currency: 'USD',
    order: 'mdy',
    rows: 'D 4520 C 250000 D 6240 D 120000 D 7318',
    first: '2024-01-05',
    last: '2024-01-14',
    options: { currency: 'USD' },
  },
  {
    file: 'real/Maxed-OSS-statement-normalizer/capital_one_creditcard.csv',
    profile: 'capone_card',
    currency: 'USD',
    order: 'mdy',
    rows: 'D 4520 D 1599 D 8235 C 25000 D 2999',
    first: '2024-02-01',
    last: '2024-02-07',
  },
  // --- UK / EU ---
  {
    file: 'real/mentria-ai-website/uk-monzo.csv',
    profile: 'monzo',
    currency: 'GBP',
    order: 'dmy',
    rows: 'D 495 C 245000 D 3850 D 6217 D 20000 D 780',
    first: '2026-09-01',
    last: '2026-09-25',
  },
  {
    file: 'real/mentria-ai-website/eu-revolut.csv',
    profile: 'revolut',
    currency: 'EUR',
    order: 'dmy',
    rows: 'D 2345 C 50000 D 1160 D 7500 C 2995',
    first: '2026-09-02',
    last: '2026-09-23',
    balance: [4, 0],
  },
  {
    file: 'real/MugenLab-ledgerbridge/revolut.csv',
    profile: 'revolut',
    currency: 'GBP',
    order: 'dmy',
    rows: 'D 1420 C 25000 D 865',
    first: '2026-03-02',
    last: '2026-03-11',
    balance: [2, 0],
  },
  // --- UAE / Australia, in the shape of layouts that could not be vendored ---
  {
    file: 'specimen-shaped/adcb-posting-date.csv',
    profile: 'adcb',
    currency: 'AED',
    order: 'dmy',
    rows: 'D 25050 C 1200000 D 100000 D 41900 D 1100000',
    first: '2024-01-02',
    last: '2024-01-28',
    balance: [4, 0],
  },
  {
    file: 'specimen-shaped/westpac-corporate-online.csv',
    profile: 'westpac_corporate',
    currency: 'AUD',
    order: 'dmy',
    rows: 'D 500000 C 125075 D 36000',
    first: '2026-02-08',
    last: '2026-02-09',
    skipped: 2, // balance-only rows
  },
];

describe.each(TABLES)('$file', (c) => {
  const result = parseStatementTable(readTable(read(c.file)), {
    today: '2026-10-17',
    ...c.options,
  });
  if (!result.ok) throw new Error(`${c.file}: ${result.reason}`);

  it(`is read as ${c.profile} in ${c.currency}, every row to the minor unit`, () => {
    expect(result.profile).toBe(c.profile);
    expect(result.currency).toBe(c.currency);
    expect(signed(result.rows)).toBe(c.rows);
    expect(result.rows[0]!.date).toBe(c.first);
    expect(result.rows[result.rows.length - 1]!.date).toBe(c.last);
    expect(result.dateOrder).toBe(c.order);
    expect(result.dateAmbiguous).toBe(false);
    expect(result.rows.every((r) => r.date !== null)).toBe(true);
    if (c.skipped !== undefined) expect(result.skipped).toBe(c.skipped);
  });

  it(c.balance ? 'carries balances that add up' : 'carries no balances', () => {
    if (c.balance) {
      expect(result.rows.every((r) => r.balance !== null)).toBe(true);
      expect([result.balanceChecked, result.balanceFailed]).toEqual(c.balance);
    } else {
      expect(result.rows.every((r) => r.balance === null)).toBe(true);
    }
  });
});

interface PdfCase {
  readonly file: string;
  readonly order?: 'dmy' | 'mdy';
  readonly rows: string;
  readonly dates: readonly string[];
  readonly opening: string | null;
  readonly balance: readonly [number, number];
  readonly unreadable?: number;
  /** Rows whose direction the balance arithmetic settled (0.9). */
  readonly sure?: number;
}

const PDFS: readonly PdfCase[] = [
  {
    // Two pages; narrations wrap below the row and across the page break; the
    // summary, header and footer blocks of each page never become rows.
    file: 'real/raptar231-indian-bank-statement-parser/hdfc/hdfc_savings-april-2026.txt',
    rows: 'D 1200000 D 350000 D 2500000 D 400000 D 650000 D 15000 C 180000 C 50000 D 1800000 C 25000 D 300000 D 1520000 D 480050 D 850000 C 17500000',
    dates: ['2026-04-01', '2026-04-28'],
    opening: null,
    balance: [14, 0],
    sure: 14,
  },
  {
    // The year of each row sits on the line below its dates.
    file: 'real/raptar231-indian-bank-statement-parser/sbi/netbanking_2021_22.txt',
    rows: 'C 400000 D 250000 D 100000 C 500000 D 300000',
    dates: ['2021-04-01', '2021-04-20'],
    opening: null,
    balance: [4, 0],
    sure: 4,
  },
  {
    file: 'real/raptar231-indian-bank-statement-parser/sbi/netbanking_2018_19.txt',
    rows: 'C 2500000 D 200000 C 150000 D 120000 C 1500',
    dates: ['2018-04-18', '2018-04-30'],
    opening: null,
    balance: [4, 0],
    sure: 4,
  },
  {
    // YONO: the date on one line, the narration on the next, the figures on a
    // third with "-" for the empty columns; the opening balance stated at the end.
    file: 'real/raptar231-indian-bank-statement-parser/sbi/yono_savings_multi_jan_2026.txt',
    rows: 'D 9000 C 300',
    dates: ['2025-12-04', '2025-12-25'],
    opening: '32621',
    balance: [2, 0],
    sure: 2,
  },
  {
    file: 'specimen-shaped/icici-sno-remarks.pdf.txt',
    rows: 'D 19900 D 500000 C 49920 D 1600000 D 1000000 C 5056700 D 100000',
    dates: ['2026-04-02', '2026-04-10'],
    opening: null,
    balance: [6, 0],
    sure: 6,
  },
  {
    file: 'specimen-shaped/axis-initbr.pdf.txt',
    rows: 'C 2000000 D 160000 D 12490 C 162800 D 16200 D 2000000 C 50000 D 300000 C 5056700',
    dates: ['2026-04-02', '2026-04-16'],
    opening: '924973',
    balance: [9, 0],
    sure: 9,
  },
  {
    file: 'specimen-shaped/kotak-drcr.pdf.txt',
    rows: 'D 34700 C 3500000 C 200000 D 125000 D 450000 C 12500 D 20500',
    dates: ['2025-07-01', '2025-07-31'],
    opening: '1000000',
    balance: [7, 0],
    sure: 7,
  },
  {
    file: 'specimen-shaped/anz-personal.pdf.txt',
    rows: 'D 3395 D 12000 D 25000 C 210000 D 20000',
    dates: ['2025-12-30', '2026-01-09'],
    opening: '659777',
    balance: [5, 0],
    sure: 5,
  },
  {
    file: 'specimen-shaped/wells-fargo-checking.pdf.txt',
    order: 'mdy',
    rows: 'D 4520 C 50000 D 1599 C 4076 D 25000 D 20000 C 100000 D 726 D 1000',
    dates: ['2025-12-16', '2026-01-15'],
    opening: '200000',
    balance: [9, 0],
    sure: 9,
  },
  {
    // No running balance: the sign and the section heading give the direction.
    file: 'specimen-shaped/bofa-checking.pdf.txt',
    order: 'mdy',
    rows: 'C 250000 C 15000 D 4632 D 8500 D 20000 D 102100 D 10000 D 12500 D 1200',
    dates: ['2012-07-05', '2012-07-31'],
    opening: null,
    balance: [0, 0],
    sure: 0,
  },
  {
    file: 'specimen-shaped/commbank-foundation-card.pdf.txt',
    rows: 'D 8550 D 10000 D 6000 D 425 D 2310',
    dates: ['2026-01-02', '2026-01-20'],
    opening: '45000',
    balance: [0, 0],
    sure: 0,
  },
];

describe.each(PDFS)('$file', (c) => {
  const pages = read(c.file).split(/^=== PAGE ===$/m);
  const result = parseStatementText(pages, { today: '2026-10-17', order: c.order });

  it('reads every row, dated, with the right direction and amount', () => {
    expect(signed(result.rows)).toBe(c.rows);
    expect(result.rows[0]!.date).toBe(c.dates[0]);
    expect(result.rows[result.rows.length - 1]!.date).toBe(c.dates[1]);
    expect(result.rows.every((r) => r.date !== null)).toBe(true);
    expect(result.unreadable).toBe(c.unreadable ?? 0);
  });

  it('agrees with the statement’s own balances', () => {
    expect(result.openingBalance).toBe(c.opening);
    expect([result.balanceChecked, result.balanceFailed]).toEqual(c.balance);
    if (c.sure !== undefined) {
      expect(result.rows.filter((r) => r.confidence >= 0.9)).toHaveLength(c.sure);
    }
  });

  it('keeps headers, summaries, totals and footers out of the narrations', () => {
    const text = result.rows.map((r) => r.description).join('\n');
    expect(text).not.toMatch(
      /total|opening balance|closing balance|page \d|statement summary|customer care|daily ledger|account number|=== PAGE/i,
    );
  });
});

interface OfxCase {
  readonly file: string;
  readonly currency: string;
  readonly rows: string;
  readonly first: string;
  readonly closing: string | null;
  readonly refs?: readonly string[];
}

const OFX: readonly OfxCase[] = [
  {
    file: 'real/mentria-ai-website/us-ofx2.ofx',
    currency: 'USD',
    rows: 'D 675 D 142500 C 310422 D 5412 D 1200',
    first: '2026-09-03',
    closing: '421135',
    refs: ['OFX2202609030'],
  },
  {
    // An OFX 2 XML header over an SGML body, a credit card, MEMO only, a negative ledger.
    file: 'real/jseutter-ofxparse/anzcc.ofx',
    currency: 'AUD',
    rows: 'D 550',
    first: '2017-05-08',
    closing: '-12345',
    refs: ['201705080001'],
  },
  {
    // CDATA-wrapped names, a one-digit FITID.
    file: 'real/jseutter-ofxparse/suncorp.ofx',
    currency: 'AUD',
    rows: 'D 1685',
    first: '2013-12-15',
    closing: '123412',
    refs: ['201312151'],
  },
  {
    file: 'real/jseutter-ofxparse/checking.ofx',
    currency: 'USD',
    rows: 'C 1 D 3451 D 2500',
    first: '2011-03-31',
    closing: '10099',
    refs: ['201103310000486', '201104050000487', '201104070000488'],
  },
  {
    file: 'real/jseutter-ofxparse/bank_medium.ofx',
    currency: 'CAD',
    rows: 'D 660 D 31667 D 2200',
    first: '2009-04-01',
    closing: '38234',
  },
  {
    file: 'real/MugenLab-ledgerbridge/bank_ofx1.ofx',
    currency: 'USD',
    rows: 'D 4250 C 250000 D 12000 D 999',
    first: '2026-01-05',
    closing: '332751',
  },
  {
    file: 'real/MugenLab-ledgerbridge/creditcard.qfx',
    currency: 'USD',
    rows: 'D 6420 C 50000 D 111',
    first: '2026-03-02',
    closing: '-23431',
    refs: ['20260302CC0001'],
  },
  {
    file: 'real/MugenLab-ledgerbridge/ofx2_header_sgml_body.ofx',
    currency: 'CAD',
    rows: 'D 6420',
    first: '2026-04-08',
    closing: '-6420',
  },
  {
    // `-1.234,56` under CURDEF EUR: both separators present, so the last one is the point.
    file: 'real/MugenLab-ledgerbridge/ofx_comma_decimals.ofx',
    currency: 'EUR',
    rows: 'D 123456 C 200000',
    first: '2026-03-04',
    closing: '176544',
  },
];

describe.each(OFX)('$file', (c) => {
  it('is OFX, read to the cent with the bank’s own ids', () => {
    const text = read(c.file);
    expect(looksLikeOfx(text)).toBe(true);
    const result = parseOfx(text);
    if (!result.ok) throw new Error(result.reason);
    expect(result.currency).toBe(c.currency);
    expect(signed(result.rows)).toBe(c.rows);
    expect(result.rows[0]!.date).toBe(c.first);
    expect(result.closingBalance).toBe(c.closing);
    expect(result.skipped).toBe(0);
    if (c.refs) expect(result.rows.slice(0, c.refs.length).map((r) => r.ref)).toEqual(c.refs);
  });
});

describe('details the real files pin down', () => {
  it('Suncorp: CDATA-wrapped NAME and MEMO are read, not dropped', () => {
    const result = parseOfx(read('real/jseutter-ofxparse/suncorp.ofx'));
    if (!result.ok) throw new Error(result.reason);
    expect(result.rows[0]!.description).toBe(
      'EFTPOS WDL HANDYWAY ALDI STORE EFTPOS WDL HANDYWAY ALDI STORE GEELONG WEST VICAU',
    );
  });

  it('an empty OFX is "no transactions", not a crash', () => {
    expect(parseOfx(read('real/jseutter-ofxparse/bank_small.ofx'))).toEqual({
      ok: false,
      reason: 'no_transactions',
    });
  });

  it('SBI’s NetBanking export is tab-separated with padded header cells', () => {
    const table = readTable(read('real/mentria-ai-website/in-sbi.txt'));
    expect(table.delimiter).toBe('\t');
  });

  it('Chase checking: a trailing empty cell on every row and a negative balance are fine', () => {
    const result = parseStatementTable(
      readTable(read('real/mentria-ai-website/us-chase-checking.csv')),
      {
        today: '2026-10-17',
      },
    );
    if (!result.ok) throw new Error(result.reason);
    expect(result.rows[11]!.balance).toBe('-193380');
  });

  it('Kotak: the second Dr/Cr column says which way the balance is', () => {
    const csv =
      'Sl. No.,Date,Description,Chq / Ref number,Amount,Dr / Cr,Balance,Dr / Cr\n' +
      '1,01-09-2026,UPI/X/624612345678/Rent,UTR1,"1,000.00",DR,"200.00",DR\n' +
      '2,02-09-2026,SALARY,UTR2,"1,200.00",CR,"1,000.00",CR\n';
    const result = parseStatementTable(readTable(csv), { today: '2026-10-17' });
    if (!result.ok) throw new Error(result.reason);
    expect(result.profile).toBe('kotak');
    expect(result.rows.map((r) => r.balance)).toEqual(['-20000', '100000']);
    expect(result.balanceFailed).toBe(0);
  });

  it('the HDFC export in the “Chq/Ref Number … Debit Amount” wording is still HDFC', () => {
    expect(
      parseStatementTable(readTable(read('real/KanveerMadan-Vaulta/hdfc.csv')), {
        today: '2026-10-17',
      }),
    ).toMatchObject({ profile: 'hdfc', bank: 'HDFC Bank' });
  });

  it('the Vaulta HDFC file: an empty narration becomes "Transaction", a 0.00 row is skipped', () => {
    const result = parseStatementTable(readTable(read('real/KanveerMadan-Vaulta/hdfc.csv')), {
      today: '2026-10-17',
    });
    if (!result.ok) throw new Error(result.reason);
    expect(result.rows[4]!.description).toBe('Transaction');
    expect(result.rows.some((r) => r.amount === '0')).toBe(false);
    expect(result.rows[5]!.warnings).toContain('balance_mismatch');
  });

  it('Westpac Corporate Online: a quoted multiline narrative is one row, one line', () => {
    const result = parseStatementTable(
      readTable(read('specimen-shaped/westpac-corporate-online.csv')),
      { today: '2026-10-17' },
    );
    if (!result.ok) throw new Error(result.reason);
    expect(result.rows).toHaveLength(3);
    expect(result.rows[0]!.description).toBe('PAYMENT TO SAMPLE SUPPLIER INV 1001');
    expect(result.rows[1]!.ref).toBe('NPP000000001');
    // CLOSING_BAL is the account's closing balance on every row, not a running one.
    expect(result.rows.every((r) => r.balance === null)).toBe(true);
    expect(result.balanceChecked).toBe(0);
  });

  it('ADCB’s e-statement: the metadata lines are skipped and the posting time ignored', () => {
    const result = parseStatementTable(readTable(read('specimen-shaped/adcb-posting-date.csv')), {
      today: '2026-10-17',
    });
    if (!result.ok) throw new Error(result.reason);
    expect(result.bank).toBe('ADCB');
    expect(result.rows[0]!.ref).toBe('REF0000001');
    expect(result.rows[0]!.date).toBe('2024-01-02');
  });
});
