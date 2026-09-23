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

describe('recentActivity — the reader’s stake', () => {
  /** One group, me and Ravi, and four activity rows about different objects. */
  function stakeMirror(): MirrorState {
    const version = (payers: [string, string][], shares: [string, string][]) => ({
      currency: 'INR',
      payers: payers.map(([member_id, amount]) => ({ member_id, amount })),
      shares: shares.map(([member_id, amount]) => ({ member_id, amount })),
    });
    const act = (id: string, over: Record<string, unknown>) => ({
      id,
      group_id: 'g-goa',
      actor_member_id: 'm-ravi',
      verb: 'added',
      object_type: 'expense',
      payload: {},
      created_at: `2026-09-10T10:00:0${id.slice(-1)}.000Z`,
      ...over,
    });
    return {
      cursors: {},
      tables: {
        groups: { 'g-goa': { id: 'g-goa', name: 'Goa', cover_emoji: null } },
        group_members: {
          'm-me': {
            id: 'm-me',
            group_id: 'g-goa',
            profile_id: 'p-me',
            ghost_name: null,
            left_at: null,
            profile: { display_name: 'Asha' },
          },
          'm-ravi': { id: 'm-ravi', group_id: 'g-goa', profile_id: 'p-ravi', ghost_name: null },
        },
        expenses: {
          // I paid 1000, owe 500: I lent 500.
          'e-lent': {
            id: 'e-lent',
            group_id: 'g-goa',
            currentVersion: version(
              [['m-me', '1000']],
              [
                ['m-me', '500'],
                ['m-ravi', '500'],
              ],
            ),
          },
          // I paid exactly my share: square, no direction.
          'e-square': {
            id: 'e-square',
            group_id: 'g-goa',
            currentVersion: version([['m-me', '500']], [['m-me', '500']]),
          },
          // A tombstone-ish row with no version.
          'e-empty': { id: 'e-empty', group_id: 'g-goa', currentVersion: null },
        },
        activity_log: {
          a1: act('a1', { object_id: 'e-lent' }),
          a2: act('a2', { object_id: 'e-square' }),
          a3: act('a3', { object_id: 'e-empty' }),
          a4: act('a4', { object_type: 'settlement', object_id: 's-1', verb: 'settled' }),
          a5: act('a5', { object_id: null, actor_member_id: null }),
          a6: act('a6', { object_id: 'e-unknown' }),
        },
      },
    } as unknown as MirrorState;
  }

  it('carries my signed stake on an expense row I am on', () => {
    // Given I paid 1000 and owe 500 on "e-lent"
    const rows = recentActivity(stakeMirror(), 'p-me');
    // Then the row about it carries +500 in the bill's currency
    expect(rows.find((r) => r.id === 'a1')?.stake).toEqual({ amount: 500n, currency: 'INR' });
  });

  it('is null for a square stake, a missing version, a settlement, an unknown expense and no object', () => {
    const byId = new Map(recentActivity(stakeMirror(), 'p-me').map((r) => [r.id, r]));
    for (const id of ['a2', 'a3', 'a4', 'a5', 'a6']) expect(byId.get(id)?.stake).toBeNull();
  });

  it('is null everywhere when no reader is given, and a row with no actor has none', () => {
    const rows = recentActivity(stakeMirror());
    expect(rows.every((r) => r.stake === null)).toBe(true);
    expect(rows.find((r) => r.id === 'a5')?.actor).toBeNull();
    // A group row with no archived_at column reads as not archived
    expect(
      recentActivity(stakeMirror()).find((r) => r.actor_member_id === 'm-ravi')?.group?.archived_at,
    ).toBeNull();
  });
});
