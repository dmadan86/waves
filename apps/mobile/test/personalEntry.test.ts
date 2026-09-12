/**
 * The private ledger's one form writes what the three forms wrote.
 *
 * Collapsing "add expense", "add income" and the recurring editor into a single
 * screen is an interface change and nothing else: `personal_records` is one
 * opaque json column, the server relays it without reading it, and a merged
 * form that quietly reshaped a blob would be a silent data migration nobody
 * asked for. So these assert the payloads literally — the exact keys and values
 * the old `encodeTxn` and `encodeRecurring` call sites produced — rather than
 * round-tripping them through a decoder that would forgive a dropped field.
 *
 * The route checks are the other half of the same worry. Merging forms is how
 * you break a link: the loans screen, the ledger list, the Me tab and the rules
 * list all push into `personal/`, and expo-router resolves those paths off the
 * file tree, so a file that stops existing is a dead button with no compile
 * error behind it.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { Frequency, type PersonalRecurring, type PersonalTxn } from '@waves/core';

import { entryRecord, NEW_REPEAT, repeatOf, type EntryDraft } from '../src/lib/personalEntry';

const DRAFT: EntryDraft = {
  kind: 'expense',
  amount: 125000n,
  currency: 'INR',
  category: 'food',
  note: 'Groceries',
  date: '2026-09-12',
  loanId: null,
  recurringId: null,
};

const RULE: PersonalRecurring = {
  id: 'rule-1',
  txnKind: 'income',
  amount: 5000000n,
  currency: 'INR',
  category: 'inc.salary',
  note: 'Salary',
  cadence: 'monthly',
  interval: 1,
  secondDay: null,
  anchorDate: '2026-01-01',
  nextDate: '2026-10-01',
  endDate: '2027-12-31',
  autoPost: true,
  active: true,
};

describe('a one-off entry', () => {
  it('stores an expense exactly as the add-expense screen did', () => {
    const record = entryRecord(DRAFT, null);

    expect(record.recordKind).toBe('txn');
    expect(record.recordId).toBeUndefined();
    expect(record.data).toEqual({
      kind: 'expense',
      amount: '125000',
      currency: 'INR',
      category: 'food',
      note: 'Groceries',
      date: '2026-09-12',
      loanId: null,
      recurringId: null,
    });
  });

  it('stores an income exactly as the add-income screen did — the same shape, the other way', () => {
    const record = entryRecord(
      { ...DRAFT, kind: 'income', category: 'inc.salary', note: 'September' },
      null,
    );

    expect(record.recordKind).toBe('txn');
    expect(record.data).toMatchObject({ kind: 'income', category: 'inc.salary' });
    // Direction is the only difference. An income filed as an expense is the
    // wrong sign on every total that reads this row.
    expect(Object.keys(record.data).sort()).toEqual(
      Object.keys(entryRecord(DRAFT, null).data).sort(),
    );
  });

  it('keeps the loan a repayment settles, and the rule that minted an entry', () => {
    const editing: PersonalTxn = {
      id: 'txn-7',
      kind: 'expense',
      amount: 1n,
      currency: 'INR',
      category: null,
      note: null,
      date: '2026-09-01',
      loanId: 'loan-3',
      recurringId: 'rule-1',
    };
    const record = entryRecord(
      { ...DRAFT, category: null, loanId: 'loan-3', recurringId: 'rule-1' },
      null,
      { txn: editing },
    );

    expect(record.recordId).toBe('txn-7');
    expect(record.data).toMatchObject({ loanId: 'loan-3', recurringId: 'rule-1' });
  });
});

describe('repeating, as a property of the entry', () => {
  it('writes a rule rather than a transaction, with the entry’s date as its start', () => {
    const record = entryRecord(DRAFT, NEW_REPEAT);

    expect(record.recordKind).toBe('recurring');
    expect(record.data).toEqual({
      txnKind: 'expense',
      amount: '125000',
      currency: 'INR',
      category: 'food',
      note: 'Groceries',
      cadence: 'monthly',
      interval: 1,
      secondDay: null,
      anchorDate: '2026-09-12',
      nextDate: '2026-09-12',
      endDate: null,
      autoPost: false,
      active: true,
    });
  });

  it('carries the named patterns into the schedule the ledger stores', () => {
    const schedule = (frequency: Frequency, interval = 5, secondDay = 20) =>
      entryRecord(DRAFT, { ...NEW_REPEAT, frequency, interval, secondDay }).data;

    expect(schedule(Frequency.Fortnightly)).toMatchObject({ cadence: 'weekly', interval: 2 });
    expect(schedule(Frequency.Quarterly)).toMatchObject({ cadence: 'monthly', interval: 3 });
    expect(schedule(Frequency.Yearly)).toMatchObject({ cadence: 'yearly', interval: 1 });
    expect(schedule(Frequency.TwiceAMonth)).toMatchObject({
      cadence: 'semimonthly',
      secondDay: 20,
    });
    expect(schedule(Frequency.EveryNMonths)).toMatchObject({ cadence: 'monthly', interval: 5 });
  });

  it('opens an existing rule on the pattern it was written with', () => {
    const twice = repeatOf(
      { ...RULE, cadence: 'semimonthly', secondDay: 21 },
      Frequency.TwiceAMonth,
    );

    expect(twice).toEqual({
      frequency: Frequency.TwiceAMonth,
      interval: 2,
      secondDay: 21,
      autoPost: true,
      active: true,
    });
  });

  it('leaves a rule already ahead of its start where it is in the queue', () => {
    const record = entryRecord(
      { ...DRAFT, date: RULE.anchorDate },
      repeatOf(RULE, Frequency.Monthly),
      {
        rule: RULE,
      },
    );

    expect(record.recordId).toBe('rule-1');
    // Re-minting October would double up months the timeline can already show.
    expect(record.data).toMatchObject({ anchorDate: '2026-01-01', nextDate: '2026-10-01' });
  });

  it('pulls a rule along when its start moves past the next one due', () => {
    const record = entryRecord(
      { ...DRAFT, date: '2027-03-01' },
      repeatOf(RULE, Frequency.Monthly),
      {
        rule: RULE,
      },
    );

    expect(record.data).toMatchObject({ anchorDate: '2027-03-01', nextDate: '2027-03-01' });
  });

  it('carries an end date through an edit, because nothing on the form can set one', () => {
    const record = entryRecord(
      { ...DRAFT, date: RULE.anchorDate },
      repeatOf(RULE, Frequency.Monthly),
      {
        rule: RULE,
      },
    );

    expect(record.data).toMatchObject({ endDate: '2027-12-31' });
  });

  it('pauses a rule without disturbing anything else about it', () => {
    const record = entryRecord(
      { ...DRAFT, date: RULE.anchorDate },
      { ...repeatOf(RULE, Frequency.Monthly), active: false },
      { rule: RULE },
    );

    expect(record.data).toMatchObject({ active: false, autoPost: true, nextDate: '2026-10-01' });
  });
});

describe('the rooms of the private ledger', () => {
  const APP = join(__dirname, '../src/app');

  it('all still exist, so every push into them still resolves', () => {
    // expo-router resolves a path off the file tree, so a merged form that
    // deleted a file would leave a button that does nothing and compiles fine.
    for (const route of [
      'personal/entry.tsx',
      'personal/recurring.tsx',
      'personal/transactions.tsx',
      'personal/loans.tsx',
      'personal/budgets.tsx',
      'personal/source/[id].tsx',
      '(tabs)/me.tsx',
    ]) {
      expect(existsSync(join(APP, route)), route).toBe(true);
    }
  });

  it('names the one form from every screen that used to have one of its own', () => {
    const source = (name: string): string => readFileSync(join(APP, name), 'utf8');

    // The rules list writes nothing itself any more: both its "+" and its pencil
    // open the shared form, one with a repeat switched on and one on a rule.
    expect(source('personal/recurring.tsx')).toContain("params: { repeats: '1' }");
    expect(source('personal/recurring.tsx')).toContain('recurringId: rule.id');
    expect(source('personal/recurring.tsx')).not.toContain('AmountField');

    // And the Me tab's two add buttons still preselect a direction rather than
    // leading to two different screens.
    expect(source('(tabs)/me.tsx')).toContain("params: { kind: 'expense' }");
    expect(source('(tabs)/me.tsx')).toContain("params: { kind: 'income' }");
  });
});
