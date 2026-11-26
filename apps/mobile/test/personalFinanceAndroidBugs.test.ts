import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { PersonalTxn } from '@waves/core';
import { dayNet, filterTxns } from '../src/lib/txnLedger';
import { isPersonalMode } from '../src/lib/tabBar';
import { formatLoanPaymentDate, loanPaymentDefaults } from '../src/lib/loanPayment';
import { orphanedPersonalTxnIds } from '../src/lib/personalOrphans';
import { monthlySpendEntries } from '../src/lib/monthlySpend';
import { settingsRoute } from '../src/lib/settingsRoute';

const src = (path: string): string => readFileSync(join(__dirname, '../src', path), 'utf8');

const txn = (over: Partial<PersonalTxn> & Pick<PersonalTxn, 'id' | 'date'>): PersonalTxn => ({
  kind: 'expense',
  currency: 'INR',
  category: 'food',
  note: null,
  loanId: null,
  recurringId: null,
  amount: 100n,
  ...over,
});

describe('Android personal finance regressions', () => {
  it('repairs only transactions whose known parent is tombstoned', () => {
    const row = (
      id: string,
      record_kind: string,
      data: Record<string, unknown>,
      deleted_at: string | null,
    ) => ({
      id,
      owner_user_id: 'u1',
      record_kind,
      data,
      deleted_at,
      created_at: '',
    });
    expect(
      orphanedPersonalTxnIds([
        row('gone-parent', 'loan', {}, 'deleted'),
        row('orphan', 'txn', { loanId: 'gone-parent' }, null),
        row('not-arrived', 'txn', { propertyId: 'future' }, null),
        row('still-linked', 'investment', {}, null),
        row('not-orphan', 'txn', { investmentId: 'still-linked' }, null),
      ] as never),
    ).toEqual(['orphan']);
  });
  it('uses Home Spent entries for the Transactions expense drill-down', () => {
    const rows = [
      txn({ id: 'daily', date: '2026-11-04' }),
      txn({ id: 'investment', date: '2026-11-04', category: 'inv.fund' }),
      txn({ id: 'loan', date: '2026-11-04', loanId: 'l1' }),
      txn({ id: 'old-month', date: '2026-10-31' }),
    ];
    expect(monthlySpendEntries(rows, '2026-11', 'INR').map((row) => row.id)).toEqual(['daily']);
  });
  it('drill-down back returns to the Personal Reports or Budgets screen', () => {
    const txns = src('app/personal/transactions.tsx');
    expect(txns).toContain(
      'params.returnTo ? router.replace(params.returnTo as never) : router.back()',
    );
    expect(src('app/personal/spending.tsx')).toContain("returnTo: '/personal/spending'");
    expect(src('app/personal/budgets.tsx')).toContain("returnTo: '/personal/budgets'");
    expect(src('app/(tabs)/me.tsx')).toContain("returnTo: '/(tabs)/me'");
    expect(src('app/personal/budgets.tsx')).toContain("returnTo: '/personal/budgets'");
  });

  it('Me settings keep the Personal tab bar', () => {
    // Opened from Me: stays in Personal. Opened from Groups: stays in Groups.
    for (const page of ['backup', 'scene', 'lock']) {
      expect(isPersonalMode(['settings', page], 'personal')).toBe(true);
      expect(isPersonalMode(['settings', page])).toBe(false);
    }
    expect(isPersonalMode(['settings', 'account'])).toBe(false);
    expect(settingsRoute('/settings/backup', 'personal')).toBe('/settings/backup?space=personal');
    expect(settingsRoute('/settings/backup', undefined)).toBe('/settings/backup');
    expect(src('app/settings/lock.tsx')).toContain("settingsRoute('/settings/backup', space)");
    expect(src('app/settings/lock.tsx')).toContain("settingsRoute('/settings/account', space)");
  });

  it('Budgets and Loans show the same reachable Planning chips', () => {
    for (const page of ['budgets.tsx', 'loans.tsx']) {
      const content = src(`app/personal/${page}`);
      expect(content).toContain("value: 'recurring', label: t.personal.recurring");
      expect(content).toContain("value: 'budgets', label: t.personal.budgets");
      expect(content).toContain("value: 'loans', label: t.personal.loans");
    }
  });

  it('loan payments use payment copy and date formatting, with a single neutral empty state', () => {
    const loans = src('app/personal/loans.tsx');
    const entry = src('app/personal/entry.tsx');
    expect(loans).toContain("recordPayment: '1'");
    expect(loans).toContain('loanPaymentDefaults(loan)');
    expect(loans).toContain('formatLoanPaymentDate(p.date, locale)');
    expect(loans).toContain('<FieldLabel>{t.personalSetup.emiLabel}</FieldLabel>');
    expect(loans).toContain('carried.emiAmount = emiAmount.toString()');
    expect(loans).toContain('wallet-outline');
    expect(loans).toContain('numberOfLines={2}');
    expect(loans).toContain('minHeight: 40');
    expect(loans).toContain('Delete this loan and its payments?');
    expect(loans).toContain('<ScrollView');
    expect(loans).toContain('formatLoanPaymentDate(p.date, locale)');
    expect(loans).not.toContain('{t.personal.closeLoan}</Text>');
    expect(entry).toContain("'Save payment'");
    expect(entry).toContain('recordPayment\n');
  });

  it('loan payment prefill uses the EMI amount and a category guessed from the loan', () => {
    expect(
      loanPaymentDefaults({
        carried: { emiAmount: 12500n },
        counterpart: 'Landlord',
        note: 'rent deposit',
      }),
    ).toEqual({ amount: '12500', category: 'home' });
    // A car loan is not "home": no keyword match falls back to Other, an honest answer.
    expect(
      loanPaymentDefaults({ carried: { emiAmount: '8000' }, counterpart: 'Ravi', note: null }),
    ).toEqual({ amount: '8000', category: 'other' });
    // Zero or missing EMI prefills nothing rather than "0".
    expect(loanPaymentDefaults({ carried: { emiAmount: 0n } })).toEqual({ category: 'other' });
    expect(loanPaymentDefaults({ carried: undefined })).toEqual({ category: 'other' });
    expect(loanPaymentDefaults({ carried: { emiAmount: 'junk' } })).toEqual({ category: 'other' });
  });

  it('loan payment dates are localized instead of raw ISO strings', () => {
    expect(formatLoanPaymentDate('2026-11-25', 'en-GB')).toBe('25 Nov 2026');
  });

  it('Transactions can browse months and explain filtered empty results', () => {
    const txns = src('app/personal/transactions.tsx');
    expect(txns).toContain('setBrowseMonth(shiftMonth(browseMonth, -1))');
    expect(txns).toContain('setBrowseMonth(shiftMonth(browseMonth, 1))');
    expect(txns).toContain('No entries match these filters');
    expect(txns).toContain('Clear filters');
    expect(txns).toContain('<CategoryPicker\n          wrap');
    expect(txns).toContain('`No entries in ${monthLabel(browseMonth, locale)}`');
    expect(txns).toContain("tab !== 'all' || drillIn");
    expect(txns).not.toContain('accessibilityLabel={t.personal.add}');
  });

  it('Transactions month filtering keeps exact month boundaries and mixed currencies uncombined', () => {
    const rows = [
      txn({ id: 'before', date: '2026-10-31' }),
      txn({ id: 'in-month', date: '2026-11-01' }),
      txn({ id: 'after', date: '2026-12-01' }),
      txn({ id: 'eur', date: '2026-11-30', currency: 'EUR', kind: 'income' }),
    ];
    expect(
      filterTxns(rows, { tab: 'all', needle: '', month: '2026-11' }).map((row) => row.id),
    ).toEqual(['in-month', 'eur']);
    expect(dayNet([rows[1]!, rows[3]!])).toEqual({ net: 0n, currency: '' });
    expect(filterTxns([], { tab: 'all', needle: '', month: '2026-11' })).toEqual([]);
  });

  it('Recurring uses the shared overflow menu and budgets name their delete target', () => {
    const recurring = src('app/personal/recurring.tsx');
    expect(recurring).toContain('<OverflowMenu');
    expect(recurring).toContain("tone: 'danger'");
    expect(recurring).toContain("addRecurring: '1'");
    expect(src('app/personal/entry.tsx')).toContain('addRecurring\n');
    expect(recurring).toContain('useClaimFab(true, t.personal.addRecurring');
    expect(src('app/personal/entry.tsx')).toContain('editing || recordPayment');
    expect(src('app/personal/setup.tsx')).toContain(
      'setupPrefillForUntouched(null, incomePrefill, touched.current)',
    );
    expect(src('data/personal.ts')).toContain('orphanedPersonalTxnIds(records)');
    expect(src('app/personal/budgets.tsx')).toContain("replace('this entry', 'this budget')");
    expect(src('app/personal/budgets.tsx')).toContain('setMonth(shiftMonth(month, 1))');
  });

  it('the Home More menu can scroll its final Add by voice item into view', () => {
    const menu = src('components/OverflowMenu.tsx');
    expect(menu).toContain('<ScrollView');
    expect(menu).toContain('nestedScrollEnabled');
    expect(menu).toContain('maxHeight: Math.max(0, room), flexShrink: 1');
    expect(menu).toContain('const estimate = items.reduce(');
    expect(src('app/(tabs)/me.tsx')).toContain('h.moreVoice');
  });

  it('Loans show one add control when empty', () => {
    expect(src('app/personal/loans.tsx')).toContain('{sorted.length > 0 ? (');
  });
});
