import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { accountLine, budgetsSummary, loansSummary } from '../src/lib/personalAccounts';
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
      accountLine({ count: 2, amount: 500n }, 'en', { live, none: 'None' }, fmt, 'amount'),
    ).toBe('2 loans · $500 outstanding');
    expect(accountLine({ count: 1, amount: 5n }, 'en', { live, none: 'None' }, fmt, 'amount')).toBe(
      '1 loan · $5 outstanding',
    );
    expect(accountLine({ count: 0, amount: 0n }, 'en', { live, none: 'None' }, fmt, 'amount')).toBe(
      'None',
    );
  });
  it('sums only open loans', () => {
    const s = loansSummary([
      { direction: 'borrowed', left: 100n, status: 'active' },
      { direction: 'lent', left: 50n, status: 'active' },
      { direction: 'lent', left: 70n, status: 'closed' },
    ]);
    expect(s).toEqual({ count: 2, amount: 150n });
  });
  it('has no budgets to total when none exist', () => {
    expect(budgetsSummary([], [], '2026-11', 'INR')).toEqual({ count: 0, amount: 0n });
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
