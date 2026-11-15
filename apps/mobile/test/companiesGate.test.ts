import { describe, expect, it } from 'vitest';

import { isCompanyRoute, visibleGroups } from '../src/lib/companiesGate';
import { coldStartPlan, companyTabTarget } from '../src/lib/spaces';
import { viewerCompanyIds } from '../src/lib/companyTab';

const groups = [
  { id: 'a', type: 'trip', archived_at: null, deleted_at: null },
  { id: 'c', type: 'company', archived_at: null, deleted_at: null },
];

describe('companies off (iPhone)', () => {
  it('drops company groups, keeps the rest', () => {
    expect(visibleGroups(groups, false).map((g) => g.id)).toEqual(['a']);
  });

  it('keeps everything when companies are on', () => {
    expect(visibleGroups(groups, true)).toHaveLength(2);
  });

  it('a member of a company has no companies, so the cold start stays Personal', () => {
    const members = [{ group_id: 'c', profile_id: 'me', left_at: null }];
    const ids = viewerCompanyIds(visibleGroups(groups, false), members, 'me');
    expect(ids).toEqual([]);
    expect(coldStartPlan('c', true, ids)).toBe('personal');
    expect(companyTabTarget(ids, 'c')).toBeNull();
  });

  it('recognises company-only routes', () => {
    expect(isCompanyRoute('/companies')).toBe(true);
    expect(isCompanyRoute('/new-company')).toBe(true);
    expect(isCompanyRoute('/group/g1/company-bills')).toBe(true);
    expect(isCompanyRoute('/group/g1')).toBe(false);
    expect(isCompanyRoute('/group/g1/settle')).toBe(false);
  });
});
