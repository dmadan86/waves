import { describe, expect, it } from 'vitest';

import type { ActivityRow } from '@waves/api-client';

import { activityAmount, describeActivity } from '../src/lib/activity';
import { itemizedRows } from '../src/lib/itemizedLines';

const row = (over: Partial<ActivityRow>): ActivityRow => ({
  id: 'a1',
  group_id: 'g1',
  actor_member_id: 'm1',
  actor: { id: 'm1', profile_id: 'p1', ghost_name: null, profile: { display_name: 'Me' } },
  verb: 'restored',
  object_type: 'expense',
  object_id: 'e1',
  payload: {},
  created_at: '2026-11-26T10:00:00Z',
  ...over,
});

describe('web activity names and amounts', () => {
  it('a restore row names the expense, like a delete row', () => {
    expect(describeActivity(row({}), 'p1', new Map([['e1', 'Dinner']]))).toBe(
      'You restored Dinner',
    );
  });
  it('delete and restore rows take the amount from the expense, added rows from the payload', () => {
    const figures = new Map([['e1', { amount: '45000', currency: 'INR' }]]);
    expect(activityAmount(row({}), figures)).toEqual({ minor: 45000n, currency: 'INR' });
    expect(activityAmount(row({ verb: 'deleted' }), figures)?.minor).toBe(45000n);
    expect(
      activityAmount(row({ verb: 'added', payload: { amount: '1200', currency: 'INR' } }))?.minor,
    ).toBe(1200n);
    expect(activityAmount(row({ verb: 'joined', object_type: 'member' }), figures)).toBeNull();
  });
});

describe('web itemised expense detail', () => {
  it('lists each line with who claimed it', () => {
    const params = {
      kind: 'itemized',
      items: [
        { label: 'Pizza', total: '30000' },
        { label: 'Beer', total: '20000' },
      ],
      claims: { '0': ['m1', 'm2'], '1': ['m2'] },
    };
    expect(itemizedRows('itemized', params)).toEqual([
      { label: 'Pizza', total: 30000n, claimers: ['m1', 'm2'] },
      { label: 'Beer', total: 20000n, claimers: ['m2'] },
    ]);
    expect(itemizedRows('equal', params)).toEqual([]);
  });
});
