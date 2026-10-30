import { describe, expect, it, vi } from 'vitest';

import { companyTabTarget, groupsOutsideCompanies, resolveSpace } from '../src/lib/spaces';

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
