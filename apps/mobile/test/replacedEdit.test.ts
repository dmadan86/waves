import { describe, expect, it } from 'vitest';

import { replacedEditNotice } from '@/lib/groupNew';

const row = (actor: string, loser: string, at: string) => ({
  verb: 'superseded',
  object_type: 'expense',
  object_id: 'e1',
  actor_member_id: actor,
  created_at: at,
  payload: { supersededAuthorMemberId: loser },
});

describe('replacedEditNotice', () => {
  const mine = (id: string) => id === 'a';
  it('tells the person whose edit was replaced, and who replaced it', () => {
    expect(replacedEditNotice([row('b', 'a', '2026-11-26T10:00:00Z')], 'e1', mine)).toEqual({
      byMemberId: 'b',
    });
  });
  it('says nothing to the winner, another bill, or my own other phone', () => {
    expect(replacedEditNotice([row('a', 'b', '2026-11-26T10:00:00Z')], 'e1', mine)).toBeNull();
    expect(replacedEditNotice([row('b', 'a', '2026-11-26T10:00:00Z')], 'e2', mine)).toBeNull();
    expect(replacedEditNotice([row('a', 'a', '2026-11-26T10:00:00Z')], 'e1', mine)).toBeNull();
  });
});
