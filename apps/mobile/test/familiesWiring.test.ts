/**
 * The three places the family lens is wired into screens that cannot be
 * rendered here (the same source-text approach as balancesSettleOneTab):
 * the expense draft keeps the People/Families choice and the saved units
 * snapshot, the Balances lens names the viewer for their own family, and the
 * delete-group warning lists the families' debts under the Balances labels.
 */

import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const read = (path: string): string =>
  readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8');

describe('families wiring', () => {
  it('saves and restores the split choice and the units snapshot with the crash draft', () => {
    const source = read('app/group/[id]/add-expense.tsx');
    const draft = source.slice(source.indexOf('useDraft<ExpenseDraft>('));
    const saved = draft.slice(0, draft.indexOf('{ enabled:'));
    expect(saved).toMatch(/\bsavedUnits,/);
    expect(saved).toMatch(/\bsplitBy,/);
    expect(source).toMatch(/setSavedUnits\(draft\.savedUnits \?\? null\)/);
    expect(source).toMatch(/setSplitBy\(draft\.splitBy \?\? 'people'\)/);
  });

  it('names the viewer for their own family in the Balances lens, and pends by family', () => {
    const source = read('app/group/[id]/index.tsx');
    expect(source).toMatch(/familyTransfers\(ledger\.net, units, ledger\.myMemberId\)/);
    expect(source).toMatch(
      /familyLens \? \(memberId\) => unitOf\(units, memberId\) \?\? memberId : undefined/,
    );
  });

  it('lists the delete-group debts by family with the Balances labels', () => {
    const source = read('app/group/[id]/settings.tsx');
    const debts = source.slice(source.indexOf('const outstandingDebts'));
    expect(debts).toMatch(/warningTransfers\(ledger, group\.data\?\.units\)/);
    expect(debts).toMatch(/familyLabel\(group\.data\?\.units, memberId, nameFor\(memberId\)\)/);
  });
});
