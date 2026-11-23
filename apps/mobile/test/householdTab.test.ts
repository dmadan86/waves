import { describe, expect, it } from 'vitest';

import { personalBackRoute, personalBarAction } from '../src/lib/tabBar';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  householdBackRoute,
  householdLocalBack,
  householdBalancesRoute,
  householdUpcomingRoute,
  householdBarActiveKey,
  householdBarRoute,
  isHouseholdBarRoot,
  isHouseholdMode,
} from '../src/lib/householdTab';

describe('householdTab', () => {
  it('is on for household groups inside a group route only', () => {
    expect(isHouseholdMode(['group', '[id]'], 'g', { type: 'couple' })).toBe(true);
    expect(isHouseholdMode(['group', '[id]'], 'g', { type: 'trip' })).toBe(false);
    expect(isHouseholdMode(['group', '[id]'], 'g', { type: 'company' })).toBe(false);
    expect(isHouseholdMode(['(tabs)', 'me'], null, { type: 'couple' })).toBe(false);
  });
  it('picks the active tab from route and query', () => {
    const g = ['group', '[id]'];
    expect(householdBarActiveKey(g)).toBe('home');
    expect(householdBarActiveKey(g, { view: 'ledger' })).toBe('transactions');
    expect(householdBarActiveKey(g, { tab: 'balances' })).toBe('transactions');
    expect(householdBarActiveKey(g, { hh: 'planning' })).toBe('planning');
    expect(householdBarActiveKey([...g, 'insights'])).toBe('reports');
    expect(householdBarActiveKey([...g, 'budget'])).toBe('planning');
    expect(householdBarActiveKey([...g, 'members'])).toBe('me');
    expect(householdBarActiveKey([...g, 'settle'])).toBe('');
    expect(householdBarActiveKey(['friends'])).toBe('');
  });
  it('routes each tab', () => {
    expect(householdBarRoute('g', 'home')).toBe('/group/g?nav=tab');
    expect(householdBarRoute('g', 'transactions')).toBe('/group/g?view=ledger&nav=tab');
    expect(householdBarRoute('g', 'planning')).toBe('/group/g?hh=planning&nav=tab');
    expect(householdBarRoute('g', 'reports')).toBe('/group/g/insights?nav=tab');
    expect(householdBarRoute('g', 'me')).toBe('/group/g/members?nav=tab');
  });
  it('knows a tab root', () => {
    expect(isHouseholdBarRoot(['group', '[id]'], {}, 'home')).toBe(true);
    expect(isHouseholdBarRoot(['group', '[id]'], { hh: 'planning' }, 'home')).toBe(false);
    expect(isHouseholdBarRoot(['group', '[id]', 'insights'], {}, 'reports')).toBe(true);
    expect(isHouseholdBarRoot(['group', '[id]', 'budget'], {}, 'planning')).toBe(false);
  });
});

describe('householdTab navigation', () => {
  const g = ['group', '[id]'];
  it('Back from Transactions returns to the household Home, not the shared Home', () => {
    expect(householdBackRoute(g, { view: 'ledger' }, 'g')).toBe('/group/g?nav=back');
    expect(householdBackRoute(g, { tab: 'balances' }, 'g')).toBe('/group/g?nav=back');
  });
  it('Back from the other tab roots returns Home too', () => {
    expect(householdBackRoute(g, { hh: 'planning' }, 'g')).toBe('/group/g?nav=back');
    expect(householdBackRoute(g, { hh: 'upcoming' }, 'g')).toBe('/group/g?nav=back');
    expect(householdBackRoute([...g, 'insights'], {}, 'g')).toBe('/group/g?nav=back');
    expect(householdBackRoute([...g, 'members'], {}, 'g')).toBe('/group/g?nav=back');
  });
  it('leaves Back alone on Home and on screens opened from a tab', () => {
    expect(householdBackRoute(g, {}, 'g')).toBeNull();
    expect(householdBackRoute([...g, 'budget'], {}, 'g')).toBeNull();
    expect(householdBackRoute([...g, 'expense', 'x'], {}, 'g')).toBeNull();
    expect(householdBackRoute([...g, 'settle'], {}, 'g')).toBeNull();
    expect(householdBackRoute(['friends'], {}, 'g')).toBeNull();
  });
  it('tab routes cut (nav=tab) and the Upcoming view belongs to Planning', () => {
    for (const key of ['home', 'transactions', 'planning', 'reports', 'me'])
      expect(householdBarRoute('g', key)).toContain('nav=tab');
    expect(householdBalancesRoute('g')).toBe('/group/g?view=ledger&nav=tab&tab=balances');
    expect(householdUpcomingRoute('g')).toContain('hh=upcoming');
    expect(householdBarActiveKey(g, { hh: 'upcoming' })).toBe('planning');
  });
});

describe('personalBackRoute', () => {
  it('sends other Personal tabs to Personal Home, and Home to the shared Home', () => {
    expect(personalBackRoute('transactions')).toBe('/me');
    expect(personalBackRoute('planning')).toBe('/me');
    expect(personalBackRoute('reports')).toBe('/me');
    expect(personalBackRoute('home')).toBe('/');
  });
});

describe('local views on the household Home', () => {
  it('Back from Bills, Income, Upcoming and Planning returns to the route view', () => {
    for (const tab of ['bills', 'income', 'upcoming', 'planning'])
      expect(householdLocalBack(tab)).toBe('overview');
    // Bills opened from the bar's Planning goes back to Planning, then the bar's Back takes over.
    expect(householdLocalBack('bills', 'planning')).toBe('planning');
    expect(householdLocalBack('planning', 'planning')).toBeNull();
    expect(householdLocalBack('overview')).toBeNull();
    expect(householdLocalBack('upcoming', 'upcoming')).toBeNull();
  });
  it('the screen consumes hardware Back while a local view is open', () => {
    const src = readFileSync(
      join(__dirname, '../src/components/household/HouseholdScreen.tsx'),
      'utf8',
    );
    expect(src).toMatch(/householdLocalBack\(tab, hh\)/);
    expect(src).toMatch(/BackHandler\.addEventListener\('hardwareBackPress'[\s\S]*?return true;/);
  });
});

describe('personalBarAction (returning to Personal Home must not rebuild (tabs))', () => {
  it('pushes the first hop out of the tab navigator instead of replacing it', () => {
    expect(personalBarAction(['(tabs)', 'me'], '/personal/transactions')).toBe('push');
  });
  it('replaces between Personal siblings', () => {
    expect(personalBarAction(['personal', 'transactions'], '/personal/spending')).toBe('replace');
  });
  it('pops back to the mounted Home from a Personal screen', () => {
    expect(personalBarAction(['personal', 'recurring'], '/me')).toBe('dismissTo');
  });
});
