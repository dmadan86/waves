import { describe, expect, it } from 'vitest';

import { resolveFab } from '../src/lib/tabBar';
import {
  companyActiveKey,
  companyBackRoute,
  companyBarActiveKey,
  companyBarRoute,
  isCompanyMode,
  viewerRoleIn,
  homeSecondActionKey,
  isCompanyTabRoot,
  reviewSlotKey,
  viewerCompanyIds,
} from '../src/lib/companyTab';

describe('viewerCompanyIds', () => {
  const groups = [
    'second',
    'left',
    'archived',
    'deleted',
    'other',
    'regular',
    'first',
    'second',
  ].map((id) => ({
    id,
    type: id === 'regular' ? 'group' : 'company',
    archived_at: id === 'archived' ? '2026-01-01' : null,
    deleted_at: id === 'deleted' ? '2026-01-01' : null,
  }));
  const members = groups.map(({ id }) => ({
    group_id: id,
    profile_id: id === 'other' ? 'someone-else' : 'viewer',
    left_at: id === 'left' ? '2026-01-01' : null,
  }));

  it('excludes left, archived, deleted, other-user and non-company groups, preserving order without duplicates', () => {
    expect(viewerCompanyIds(groups, members, 'viewer')).toEqual(['second', 'first']);
  });

  it('returns no companies for a null viewer, even with a null-profile membership', () => {
    expect(
      viewerCompanyIds(groups, [{ group_id: 'first', profile_id: null, left_at: null }], null),
    ).toEqual([]);
  });

  it('requires a membership and accepts any current matching entry', () => {
    expect(viewerCompanyIds(groups, [], 'viewer')).toEqual([]);
    expect(
      viewerCompanyIds(
        groups,
        [
          { group_id: 'first', profile_id: 'viewer', left_at: '2026-01-01' },
          { group_id: 'first', profile_id: 'viewer', left_at: null },
        ],
        'viewer',
      ),
    ).toEqual(['first']);
  });
});

describe('company tab destinations', () => {
  it('uses the Review slot for Company only when companies exist', () => {
    expect(reviewSlotKey([])).toBe('captures');
    expect(reviewSlotKey(['a'])).toBe('company');
    expect(reviewSlotKey(['a', 'b'])).toBe('company');
  });

  it('swaps Settle up for Review on Home only for company users', () => {
    expect(homeSecondActionKey([])).toBe('settle');
    expect(homeSecondActionKey(['a'])).toBe('review');
    expect(homeSecondActionKey(['a', 'b'])).toBe('review');
  });
});

describe('companyActiveKey', () => {
  it('highlights the companies list and company subroutes', () => {
    expect(companyActiveKey(['companies'], null, [])).toBe('company');
    expect(companyActiveKey(['companies', 'details'], null, [])).toBe('company');
    expect(companyActiveKey(['group', '[id]'], 'a', ['a', 'b'])).toBe('company');
    expect(companyActiveKey(['group', '[id]', 'members'], 'a', ['a'])).toBe('company');
  });

  it('leaves unrelated routes, groups and null group ids inactive', () => {
    expect(companyActiveKey([], null, ['a'])).toBe('');
    expect(companyActiveKey(['captures'], 'a', ['a'])).toBe('');
    expect(companyActiveKey(['group', '[id]'], 'b', ['a'])).toBe('');
    expect(companyActiveKey(['group', '[id]'], null, ['a'])).toBe('');
  });
});

describe('isCompanyTabRoot', () => {
  it('recognizes only the list root or the sole company root', () => {
    expect(isCompanyTabRoot(['companies'], null, [])).toBe(true);
    expect(isCompanyTabRoot(['group', '[id]'], 'a', ['a'])).toBe(true);
    expect(isCompanyTabRoot(['companies', 'details'], null, ['a'])).toBe(false);
    expect(isCompanyTabRoot(['group', '[id]', 'members'], 'a', ['a'])).toBe(false);
    expect(isCompanyTabRoot(['group', '[id]'], 'a', ['a', 'b'])).toBe(false);
    expect(isCompanyTabRoot(['group', '[id]'], 'b', ['a'])).toBe(false);
    expect(isCompanyTabRoot(['group', '[id]'], null, ['a'])).toBe(false);
    expect(isCompanyTabRoot(['group', '[id]'], 'a', [])).toBe(false);
    expect(isCompanyTabRoot(['group'], 'a', ['a'])).toBe(false);
    expect(isCompanyTabRoot(['captures', '[id]'], 'a', ['a'])).toBe(false);
    expect(isCompanyTabRoot([], null, [])).toBe(false);
  });
});

describe('isCompanyMode', () => {
  const seg = ['group', '[id]'];
  it('is on for an owner or manager inside their company', () => {
    expect(isCompanyMode(seg, 'a', ['a', 'b'], 'admin')).toBe(true);
    expect(isCompanyMode(seg, 'a', ['a'], 'manager')).toBe(true);
  });
  it('is off for an employee, a non-company group, or a company the viewer is not in', () => {
    expect(isCompanyMode(seg, 'a', ['a'], 'member')).toBe(false);
    expect(isCompanyMode(seg, 'g', ['a'], 'admin')).toBe(false);
    expect(isCompanyMode(seg, 'z', ['a'], 'admin')).toBe(false);
    expect(isCompanyMode(seg, 'a', ['a'], null)).toBe(false);
  });
  it('is off outside group routes', () => {
    expect(isCompanyMode(['personal', 'spending'], 'a', ['a'], 'admin')).toBe(false);
  });
  it('reads the role per company: owner in A, employee in B', () => {
    const members = [
      { group_id: 'a', profile_id: 'me', left_at: null, role: 'admin' },
      { group_id: 'b', profile_id: 'me', left_at: null, role: 'member' },
      { group_id: 'c', profile_id: 'me', left_at: '2026-01-01', role: 'admin' },
    ];
    expect(viewerRoleIn(members, 'a', 'me')).toBe('admin');
    expect(viewerRoleIn(members, 'b', 'me')).toBe('member');
    expect(viewerRoleIn(members, 'c', 'me')).toBeNull();
  });
});

describe('company bar navigation', () => {
  it('highlights the tab a screen belongs to', () => {
    expect(companyBarActiveKey(['group', '[id]'])).toBe('overview');
    expect(companyBarActiveKey(['group', '[id]', 'company-people'])).toBe('team');
    expect(companyBarActiveKey(['group', '[id]', 'members'])).toBe('team');
    expect(companyBarActiveKey(['group', '[id]', 'company-wages'])).toBe('payments');
    expect(companyBarActiveKey(['group', '[id]', 'company-team'])).toBe('team');
    expect(companyBarActiveKey(['group', '[id]', 'company-work'])).toBe('team');
    expect(companyBarActiveKey(['group', '[id]', 'company-attendance'])).toBe('team');
    expect(companyBarActiveKey(['group', '[id]', 'company-pending'])).toBe('overview');
    expect(companyBarActiveKey(['group', '[id]', 'company-entry'])).toBe('');
    expect(companyBarRoute('a', 'team')).toBe('/group/a/company-team');
  });
  it('Back goes sub-tab to Overview, Overview to Home, and nowhere on deeper screens', () => {
    expect(companyBackRoute(['group', '[id]', 'company-more'], 'a')).toBe('/group/a');
    expect(companyBackRoute(['group', '[id]', 'company-team'], 'a')).toBe('/group/a');
    expect(companyBackRoute(['group', '[id]', 'company-work'], 'a')).toBe('/group/a');
    expect(companyBackRoute(['group', '[id]', 'company-people'], 'a')).toBe('/group/a');
    expect(companyBackRoute(['group', '[id]', 'company-attendance'], 'a')).toBe('/group/a');
    expect(companyBackRoute(['group', '[id]', 'company-pending'], 'a')).toBe('/group/a');
    expect(companyBackRoute(['group', '[id]'], 'a')).toBe('/');
    expect(companyBackRoute(['group', '[id]', 'company-statement'], 'a')).toBeNull();
  });
  it('hides the add button on entry, wages, invite and export', () => {
    for (const s of ['company-entry', 'company-wages', 'invite', 'export'])
      expect(resolveFab(['group', '[id]', s])).toBe(false);
    expect(resolveFab(['group', '[id]', 'company-people'])).toBe(true);
  });
});
