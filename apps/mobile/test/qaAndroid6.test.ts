/**
 * Device-QA round 6 (Android + iOS, 2026-11-26): the pure decisions, plus source checks for the
 * wiring that mobile's vitest cannot render (see vitest.config.ts).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { budgetDailyPace, type CurrencyCode, type PersonalBudget } from '@waves/core';

import { currentFigures } from '@/data/recentActivity';
import { amountInCurrency } from '@/lib/expenseForm';
import { needsCompactTile } from '@/lib/householdHome';
import { setupDailyPace } from '@/lib/personalSetup';
import { reviewSubtitle } from '@/lib/reviewFeed';

const src = (path: string): string => readFileSync(join(__dirname, '../src', path), 'utf8');

describe('currency switch keeps the typed amount (P0: 10.50 INR became ¥1050)', () => {
  it('re-expresses 10.50 in yen precision', () => {
    expect(amountInCurrency(1050n, 'INR' as CurrencyCode, 'JPY' as CurrencyCode)).toBe(11n);
    expect(amountInCurrency(1050n, 'JPY' as CurrencyCode, 'INR' as CurrencyCode)).toBe(105000n);
  });
  it('every picker that holds an amount goes through the one helper', () => {
    expect(src('components/QuickExpenseSheet.tsx')).toMatch(/setAmount\(amountInCurrency\(/);
    expect(src('app/capture.tsx')).toMatch(/setAmount\(amountInCurrency\(/);
    expect(src('app/group/[id]/add-expense.tsx')).toMatch(/setAmount\(amountInCurrency\(/);
  });
});

describe('Quick expense sheet layout and taps', () => {
  const sheet = src('components/QuickExpenseSheet.tsx');
  it('the destination row lets the first tap through a raised keyboard and ends with padding', () => {
    const row = sheet.slice(sheet.indexOf('ref={chipsRef}'), sheet.indexOf('ref={chipsRef}') + 400);
    expect(row).toContain('keyboardShouldPersistTaps="handled"');
    expect(row).toContain('paddingRight');
  });
  it('category tiles are top-aligned so a two-line label cannot move one tile', () => {
    expect(src('components/QuickCategoryRow.tsx')).toMatch(/alignItems: 'flex-start'/);
  });
});

describe('Review', () => {
  const strings = { heroSubtitle: 'waiting for a group', heroSubtitleSorted: 'to review' };
  it('only says "waiting for a group" while one has none', () => {
    expect(reviewSubtitle([{ target_group_id: 'g' }], strings)).toBe('to review');
    expect(reviewSubtitle([{ target_group_id: 'g' }, { target_group_id: null }], strings)).toBe(
      'waiting for a group',
    );
    expect(reviewSubtitle([], strings)).toBe('waiting for a group');
  });
  it('the bar button names Personal', () => {
    expect(src('app/(tabs)/captures.tsx')).toContain('label={t.captures.justMePersonal}');
  });
});

describe('Setup reveal and Home pace', () => {
  const cap: PersonalBudget = {
    id: 'b',
    category: null,
    limit: 3_400_000n,
    currency: 'INR' as CurrencyCode,
  };
  it('uses the overall budget remainder like Home, free only without a budget', () => {
    const free = 3_440_100n;
    expect(
      setupDailyPace({ budgets: [cap], txns: [] }, free, 'INR' as CurrencyCode, '2026-11-26'),
    ).toBe(budgetDailyPace(3_400_000n, '2026-11-26'));
    expect(
      setupDailyPace({ budgets: [], txns: [] }, free, 'INR' as CurrencyCode, '2026-11-26'),
    ).toBe(budgetDailyPace(free, '2026-11-26'));
  });
});

describe('Couple tiles and Personal entry', () => {
  it('shows the standard figure below 100,000 and the short form above', () => {
    expect(needsCompactTile(187_200n)).toBe(false);
    expect(needsCompactTile(10_000_000n)).toBe(true);
  });
  it('Save is pinned outside the scroll and lifted by the keyboard', () => {
    const entry = src('app/personal/entry.tsx');
    expect(entry).toContain('<KeyboardAvoidingView');
    expect(entry.indexOf('<SaveButton')).toBeGreaterThan(entry.indexOf('</ScrollView>'));
  });
});

describe('Activity rows show what the expense holds now', () => {
  const expenses = new Map([
    [
      'e1',
      { currentVersion: { amount: '45000', currency: 'INR', description: 'Dinner' } as never },
    ],
  ]);
  const row = (verb: string, id: string) =>
    ({
      id,
      verb,
      object_type: 'expense',
      object_id: 'e1',
      payload: { amount: '30000', description: '' },
    }) as never;
  it('newest edit and a delete use the current amount and name; older edits keep theirs', () => {
    const newest = new Map([['e1', 'a2']]);
    expect(currentFigures(row('edited', 'a2'), expenses, newest)).toMatchObject({
      amount: '45000',
      description: 'Dinner',
    });
    expect(currentFigures(row('deleted', 'a3'), expenses, newest)).toMatchObject({
      amount: '45000',
      description: 'Dinner',
    });
    expect(currentFigures(row('edited', 'a1'), expenses, newest)).toMatchObject({
      amount: '30000',
    });
  });
});

describe('Back from a drill-down', () => {
  it('the bar is told the drill-down is nested (root cause: it claimed Back for a tab root)', () => {
    expect(src('components/AppTabBar.tsx')).toContain(
      'isNestedPersonal(segments, params.returnTo)',
    );
  });
});
