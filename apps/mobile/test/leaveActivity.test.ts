import { describe, expect, it } from 'vitest';
import type { MirrorState } from '@waves/core';
import { describeActivity, activityHeadline, activityTarget } from '@/data/activity';
import { recentActivity } from '@/data/recentActivity';
import { canDeleteComment, departedIds } from '@/lib/departedExpenses';

const mirror = {
  cursors: {},
  tables: {
    groups: { g: { id: 'g', name: 'Goa', cover_emoji: null, archived_at: null } },
    group_members: {
      me: { id: 'me', group_id: 'g', profile_id: 'p-me', ghost_name: null },
      ravi: {
        id: 'ravi',
        group_id: 'g',
        profile_id: 'p-r',
        ghost_name: null,
        left_at: '2026-09-02T00:00:00Z',
        profile: { display_name: 'Ravi' },
      },
    },
    expenses: {
      e1: {
        id: 'e1',
        group_id: 'g',
        deleted_at: null,
        currentVersion: {
          description: 'Dinner',
          currency: 'USD',
          amount: '1000',
          author_member_id: 'me',
          created_at: '2026-09-03T10:00:00.000Z',
          payers: [],
          shares: [],
        },
      },
    },
    activity_log: {
      r1: {
        id: 'r1',
        group_id: 'g',
        actor_member_id: 'me',
        verb: 'resplit',
        object_type: 'resplit_batch',
        object_id: 'b',
        payload: { count: 1, amount: '1000', name: 'Ravi' },
        created_at: '2026-09-03T10:00:00+00:00',
      },
    },
    expense_comments: {
      c1: {
        id: 'c1',
        group_id: 'g',
        expense_id: 'e1',
        author_member_id: 'ravi',
        deleted_by: 'me',
        body: 'hello',
        created_at: '2026-09-01T00:00:00Z',
        deleted_at: '2026-09-04T00:00:00Z',
      },
    },
  },
} as unknown as MirrorState;

describe('leave activity', () => {
  const rows = recentActivity(mirror, 'p-me');
  it('lists comments added and deleted, naming who deleted and whose it was', () => {
    const added = rows.find((r) => r.verb === 'commented')!;
    const deleted = rows.find((r) => r.verb === 'comment_deleted')!;
    expect(describeActivity(added, 'p-me')).toContain('Ravi commented on Dinner');
    expect(describeActivity(deleted, 'p-me')).toBe("You deleted Ravi's comment on Dinner");
    expect(activityHeadline(deleted)).toBe('Comment deleted');
    expect(activityTarget(deleted)).toBe('/group/g/expense/e1');
  });
  it('reads a USD re-split in dollars, not the legacy currency', () => {
    expect(rows.find((r) => r.verb === 'resplit')!.payload.currency).toBe('USD');
  });
});

describe('comment deletion and departed members', () => {
  it('lets a plain member delete the comment of someone who has left, but not a present one', () => {
    const gone = departedIds([
      { id: 'ravi', left_at: '2026-09-02' },
      { id: 'me', left_at: null },
    ]);
    expect(canDeleteComment(false, false, gone.has('ravi'))).toBe(true);
    expect(canDeleteComment(false, false, gone.has('me'))).toBe(false);
  });
});

describe('delete warning', () => {
  it('names a debtor who has left: the lookup is the list that keeps them', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync('src/app/group/[id]/settings.tsx', 'utf8');
    const at = source.indexOf('const nameFor = (memberId: string)');
    expect(source.slice(at, at + 400)).toContain('everyone.data');
  });
});
