import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { MirrorState } from '@waves/core';

import { recentActivity } from '@/data/recentActivity';

describe('restored expense keeps its name in the feed (was "Restored Travel", the category)', () => {
  it('a restore row carries the expense description', () => {
    const mirror = {
      cursors: {},
      tables: {
        groups: { g1: { id: 'g1', name: 'Goa', cover_emoji: null, archived_at: null } },
        group_members: {},
        expenses: {
          e1: {
            id: 'e1',
            group_id: 'g1',
            currentVersion: {
              amount: '45000',
              currency: 'INR',
              description: 'Dinner',
              payers: [],
              shares: [],
            },
          },
        },
        activity_log: {
          a1: {
            id: 'a1',
            group_id: 'g1',
            actor_member_id: null,
            verb: 'restored',
            object_type: 'expense',
            object_id: 'e1',
            payload: {},
            created_at: '2026-11-26T10:00:00.000Z',
          },
        },
      },
    } as unknown as MirrorState;
    expect(recentActivity(mirror)[0]?.payload.description).toBe('Dinner');
  });
});

describe('Edit expense auto-balances the other payer', () => {
  it('typing a payer on an edit does not keep every other payer locked', () => {
    const src = readFileSync(join(__dirname, '../src/app/group/[id]/add-expense.tsx'), 'utf8');
    expect(src).toMatch(/locked: editing && effectiveLocks\.size >= payers\.size \? EMPTY_LOCKS/);
  });
});
