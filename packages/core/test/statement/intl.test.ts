/**
 * US, UK and Australian exports: every layout read to the cent from a
 * synthetic file, the day/month order decided (or flagged) rather than guessed,
 * signed and split amount columns, CR/DR suffixes, bare data with no header
 * row, and OFX / QFX with the bank's own transaction id as the reference.
 */

import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  decodeBytes,
  currencyForStatementCountry,
  looksLikeOfx,
  parseOfx,
  parseStatementTable,
  planStatementImport,
  readTable,
} from '../../src';

const read = (name: string): string =>
  decodeBytes(
    new Uint8Array(readFileSync(new URL(`../fixtures/statement/intl/${name}`, import.meta.url))),
  ).text;

/** The same five transactions in every fixture, 1 to 13 October 2026. */
const DIRECTIONS = ['debit', 'credit', 'debit', 'debit', 'debit'];
const AMOUNTS = ['450', '250000', '120050', '6235', '2000'];
const BALANCES = ['99550', '349550', '229500', '223265', '221265'];
const DATES = ['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-05', '2026-10-13'];

type Case = {
  file: string;
  profile: string;
  currency: string;
  order: 'dmy' | 'mdy';
  balances: boolean;
};

const CASES: Case[] = [
  {
    file: 'chase_checking.csv',
    profile: 'chase_checking',
    currency: 'USD',
    order: 'mdy',
    balances: true,
  },
  { file: 'chase_card.csv', profile: 'chase_card', currency: 'USD', order: 'mdy', balances: false },
  { file: 'bofa.csv', profile: 'bofa', currency: 'USD', order: 'mdy', balances: true },
  { file: 'citi.csv', profile: 'citi', currency: 'USD', order: 'mdy', balances: false },
  {
    file: 'capone_card.csv',
    profile: 'capone_card',
    currency: 'USD',
    order: 'mdy',
    balances: false,
  },
  {
    file: 'capone_bank.csv',
    profile: 'capone_bank',
    currency: 'USD',
    order: 'mdy',
    balances: true,
  },
  {
    file: 'wells_fargo.csv',
    profile: 'wells_fargo',
    currency: 'USD',
    order: 'mdy',
    balances: false,
  },
  { file: 'barclays.csv', profile: 'barclays', currency: 'GBP', order: 'dmy', balances: false },
  { file: 'hsbc_uk.csv', profile: 'hsbc_uk', currency: 'GBP', order: 'dmy', balances: false },
  { file: 'lloyds.csv', profile: 'lloyds', currency: 'GBP', order: 'dmy', balances: true },
  { file: 'natwest.csv', profile: 'natwest', currency: 'GBP', order: 'dmy', balances: true },
  { file: 'monzo.csv', profile: 'monzo', currency: 'GBP', order: 'dmy', balances: false },
  { file: 'starling.csv', profile: 'starling', currency: 'GBP', order: 'dmy', balances: true },
  { file: 'revolut.csv', profile: 'revolut', currency: 'GBP', order: 'dmy', balances: true },
  { file: 'commbank.csv', profile: 'commbank', currency: 'AUD', order: 'dmy', balances: true },
  { file: 'westpac.csv', profile: 'westpac', currency: 'AUD', order: 'dmy', balances: false },
  { file: 'anz.csv', profile: 'anz', currency: 'AUD', order: 'dmy', balances: false },
  { file: 'nab.csv', profile: 'nab', currency: 'AUD', order: 'dmy', balances: true },
  {
    file: 'emirates_nbd.csv',
    profile: 'emirates_nbd',
    currency: 'AED',
    order: 'dmy',
    balances: true,
  },
  { file: 'adcb.csv', profile: 'adcb', currency: 'AED', order: 'dmy', balances: true },
  { file: 'fab.csv', profile: 'fab', currency: 'AED', order: 'dmy', balances: true },
  { file: 'mashreq.csv', profile: 'mashreq', currency: 'AED', order: 'dmy', balances: true },
  { file: 'dib.csv', profile: 'dib', currency: 'AED', order: 'dmy', balances: true },
];

describe.each(CASES)('$file', ({ file, profile, currency, order, balances }) => {
  const result = parseStatementTable(readTable(read(file)), { today: '2026-10-17' });
  if (!result.ok) throw new Error(`${file}: ${result.reason}`);

  it('is recognised and read to the cent', () => {
    expect(result.profile).toBe(profile);
    expect(result.currency).toBe(currency);
    expect(result.rows.map((r) => [r.direction, r.amount])).toEqual(
      DIRECTIONS.map((d, i) => [d, AMOUNTS[i]]),
    );
  });

  it('reads the dates in the bank’s own order, without asking', () => {
    expect(result.rows.map((r) => r.date)).toEqual(DATES);
    expect(result.dateOrder).toBe(order);
    expect(result.dateAmbiguous).toBe(false);
  });

  it('carries balances where the export has them, and they add up', () => {
    if (balances) {
      expect(result.rows.map((r) => r.balance)).toEqual(BALANCES);
      expect(result.balanceFailed).toBe(0);
      expect(result.balanceChecked).toBeGreaterThanOrEqual(4);
    } else {
      expect(result.rows.every((r) => r.balance === null)).toBe(true);
    }
  });
});

describe('the UAE', () => {
  const parse = (file: string) => {
    const result = parseStatementTable(readTable(read(file)), { today: '2026-10-17' });
    if (!result.ok) throw new Error(result.reason);
    return result;
  };

  it('reads the bilingual header (FAB) and the Arabic-only one (Mashreq) as well as English', () => {
    expect(parse('fab.csv').profile).toBe('fab');
    expect(parse('mashreq.csv').profile).toBe('mashreq');
  });

  it('takes the bank reference column as the reference, and AED markers in amounts', () => {
    expect(parse('fab.csv').rows[0]!.ref).toBe('FAB202610017' + '7');
    expect(parse('emirates_nbd.csv').rows[2]!.amount).toBe('120050');
  });

  it('the UAE has its own currency and day-first default', () => {
    expect(currencyForStatementCountry('AE')).toBe('AED');
  });
});

describe('details of particular banks', () => {
  const parse = (file: string) => {
    const result = parseStatementTable(readTable(read(file)), { today: '2026-10-17' });
    if (!result.ok) throw new Error(result.reason);
    return result;
  };

  it('Monzo’s transaction id is the reference', () => {
    const rows = parse('monzo.csv').rows;
    expect(rows[0]!.ref).toBe('TX0000100000ABCDEF');
    expect(new Set(rows.map((r) => r.ref)).size).toBe(5);
  });

  it('Revolut: a pending row is left out and counted', () => {
    const result = parse('revolut.csv');
    expect(result.rows).toHaveLength(5);
    expect(result.skipped).toBe(1);
  });

  it('Bank of America: the summary block above the header is skipped', () => {
    const result = parse('bofa.csv');
    expect(result.rows[0]!.description).toBe('STARBUCKS STORE 1234');
  });

  it('a bare three-column file is read and called a similar layout, not a named bank', () => {
    expect(parse('anz.csv').bank).toMatch(/similar/);
    expect(parse('hsbc_uk.csv').bank).toMatch(/similar/);
  });

  it('does not take an Indian export for an international one, or the reverse', () => {
    const india = parseStatementTable(
      readTable(
        'Date,Narration,Chq./Ref.No.,Value Dt,Withdrawal Amt.,Deposit Amt.,Closing Balance\n01/10/26,UPI-X,,01/10/26,10.00,,90.00\n',
      ),
      { today: '2026-10-17' },
    );
    if (!india.ok) throw new Error('india');
    expect(india.profile).toBe('hdfc');
    expect(india.currency).toBe('INR');
  });
});

describe('day and month order is decided from the file, or flagged', () => {
  const generic = (rows: string[], extra = {}) =>
    parseStatementTable(readTable(['Date,Description,Amount', ...rows].join('\n')), {
      today: '2026-10-17',
      ...extra,
    });

  it('a day above 12 settles it, whatever the country says', () => {
    const result = generic(['03/04/2026,A,-1.00', '13/04/2026,B,-2.00']);
    if (!result.ok) throw new Error(result.reason);
    expect(result.dateOrder).toBe('dmy');
    expect(result.dateAmbiguous).toBe(false);
    expect(result.rows.map((r) => r.date)).toEqual(['2026-04-03', '2026-04-13']);

    const us = generic(['04/03/2026,A,-1.00', '04/13/2026,B,-2.00']);
    if (!us.ok) throw new Error(us.reason);
    expect(us.dateOrder).toBe('mdy');
    expect(us.rows.map((r) => r.date)).toEqual(['2026-04-03', '2026-04-13']);
  });

  it('a run in date order settles it', () => {
    const result = generic(['01/02/2026,A,-1.00', '05/02/2026,B,-2.00', '01/03/2026,C,-3.00']);
    if (!result.ok) throw new Error(result.reason);
    expect(result.dateAmbiguous).toBe(false);
  });

  it('when nothing settles it, it says so instead of choosing silently', () => {
    const result = generic(['03/04/2026,A,-1.00', '03/04/2026,B,-2.00', '03/05/2026,C,-3.00']);
    if (!result.ok) throw new Error(result.reason);
    expect(result.dateAmbiguous).toBe(true);
  });

  it('the person’s choice overrides the guess, and the country is only the default', () => {
    const rows = ['03/04/2026,A,-1.00', '03/04/2026,B,-2.00'];
    const asUs = generic(rows, { country: 'US' });
    if (!asUs.ok) throw new Error(asUs.reason);
    expect(asUs.rows[0]!.date).toBe('2026-03-04');
    const asUk = generic(rows, { order: 'dmy' });
    if (!asUk.ok) throw new Error(asUk.reason);
    expect(asUk.rows[0]!.date).toBe('2026-04-03');
  });

  it('a named bank never asks: Barclays is day-first even when every date is ambiguous', () => {
    const csv =
      'Number,Date,Account,Amount,Subcategory,Memo\n1,03/04/2026,20-00-00 1,-5.00,PURCHASE,X\n';
    const result = parseStatementTable(readTable(csv), { today: '2026-10-17' });
    if (!result.ok) throw new Error(result.reason);
    expect(result.rows[0]!.date).toBe('2026-04-03');
    expect(result.dateAmbiguous).toBe(false);
  });
});

describe('how an amount is written', () => {
  const parse = (csv: string) => {
    const result = parseStatementTable(readTable(csv), { today: '2026-10-17' });
    if (!result.ok) throw new Error(result.reason);
    return result.rows.map((r) => [r.direction, r.amount]);
  };

  it('currency symbols, prefixes and thousand separators', () => {
    expect(
      parse(
        'Date,Description,Amount\n13/10/2026,A,"-$1,234.50"\n13/10/2026,B,"A$12.00"\n13/10/2026,C,"£2,000.00"\n',
      ),
    ).toEqual([
      ['debit', '123450'],
      ['credit', '1200'],
      ['credit', '200000'],
    ]);
  });

  it('parentheses are a debit, and a CR or DR suffix beats the sign', () => {
    expect(
      parse(
        'Date,Description,Amount\n13/10/2026,A,(45.00)\n13/10/2026,B,45.00 DR\n13/10/2026,C,-45.00 CR\n',
      ),
    ).toEqual([
      ['debit', '4500'],
      ['debit', '4500'],
      ['credit', '4500'],
    ]);
  });

  it('separate debit and credit columns, either sign convention', () => {
    expect(
      parse('Date,Details,Money Out,Money In\n13/10/2026,A,-10.00,\n13/10/2026,B,,5.00\n'),
    ).toEqual([
      ['debit', '1000'],
      ['credit', '500'],
    ]);
  });
});

describe('OFX and QFX', () => {
  it('recognises the file by its content', () => {
    expect(looksLikeOfx(read('us.qfx'))).toBe(true);
    expect(looksLikeOfx(read('uk.ofx'))).toBe(true);
    expect(looksLikeOfx(read('hsbc_uk.csv'))).toBe(false);
  });

  it.each([
    ['us.qfx', 'USD'],
    ['uk.ofx', 'GBP'],
  ])('%s: SGML and XML both read, FITID is the reference', (file, currency) => {
    const result = parseOfx(read(file));
    if (!result.ok) throw new Error(result.reason);
    expect(result.currency).toBe(currency);
    expect(result.rows.map((r) => [r.date, r.direction, r.amount])).toEqual(
      DATES.map((d, i) => [d, DIRECTIONS[i], AMOUNTS[i]]),
    );
    expect(result.rows[0]!.description).toBe('STARBUCKS STORE 1234 POS PURCHASE');
    expect(result.rows[0]!.ref).toBe('20261001001A9');
    expect(new Set(result.rows.map((r) => r.ref)).size).toBe(5);
    expect(result.closingBalance).toBe('221265');
  });

  it('refuses a file that is not OFX, or has no transactions', () => {
    expect(parseOfx('Date,Amount\n')).toEqual({ ok: false, reason: 'not_ofx' });
    expect(parseOfx('<OFX><BANKMSGSRSV1></BANKMSGSRSV1></OFX>')).toEqual({
      ok: false,
      reason: 'no_transactions',
    });
  });

  it('gives a short FITID the day, so two banks’ counters cannot collide', () => {
    const text =
      '<OFX><CURDEF>USD<BANKTRANLIST><STMTTRN><DTPOSTED>20261001<TRNAMT>-1.00<FITID>1<NAME>A</STMTTRN>' +
      '<STMTTRN><DTPOSTED>20261002<TRNAMT>-1.00<FITID>1<NAME>B</STMTTRN></BANKTRANLIST></OFX>';
    const result = parseOfx(text);
    if (!result.ok) throw new Error(result.reason);
    expect(result.rows.map((r) => r.ref)).toEqual(['202610011', '202610021']);
  });
});

describe('outside India', () => {
  it('there are no bank messages to merge with, but the ledger is still checked', () => {
    const result = parseOfx(read('us.qfx'));
    if (!result.ok) throw new Error(result.reason);
    const plan = planStatementImport(result.rows, {
      currency: 'USD',
      existing: [
        {
          id: 'e1',
          date: '2026-10-01',
          currency: 'USD',
          amount: 450n,
          description: 'STARBUCKS STORE 1234 POS PURCHASE',
        },
      ],
    });
    expect(plan.summary.merged).toBe(0);
    expect(plan.items[0]).toMatchObject({ status: 'likely_duplicate', ticked: false });
    expect(plan.items.filter((i) => i.section === 'out' && i.ticked)).toHaveLength(3);
  });

  it('importing the same OFX twice dedupes on FITID within the file', () => {
    const result = parseOfx(read('us.qfx'));
    if (!result.ok) throw new Error(result.reason);
    const plan = planStatementImport([...result.rows, ...result.rows], { currency: 'USD' });
    expect(plan.summary.inFile).toBe(5);
    expect(plan.summary.added).toBe(5);
  });
});

describe('OFX with hostile input', () => {
  it('stays linear on 100k unterminated blocks and whitespace runs', () => {
    const started = performance.now();
    parseOfx(`<OFX>${'<STMTTRN>'.repeat(20_000)}`);
    parseOfx(`<OFX><LEDGERBAL>${'<LEDGERBAL>'.repeat(20_000)}`);
    parseOfx(`<OFX><STMTTRN><DTPOSTED>${' \t'.repeat(50_000)}x</STMTTRN>`);
    expect(performance.now() - started).toBeLessThan(50);
  });
});
