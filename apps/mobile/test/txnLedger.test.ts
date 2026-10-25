import { describe, expect, it } from 'vitest';
import { format, money, type PersonalTxn } from '@waves/core';
import { dayNet, filterTxns, groupByDay } from '../src/lib/txnLedger';

function txn(id: string, overrides: Partial<PersonalTxn> = {}): PersonalTxn {
  return {
    id,
    kind: 'expense',
    amount: 10000n,
    currency: 'INR',
    category: 'food',
    note: null,
    date: '2026-10-25',
    loanId: null,
    recurringId: null,
    ...overrides,
  };
}
const expense = txn('expense', { note: 'Lunch' });
const income = txn('income', { kind: 'income', amount: 30000n });
const transfer = txn('transfer', { loanId: 'loan-1' });

describe('transaction ledger', () => {
  it('groups days with counts and rows in input order without mutation', () => {
    const older = txn('older', { date: '2026-10-24' });
    const rows = Object.freeze([expense, older, income]);
    expect(groupByDay(rows)).toEqual([
      { day: expense.date, count: 2, net: 20000n, currency: 'INR', rows: [expense, income] },
      { day: older.date, count: 1, net: -10000n, currency: 'INR', rows: [older] },
    ]);
    expect(groupByDay([])).toEqual([]);
  });
  it('subtracts expenses and adds income, including repayments', () => {
    expect(dayNet([expense, transfer])).toEqual({ net: -20000n, currency: 'INR' });
    expect(dayNet([expense, income])).toEqual({ net: 20000n, currency: 'INR' });
    expect(dayNet([expense, txn('refund', { kind: 'income' })]).net).toBe(0n);
    expect(dayNet([])).toEqual({ net: 0n, currency: '' });
  });
  it('suppresses mixed-currency totals', () => {
    const rows = [expense, txn('usd', { currency: 'USD' })];
    expect(dayNet(rows)).toEqual({ net: 0n, currency: '' });
    expect(groupByDay(rows)[0]).toMatchObject({ count: 2, net: 0n, currency: '' });
  });
  it('searches notes, category labels and formatted amounts', () => {
    const options = { tab: 'all' as const, locale: 'en', categoryLabel: () => 'Dining' };
    for (const needle of [
      ' LUNCH ',
      'dInInG',
      format(money(expense.amount, expense.currency), { locale: 'en' }),
    ]) {
      expect(filterTxns([expense], { ...options, needle })).toEqual([expense]);
    }
    expect(filterTxns([expense], { ...options, needle: 'missing' })).toEqual([]);
    expect(filterTxns([expense], { ...options, needle: '  ' })).toEqual([expense]);
  });
  it('filters tabs, retaining transfers under their expense or income kind', () => {
    const incoming = txn('incoming', { kind: 'income', loanId: '' });
    const rows = [expense, income, transfer, incoming];
    expect(filterTxns(rows, { tab: 'all', needle: '' })).toEqual(rows);
    expect(filterTxns(rows, { tab: 'expense', needle: '' })).toEqual([expense, transfer]);
    expect(filterTxns(rows, { tab: 'income', needle: '' })).toEqual([income, incoming]);
    expect(filterTxns(rows, { tab: 'transfer', needle: '' })).toEqual([transfer, incoming]);
  });
  it('combines category, month and inclusive date range filters', () => {
    const rows = [
      expense,
      txn('other', { category: 'travel' }),
      txn('old', { date: '2026-09-25' }),
    ];
    expect(
      filterTxns(rows, {
        tab: 'all',
        needle: '',
        categoryMatch: (category) => category === 'food',
        month: '2026-10',
        from: '2026-10-25',
        to: '2026-10-25',
      }),
    ).toEqual([expense]);
  });
});
