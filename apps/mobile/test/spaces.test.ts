import { describe, expect, it, vi } from 'vitest';

import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  coldStartPlan,
  coldStartSettled,
  companyTabTarget,
  followSpace,
  groupsOutsideCompanies,
  rememberSpace,
  resolveSpace,
  settleColdStart,
  spaceForRoute,
  takeColdStart,
} from '../src/lib/spaces';

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: { getItem: vi.fn(), setItem: vi.fn() },
}));

describe('spaces', () => {
  it('keeps companies out of the group list', () => {
    const groups = [{ type: 'trip' }, { type: 'company' }, { type: 'home' }];
    expect(groupsOutsideCompanies(groups)).toEqual([{ type: 'trip' }, { type: 'home' }]);
  });

  it('resolves a gone, left or unknown company to Personal', () => {
    expect(resolveSpace('c1', ['c1', 'c2'])).toBe('c1');
    expect(resolveSpace('c9', ['c1'])).toBe('personal');
    expect(resolveSpace('personal', ['c1'])).toBe('personal');
    expect(resolveSpace(null, ['c1'])).toBe('personal');
  });

  it('points the Company tab at the last company, the only one, or the list', () => {
    expect(companyTabTarget([], 'c1')).toBeNull();
    expect(companyTabTarget(['c1', 'c2'], 'c2')).toBe('/group/c2');
    expect(companyTabTarget(['c1'], null)).toBe('/group/c1');
    expect(companyTabTarget(['c1', 'c2'], null)).toBe('/companies');
    expect(companyTabTarget(['c1', 'c2'], 'gone')).toBe('/companies');
  });
});

describe('following the route', () => {
  const companies = ['c1', 'c2'];
  it('a company route (any role) sets that company', () => {
    expect(spaceForRoute(['group', '[id]', 'company-people'], 'c2', companies)).toBe('c2');
    expect(spaceForRoute(['group', '[id]'], 'c1', companies)).toBe('c1');
  });
  it('a plain group or an unknown id does not', () => {
    expect(spaceForRoute(['group', '[id]'], 'trip', companies)).toBeNull();
    expect(spaceForRoute(['group', '[id]'], null, companies)).toBeNull();
  });
  it('Home, Friends and Personal tabs set personal', () => {
    expect(spaceForRoute(['(tabs)'], null, companies)).toBe('personal');
    expect(spaceForRoute(['(tabs)', 'friends'], null, companies)).toBe('personal');
    expect(spaceForRoute(['personal', 'spending'], null, companies)).toBe('personal');
  });
  it('settings, modals and lists leave it alone', () => {
    expect(spaceForRoute(['settings', 'categories'], null, companies)).toBeNull();
    expect(spaceForRoute(['group', '[id]', 'settings'], 'c1', companies)).toBeNull();
    expect(spaceForRoute(['companies'], null, companies)).toBeNull();
    expect(spaceForRoute(['paywall'], null, companies)).toBeNull();
  });
  it('writes only on change and never undoes an explicit switch', async () => {
    const set = vi.mocked(AsyncStorage.setItem);
    set.mockClear();
    await followSpace('u1', 'c1');
    await followSpace('u1', 'c1');
    expect(set).toHaveBeenCalledWith('waves.lastSpace.u1', 'c1');
    expect(set).toHaveBeenCalledTimes(2); // lastSpace + lastCompany, once
    await rememberSpace('u1', 'personal');
    await followSpace('u1', 'personal');
    expect(set).toHaveBeenCalledTimes(3);
  });
  it('a first non-Home route settles the cold start', () => {
    expect(coldStartSettled('u2')).toBe(false);
    settleColdStart('u2');
    expect(coldStartSettled('u2')).toBe(true);
    expect(takeColdStart('u2')).toBe(false);
  });
});

describe('coldStartPlan', () => {
  it('stays on Personal without waiting for the company list', () => {
    expect(coldStartPlan(null, false, [])).toBe('stay');
    expect(coldStartPlan('personal', false, [])).toBe('stay');
  });
  it('waits for the list, then opens the remembered company or falls back', () => {
    expect(coldStartPlan('c1', false, [])).toBe('wait');
    expect(coldStartPlan('c1', true, ['c1', 'c2'])).toBe('c1');
    expect(coldStartPlan('gone', true, ['c1'])).toBe('personal');
  });
});
