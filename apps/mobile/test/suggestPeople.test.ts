import { describe, expect, it } from 'vitest';

import { suggestPeople, type SourceGroup } from '@/lib/addFromAnotherGroup';

const member = (
  memberId: string,
  name: string,
  over: Partial<{ profileId: string | null; phone: string | null; leftAt: string | null }> = {},
) => ({
  memberId,
  name,
  profileId: over.profileId ?? null,
  email: null,
  phone: over.phone ?? null,
  leftAt: over.leftAt ?? null,
});

const groups: SourceGroup[] = [
  {
    groupId: 'g1',
    groupLabel: 'Goa',
    members: [
      member('m1', 'Me', { profileId: 'p-me' }),
      member('m2', 'Ravi', { phone: '+919000000001' }),
      member('m3', 'Asha'),
      member('m4', 'Real Person', { profileId: 'p-real' }),
    ],
  },
  {
    groupId: 'g2',
    groupLabel: 'Flat',
    members: [
      member('m5', 'Ravi K', { phone: '+919000000001' }),
      member('m6', 'Zoe'),
      member('m7', 'Gone', { leftAt: '2026-01-01' }),
    ],
  },
];

describe('suggestPeople', () => {
  it('offers placeholders once each, the most shared first, never you or a real account', () => {
    const names = suggestPeople(groups, 'p-me', []).map((p) => p.name);
    expect(names).toEqual(['Ravi', 'Asha', 'Zoe']);
  });

  it('leaves out anybody already picked', () => {
    const picked = [{ name: 'Asha', email: null, phone: null }];
    expect(suggestPeople(groups, 'p-me', picked).map((p) => p.name)).toEqual(['Ravi', 'Zoe']);
  });

  it('stops at the limit', () => {
    expect(suggestPeople(groups, 'p-me', [], 1)).toHaveLength(1);
  });
});
