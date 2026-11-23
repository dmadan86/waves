/**
 * Navigation audit for the household space, as data: every tile, menu row and bar tab
 * is one case (where it lands, which bar and active key show, where Back goes), plus
 * regression tests for the three bugs seen on the phone and the same coverage for the
 * Personal and company bars.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import {
  companyBackRoute,
  companyBarActiveKey,
  companyBarRoute,
  isCompanyBarRoot,
  isCompanyMode,
} from '../src/lib/companyTab';
import {
  householdGearEntries,
  householdHomeButtons,
  householdMoreEntries,
  householdTiles,
  runHouseholdAction,
  type ActionDeps,
  type HouseholdAction,
} from '../src/lib/householdEntries';
import {
  barMove,
  householdBackRoute,
  householdBarActiveKey,
  householdBarRoute,
  isHouseholdMode,
  type HouseholdBarKey,
} from '../src/lib/householdTab';
import { installTabBack } from '../src/lib/tabBack';
import {
  isNestedPersonal,
  isPersonalMode,
  personalActiveKey,
  personalBackRoute,
  resolveTabBar,
} from '../src/lib/tabBar';

const G = 'g1';
const HOME = `/group/${G}?nav=back`;
const src = (path: string): string => readFileSync(join(__dirname, '../src', path), 'utf8');

/** A route string as the bar sees it: segments (the id as `[id]`) and its query. */
function parse(href: string) {
  const url = new URL(href, 'https://app.test');
  const segments = url.pathname
    .split('/')
    .filter(Boolean)
    .map((part) => (part === G ? '[id]' : part));
  return { segments, search: Object.fromEntries(url.searchParams) };
}

// ───────────────────────────────────────────────────────── the audit table ──

/** key → [kind, href or view, bar active key ('' = none/hidden), bar shown]. */
type Row = [string, HouseholdAction['kind'], string, HouseholdBarKey | '', boolean];

const TILES: Row[] = [
  ['expense', 'push', `/group/${G}/add-expense`, '', false],
  ['income', 'push', `/group/${G}/income-edit`, 'planning', true],
  ['bills', 'view', 'bills', 'home', true],
  ['budget', 'push', `/group/${G}/budget`, 'planning', true],
  ['settle', 'push', `/group/${G}/settle`, '', false],
  ['members', 'replace', `/group/${G}/members?nav=tab`, 'me', true],
  ['expenses', 'replace', `/group/${G}?view=ledger&nav=tab`, 'transactions', true],
  ['more', 'more', '', 'home', true],
];
const BUTTONS: Row[] = [
  ['flowIncome', 'view', 'income', 'home', true],
  ['flowSpent', 'replace', `/group/${G}?view=ledger&nav=tab`, 'transactions', true],
  ['flowLeft', 'replace', `/group/${G}/insights?nav=tab`, 'reports', true],
  ['balance', 'replace', `/group/${G}?view=ledger&nav=tab&tab=balances`, 'transactions', true],
  ['search', 'replace', `/group/${G}?view=ledger&nav=tab`, 'transactions', true],
  ['bell', 'view', 'upcoming', 'home', true],
];
const MORE: Row[] = [
  ['allExpenses', 'replace', `/group/${G}?view=ledger&nav=tab`, 'transactions', true],
  ['whoPaid', 'replace', `/group/${G}?view=ledger&nav=tab&tab=balances`, 'transactions', true],
  ['upcoming', 'view', 'upcoming', 'home', true],
  ['spending', 'replace', `/group/${G}/insights?nav=tab`, 'reports', true],
  ['scan', 'push', '/capture?scan=42&targetGroupId=g1', '', false],
  ['voice', 'route', '/voice', '', false],
  ['categories', 'route', '/settings/categories', '', false],
  ['import', 'route', `/group/${G}/import`, '', true],
  ['export', 'route', `/group/${G}/export`, '', true],
];
const GEAR: Row[] = [
  ['members', 'replace', `/group/${G}/members?nav=tab`, 'me', true],
  ['invite', 'route', `/group/${G}/invite`, 'me', false],
  ['settle', 'route', `/group/${G}/settle`, '', false],
  ['settings', 'route', `/group/${G}/settings`, 'me', true],
  ['scene', 'route', '/settings/scene', '', true],
  ['lock', 'route', '/settings/lock', '', true],
];

function hrefOf(action: HouseholdAction): string {
  if (action.kind === 'replace' || action.kind === 'push') return action.href;
  if (action.kind === 'view') return action.view;
  if (action.kind === 'route')
    return typeof action.route === 'string' ? action.route : action.route.pathname;
  return '';
}

const lists: [string, Row[], ReturnType<typeof householdTiles>][] = [
  ['tile', TILES, householdTiles(G)],
  ['home button', BUTTONS, householdHomeButtons(G)],
  ['More entry', MORE, householdMoreEntries(G, 42)],
  ['gear entry', GEAR, householdGearEntries(G)],
];

describe('household audit table', () => {
  for (const [what, rows, entries] of lists) {
    it(`${what}s are exactly the audited set, in order`, () => {
      expect(entries.map((e) => e.key)).toEqual(rows.map((r) => r[0]));
    });
    for (const [key, kind, target, activeKey, barShown] of rows) {
      const entry = entries.find((e) => e.key === key)!;
      describe(`${what} ${key}`, () => {
        it('lands where the table says, with the right navigation verb', () => {
          expect(entry.action.kind).toBe(kind);
          expect(hrefOf(entry.action)).toBe(target);
        });
        if (kind === 'replace' || kind === 'push') {
          const { segments, search } = parse(target);
          it('shows the right bar and active tab', () => {
            expect(resolveTabBar(segments).hidden).toBe(!barShown);
            if (barShown) {
              expect(isHouseholdMode(segments, G, { type: 'couple' })).toBe(true);
              expect(householdBarActiveKey(segments, search)).toBe(activeKey);
            }
          });
          it('Back goes to the household Home for a replaced bar tab, and pops otherwise', () => {
            const back = householdBackRoute(segments, search, G);
            if (kind === 'replace') expect(back).toBe(HOME);
            else expect(back).toBeNull();
          });
        }
        if (kind === 'replace') {
          it('cuts instead of sliding (nav=tab)', () => {
            expect(parse(target).search.nav).toBe('tab');
          });
        }
        if (kind === 'view') {
          it('is an in-place view of Home: bar stays on Home, Back returns to the Overview', () => {
            expect(householdBarActiveKey(['group', '[id]'], {})).toBe('home');
          });
        }
      });
    }
  }

  it('route entries for group screens keep the household bar and a popping Back', () => {
    for (const row of [...MORE, ...GEAR].filter(
      (r) => r[1] === 'route' && r[2].startsWith('/group'),
    )) {
      const { segments, search } = parse(row[2]);
      expect(isHouseholdMode(segments, G, { type: 'home' })).toBe(true);
      expect(householdBackRoute(segments, search, G)).toBeNull();
    }
  });
});

describe('runHouseholdAction uses the right verb', () => {
  const make = () => {
    const router = { replace: vi.fn(), push: vi.fn() };
    const deps: ActionDeps = {
      router: router as never,
      showView: vi.fn(),
      openMore: vi.fn(),
    };
    return { router, deps };
  };
  const every = [
    ...householdTiles(G),
    ...householdHomeButtons(G),
    ...householdMoreEntries(G, 42),
    ...householdGearEntries(G),
  ];
  it('replace → router.replace, push → router.push, nothing else navigates', () => {
    for (const entry of every) {
      const { router, deps } = make();
      runHouseholdAction(entry.action, deps);
      const kind = entry.action.kind;
      expect(router.replace).toHaveBeenCalledTimes(kind === 'replace' ? 1 : 0);
      expect(router.push).toHaveBeenCalledTimes(kind === 'push' || kind === 'route' ? 1 : 0);
      if (kind === 'view') expect(deps.showView).toHaveBeenCalledOnce();
      if (kind === 'more') expect(deps.openMore).toHaveBeenCalledOnce();
    }
  });
  it('a bar destination is never a push (that would leave a stale Home under it)', () => {
    for (const entry of every)
      if (/nav=tab/.test(hrefOf(entry.action))) expect(entry.action.kind).toBe('replace');
  });
});

// ───────────────────────────────────────────────── bug (a): plain ledger header ──

describe('bug a: the household Transactions tab is the plain-header ledger', () => {
  it('the Transactions route is the ledger view of the group screen', () => {
    const { segments, search } = parse(householdBarRoute(G, 'transactions'));
    expect(segments).toEqual(['group', '[id]']);
    expect(search.view).toBe('ledger');
    expect(householdBarActiveKey(segments, search)).toBe('transactions');
  });
  it('the household ledger draws TabHeader and no ScenicScreen; only split groups keep the scenic hero', () => {
    const screen = src('app/group/[id]/index.tsx');
    expect(screen).toMatch(/if \(!classic\)\s+return \(\s*<Screen edges=\{\[\]\}>\s*<TabHeader/);
    expect(screen).not.toMatch(/<ScenicScreen\b/);
    expect(screen).toMatch(/const classic = !hasHouseholdHome\(groupData\)/);
    expect(screen).toMatch(/<GroupHero\b/);
  });
});

// ───────────────────────────────────────── bug (b): Back from every tab root ──

describe('bug b: Back from a household tab root lands on the household Home', () => {
  const roots: [string, string][] = [
    ['Transactions', householdBarRoute(G, 'transactions')],
    ['Transactions (Balances)', `${householdBarRoute(G, 'transactions')}&tab=balances`],
    ['Planning', householdBarRoute(G, 'planning')],
    ['Upcoming', `/group/${G}?hh=upcoming&nav=tab`],
    ['Reports', householdBarRoute(G, 'reports')],
    ['Members', householdBarRoute(G, 'me')],
  ];
  for (const [name, href] of roots) {
    it(`${name}: header chevron and hardware Back both replace with Home, never '/'`, () => {
      const { segments, search } = parse(href);
      const home = householdBackRoute(segments, search, G);
      expect(home).toBe(HOME);

      let override: (() => void) | null = null;
      let hardware: (() => boolean) | null = null;
      const replace = vi.fn();
      const cleanup = installTabBack(() => replace(home), {
        setOverride: (fn) => (override = fn),
        addHardwareBack: (handler) => {
          hardware = handler;
          return { remove: vi.fn() };
        },
      });
      // The chevron calls router.back(), which runs the override.
      override!();
      // Hardware Back runs the same function and consumes the press.
      expect(hardware!()).toBe(true);
      expect(replace).toHaveBeenCalledTimes(2);
      for (const call of replace.mock.calls) {
        expect(call[0]).toBe(HOME);
        expect(call[0]).not.toBe('/');
      }
      cleanup!();
      expect(override).toBeNull();
    });
  }
  it('Home itself installs nothing, so Back leaves the group', () => {
    expect(householdBackRoute(['group', '[id]'], {}, G)).toBeNull();
    const setOverride = vi.fn();
    expect(
      installTabBack(null, { setOverride, addHardwareBack: vi.fn() as never }),
    ).toBeUndefined();
    expect(setOverride).not.toHaveBeenCalled();
  });
  it('the bar wires both paths through installTabBack', () => {
    const bar = src('components/AppTabBar.tsx');
    expect(bar).toMatch(/householdBackRoute\(/);
    expect(bar).toMatch(
      /addHardwareBack: \(handler\) =>\s*BackHandler\.addEventListener\('hardwareBackPress', handler\)/,
    );
    expect(bar).toMatch(/setOverride: setBackOverride/);
  });
});

// ─────────────────────────────────────────── bug (c): tab switches do not slide ──

describe('bug c: household tab switches replace and cut', () => {
  const keys: HouseholdBarKey[] = ['home', 'transactions', 'planning', 'reports', 'me'];
  it('every bar route carries nav=tab', () => {
    for (const key of keys) expect(parse(householdBarRoute(G, key)).search.nav).toBe('tab');
  });
  it('the bar moves by barMove (no unmount of the group root), never a bare replace', () => {
    const bar = src('components/AppTabBar.tsx');
    expect(bar).toMatch(/runBarMove\(barMove\(segments, href\), href as never\)/);
    expect(bar).not.toMatch(/router\.replace\(householdBarRoute/);
  });
  it('barMove: root views swap in place, Reports/Members push once then replace, Home pops', () => {
    const root = ['group', '[id]'];
    const reports = ['group', '[id]', 'insights'];
    const home = householdBarRoute(G, 'home');
    const ledger = householdBarRoute(G, 'transactions');
    // Home, Transactions and Planning are one mounted screen: params change, nothing navigates.
    for (const key of ['home', 'transactions', 'planning'] as const)
      expect(barMove(root, householdBarRoute(G, key))).toBe('navigate');
    expect(barMove(root, householdBarRoute(G, 'reports'))).toBe('push');
    expect(barMove(reports, householdBarRoute(G, 'me'))).toBe('replace');
    // Back to a root view pops to the still-mounted root, so the stack never grows.
    expect(barMove(reports, home)).toBe('dismissTo');
    expect(barMove(reports, ledger)).toBe('dismissTo');
    expect(barMove(['group', '[id]', 'expense', 'e1'], home)).toBe('dismissTo');
  });
  it('company: Overview pops, sub-tabs push once then replace', () => {
    expect(barMove(['group', '[id]'], companyBarRoute(G, 'team'))).toBe('push');
    expect(barMove(['group', '[id]', 'company-team'], companyBarRoute(G, 'vendors'))).toBe(
      'replace',
    );
    expect(barMove(['group', '[id]', 'company-team'], companyBarRoute(G, 'home'))).toBe(
      'dismissTo',
    );
  });
  it('the stack cuts on nav=tab for the group screen, Spending and Members', () => {
    const layout = src('app/_layout.tsx');
    expect(layout).toMatch(/nav === 'launch' \|\| nav === 'tab'\) return \{ animation: 'none' \}/);
    expect(layout).toMatch(/name="group\/\[id\]\/insights" options=\{tabCut\}/);
    expect(layout).toMatch(/name="group\/\[id\]\/members" options=\{tabCut\}/);
    expect(layout).toMatch(/=== 'tab'\s*\? \{ animation: 'none' as const \}/);
  });
});

// ─────────────────────────────────────────────────────────────────── Personal ──

describe('Personal mode', () => {
  const roots: [string[], string][] = [
    [['personal', 'transactions'], 'transactions'],
    [['personal', 'recurring'], 'planning'],
    [['personal', 'spending'], 'reports'],
  ];
  for (const [segments, key] of roots)
    it(`${segments.join('/')}: Personal bar, ${key} active, Back to Personal Home`, () => {
      expect(isPersonalMode(segments)).toBe(true);
      expect(personalActiveKey(segments)).toBe(key);
      expect(personalBackRoute(key)).toBe('/me');
    });
  it('Personal Home Back leaves to the shared Home', () => {
    expect(personalActiveKey(['(tabs)', 'me'])).toBe('home');
    expect(personalBackRoute('home')).toBe('/');
  });
  it('the bar stays Personal on nested routes, which pop their own stack', () => {
    for (const leaf of ['entry', 'source', 'budgets', 'loans', 'upcoming']) {
      const segments = ['personal', leaf];
      expect(isPersonalMode(segments)).toBe(true);
      expect(isNestedPersonal(segments)).toBe(true);
    }
    expect(isNestedPersonal(['personal', 'transactions'])).toBe(false);
    expect(isNestedPersonal(['group', '[id]'])).toBe(false);
  });
  it('hardware and chevron Back share one function', () => {
    expect(src('components/AppTabBar.tsx')).toMatch(/personalBackRoute\(activeKey\)/);
  });
});

// ───────────────────────────────────────────────────────────────────── company ──

describe('company mode', () => {
  const ids = [G];
  it('is on for an owner or manager of a company, off for staff and others', () => {
    expect(isCompanyMode(['group', '[id]'], G, ids, 'admin')).toBe(true);
    expect(isCompanyMode(['group', '[id]'], G, ids, 'manager')).toBe(true);
    expect(isCompanyMode(['group', '[id]'], G, ids, 'member')).toBe(false);
    expect(isCompanyMode(['group', '[id]'], 'other', ids, 'admin')).toBe(false);
  });
  for (const tab of ['team', 'payments', 'vendors', 'clients', 'more']) {
    it(`${tab} tab root: Back goes to the company Home`, () => {
      const route = companyBarRoute(G, tab);
      const segments = ['group', '[id]', route.split('/').pop()!];
      expect(companyBarActiveKey(segments)).toBe(tab === 'team' ? 'team' : tab);
      expect(isCompanyBarRoot(segments)).toBe(true);
      expect(companyBackRoute(segments, G)).toBe(`/group/${G}?nav=back`);
    });
  }
  it('company Home Back leaves to Home', () => {
    expect(companyBackRoute(['group', '[id]'], G)).toBe('/');
  });
  it('header chevron and hardware Back run the same function', () => {
    const run = vi.fn();
    let override: (() => void) | null = null;
    let hardware: (() => boolean) | null = null;
    installTabBack(run, {
      setOverride: (fn) => (override = fn),
      addHardwareBack: (handler) => ((hardware = handler), { remove: vi.fn() }),
    });
    override!();
    hardware!();
    expect(run).toHaveBeenCalledTimes(2);
  });
  it('the bar installs company Back through installTabBack', () => {
    expect(src('components/AppTabBar.tsx')).toMatch(/companyBack === null/);
  });
});
