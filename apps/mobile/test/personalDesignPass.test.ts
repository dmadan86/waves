import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  accountLine,
  budgetsSummary,
  investedSummary,
  loansSummary,
  otherCurrenciesLine,
  rentalsSummary,
} from '../src/lib/personalAccounts';
import { isPersonalRoot } from '../src/lib/tabBar';
import { STRINGS_BY_LANGUAGE } from '../src/i18n';

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

describe('Personal tab bar', () => {
  const bar = read('src/components/AppTabBar.tsx');
  it('lists Accounts in place of Me', () => {
    const block = bar.slice(bar.indexOf('const personalItems'), bar.indexOf('const pendingCount'));
    expect(block).toContain("key: 'accounts'");
    expect(block).not.toContain("key: 'me'");
    expect(block).toMatch(
      /key: 'home'[\s\S]*key: 'transactions'[\s\S]*key: 'planning'[\s\S]*key: 'reports'[\s\S]*key: 'accounts'/,
    );
  });
  it('knows the Accounts root', () => {
    expect(isPersonalRoot(['personal', 'accounts'], 'accounts')).toBe(true);
  });
});

describe('Accounts summaries', () => {
  const fmt = (n: bigint) => `$${n}`;
  const live = {
    one: '{n} loan · {amount} outstanding',
    other: '{n} loans · {amount} outstanding',
  };
  it('quotes count and amount, or invites when empty', () => {
    expect(
      accountLine(
        { count: 2, amount: 500n, others: [] },
        'en',
        { live, none: 'None' },
        fmt,
        'amount',
      ),
    ).toBe('2 loans · $500 outstanding');
    expect(
      accountLine(
        { count: 1, amount: 5n, others: [] },
        'en',
        { live, none: 'None' },
        fmt,
        'amount',
      ),
    ).toBe('1 loan · $5 outstanding');
    expect(
      accountLine(
        { count: 0, amount: 0n, others: [] },
        'en',
        { live, none: 'None' },
        fmt,
        'amount',
      ),
    ).toBe('None');
  });
  it('sums only open loans', () => {
    const s = loansSummary(
      [
        { direction: 'borrowed', left: 100n, status: 'active', currency: 'INR' },
        { direction: 'lent', left: 50n, status: 'active', currency: 'INR' },
        { direction: 'lent', left: 70n, status: 'closed', currency: 'INR' },
      ],
      'INR',
    );
    expect(s).toEqual({ count: 2, amount: 150n, others: [] });
  });
  it('has no budgets to total when none exist', () => {
    expect(budgetsSummary([], [], '2026-11', 'INR')).toEqual({ count: 0, amount: 0n, others: [] });
  });
  it('has copy in every language', () => {
    for (const lang of ['en', 'ta', 'hi', 'ar'] as const) {
      const h = STRINGS_BY_LANGUAGE[lang].personalHome;
      expect(h.navAccounts.length).toBeGreaterThan(0);
      expect(h.addBill.length).toBeGreaterThan(0);
    }
  });
});

describe('Reports tab root', () => {
  const src = read('src/app/personal/spending.tsx');
  it('has no back arrow on the tab root and no wallet hero', () => {
    expect(src).toContain('hideBack={!returnTo}');
    expect(src).not.toContain('SpendingArt');
    expect(src).toContain('MonthSwitcher');
  });
});

describe('Personal Home header', () => {
  const src = read('src/app/(tabs)/me.tsx');
  it('shows a ⋮ menu with Settings, not a gear', () => {
    expect(src).toContain('icon="ellipsis-vertical"');
    expect(src).not.toContain('icon="settings-outline"\n          label={h.settings}');
    expect(src).toContain("route: '/profile?space=personal'");
  });
});

describe('household home', () => {
  it('has a labelled mic in the header and no floating button', () => {
    expect(read('src/components/household/HouseholdScreen.tsx')).toContain('icon="mic-outline"');
    expect(read('src/components/AppTabBar.tsx')).toContain('company && showFab(segments, company)');
  });
});

describe('EmptyCard', () => {
  const src = read('src/components/standard/EmptyCard.tsx');
  it('renders icon, title, helper and an optional action', () => {
    expect(src).toContain('{title}');
    expect(src).toContain('{helper}');
    expect(src).toMatch(/action \? \(/);
    expect(read('src/components/household/HouseholdTabs.tsx')).toContain('add-bills');
  });
});

describe('Accounts never mix currencies', () => {
  const fmt = (n: bigint, c: string) => `${c} ${n}`;
  it('loans: default total, others kept apart, count covers all', () => {
    const s = loansSummary(
      [
        { direction: 'borrowed', left: 100n, status: 'active', currency: 'INR' },
        { direction: 'borrowed', left: 1200n, status: 'active', currency: 'USD' },
        { direction: 'lent', left: 3000n, status: 'active', currency: 'AED' },
        { direction: 'lent', left: 5n, status: 'active', currency: 'GBP' },
      ],
      'INR',
    );
    expect(s.count).toBe(4);
    expect(s.amount).toBe(100n);
    expect(s.others).toEqual([
      { currency: 'AED', amount: 3000n },
      { currency: 'GBP', amount: 5n },
      { currency: 'USD', amount: 1200n },
    ]);
  });
  it('investments and rentals do the same', () => {
    expect(
      investedSummary(
        [
          { currency: 'INR', amount: 10n },
          { currency: 'USD', amount: 7n },
        ],
        'INR',
      ),
    ).toEqual({ count: 2, amount: 10n, others: [{ currency: 'USD', amount: 7n }] });
    expect(
      rentalsSummary(
        [
          { currency: 'USD', amount: 9n },
          { currency: 'USD', amount: 1n },
        ],
        'INR',
      ),
    ).toEqual({ count: 2, amount: 0n, others: [{ currency: 'USD', amount: 10n }] });
  });
  it('budgets count every budget, total the default one', () => {
    expect(budgetsSummary([], [], '2026-11', 'INR').others).toEqual([]);
  });
  it('writes the second line: top two, then how many more', () => {
    const others = [
      { currency: 'USD', amount: 1200n },
      { currency: 'AED', amount: 3000n },
      { currency: 'GBP', amount: 5n },
    ];
    expect(otherCurrenciesLine(others, fmt, (n) => `+${n} more`)).toBe(
      '+ USD 1200 · AED 3000 · +1 more',
    );
    expect(otherCurrenciesLine([], fmt, (n) => `+${n} more`)).toBeNull();
  });
});
