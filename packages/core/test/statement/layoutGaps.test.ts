/**
 * The ways real exports stray from "date, narration, amount, balance", one
 * focused case each, written from samples of the banks' own output (the full
 * files are under `realFixtures.test.ts`).
 */

import { describe, expect, it } from 'vitest';

import { parseStatementTable, parseStatementText, readTable } from '../../src';

const pdf = (text: string, options: { order?: 'dmy' | 'mdy'; openingBalance?: string } = {}) =>
  parseStatementText([text], { today: '2026-10-17', ...options });

const table = (csv: string, options = {}) =>
  parseStatementTable(readTable(csv), { today: '2026-10-17', ...options });

describe('1. ICICI: a serial number first, the remarks after the amounts', () => {
  const text = [
    'S No.  Cheque Number  Transaction Remarks  Date  Withdrawal Amount (INR)  Deposit Amount (INR)  Balance (INR)',
    '1  02.04.2026  199.00  40718.24  BIL/NUCL/001100000001/Recharge/SAMPLE RECHARGE Bil Payment',
    '2  02.04.2026  5000.00  35718.24  UPI/SAMPLE PAYEE/payee@okhdfc/Payment fr/AXIS BANK/559200000001/IBL0a',
    '3  03.04.2026  499.20  36217.44  UPI/SAMPLE SHOP/9999900001@axi/Refund/AXIS BANK/820600000002/IBL0b',
  ].join('\n');

  it('reads every row with the remarks as the narration and the balance settling the direction', () => {
    const result = pdf(text);
    expect(result.unreadable).toBe(0);
    expect(result.rows.map((r) => [r.date, r.direction, r.amount, r.balance])).toEqual([
      ['2026-04-02', 'debit', '19900', '4071824'],
      ['2026-04-02', 'debit', '500000', '3571824'],
      ['2026-04-03', 'credit', '49920', '3621744'],
    ]);
    expect(result.rows[1]!.description).toBe(
      'UPI/SAMPLE PAYEE/payee@okhdfc/Payment fr/AXIS BANK/559200000001/IBL0a',
    );
    expect(result.rows[1]!.ref).toBe('559200000001');
    expect(result.balanceFailed).toBe(0);
  });

  it('does not take the serial number for the day', () => {
    expect(pdf(text).rows.map((r) => r.date)).not.toContain('2026-04-01');
  });
});

describe('2. Axis: a branch code after the balance', () => {
  it('drops the trailing Init. code and reads amount and balance', () => {
    const result = pdf(
      [
        '## Tran Date  Chq No  Particulars  Debit  Credit  Balance  Init.',
        '## OPENING BALANCE 9,249.73',
        '02-04-2026 UPI/P2A/626100000001/SAMPLE PAYER /UTIB/Payment/ 20000.00 29249.73 3693',
        '03-04-2026 UPI/P2M/645900000003/Sample Services/UPI/AXIS BANK 124.90 29124.83 248',
        '## TRANSACTION TOTAL 124.90 20,000.00',
        '## CLOSING BALANCE 29,124.83',
      ].join('\n'),
    );
    expect(result.unreadable).toBe(0);
    expect(result.openingBalance).toBe('924973');
    expect(result.rows.map((r) => [r.direction, r.amount, r.balance, r.confidence])).toEqual([
      ['credit', '2000000', '2924973', 0.9],
      ['debit', '12490', '2912483', 0.9],
    ]);
    expect(result.rows.every((r) => !/\b(?:3693|248)$/.test(r.description))).toBe(true);
    expect(result.balanceFailed).toBe(0);
  });
});

describe('3. dates without a year', () => {
  it('SBI: the year is on the next line, with the reference after it', () => {
    const result = pdf(
      [
        'Account Statement from 1 Apr 2021 to 31 Mar 2022',
        'Txn Date Value Description Ref No./Cheque Debit Credit Balance',
        '1 Apr 1 Apr BY UPI-SHOPEE 4,000.00 12,000.00',
        '2021 2021 412345678901 UPI REF-',
        '5 Apr 5 Apr TO UPI-AMAZON 2,500.00 9,500.00',
        '2021 2021 UPI/210000000000/AMZN PAY',
      ].join('\n'),
    );
    expect(result.rows.map((r) => [r.date, r.direction, r.amount])).toEqual([
      ['2021-04-01', 'credit', '400000'],
      ['2021-04-05', 'debit', '250000'],
    ]);
    expect(result.rows[0]!.description).toBe('BY UPI-SHOPEE 412345678901 UPI REF-');
    expect(result.rows[0]!.ref).toBe('412345678901');
  });

  it('ANZ: the year is printed once, and again when it changes', () => {
    const result = pdf(
      [
        'Date Transaction Details Withdrawals ($) Deposits ($) Balance ($)',
        '2025',
        '29 DEC OPENING BALANCE 6,597.77',
        '30 DEC EFTPOS 33.95 6,563.82',
        'POST ASPLEY POST SHO QLDAU',
        '2026',
        '02 JAN SALARY SAMPLE EMPLOYER 2,100.00 8,663.82',
      ].join('\n'),
    );
    expect(result.rows.map((r) => [r.date, r.direction, r.amount])).toEqual([
      ['2025-12-30', 'debit', '3395'],
      ['2026-01-02', 'credit', '210000'],
    ]);
    expect(result.rows[0]!.description).toBe('EFTPOS POST ASPLEY POST SHO QLDAU');
    expect(result.openingBalance).toBe('659777');
    expect(result.balanceChecked).toBe(2);
  });

  it('a US statement: the year comes from the period, rolling over from December to January', () => {
    const result = pdf(
      [
        'Statement period December 16, 2025 - January 15, 2026',
        'Date Description Deposits/Additions Withdrawals/Subtractions Ending daily balance',
        '12/31 Recurring Payment 15.99 2,438.81',
        '01/02 Check 250.00 2,188.81',
      ].join('\n'),
      { order: 'mdy' },
    );
    expect(result.rows.map((r) => r.date)).toEqual(['2025-12-31', '2026-01-02']);
    expect(result.unreadable).toBe(0);
  });

  it('with nothing to say which year, the rows are not guessed at', () => {
    const result = pdf('12/31 Recurring Payment 15.99 2,438.81\n01/02 Check 250.00 2,188.81');
    expect(result.rows).toHaveLength(0);
  });

  it('a statement that dates its rows in full ignores a yearless-looking address line', () => {
    const result = pdf(
      [
        '1/2 SAMPLE APARTMENT, MAIN STREET',
        'As on 31-12-25',
        '04-12-25 APY_DEC25 - - 90.00 236.21',
        '25-12-25 INTEREST CREDIT - 3.00 - 239.21',
      ].join('\n'),
    );
    expect(result.rows.map((r) => [r.date, r.direction, r.amount, r.balance])).toEqual([
      ['2025-12-04', 'debit', '9000', '23621'],
      ['2025-12-25', 'credit', '300', '23921'],
    ]);
  });
});

describe('4. real header variants', () => {
  it('Axis "Init.Br": still Axis, balance after the debit and credit columns', () => {
    const result = table(
      'Tran Date,Chq No,Particulars,Debit,Credit,Balance,Init.Br\n' +
        '01-06-2024,,UPI/P2M/415311110000/BIGBASKET/Groceries,"1,845.25",,"54,154.75",248\n' +
        '03-06-2024,,IMPS/P2A/415333330000/MOM,,"5,000.00","59,154.75",248\n',
    );
    if (!result.ok) throw new Error(result.reason);
    expect(result.profile).toBe('axis');
    expect(result.rows.map((r) => [r.direction, r.amount, r.balance])).toEqual([
      ['debit', '184525', '5415475'],
      ['credit', '500000', '5915475'],
    ]);
  });

  it('Axis "AMOUNT,DR/CR": still Axis, one amount with a marker', () => {
    const result = table(
      'Tran Date,CHQNO,PARTICULARS,AMOUNT,DR/CR,BAL,SOL\n' +
        '02-03-2026,,NEFT/RAZORPAY,126907.00,CR,841220.50,1234\n' +
        '04-03-2026,,CONSOLIDATED CHARGES,826.00,DR,840394.50,1234\n',
    );
    if (!result.ok) throw new Error(result.reason);
    expect(result.profile).toBe('axis');
    expect(result.rows.map((r) => [r.direction, r.amount])).toEqual([
      ['credit', '12690700'],
      ['debit', '82600'],
    ]);
    expect(result.balanceFailed).toBe(0);
  });

  it('Kotak "Date … Dr / Cr … Balance, Dr / Cr": still Kotak, the second marker signs the balance', () => {
    const result = table(
      'Sl. No.,Date,Description,Chq / Ref number,Amount,Dr / Cr,Balance,Dr / Cr\n' +
        '1,01-09-2026,IMPS-624401234567-ACME-SALARY,UTR100001,"1,20,000.00",CR,"2,00,000.00",CR\n' +
        '2,03-09-2026,UPI/RENT/624612345678,UTR100002,"2,32,000.00",DR,"32,000.00",DR\n',
    );
    if (!result.ok) throw new Error(result.reason);
    expect(result.profile).toBe('kotak');
    expect(result.rows.map((r) => [r.direction, r.amount, r.balance])).toEqual([
      ['credit', '12000000', '20000000'],
      ['debit', '23200000', '-3200000'],
    ]);
    expect(result.balanceFailed).toBe(0);
  });

  it('a plain "Date,Narration,Amount,Dr/Cr,Balance" is not called Kotak', () => {
    const result = table(
      'Date,Narration,Amount,Dr/Cr,Balance\n01/09/2026,SALARY,"1,20,000.00",Cr,"2,00,000.00"\n',
    );
    if (!result.ok) throw new Error(result.reason);
    expect(result.profile).toBe('generic');
  });

  it('ADCB "Posting Date … Debit Amount, Credit Amount": ADCB in dirhams, day first', () => {
    const result = table(
      '"Account Number: 10000000000001 AED",\n' +
        'Posting Date,Value Date,Reference No,Description,Debit Amount,Credit Amount,Balance\n' +
        '"02/01/2024 09:15:00","02/01/2024","REF0000001","POS PURCHASE","250.5","0.00","4,749.50",\n' +
        '"05/01/2024 12:00:00","05/01/2024","REF0000002","SALARY","0.00","12,000.00","16,749.50",\n',
    );
    if (!result.ok) throw new Error(result.reason);
    expect(result.profile).toBe('adcb');
    expect(result.currency).toBe('AED');
    expect(result.dateOrder).toBe('dmy');
    expect(result.rows.map((r) => [r.date, r.direction, r.amount, r.ref])).toEqual([
      ['2024-01-02', 'debit', '25050', 'REF0000001'],
      ['2024-01-05', 'credit', '1200000', 'REF0000002'],
    ]);
    expect(result.balanceFailed).toBe(0);
  });

  describe('a layout read from its headers alone is in the account’s currency, not rupees', () => {
    const csv = 'Transaction Date,Description,Debit,Credit\n01/15/2026,Payroll,,3200.00\n';

    it('the country’s currency when that is all that is known', () => {
      expect(table(csv, { country: 'US' })).toMatchObject({ profile: 'generic', currency: 'USD' });
      expect(table(csv, { country: 'AE' })).toMatchObject({ currency: 'AED' });
    });

    it('the account’s currency when the caller says', () => {
      expect(table(csv, { currency: 'EUR', country: 'US' })).toMatchObject({ currency: 'EUR' });
      expect(
        table('Date,Description,Amount\n01/15/2026,Payroll,3200.00\n', { currency: 'GBP' }),
      ).toMatchObject({
        profile: 'generic',
        currency: 'GBP',
      });
    });

    it('and India by default, as before', () => {
      expect(table(csv)).toMatchObject({ currency: 'INR' });
    });
  });
});

describe('5. signs', () => {
  it('a spaced minus "- 46.32" is a debit, and an unsigned figure under "Deposits" a credit', () => {
    const result = pdf(
      [
        'Deposits and other additions',
        'Date Description Amount',
        '07/05/12 ACME CORP DES:PAYROLL 2,500.00',
        'Total deposits and other additions $2,500.00',
        'Withdrawals and other subtractions',
        'Date Description Amount',
        '07/02/12 CHECKCARD 0701 SAMPLE GROCERY - 46.32',
        'Total withdrawals and other subtractions - $46.32',
      ].join('\n'),
      { order: 'mdy' },
    );
    expect(result.rows.map((r) => [r.date, r.direction, r.amount, r.confidence])).toEqual([
      ['2012-07-05', 'credit', '250000', 0.75],
      ['2012-07-02', 'debit', '4632', 0.8],
    ]);
    expect(result.rows.map((r) => r.description)).toEqual([
      'ACME CORP DES:PAYROLL',
      'CHECKCARD 0701 SAMPLE GROCERY',
    ]);
  });

  it('parentheses are a negative amount, kept as such', () => {
    const result = pdf(
      'Statement period 1 January 2026 to 31 January 2026\n' +
        '2 Jan Sample Supermarket 85.50\n5 Jan Payment received - thank you (100.00)\n',
    );
    expect(result.rows.map((r) => [r.direction, r.amount, r.confidence])).toEqual([
      ['debit', '8550', 0.55],
      ['debit', '10000', 0.8],
    ]);
  });

  it('a negative running balance keeps its sign, and the arithmetic still holds', () => {
    const result = pdf(
      'Opening Balance 100.00\n01/10/2026 PURCHASE 120.00 -20.00\n02/10/2026 PURCHASE 50.00 -70.00\n03/10/2026 SALARY 170.00 100.00',
    );
    expect(result.rows.map((r) => [r.direction, r.balance])).toEqual([
      ['debit', '-2000'],
      ['debit', '-7000'],
      ['credit', '10000'],
    ]);
    expect(result.balanceChecked).toBe(3);
    expect(result.balanceFailed).toBe(0);
  });

  it('an explicit minus on a CSV balance is negative too', () => {
    const result = table(
      'Details,Posting Date,Description,Amount,Type,Balance,Check or Slip #\n' +
        'DEBIT,09/15/2026,AUTOPAY,-612.40,LOAN_PMT,-1933.80,\n',
    );
    if (!result.ok) throw new Error(result.reason);
    expect(result.rows[0]!.balance).toBe('-193380');
  });

  it('a lone dash between figures is an empty column, not a sign', () => {
    const result = pdf('Opening Balance 236.21\n25-12-25 INTEREST CREDIT - 3.00 - 239.21');
    expect(result.rows[0]).toMatchObject({ direction: 'credit', amount: '300', balance: '23921' });
  });

  it('a Cr/Dr marker on the amount settles the direction when there is no balance', () => {
    const result = pdf(
      '01-Jul-2025 UPI/DR/426700000001/SAMPLE FOODS 347.00 Dr\n02-Jul-2025 NEFT SALARY 35,000.00 Cr',
    );
    expect(result.rows.map((r) => [r.direction, r.confidence])).toEqual([
      ['debit', 0.8],
      ['credit', 0.8],
    ]);
  });
});

describe('6. an amount that wrapped onto the next line', () => {
  it('is one transaction with the joined narration', () => {
    const result = pdf(
      [
        'Statement period December 16, 2025 - January 15, 2026',
        '12/31 The Insurance Co.',
        'Monthly Deposit 40.76 2,479.57',
        '01/02 Check 250.00 2,229.57',
      ].join('\n'),
      { order: 'mdy' },
    );
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]).toMatchObject({
      date: '2025-12-31',
      description: 'The Insurance Co. Monthly Deposit',
      amount: '4076',
      balance: '247957',
      direction: 'credit',
    });
    expect(result.unreadable).toBe(0);
  });

  it('Axis: the narration wraps and the figures follow on the second line', () => {
    const result = pdf(
      '07-04-2026 UPI/P2A/609400000005/SAMPLE PAYEE\nSIN/UPI/State Bank Of India 20000.00 8990.83 3693',
    );
    expect(result.rows[0]).toMatchObject({
      description: 'UPI/P2A/609400000005/SAMPLE PAYEE SIN/UPI/State Bank Of India',
      amount: '2000000',
      balance: '899083',
    });
  });

  it('a dated line with no figures that is followed by furniture is unreadable, not a row', () => {
    const result = pdf('01/10/2026 SOMETHING\nPage 1 of 2\n02/10/2026 X 10.00 90.00');
    expect(result.unreadable).toBe(1);
    expect(result.rows).toHaveLength(1);
  });
});

describe('7. Westpac Corporate Online', () => {
  const csv =
    'TRAN_DATE,ACCOUNT_NO,ACCOUNT_NAME,CCY,CLOSING_BAL,AMOUNT,TRAN_CODE,NARRATIVE,SERIAL\n' +
    '20190208,032000123456,SAMPLE PTY LTD,AUD,15250.75,,,,\n' +
    '20190208,032000123456,SAMPLE PTY LTD,AUD,15250.75,-5000.00,PAY,"PAYMENT TO SUPPLIER\nINV 1001",\n' +
    '20190208,032000123456,SAMPLE PTY LTD,AUD,15250.75,1250.75,DEP,OSKO FROM CUSTOMER,NPP000000001\n';

  it('YYYYMMDD dates, a signed AMOUNT, the transaction id kept', () => {
    const result = table(csv);
    if (!result.ok) throw new Error(result.reason);
    expect(result.profile).toBe('westpac_corporate');
    expect(result.currency).toBe('AUD');
    expect(result.rows.map((r) => [r.date, r.direction, r.amount, r.ref])).toEqual([
      ['2019-02-08', 'debit', '500000', null],
      ['2019-02-08', 'credit', '125075', 'NPP000000001'],
    ]);
  });

  it('the repeated closing balance is not a running balance, and a balance-only row is not a transaction', () => {
    const result = table(csv);
    if (!result.ok) throw new Error(result.reason);
    expect(result.rows.every((r) => r.balance === null)).toBe(true);
    expect(result.balanceChecked).toBe(0);
    expect(result.skipped).toBe(1);
  });

  it('a quoted multiline narrative stays one record', () => {
    const result = table(csv);
    if (!result.ok) throw new Error(result.reason);
    expect(result.rows[0]!.description).toBe('PAYMENT TO SUPPLIER INV 1001');
  });
});

describe('what never becomes a transaction', () => {
  it('section headings, daily balance summaries, totals and a period line', () => {
    const result = pdf(
      [
        'Statement period December 16, 2025 - January 15, 2026',
        'Deposits and other additions',
        '12/20 Online Transfer 500.00',
        'Total deposits and other additions $500.00',
        'Checks',
        '01/02 1001 - 250.00',
        'Totals $500.00 $250.00',
        'Daily ledger balance summary',
        'Date Balance Date Balance',
        '12/16 1,954.80 12/20 2,454.80',
        '01/02 2,204.80',
      ].join('\n'),
      { order: 'mdy' },
    );
    expect(result.rows.map((r) => [r.date, r.direction, r.amount])).toEqual([
      ['2025-12-20', 'credit', '50000'],
      ['2026-01-02', 'debit', '25000'],
    ]);
    expect(result.unreadable).toBe(0);
  });

  it('an opening-balance or B/F line dated like a row', () => {
    const result = pdf(
      '01-04-2019 B/F 2,04,759.22\n02-04-2019 UPI/909100000001/NA 100.00 2,04,659.22',
    );
    expect(result.rows).toHaveLength(1);
    expect(result.openingBalance).toBe('20475922');
    expect(result.rows[0]).toMatchObject({ direction: 'debit', confidence: 0.9 });
  });

  it('a CSV summary block and its "Beginning balance" row', () => {
    const result = table(
      'Description,,Summary Amt.\nBeginning balance as of 01/01/2026,,"5,200.00"\nTotal credits,,"3,200.00"\n\n' +
        'Date,Description,Amount,Running Bal.\n01/02/2026,Beginning balance as of 01/01/2026,,"5,200.00"\n' +
        '01/03/2026,CORNER MARKET,-42.67,"5,157.33"\n01/31/2026,Ending balance as of 01/31/2026,,"5,157.33"\n',
    );
    if (!result.ok) throw new Error(result.reason);
    expect(result.rows).toHaveLength(1);
    expect(result.skipped).toBe(2);
  });
});
