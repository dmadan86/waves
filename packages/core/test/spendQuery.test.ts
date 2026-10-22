import { describe, expect, it } from 'vitest';
import type { PersonalTxn } from '../src/personal/types';
import {
  answerSpendQuery,
  lastMonthOf,
  parseSpendQuery,
  withPeriod,
  type SpendGroupExpense,
  type SpendLedger,
  type SpendQuery,
} from '../src/voice/spendQuery';

const TODAY = '2026-10-19';
const parse = (text: string): SpendQuery => {
  const query = parseSpendQuery(text, TODAY);
  expect(query).not.toBeNull();
  return query!;
};
const txn = (over: Partial<PersonalTxn> = {}): PersonalTxn => ({
  id: 'p1',
  kind: 'expense',
  amount: 10000n,
  currency: 'INR',
  category: 'food',
  note: 'Lunch',
  date: TODAY,
  loanId: null,
  recurringId: null,
  ...over,
});
const group = (over: Partial<SpendGroupExpense> = {}): SpendGroupExpense => ({
  id: 'g1',
  groupId: 'goa',
  groupName: 'Goa trip',
  description: 'Lunch',
  category: 'food',
  date: TODAY,
  currency: 'INR',
  myShareMinor: 20000n,
  participantNames: ['Anu'],
  ...over,
});
const ledger = (txns: readonly PersonalTxn[] = []): SpendLedger => ({ txns, budgets: [] });
const food = (): SpendQuery => parse('how much did I spend on food this month');

describe('spend query parser', () => {
  it('SQ-01 sum food this month', () => {
    expect(food()).toEqual({
      metric: 'sum',
      category: 'food',
      period: { from: '2026-10-01', to: '2026-10-31' },
      periodKey: 'thisMonth',
      assumedPeriod: false,
    });
  });
  it('SQ-02 this week starts Monday', () => {
    expect(parse('how much did I spend this week').period).toEqual({
      from: TODAY,
      to: '2026-10-25',
    });
  });
  it('SQ-03 last month', () => {
    expect(parse('spent last month').period).toEqual({ from: '2026-09-01', to: '2026-09-30' });
  });
  it('SQ-04 today and yesterday', () => {
    expect(parse('spent today').period).toEqual({ from: TODAY, to: TODAY });
    expect(parse('what did I spend yesterday').period).toEqual({
      from: '2026-10-18',
      to: '2026-10-18',
    });
  });
  it('SQ-05 group in Goa', () => {
    expect(parse('how much did I spend in Goa').group).toBe('goa');
  });
  it('SQ-06 merchant on Swiggy', () => {
    expect(parse('how much did I spend on Swiggy')).toMatchObject({ merchant: 'swiggy' });
    expect(parse('spent on Swiggy').category).toBeUndefined();
    expect(parse('spent at Starbucks').merchant).toBe('starbucks');
  });
  it('SQ-07 biggest expense', () => {
    expect(parse('biggest expense this month').metric).toBe('max');
  });
  it('SQ-08 how many cabs', () => {
    expect(parse('how many cabs this month')).toMatchObject({
      metric: 'count',
      category: 'travel',
    });
    expect(
      answerSpendQuery(parse('how many cabs this month'), ledger([txn({ category: 'travel' })]), [])
        .text,
    ).toBe('You had 1 expenses on travel this month');
  });
  it('SQ-09 food budget left', () => {
    expect(parse('how much food budget left')).toMatchObject({
      metric: 'budgetLeft',
      category: 'food',
    });
  });
  it('SQ-10 Hinglish food this month', () => {
    expect(parse('is mahine khaane pe kitna gaya')).toMatchObject({
      metric: 'sum',
      category: 'food',
      periodKey: 'thisMonth',
      assumedPeriod: false,
    });
  });
  it('SQ-11 Hinglish yesterday', () => {
    expect(parse('kal kitna kharch hua').periodKey).toBe('yesterday');
  });
  it('SQ-12 Tamil English this month', () => {
    expect(parse('indha maasam evlo selavu').periodKey).toBe('thisMonth');
  });
  it('SQ-13 balance questions belong to balance path', () => {
    for (const text of ['who owes me', 'how much does Anu owe me', 'am I settled in Goa'])
      expect(parseSpendQuery(text, TODAY)).toBeNull();
  });
  it('SQ-14 add commands are not questions', () => {
    expect(parseSpendQuery('add 800 lunch', TODAY)).toBeNull();
  });
  it('SQ-15 spent alone assumes this month and says so', () => {
    const q = parse('spent');
    expect(q.assumedPeriod).toBe(true);
    expect(q.period).toEqual(food().period);
    expect(answerSpendQuery(q, ledger([txn()]), []).text).toBe('You spent ₹100 this month');
  });
});

describe('spend computation', () => {
  it('SQ-16 personal expenses plus my positive group shares excluding loans and income', () => {
    const data = ledger([
      txn(),
      txn({ id: 'income', kind: 'income', amount: 999999n }),
      txn({ id: 'loan', loanId: 'loan' }),
      txn({ id: 'old', date: '2026-09-30' }),
    ]);
    expect(
      answerSpendQuery(food(), data, [
        group(),
        group({ id: 'zero', myShareMinor: 0n }),
        group({ id: 'negative', myShareMinor: -20n }),
      ]).totals,
    ).toEqual([{ currency: 'INR', minor: 30000n, count: 2 }]);
  });
  it('SQ-17 currencies remain separate in sentence', () => {
    expect(
      answerSpendQuery(
        food(),
        ledger([txn({ amount: 1240000n }), txn({ id: 'gbp', currency: 'GBP', amount: 3500n })]),
        [],
      ).text,
    ).toBe('You spent ₹12,400 and £35 on food this month');
  });
  it('SQ-18 empty food answer', () => {
    expect(answerSpendQuery(food(), ledger(), [])).toMatchObject({
      status: 'empty',
      text: 'Nothing on food this month',
      biggest: null,
      totals: [],
      budgets: [],
    });
  });
  it('SQ-19 biggest expense description and UTC calendar date', () => {
    const q = parse('biggest expense this month');
    expect(answerSpendQuery(q, ledger([txn({ amount: 800000n })]), [group()])).toMatchObject({
      biggest: { minor: 800000n, source: 'personal', description: 'Lunch' },
      text: 'Biggest: ₹8,000 Lunch on 19 Oct',
    });
    expect(answerSpendQuery(q, ledger(), [group({ myShareMinor: 800000n })]).biggest).toMatchObject(
      { source: 'group', groupName: 'Goa trip' },
    );
  });
  it('SQ-20 budget absent, left and over use personal budget screen semantics', () => {
    const q = parse('how much food budget left');
    expect(answerSpendQuery(q, ledger(), [])).toMatchObject({
      status: 'noBudget',
      text: 'No food budget set · Set one',
    });
    const budgets = [{ id: 'b', category: 'food', currency: 'INR', limit: 500000n }];
    const data = {
      txns: [
        txn({ amount: 380000n }),
        txn({ kind: 'income' }),
        txn({ loanId: 'l' }),
        txn({ currency: 'GBP' }),
        txn({ category: 'travel' }),
      ],
      budgets,
    };
    const result = answerSpendQuery(q, data, [group({ myShareMinor: 900000n })]);
    expect(result.text).toBe('₹1,200 left of ₹5,000 food budget this month');
    expect(result.budgets).toEqual([
      { currency: 'INR', limit: 500000n, spent: 380000n, remaining: 120000n },
    ]);
    expect(answerSpendQuery(q, { txns: [txn({ amount: 530000n })], budgets }, []).text).toBe(
      '₹300 over your ₹5,000 food budget',
    );
    expect(
      answerSpendQuery({ ...q, period: { from: TODAY, to: TODAY }, periodKey: 'today' }, data, [])
        .budgets,
    ).toEqual(result.budgets);
  });
  it('SQ-21 builtins, catalog keys and labels, and snapshot labels', () => {
    const catalog = [
      { key: 'tag1', label: 'Hobbies', builtinId: null },
      { key: 'food', label: 'Meals', builtinId: 'food' },
    ];
    for (const category of ['food', 'FOOD & DRINK', 'Meals']) {
      expect(
        answerSpendQuery({ ...food(), category }, ledger([txn()]), [], { catalog }).totals[0]
          ?.minor,
      ).toBe(10000n);
    }
    for (const category of ['tag1', 'HOBBIES']) {
      expect(
        answerSpendQuery({ ...food(), category }, ledger([txn({ category: 'tag1' })]), [], {
          catalog,
        }),
      ).toMatchObject({ categoryLabel: 'Hobbies', totals: [{ minor: 10000n }] });
    }
    expect(
      answerSpendQuery({ ...food(), category: 'hobbies' }, ledger(), [
        group({ category: 'deleted-tag', categoryLabel: 'Hobbies' }),
      ]),
    ).toMatchObject({ categoryLabel: 'Hobbies', totals: [{ minor: 20000n }] });
  });
  it('SQ-22 totals and tie breaks are independent of input order', () => {
    const txns = [
      txn({ id: 'z', currency: 'USD', amount: 3500n }),
      txn({ id: 'a', currency: 'GBP', amount: 3500n }),
      txn({ id: 'b', amount: 9000n }),
    ];
    const a = answerSpendQuery(food(), ledger(txns), []);
    expect(a.totals.map((t) => t.currency)).toEqual(['INR', 'GBP', 'USD']);
    expect(answerSpendQuery(food(), ledger([...txns].reverse()), [])).toEqual(a);
    const q = parse('biggest expense');
    const tied = [txn({ id: 'z', note: 'Z' }), txn({ id: 'a', note: 'A' })];
    expect(answerSpendQuery(q, ledger(tied), []).text).toBe('Biggest: ₹100 A on 19 Oct');
    expect(answerSpendQuery(q, ledger([...tied].reverse()), [])).toEqual(
      answerSpendQuery(q, ledger(tied), []),
    );
  });
  it('SQ-23 inclusive calendar date boundaries', () => {
    const txns = ['2026-09-30', '2026-10-01', '2026-10-31', '2026-11-01'].map((date) =>
      txn({ id: date, date }),
    );
    expect(
      answerSpendQuery(
        food(),
        ledger(txns),
        txns.map((t) => group({ id: t.id, date: t.date })),
      ).totals,
    ).toEqual([{ currency: 'INR', minor: 60000n, count: 4 }]);
  });
});

describe('additional language, calendar and filters', () => {
  it('EXTRA-statements with an amount are expenses being added, not questions', () => {
    for (const text of [
      'spent 500 on lunch',
      'I spent 200 on chai yesterday',
      'spent 800 at Starbucks',
      '500 spent on cab',
      'chai pe 50 kharch hua',
      'Spent ₹250 on lunch',
    ]) {
      expect(parseSpendQuery(text, TODAY), text).toBeNull();
    }
  });
  it('EXTRA-period numbers are not amounts', () => {
    expect(parse('how much did I spend in the last 7 days')).toMatchObject({ periodKey: 'last7' });
    expect(parse('how much did I spend in 2025')).toMatchObject({ periodKey: 'year' });
  });
  it('EXTRA-Devanagari today and last month', () => {
    expect(parse('आज कितना खर्च हुआ')).toMatchObject({ periodKey: 'today', assumedPeriod: false });
    expect(parse('पिछले महीने कितना खर्च हुआ')).toMatchObject({ periodKey: 'lastMonth' });
  });
  it('EXTRA-custom category budget and group names that resemble categories', () => {
    expect(parse('how much hobbies budget left').category).toBe('hobbies');
    expect(parse('how much is left in my food budget')).toMatchObject({
      metric: 'budgetLeft',
      category: 'food',
    });
    expect(parse('spent in Home').group).toBe('home');
    expect(parse('spent on Amazon')).toMatchObject({ merchant: 'amazon' });
    expect(parseSpendQuery('I paid 500 for food expense', TODAY)).toBeNull();
  });
  it('EXTRA-script Devanagari and Tamil script', () => {
    expect(parse('इस महीने खाने पर कितना खर्च हुआ')).toMatchObject({
      category: 'food',
      periodKey: 'thisMonth',
    });
    expect(parse('कल कितना खर्च हुआ').periodKey).toBe('yesterday');
    expect(parse('இந்த மாதம் எவ்வளவு செலவு').periodKey).toBe('thisMonth');
  });
  it('EXTRA-leap February has 29 days', () => {
    expect(parseSpendQuery('spent this month', '2024-02-15')?.period).toEqual({
      from: '2024-02-01',
      to: '2024-02-29',
    });
  });
  it('EXTRA-rollover December and week across years', () => {
    expect(parseSpendQuery('spent last month', '2027-01-03')?.period).toEqual({
      from: '2026-12-01',
      to: '2026-12-31',
    });
    expect(parseSpendQuery('spent last week', '2027-01-05')?.period).toEqual({
      from: '2026-12-28',
      to: '2027-01-03',
    });
  });
  it('EXTRA-month future month uses previous year', () => {
    expect(parse('spent in December').period).toEqual({ from: '2025-12-01', to: '2025-12-31' });
    const q = parse('spent in September');
    expect(q.period).toEqual({ from: '2026-09-01', to: '2026-09-30' });
    expect(answerSpendQuery(q, ledger(), []).text).toBe('Nothing in September 2026');
  });
  it('EXTRA-invalid today returns null', () => {
    for (const today of ['', 'bad', '2026-02-30', '2026-13-01', '2026-1-01'])
      expect(parseSpendQuery('spent', today)).toBeNull();
  });
  it('EXTRA-guards commands do not hijack entry paths', () => {
    for (const text of [
      'paid 500 for food',
      'split dinner with Anu',
      'remind Ravi',
      'add 500 for food',
      'add 500 expense',
    ])
      expect(parseSpendQuery(text, TODAY)).toBeNull();
  });
  it('EXTRA-periods relative days years and helpers', () => {
    expect(parse('spent last 7 days').period).toEqual({ from: '2026-10-13', to: TODAY });
    expect(parse('spent last 30 days').period).toEqual({ from: '2026-09-20', to: TODAY });
    expect(parse('spent this year').period).toEqual({ from: '2026-01-01', to: '2026-12-31' });
    expect(parse('spent last year').period).toEqual({ from: '2025-01-01', to: '2025-12-31' });
    expect(lastMonthOf(food(), TODAY)).toEqual({
      ...food(),
      periodKey: 'lastMonth',
      assumedPeriod: false,
      period: { from: '2026-09-01', to: '2026-09-30' },
    });
    expect(withPeriod(food(), 'today', TODAY).period).toEqual({ from: TODAY, to: TODAY });
  });
  it('EXTRA-filters group person and merchant use case insensitive text', () => {
    const mirror = [
      group({ note: 'Swiggy', payee: 'Starbucks' }),
      group({ id: 'other', groupName: 'Home', participantNames: ['Ravi'] }),
    ];
    const q = parse('spent on food in GOA with ANU');
    expect(answerSpendQuery(q, ledger([txn()]), mirror).totals[0]?.minor).toBe(20000n);
    for (const merchant of ['swiggy', 'starbucks', 'lunch'])
      expect(answerSpendQuery({ ...q, merchant }, ledger(), mirror).totals[0]?.minor).toBe(20000n);
    expect(
      answerSpendQuery(parse('spent at Starbucks'), ledger([txn({ note: 'STARBUCKS coffee' })]), [])
        .totals[0]?.minor,
    ).toBe(10000n);
  });
  it('EXTRA-normalisation labels aliases and language periods', () => {
    expect(parse('  HOW much did I SPEND on FOOD & DRINK, this month?! ').category).toBe('food');
    for (const word of ['khaana', 'khane', 'khana', 'khaane', 'saapadu', 'sappadu'])
      expect(parse(`spent ${word}`).category).toBe('food');
    for (const word of ['cab', 'cabs', 'auto', 'uber', 'ola', 'taxi', 'petrol', 'safar'])
      expect(parse(`spent ${word}`).category).toBe('travel');
    for (const word of ['kirana', 'sabzi'])
      expect(parse(`spent ${word}`).category).toBe('groceries');
    expect(parse('spent kapde').category).toBe('shopping');
    for (const word of ['pichhle mahine', 'last mahine', 'pichle mahine', 'kadantha maasam'])
      expect(parse(`kharch ${word}`).periodKey).toBe('lastMonth');
    for (const word of ['is hafte', 'iss hafte'])
      expect(parse(`kharch ${word}`).periodKey).toBe('thisWeek');
    expect(parse('kharch pichhle hafte').periodKey).toBe('lastWeek');
    expect(parse('kharch is saal').periodKey).toBe('thisYear');
    for (const word of ['aaj', 'inru']) expect(parse(`selavu ${word}`).periodKey).toBe('today');
    expect(parse('selavu naetru').periodKey).toBe('yesterday');
  });
});
