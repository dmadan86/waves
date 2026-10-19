import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  decodeLoan,
  encodeLoan,
  decodeTxn,
  encodeTxn,
  type PersonalLoan,
  type PersonalTxn,
} from '../src/personal/types';
import { loanOutstanding, monthlySummary } from '../src/personal/compute';
import { budgetSpendWindow } from '../src/personal/budgetContext';
import { computePersonalSpending } from '../src/personal/spending';
import { computeShares } from '../src/split/computeShares';
import { balanceOf, balanceSums, computeNetBalances } from '../src/balances/balances';
import { advanceSession, detectLendTarget, NEW_SESSION } from '../src/voice/followUps';

const loan = (over: Partial<PersonalLoan> = {}): PersonalLoan => ({
  id: 'loan-ravi',
  direction: 'lent',
  counterpart: 'Ravi',
  principal: 800000n,
  currency: 'INR',
  note: null,
  startDate: '2026-10-21',
  status: 'active',
  ...over,
});
const txn = (over: Partial<PersonalTxn> = {}): PersonalTxn => ({
  id: 'expense-1',
  kind: 'expense',
  amount: 800000n,
  currency: 'INR',
  category: 'other',
  note: 'gave to Ravi',
  date: '2026-10-21',
  loanId: null,
  recurringId: null,
  ...over,
});
const members = ['m-me', 'm-anu', 'm-ravi'];
const expense = (payer: string, amount = 120000n) => ({
  id: 'goa-dinner',
  date: '2026-10-21',
  currency: 'INR',
  amount,
  payers: { [payer]: amount },
  shares: Object.fromEntries(
    computeShares({
      amount,
      currency: 'INR',
      participants: members,
      params: { kind: 'equal' },
      seed: 'goa-dinner',
    }),
  ),
});

describe('loan versus gift ledger', () => {
  it('LG-01 removing the lent expense lowers monthly spending by INR 8000', () => {
    // Data-level conversion contract: the caller deletes the original transaction.
    const original = txn();
    const converted = decodeLoan('loan-ravi', encodeLoan(loan()));
    expect(converted).toMatchObject({
      direction: 'lent',
      counterpart: 'Ravi',
      principal: 800000n,
      status: 'active',
    });
    const remaining = [original].filter((t) => t.id !== original.id);
    expect(
      monthlySummary([original], '2026-10', 'INR').expense -
        monthlySummary(remaining, '2026-10', 'INR').expense,
    ).toBe(800000n);
    expect(computePersonalSpending(remaining, '2026-10', 'INR').spending).toBe(0n);
  });
  it('LG-02 a gift stays in spending with its original category', () => {
    const gift = decodeTxn('expense-1', encodeTxn(txn({ category: 'gifts' })));
    expect(gift.category).toBe('gifts');
    expect(monthlySummary([gift], '2026-10', 'INR').expense).toBe(800000n);
    expect(computePersonalSpending([gift], '2026-10', 'INR').spending).toBe(800000n);
  });
  it('LG-03 linked repayments reduce principal and unrelated entries do not', () => {
    expect(
      loanOutstanding(loan(), [
        txn({ kind: 'income', loanId: 'loan-ravi', amount: 300000n }),
        txn({ loanId: 'another' }),
      ]),
    ).toBe(500000n);
  });
  it('LG-04 overpayment floors outstanding at zero', () => {
    expect(loanOutstanding(loan(), [txn({ loanId: 'loan-ravi', amount: 900000n })])).toBe(0n);
  });
  it('LG-05 documents current cross-currency linked repayment behaviour', () => {
    // Current compute sums linked amounts without a currency check or FX conversion.
    expect(
      loanOutstanding(loan(), [txn({ loanId: 'loan-ravi', currency: 'GBP', amount: 300000n })]),
    ).toBe(500000n);
  });
  it('LG-06 two loans to Ravi keep independent outstanding totals', () => {
    const loans = [loan(), loan({ id: 'loan-ravi-2', principal: 200000n })].map((l) =>
      decodeLoan(l.id, encodeLoan(l)),
    );
    const payments = [txn({ loanId: 'loan-ravi', amount: 300000n })];
    expect(loans.map((l) => l.id)).toEqual(['loan-ravi', 'loan-ravi-2']);
    expect(loans.map((l) => loanOutstanding(l, payments))).toEqual([500000n, 200000n]);
    expect(loans.reduce((sum, l) => sum + loanOutstanding(l, payments), 0n)).toBe(700000n);
  });
  it('LG-07 budgets exclude loan-linked expenses', () => {
    expect(
      budgetSpendWindow(
        [txn({ amount: 123n }), txn({ loanId: 'loan-ravi' })],
        { currency: 'INR', category: null },
        '2026-10',
        1,
      ),
    ).toEqual({ total: 123n, average: 123n, months: 1, monthsWithSpend: 1 });
  });
  it('LG-08 borrowed Anu loan retains direction and counterpart', () => {
    // Deferred: WS2 borrowed-language parser; exercise the resulting ledger data.
    expect(
      decodeLoan(
        'anu',
        encodeLoan(loan({ direction: 'borrowed', counterpart: 'Anu', principal: 200000n })),
      ),
    ).toMatchObject({ direction: 'borrowed', counterpart: 'Anu', principal: 200000n });
  });
  it('LG-09 lend target is capitalised trimmed and within 60 characters', () => {
    const counterpart = detectLendTarget('  gave 8000 to ravi  ');
    expect(counterpart).toBe('Ravi');
    expect(counterpart).toBe(counterpart?.trim());
    expect(counterpart!.length).toBeLessThanOrEqual(60);
    expect(decodeLoan('ravi', encodeLoan(loan({ counterpart: counterpart! }))).counterpart).toBe(
      'Ravi',
    );
  });
  it('LG-10 undo data can restore the same transaction id and carried fields', () => {
    // Deferred: WS2 undo orchestration and loan deletion; verify the restore payload.
    const original = decodeTxn('expense-1', {
      ...encodeTxn(txn()),
      futureField: { receipt: 'r1' },
    });
    const restored = decodeTxn(original.id, encodeTxn(original));
    expect(restored).toEqual(original);
    expect(restored.id).toBe('expense-1');
    expect(restored.carried).toEqual({ futureField: { receipt: 'r1' } });
  });
  it('LG-11 loan codec round trip preserves unknown carried fields', () => {
    const raw = { ...encodeLoan(loan()), futureField: { version: 2 } };
    const decoded = decodeLoan('loan-ravi', raw);
    expect(decoded.carried).toEqual({ futureField: { version: 2 } });
    expect(encodeLoan(decoded)).toEqual(raw);
    expect(decodeLoan(decoded.id, encodeLoan(decoded))).toEqual(decoded);
  });
  it('LG-12 offline loan payload is serialisable and done stops the session', () => {
    // Deferred: WS2 offline queue integration; this checks its wire payload and session gate.
    const payload = encodeLoan(loan({ carried: { sourceExpenseId: 'expense-1' } }));
    expect(decodeLoan('loan-ravi', JSON.parse(JSON.stringify(payload)))).toMatchObject({
      principal: 800000n,
      counterpart: 'Ravi',
      carried: { sourceExpenseId: 'expense-1' },
    });
    expect(advanceSession(NEW_SESSION, 'lend', 'done')).toMatchObject({
      stopped: true,
      asked: ['lend'],
    });
  });
  it('LG-13 payer switch leaves equal shares unchanged', () => {
    expect(expense('m-ravi').shares).toEqual(expense('m-me').shares);
    expect(expense('m-ravi').shares).toEqual({ 'm-me': 40000n, 'm-anu': 40000n, 'm-ravi': 40000n });
  });
  it('LG-14 Ravi is the sole payer of the full total after switching', () => {
    expect(expense('m-ravi').payers).toEqual({ 'm-ravi': 120000n });
  });
  it('LG-15 switched balances are me minus 400 and Ravi plus 800 rupees', () => {
    const balances = computeNetBalances([expense('m-ravi')], []);
    expect(balanceOf(balances, 'm-me', 'INR')).toBe(-40000n);
    expect(balanceOf(balances, 'm-anu', 'INR')).toBe(-40000n);
    expect(balanceOf(balances, 'm-ravi', 'INR')).toBe(80000n);
  });
  it('LG-16 every payer switch preserves zero-sum balances', () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 0n, max: 100000000n }),
        fc.constantFrom(...members),
        (amount, payer) => {
          expect(balanceSums(computeNetBalances([expense(payer, amount)], [])).get('INR')).toBe(0n);
          expect(expense(payer, amount).shares).toEqual(expense('m-me', amount).shares);
        },
      ),
      { seed: 20261021, numRuns: 100 },
    );
  });
});
