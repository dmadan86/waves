/**
 * What Review reads off the mirror: the filing tallies a suggestion is made
 * from, and the "filed this week" count.
 *
 * Both are one pass over rows the phone already holds. The rules that matter:
 * a tombstone is not a filing, a group you have no ledger in is not somewhere a
 * suggestion may point, and the weekly count is of assigned drafts caught in
 * the last seven days only. Hooks are run as plain functions with `useMemo`
 * stood in for by its identity.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { emptyMirror, type MirrorState } from '@waves/core';

const state = vi.hoisted(() => ({
  mirror: null as unknown,
  queue: [] as unknown[],
  session: null as { user: { id: string } } | null,
}));

vi.mock('react', () => ({ useMemo: (fn: () => unknown) => fn() }));
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ session: state.session }) }));
vi.mock('@/sync', () => ({ useSync: () => ({ mirror: state.mirror, queue: state.queue }) }));

const { useFiledThisWeek, useSuggestionIndex } = await import('@/data/reviewSources');

const OWNER = 'user-1';
const NOW = Date.parse('2026-09-20T12:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;

function withRows(tables: Record<string, Record<string, unknown>>): MirrorState {
  const m = emptyMirror();
  for (const [table, rows] of Object.entries(tables)) {
    Object.assign((m.tables as Record<string, Record<string, unknown>>)[table]!, rows);
  }
  return m;
}

function group(id: string, over: Record<string, unknown> = {}) {
  return {
    id,
    name: id,
    created_at: '2026-01-01T00:00:00.000Z',
    archived_at: null,
    deleted_at: null,
    ...over,
  };
}

function expense(id: string, groupId: string, version: Record<string, unknown> | null, over = {}) {
  return {
    id,
    group_id: groupId,
    deleted_at: null,
    created_at: '2026-09-01',
    currentVersion: version,
    ...over,
  };
}

function capture(id: string, over: Record<string, unknown>) {
  return {
    id,
    owner_user_id: OWNER,
    description: 'x',
    status: 'assigned',
    deleted_at: null,
    created_at: new Date(NOW - DAY).toISOString(),
    ...over,
  };
}

beforeEach(() => {
  state.mirror = emptyMirror();
  state.queue = [];
  state.session = { user: { id: OWNER } };
});

describe('useSuggestionIndex', () => {
  it('tallies merchants and categories per group from live filings only', () => {
    // Given filings in two live groups, one archived group (still a ledger),
    // plus a deleted expense, an expense in a deleted group and an empty filing
    state.mirror = withRows({
      groups: {
        goa: group('goa'),
        home: group('home'),
        old: group('old', { archived_at: '2026-06-01T00:00:00.000Z' }),
        gone: group('gone', { deleted_at: '2026-06-01T00:00:00.000Z' }),
      },
      expenses: {
        e1: expense('e1', 'goa', { description: 'Starbucks', category: 'food' }),
        e2: expense('e2', 'goa', { description: 'Starbucks', category: 'food' }),
        e3: expense('e3', 'home', { description: null, category: 'rent' }),
        e4: expense('e4', 'old', { description: 'Starbucks' }),
        e5: expense(
          'e5',
          'goa',
          { description: 'Starbucks', category: 'food' },
          {
            deleted_at: '2026-09-02T00:00:00.000Z',
          },
        ),
        e6: expense('e6', 'gone', { description: 'Starbucks', category: 'food' }),
        e7: expense('e7', 'home', { description: '', category: null }),
        e8: expense('e8', 'home', null),
      },
    });

    // When the index is built
    const index = useSuggestionIndex();

    // Then only the live filings are counted, per group
    expect(Object.fromEntries(index.categories.get('food') ?? [])).toEqual({ goa: 2 });
    expect(Object.fromEntries(index.categories.get('rent') ?? [])).toEqual({ home: 1 });
    expect(index.merchants.size).toBe(1);
    const [merchant] = [...index.merchants.values()];
    expect(Object.fromEntries(merchant ?? [])).toEqual({ goa: 2, old: 1 });
  });

  it('is empty for an empty mirror', () => {
    const index = useSuggestionIndex();
    expect(index.merchants.size).toBe(0);
    expect(index.categories.size).toBe(0);
  });
});

describe('useFiledThisWeek', () => {
  it('counts assigned, live drafts caught within the last seven days', () => {
    state.mirror = withRows({
      captures: {
        c1: capture('c1', {}),
        c2: capture('c2', { created_at: new Date(NOW - 6 * DAY).toISOString() }),
        // Too old
        c3: capture('c3', { created_at: new Date(NOW - 8 * DAY).toISOString() }),
        // Still waiting
        c4: capture('c4', { status: 'open' }),
        // Deleted
        c5: capture('c5', { deleted_at: new Date(NOW).toISOString() }),
        // Unreadable timestamp
        c6: capture('c6', { created_at: 'yesterday-ish' }),
        // Somebody else's
        c7: capture('c7', { owner_user_id: 'user-2' }),
      },
    });
    expect(useFiledThisWeek(NOW)).toBe(2);
  });

  it('is zero when signed out', () => {
    state.session = null;
    state.mirror = withRows({ captures: { c1: capture('c1', {}) } });
    expect(useFiledThisWeek(NOW)).toBe(0);
  });
});
