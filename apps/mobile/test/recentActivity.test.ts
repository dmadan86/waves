/**
 * The recent-activity feed as a pure read, and its `limit`.
 *
 * The watch relay asks for only the newest few rows; the screen asks for all of
 * them. The limited read must be exactly the head of the full one — same rows,
 * same order, same joins — or the watch and the phone would disagree about
 * what happened last.
 */

import { describe, expect, it } from 'vitest';

import type { MirrorState } from '@waves/core';

import { recentActivity } from '@/data/recentActivity';

function mirror(): MirrorState {
  const activity: Record<string, Record<string, unknown>> = {};
  for (let i = 0; i < 40; i += 1) {
    const group = i % 7 === 0 ? 'g-gone' : i % 2 === 0 ? 'g-goa' : 'g-home';
    activity[`a${i}`] = {
      id: `a${i}`,
      group_id: group,
      actor_member_id: i % 3 === 0 ? 'm-me' : 'm-ravi',
      verb: 'created',
      object_type: 'expense',
      object_id: `e${i}`,
      payload: { amount: String(i * 100), currency: 'INR' },
      // Some share a timestamp, so the tie order is part of what is compared.
      created_at: `2026-09-${String(10 + Math.floor(i / 2)).padStart(2, '0')}T10:00:00.000Z`,
    };
  }
  return {
    cursors: {},
    tables: {
      groups: {
        'g-goa': { id: 'g-goa', name: 'Goa', cover_emoji: null, archived_at: null },
        'g-home': { id: 'g-home', name: 'Home', cover_emoji: null, archived_at: null },
        'g-gone': {
          id: 'g-gone',
          name: 'Gone',
          cover_emoji: null,
          archived_at: null,
          deleted_at: '2026-09-01T00:00:00.000Z',
        },
      },
      group_members: {
        'm-me': { id: 'm-me', group_id: 'g-goa', profile_id: 'p-me', ghost_name: null },
        'm-ravi': { id: 'm-ravi', group_id: 'g-goa', profile_id: 'p-ravi', ghost_name: null },
      },
      activity_log: activity,
      expenses: {},
    },
  } as unknown as MirrorState;
}

describe('recentActivity', () => {
  it('is newest first and drops rows of deleted groups', () => {
    const rows = recentActivity(mirror());
    expect(rows.some((row) => row.group_id === 'g-gone')).toBe(false);
    const times = rows.map((row) => row.created_at);
    expect([...times].sort().reverse()).toEqual(times);
    expect(rows[0]?.group?.name).toBeDefined();
    expect(rows.find((row) => row.actor_member_id === 'm-me')?.actor?.profile_id).toBe('p-me');
  });

  it('limited, is exactly the head of the full feed', () => {
    const m = mirror();
    const full = recentActivity(m);
    for (const limit of [0, 1, 5, 12, full.length, full.length + 10]) {
      expect(recentActivity(m, null, limit)).toEqual(full.slice(0, limit));
    }
    expect(recentActivity(m, 'p-me', 5)).toEqual(recentActivity(m, 'p-me').slice(0, 5));
  });
});
