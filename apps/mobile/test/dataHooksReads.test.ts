/**
 * The read side of `src/data/hooks.ts`: what each screen gets out of the mirror.
 *
 * ADR-005 moved every one of these off the network and onto the local mirror,
 * which makes them pure derivations — mirror + queue in, rows out. The hooks are
 * called here as plain functions (see `support/hookHarness.ts`), against a real
 * mirror built with `@waves/core`, so what is asserted is the number a person
 * would see: their balance on the dashboard, who they owe, which groups are
 * one-to-ones, what the trip plan holds.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MutationKind, SyncTable, categoryTagsScope, groupPinsScope } from '@waves/core';

import {
  expenseRow,
  groupRow,
  memberRow,
  mirrorOf,
  query,
  queueOf,
  render,
  resetHarness,
  resetSync,
  settlementRow,
  sync,
  syncModule,
  unmount,
  type CapturedQuery,
} from './support/hookHarness';

vi.mock('react', async () => {
  const harness = await import('./support/hookHarness');
  return { ...harness.fakeReact, default: harness.fakeReact };
});
vi.mock(
  '@tanstack/react-query',
  async () => (await import('./support/hookHarness')).fakeReactQuery,
);
vi.mock('@/sync', async () => (await import('./support/hookHarness')).fakeSync);
vi.mock('expo-crypto', () => ({ randomUUID: () => 'uuid-fixed' }));
// `@/lib/phone` reads the device region from here; the real module pulls React Native.
vi.mock('@/i18n', () => ({ deviceCountry: () => 'IN' }));

const auth = vi.hoisted(() => ({
  value: { session: null, profile: null } as {
    session: { user: { id: string } } | null;
    profile: { id: string; country_code?: string | null } | null;
  },
}));
vi.mock('@/lib/auth', () => ({ useAuth: () => auth.value }));

const observability = vi.hoisted(() => ({ reportHandled: vi.fn() }));
vi.mock('@/lib/observability', () => observability);

const realtime = vi.hoisted(() => {
  interface FakeChannel {
    topic: string;
    handlers: { filter: { table: string; filter: string }; cb: () => void }[];
    subscribed: boolean;
    on: (event: string, filter: { table: string; filter: string }, cb: () => void) => FakeChannel;
    subscribe: () => FakeChannel;
  }
  const channels: FakeChannel[] = [];
  const client = {
    channel: vi.fn((topic: string) => {
      const channel: FakeChannel = {
        topic,
        handlers: [],
        subscribed: false,
        on(_event, filter, cb) {
          channel.handlers.push({ filter, cb });
          return channel;
        },
        subscribe() {
          channel.subscribed = true;
          return channel;
        },
      };
      channels.push(channel);
      return channel;
    }),
    removeChannel: vi.fn((_channel: unknown) => Promise.resolve()),
    rpc: vi.fn(),
  };
  return { channels, client };
});
vi.mock('@/lib/backend', () => ({ backend: realtime.client }));

const api = vi.hoisted(() => ({
  createGroup: vi.fn(),
  deleteGroup: vi.fn(),
  fetchBalances: vi.fn(() => Promise.resolve([])),
  fetchExpenseVersions: vi.fn(() => Promise.resolve([])),
  fetchItemClaims: vi.fn(() => Promise.resolve([])),
  fetchOpenReceipts: vi.fn(() => Promise.resolve([])),
  fetchReceipt: vi.fn(() => Promise.resolve(null)),
  fetchMemberClaims: vi.fn(() => Promise.resolve([])),
  decideMemberClaim: vi.fn(),
  recordSettlement: vi.fn(),
  leaveGroup: vi.fn(),
  updateGroup: vi.fn(),
  updateMember: vi.fn(),
  setMemberRole: vi.fn(),
  removeExpenseReceipt: vi.fn(),
}));
vi.mock('@/data/api', () => api);
vi.mock('@/lib/storage', () => ({ putImage: vi.fn(), removeRestrictedImage: vi.fn() }));
vi.mock('@/lib/image', () => ({ pickAlbumPhoto: vi.fn() }));

const hooks = await import('@/data/hooks');

const ME = 'p-me';
const OWNER = 'user-me';

beforeEach(() => {
  resetHarness();
  resetSync();
  realtime.channels.length = 0;
  realtime.client.channel.mockClear();
  realtime.client.removeChannel.mockClear();
  realtime.client.rpc.mockReset();
  observability.reportHandled.mockClear();
  auth.value = { session: { user: { id: OWNER } }, profile: { id: ME } };
});

afterEach(() => {
  unmount();
  vi.useRealTimers();
});

describe('the local-read wrapper every mirror hook returns', () => {
  it('reports loading until the mirror is hydrated, and fetching while a sync runs', () => {
    sync.hydrated = false;
    sync.status = 'syncing';
    const read = render(() => hooks.useGroups());
    expect(read.isLoading).toBe(true);
    expect(read.isFetching).toBe(true);
    expect(read.isError).toBe(false);
  });

  it('refetches by flushing the sync, never by asking the network directly', () => {
    const read = render(() => hooks.useGroups());
    read.refetch();
    expect(sync.flush).toHaveBeenCalledTimes(1);
    expect(read.isLoading).toBe(false);
    expect(read.isFetching).toBe(false);
  });
});

describe('group lists', () => {
  beforeEach(() => {
    sync.mirror = mirrorOf({
      [SyncTable.Groups]: [
        groupRow('g-live', { created_at: '2026-01-02T00:00:00Z' }),
        groupRow('g-archived', { archived_at: '2026-01-05T00:00:00Z' }),
        groupRow('g-deleted', { deleted_at: '2026-01-06T00:00:00Z' }),
      ],
    });
  });

  it('useGroups shows only live, unarchived groups', () => {
    expect(render(() => hooks.useGroups()).data.map((g) => g.id)).toEqual(['g-live']);
  });

  it('useArchivedGroups shows the archived ones, never a deleted one', () => {
    expect(render(() => hooks.useArchivedGroups()).data.map((g) => g.id)).toEqual(['g-archived']);
  });

  it('a group created offline is listed straight away', () => {
    sync.queue = queueOf({
      id: 'm-1',
      kind: MutationKind.GroupCreate,
      scope: 'g-new',
      payload: { name: 'Goa', currency: 'INR' },
    });
    const ids = render(() => hooks.useGroups()).data.map((g) => g.id);
    expect(ids).toContain('g-new');
  });
});

describe('usePinnedGroupIds', () => {
  it('is empty when nobody is signed in', () => {
    auth.value = { session: null, profile: null };
    expect(render(() => hooks.usePinnedGroupIds()).size).toBe(0);
  });

  it('includes a group pinned offline by the signed-in person', () => {
    sync.queue = queueOf({
      id: 'm-pin',
      kind: MutationKind.GroupPinSet,
      scope: groupPinsScope(OWNER),
      payload: { pinId: 'pin-1', groupId: 'g-1' },
    });
    expect([...render(() => hooks.usePinnedGroupIds())]).toEqual(['g-1']);
  });
});

describe('useOneToOneGroupIds', () => {
  it('counts a group as a one-to-one only when exactly two members are still in it', () => {
    sync.mirror = mirrorOf({
      [SyncTable.Groups]: [groupRow('g-pair'), groupRow('g-three'), groupRow('g-left')],
      [SyncTable.GroupMembers]: [
        memberRow('a1', 'g-pair', ME),
        memberRow('a2', 'g-pair', 'p-2'),
        memberRow('b1', 'g-three', ME),
        memberRow('b2', 'g-three', 'p-2'),
        memberRow('b3', 'g-three', null),
        memberRow('c1', 'g-left', ME),
        memberRow('c2', 'g-left', 'p-2'),
        memberRow('c3', 'g-left', 'p-3', { left_at: '2026-01-03T00:00:00Z' }),
      ],
    });
    const ids = render(() => hooks.useOneToOneGroupIds()).data;
    expect([...ids].sort()).toEqual(['g-left', 'g-pair']);
  });
});

describe('useGroupPeopleSignatures', () => {
  beforeEach(() => {
    sync.mirror = mirrorOf({
      [SyncTable.Groups]: [groupRow('g-mine'), groupRow('g-theirs')],
      [SyncTable.GroupMembers]: [
        memberRow('m1', 'g-mine', ME),
        memberRow('m2', 'g-mine', 'p-2'),
        memberRow('m3', 'g-mine', null, { ghost_name: 'Ravi' }),
        memberRow('m4', 'g-mine', null, { ghost_name: null }),
        memberRow('m5', 'g-mine', 'p-5', { left_at: '2026-01-02T00:00:00Z' }),
        memberRow('t1', 'g-theirs', 'p-2'),
        memberRow('t2', 'g-theirs', 'p-3'),
      ],
    });
  });

  it('lists the other live members by name, only for groups I am in', () => {
    const sigs = render(() => hooks.useGroupPeopleSignatures(ME)).data;
    expect(sigs).toEqual([{ groupId: 'g-mine', names: ['Name m2', 'Ravi'] }]);
  });

  it('has nothing to say before the profile is known', () => {
    expect(render(() => hooks.useGroupPeopleSignatures(null)).data).toEqual([]);
  });
});

describe('useSettledTotals', () => {
  it('sums confirmed settlements I was either side of, per currency', () => {
    sync.mirror = mirrorOf({
      [SyncTable.GroupMembers]: [
        memberRow('me-1', 'g-1', ME),
        memberRow('o-1', 'g-1', 'p-2'),
        memberRow('o-2', 'g-1', 'p-3'),
      ],
      [SyncTable.Settlements]: [
        settlementRow('s1', 'g-1', { from: 'me-1', to: 'o-1', amount: 500n }),
        settlementRow('s2', 'g-1', {
          from: 'o-1',
          to: 'me-1',
          amount: 250n,
          status: 'auto_confirmed',
        }),
        settlementRow('s3', 'g-1', { from: 'o-1', to: 'me-1', amount: 900n, currency: 'USD' }),
        // Only claimed, never agreed: not money that changed hands yet.
        settlementRow('s4', 'g-1', {
          from: 'me-1',
          to: 'o-1',
          amount: 10_000n,
          status: 'initiated',
        }),
        // Between two other people.
        settlementRow('s5', 'g-1', { from: 'o-1', to: 'o-2', amount: 7_000n }),
      ],
    });
    const totals = render(() => hooks.useSettledTotals(ME)).data;
    expect(totals.get('INR')).toBe(750n);
    expect(totals.get('USD')).toBe(900n);
    expect(totals.size).toBe(2);
  });
});

describe('useHomeSummary', () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: new Date(2026, 1, 15, 12, 0, 0) });
    sync.mirror = mirrorOf({
      [SyncTable.Groups]: [
        groupRow('g-1', { created_at: '2026-01-01T00:00:00Z' }),
        groupRow('g-other', { default_currency: 'EUR' }),
        groupRow('g-empty', { created_at: '2026-02-14T08:00:00Z' }),
      ],
      [SyncTable.GroupMembers]: [
        memberRow('m1', 'g-1', ME),
        memberRow('m2', 'g-1', 'p-2'),
        memberRow('m3', 'g-1', null),
        memberRow('x1', 'g-other', 'p-2'),
        memberRow('x2', 'g-other', 'p-3'),
        memberRow('e1', 'g-empty', ME),
      ],
      [SyncTable.Expenses]: [
        // I paid 900, split three ways, this month: +600 for me, 300 of it mine.
        expenseRow('e-feb', 'g-1', {
          amount: 900n,
          payer: 'm1',
          shares: { m1: 300n, m2: 300n, m3: 300n },
          date: '2026-02-10',
          createdAt: '2026-02-10T10:00:00Z',
        }),
        // Last month, paid by m2: -300 for me, not "this month".
        expenseRow('e-jan', 'g-1', {
          amount: 600n,
          payer: 'm2',
          shares: { m1: 300n, m2: 300n },
          date: '2026-01-05',
          createdAt: '2026-01-05T10:00:00Z',
        }),
        // A dollar expense this month: my 500 is dollars, never rupees.
        expenseRow('e-usd', 'g-1', {
          amount: 1000n,
          payer: 'm2',
          shares: { m1: 500n, m2: 500n },
          currency: 'USD',
          date: '2026-02-11',
          createdAt: '2026-02-11T10:00:00Z',
        }),
        // Deleted later than anything else happened: it still counts as activity.
        expenseRow('e-gone', 'g-1', {
          amount: 50n,
          payer: 'm1',
          shares: { m1: 50n },
          date: '2026-02-12',
          createdAt: '2026-02-12T10:00:00Z',
          deletedAt: '2026-02-13T10:00:00Z',
        }),
      ],
      [SyncTable.Settlements]: [
        settlementRow('s-wait', 'g-1', {
          from: 'm2',
          to: 'm1',
          amount: 200n,
          status: 'initiated',
          initiatedAt: '2026-02-09T00:00:00Z',
        }),
      ],
    });
  });

  it('computes my balance per group in the group currency, from the mirror', () => {
    const home = render(() => hooks.useHomeSummary(ME));
    // +600 (Feb) − 300 (Jan); the unconfirmed settlement does not count yet.
    expect(home.balanceFor('g-1')).toBe(300n);
    expect(home.balanceFor('g-other')).toBe(0n);
    expect(home.totals).toEqual([{ currency: 'INR', net: 300n, owed: 300n, owing: 0n }]);
  });

  it('adds up my own share of this month, per currency, biggest first', () => {
    const home = render(() => hooks.useHomeSummary(ME));
    expect(home.monthSpent).toEqual([
      { currency: 'USD', amount: 500n },
      { currency: 'INR', amount: 300n },
    ]);
  });

  it('marks groups waiting on a confirmation, and those with a ledger yet', () => {
    const home = render(() => hooks.useHomeSummary(ME));
    expect(home.hasPending('g-1')).toBe(true);
    expect(home.hasPending('g-empty')).toBe(false);
    expect(home.hasLedger('g-1')).toBe(true);
    expect(home.hasLedger('g-empty')).toBe(false);
  });

  it('orders by last activity: a deletion counts, an empty group falls back to its creation', () => {
    const home = render(() => hooks.useHomeSummary(ME));
    expect(home.lastActivityFor('g-1')).toBe(Date.parse('2026-02-13T10:00:00Z'));
    expect(home.lastActivityFor('g-empty')).toBe(Date.parse('2026-02-14T08:00:00Z'));
    expect(home.lastActivityFor('nope')).toBe(0);
  });

  it('knows who is in each group', () => {
    const home = render(() => hooks.useHomeSummary(ME));
    expect(home.memberCountFor('g-1')).toBe(3);
    expect(
      home
        .membersFor('g-other')
        .map((m) => m.id)
        .sort(),
    ).toEqual(['x1', 'x2']);
    expect(home.membersFor('nope')).toEqual([]);
    expect(home.memberCountFor('nope')).toBe(0);
  });

  it('holds the balance back until the first sync of the session settles', () => {
    sync.hasSynced = false;
    sync.status = 'syncing';
    const home = render(() => hooks.useHomeSummary(ME));
    expect(home.pendingFirstSync).toBe(true);
    expect(home.isFetching).toBe(true);

    sync.status = 'offline';
    expect(render(() => hooks.useHomeSummary(ME)).pendingFirstSync).toBe(false);
  });

  it('with no profile yet, says the viewer is unknown and shows no balance', () => {
    const home = render(() => hooks.useHomeSummary(null));
    expect(home.viewerUnknown).toBe(true);
    expect(home.balanceFor('g-1')).toBe(0n);
    expect(home.totals).toEqual([]);
    home.refetch();
    expect(sync.flush).toHaveBeenCalled();
  });

  it('re-reads the month at the next local midnight, and stops on unmount', () => {
    render(() => hooks.useHomeSummary(ME));
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(24 * 60 * 60 * 1000);
    // The tick reschedules itself for the following midnight.
    expect(vi.getTimerCount()).toBe(1);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('people', () => {
  beforeEach(() => {
    sync.mirror = mirrorOf({
      [SyncTable.Groups]: [
        groupRow('g-1'),
        groupRow('g-2', { archived_at: '2026-01-09T00:00:00Z' }),
        groupRow('g-not-mine'),
      ],
      [SyncTable.GroupMembers]: [
        memberRow('m1', 'g-1', ME),
        memberRow('m2', 'g-1', 'p-2'),
        memberRow('ghost', 'g-1', null, { ghost_name: 'Ravi', invite_phone: '+919876543210' }),
        memberRow('n1', 'g-2', ME),
        memberRow('n2', 'g-2', 'p-2'),
        memberRow('z1', 'g-not-mine', 'p-8'),
        memberRow('z2', 'g-not-mine', 'p-9'),
      ],
      [SyncTable.Expenses]: [
        expenseRow('e1', 'g-1', {
          amount: 900n,
          payer: 'm1',
          shares: { m1: 300n, m2: 300n, ghost: 300n },
          date: '2026-02-01',
        }),
        expenseRow('e2', 'g-2', {
          amount: 400n,
          payer: 'n2',
          shares: { n1: 200n, n2: 200n },
          date: '2026-01-08',
        }),
        expenseRow('e3', 'g-not-mine', {
          amount: 100n,
          payer: 'z1',
          shares: { z1: 50n, z2: 50n },
        }),
      ],
      [SyncTable.Settlements]: [
        settlementRow('s1', 'g-1', {
          from: 'm2',
          to: 'm1',
          amount: 100n,
          initiatedAt: '2026-02-03T00:00:00Z',
        }),
      ],
      [SyncTable.GhostMerges]: [
        {
          id: 'ghost',
          owner: ME,
          member_id: 'ghost',
          person_id: 'person-ravi',
          display_name: 'Ravi K',
          group_id: 'scope',
        },
      ],
    });
  });

  it('usePeopleBalances: who owes me and whom I owe, archived groups included', () => {
    const rows = render(() => hooks.usePeopleBalances(ME)).data;
    // p-2 owes me 300 in g-1, less the 100 they paid back — and I owe them 200
    // in the archived g-2. Counting the archived trip makes them square, and a
    // square person is not a debt, so they are not listed at all. The ghost is
    // the only row, keyed and named by the merge I recorded for them.
    expect(rows).toEqual([
      {
        person_key: 'person-ravi',
        profile_id: null,
        member_id: 'ghost',
        display_name: 'Ravi K',
        avatar_url: null,
        is_ghost: true,
        currency: 'INR',
        net: '300',
        group_count: 1,
        only_group_id: 'g-1',
        last_activity_at: '2026-02-01',
      },
    ]);
  });

  it('usePeopleBalances: nothing before the profile arrives', () => {
    expect(render(() => hooks.usePeopleBalances(null)).data).toEqual([]);
  });

  it('useKnownPeopleCount counts people I share a group with, square or not', () => {
    expect(render(() => hooks.useKnownPeopleCount(ME)).data).toBe(3);
    expect(render(() => hooks.useKnownPeopleCount(null)).data).toBe(0);
  });

  it('useGhostMergePersonIds maps a merged ghost to its person', () => {
    const merges = render(() => hooks.useGhostMergePersonIds());
    expect(merges.get('ghost')).toBe('person-ravi');
    expect(merges.size).toBe(1);
  });

  it('useMergeCandidates walks my groups only, and carries the invite address', () => {
    const candidates = render(() => hooks.useMergeCandidates('Someone')).data;
    const memberIds = candidates.flatMap((c) =>
      'memberIds' in c ? (c as { memberIds: string[] }).memberIds : [],
    );
    expect(candidates.length).toBeGreaterThan(0);
    expect(JSON.stringify(candidates)).not.toContain('z1');
    expect(JSON.stringify(candidates)).toContain('ghost');
    expect(memberIds).not.toContain('m1');
  });

  it('useMergeCandidates offers nobody before the profile is known', () => {
    auth.value = { session: null, profile: null };
    expect(render(() => hooks.useMergeCandidates('Someone')).data).toEqual([]);
  });
});

describe('useDestinationUsage', () => {
  it('counts live expenses per ledger group and keeps the newest timestamp', () => {
    sync.mirror = mirrorOf({
      [SyncTable.Groups]: [groupRow('g-1'), groupRow('g-dead', { deleted_at: '2026-01-02' })],
      [SyncTable.Expenses]: [
        expenseRow('a', 'g-1', {
          amount: 1n,
          payer: 'm',
          shares: { m: 1n },
          createdAt: '2026-02-01T00:00:00Z',
        }),
        expenseRow('b', 'g-1', {
          amount: 1n,
          payer: 'm',
          shares: { m: 1n },
          createdAt: '2026-02-05T00:00:00Z',
        }),
        expenseRow('c', 'g-1', {
          amount: 1n,
          payer: 'm',
          shares: { m: 1n },
          createdAt: '2026-02-03T00:00:00Z',
        }),
        expenseRow('d', 'g-1', {
          amount: 1n,
          payer: 'm',
          shares: { m: 1n },
          createdAt: '2026-02-09T00:00:00Z',
          deletedAt: '2026-02-10T00:00:00Z',
        }),
        expenseRow('e', 'g-dead', { amount: 1n, payer: 'm', shares: { m: 1n } }),
      ],
    });
    const usage = render(() => hooks.useDestinationUsage());
    expect(usage.get('g-1')).toEqual({ lastAt: '2026-02-05T00:00:00Z', count: 3 });
    expect(usage.has('g-dead')).toBe(false);
  });
});

describe('useRecentActivity', () => {
  it('reads the feed from the mirror', () => {
    expect(render(() => hooks.useRecentActivity(ME))).toEqual([]);
  });
});

describe('snapshots', () => {
  it('toSnapshot turns wire amounts into bigints', () => {
    const row = expenseRow('e', 'g', { amount: 900n, payer: 'a', shares: { a: 400n, b: 500n } });
    expect(hooks.toSnapshot(row as never)).toEqual({
      id: 'e',
      currency: 'INR',
      amount: 900n,
      payers: { a: 900n },
      shares: { a: 400n, b: 500n },
      date: '2026-02-01',
      deletedAt: null,
    });
  });

  it('toSnapshot drops a row with no version, or an amount that is not an integer', () => {
    expect(hooks.toSnapshot({ id: 'e', currentVersion: null } as never)).toBeNull();
    const bad = expenseRow('e', 'g', { amount: 1n, payer: 'a', shares: { a: 1n } }) as {
      currentVersion: { amount: string };
    };
    bad.currentVersion.amount = '12.5';
    expect(hooks.toSnapshot(bad as never)).toBeNull();
  });

  it('toSettlementSnapshots keeps allocations and drops unreadable rows', () => {
    const good = {
      ...settlementRow('s1', 'g', { from: 'a', to: 'b', amount: 300n }),
      allocations: [{ expense_id: 'e1', amount: '300' }],
    };
    const bad = { ...settlementRow('s2', 'g', { from: 'a', to: 'b', amount: 1n }), amount: 'x' };
    const out = hooks.toSettlementSnapshots([good, bad] as never);
    expect(out).toEqual([
      {
        id: 's1',
        from: 'a',
        to: 'b',
        currency: 'INR',
        amount: 300n,
        status: 'confirmed',
        at: '2026-02-02T10:00:00Z',
        allocations: [{ expenseId: 'e1', amount: 300n }],
      },
    ]);
  });

  it('memberLookup indexes members by id and tolerates undefined', () => {
    const map = hooks.memberLookup([memberRow('a', 'g', ME)] as never);
    expect(map.get('a')?.profile_id).toBe(ME);
    expect(hooks.memberLookup(undefined).size).toBe(0);
  });
});

describe('useGroup', () => {
  beforeEach(() => {
    sync.mirror = mirrorOf({
      [SyncTable.Groups]: [
        groupRow('g-1'),
        groupRow('g-arch', { archived_at: '2026-01-05T00:00:00Z' }),
        groupRow('g-del', { deleted_at: '2026-01-05T00:00:00Z' }),
      ],
      [SyncTable.GroupMembers]: [memberRow('m1', 'g-1', ME), memberRow('m2', 'g-1', 'p-2')],
      [SyncTable.Expenses]: [
        expenseRow('old', 'g-1', {
          amount: 1n,
          payer: 'm1',
          shares: { m1: 1n },
          createdAt: '2026-01-01T00:00:00Z',
        }),
        expenseRow('new', 'g-1', {
          amount: 1n,
          payer: 'm1',
          shares: { m1: 1n },
          createdAt: '2026-02-01T00:00:00Z',
        }),
      ],
      [SyncTable.ActivityLog]: [
        { id: 'a1', group_id: 'g-1', verb: 'x', created_at: '2026-01-01T00:00:00Z' },
        { id: 'a2', group_id: 'g-1', verb: 'y', created_at: '2026-02-01T00:00:00Z' },
      ],
    });
    sync.queue = queueOf({
      id: 'q-1',
      kind: MutationKind.ExpenseCreate,
      scope: 'g-1',
      payload: {
        expenseId: 'queued',
        description: 'Cab',
        expenseDate: '2026-02-02',
        currency: 'INR',
        amount: '100',
        splitParams: { kind: 'equal', members: ['m1', 'm2'] },
        participants: ['m1', 'm2'],
        payers: { m1: '100' },
      },
    });
  });

  it('reads the group, members and newest-first activity from the mirror', () => {
    const view = render(() => hooks.useGroup('g-1'));
    expect(view.group.data?.id).toBe('g-1');
    expect(view.members.data.map((m) => m.id).sort()).toEqual(['m1', 'm2']);
    expect(view.activity.data.map((a) => a.id)).toEqual(['a2', 'a1']);
  });

  it('keeps what the server has apart from what to render', () => {
    const view = render(() => hooks.useGroup('g-1'));
    expect(view.expenses.data.map((e) => e.id)).toEqual(['new', 'old']);
    expect(view.expenses.rows.map((e) => e.id)).toContain('queued');
    expect(view.expenses.data.map((e) => e.id)).not.toContain('queued');
  });

  it('opens an archived group but not a deleted one', () => {
    expect(render(() => hooks.useGroup('g-arch')).group.data?.id).toBe('g-arch');
    expect(render(() => hooks.useGroup('g-del')).group.data).toBeNull();
  });

  it("asks the server for its own balances as the cross-check's second opinion", async () => {
    const view = render(() => hooks.useGroup('g-1'));
    const balances = view.balances as unknown as CapturedQuery;
    expect(balances.options.queryKey).toEqual(['group', 'g-1', 'balances']);
    expect(balances.options.enabled).toBe(true);
    await balances.options.queryFn();
    expect(api.fetchBalances).toHaveBeenCalledWith('g-1');
    expect(
      (render(() => hooks.useGroup('')).balances as unknown as CapturedQuery).options.enabled,
    ).toBe(false);
  });
});

describe('useGroupLedger', () => {
  const ledgerMirror = (simplify: boolean) =>
    mirrorOf({
      [SyncTable.Groups]: [groupRow('g-1', { simplify_debts: simplify })],
      [SyncTable.GroupMembers]: [
        memberRow('m1', 'g-1', ME),
        memberRow('m2', 'g-1', 'p-2'),
        memberRow('m3', 'g-1', 'p-3'),
      ],
      [SyncTable.Expenses]: [
        expenseRow('e1', 'g-1', {
          amount: 900n,
          payer: 'm1',
          shares: { m1: 300n, m2: 300n, m3: 300n },
        }),
        expenseRow('e2', 'g-1', {
          amount: 300n,
          payer: 'm2',
          shares: { m3: 300n },
        }),
      ],
      [SyncTable.Settlements]: [
        settlementRow('s-wait', 'g-1', { from: 'm3', to: 'm1', amount: 100n, status: 'initiated' }),
      ],
    });

  it('gives my balance, the pending difference, and says the group is not square', () => {
    sync.mirror = ledgerMirror(false);
    const ledger = render(() => hooks.useGroupLedger('g-1', ME));
    expect(ledger.myMemberId).toBe('m1');
    expect(ledger.myBalance).toBe(600n);
    // m3 says they paid me 100: if confirmed, I am owed 100 less.
    expect(ledger.pending).toBe(-100n);
    expect(ledger.groupSettled).toBe(false);
    expect(ledger.loading).toBe(false);
    expect(ledger.balances.get('m3')).toBe(-600n);
  });

  it('lists raw pairwise debts, or simplified ones when the group asks for that', () => {
    sync.mirror = ledgerMirror(false);
    const raw = render(() => hooks.useGroupLedger('g-1', ME)).transfers;
    sync.mirror = ledgerMirror(true);
    const simplified = render(() => hooks.useGroupLedger('g-1', ME)).transfers;
    const total = (list: { amount: bigint }[]) => list.reduce((sum, t) => sum + t.amount, 0n);
    expect(total(raw)).toBeGreaterThanOrEqual(total(simplified));
    expect(simplified).toEqual([{ from: 'm3', to: 'm1', currency: 'INR', amount: 600n }]);
  });

  it('with no viewer, has no balance of mine to show', () => {
    sync.mirror = ledgerMirror(false);
    const ledger = render(() => hooks.useGroupLedger('g-1', null));
    expect(ledger.myMemberId).toBeNull();
    expect(ledger.myBalance).toBe(0n);
    expect(ledger.pending).toBe(0n);
  });

  it('a square group is settled', () => {
    sync.mirror = mirrorOf({
      [SyncTable.Groups]: [groupRow('g-1')],
      [SyncTable.GroupMembers]: [memberRow('m1', 'g-1', ME)],
    });
    expect(render(() => hooks.useGroupLedger('g-1', ME)).groupSettled).toBe(true);
  });

  describe('the server cross-check', () => {
    beforeEach(() => {
      sync.mirror = ledgerMirror(false);
      syncModule.lastSyncedAt = new Date(1_000).toISOString();
    });

    it('agrees when the server derived the same balances', () => {
      query.state.data = [
        { member_id: 'm1', currency: 'INR', balance: '600' },
        { member_id: 'm2', currency: 'INR', balance: '0' },
        { member_id: 'm3', currency: 'INR', balance: '-600' },
        { member_id: 'm1', currency: 'USD', balance: '5' },
      ];
      query.state.dataUpdatedAt = 2_000;
      expect(render(() => hooks.useGroupLedger('g-1', ME)).mismatch).toBe(false);
      expect(query.state.refetch).not.toHaveBeenCalled();
    });

    it('refetches silently on a disagreement, then reports one that survives the refetch', () => {
      query.state.data = [{ member_id: 'm1', currency: 'INR', balance: '1' }];
      query.state.dataUpdatedAt = 2_000;
      const first = render(() => hooks.useGroupLedger('g-1', ME));
      expect(first.mismatch).toBe(true);
      expect(query.state.refetch).toHaveBeenCalledTimes(1);
      expect(observability.reportHandled).not.toHaveBeenCalled();

      // Same stale snapshot again: still waiting on the refetch, nothing reported.
      render(() => hooks.useGroupLedger('g-1', ME));
      expect(observability.reportHandled).not.toHaveBeenCalled();

      // A fresh snapshot that still disagrees is a real defect — reported once.
      query.state.dataUpdatedAt = 3_000;
      render(() => hooks.useGroupLedger('g-1', ME));
      render(() => hooks.useGroupLedger('g-1', ME));
      expect(observability.reportHandled).toHaveBeenCalledTimes(1);
      expect(observability.reportHandled.mock.calls[0]?.[1]).toBe('ledger.crossCheck');
    });

    it('starts over for a different group instead of reporting on its first mismatch', () => {
      sync.mirror = mirrorOf({
        ...{
          [SyncTable.Groups]: [groupRow('g-1'), groupRow('g-2')],
          [SyncTable.GroupMembers]: [memberRow('m1', 'g-1', ME), memberRow('k1', 'g-2', ME)],
        },
      });
      query.state.data = [{ member_id: 'm1', currency: 'INR', balance: '1' }];
      query.state.dataUpdatedAt = 2_000;
      render(() => hooks.useGroupLedger('g-1', ME));
      expect(query.state.refetch).toHaveBeenCalledTimes(1);

      query.state.data = [{ member_id: 'k1', currency: 'INR', balance: '1' }];
      query.state.dataUpdatedAt = 3_000;
      render(() => hooks.useGroupLedger('g-2', ME));
      expect(query.state.refetch).toHaveBeenCalledTimes(2);
      expect(observability.reportHandled).not.toHaveBeenCalled();
    });

    it('clears its marks once the two agree again', () => {
      query.state.data = [{ member_id: 'm1', currency: 'INR', balance: '1' }];
      query.state.dataUpdatedAt = 2_000;
      render(() => hooks.useGroupLedger('g-1', ME));
      query.state.data = [
        { member_id: 'm1', currency: 'INR', balance: '600' },
        { member_id: 'm3', currency: 'INR', balance: '-600' },
      ];
      render(() => hooks.useGroupLedger('g-1', ME));
      // Disagreeing again later needs its own refetch first.
      query.state.data = [{ member_id: 'm1', currency: 'INR', balance: '2' }];
      query.state.dataUpdatedAt = 4_000;
      render(() => hooks.useGroupLedger('g-1', ME));
      expect(query.state.refetch).toHaveBeenCalledTimes(2);
      expect(observability.reportHandled).not.toHaveBeenCalled();
    });

    it('does not compare while this group still has queued writes', () => {
      sync.queue = queueOf({
        id: 'q',
        kind: MutationKind.ExpenseDelete,
        scope: 'g-1',
        payload: { expenseId: 'e2' },
      });
      query.state.data = [{ member_id: 'm1', currency: 'INR', balance: '1' }];
      query.state.dataUpdatedAt = 2_000;
      expect(render(() => hooks.useGroupLedger('g-1', ME)).mismatch).toBe(false);
    });

    it('does not compare a server snapshot older than the last sync', () => {
      query.state.data = [{ member_id: 'm1', currency: 'INR', balance: '1' }];
      query.state.dataUpdatedAt = 500;
      expect(render(() => hooks.useGroupLedger('g-1', ME)).mismatch).toBe(false);
    });
  });
});

describe('useGroupRealtime', () => {
  it('subscribes to the group rows and pulls the group when any of them change', async () => {
    render(() => hooks.useGroupRealtime('g-1'));
    expect(realtime.channels).toHaveLength(1);
    const channel = realtime.channels[0]!;
    expect(channel.topic).toMatch(/^group:g-1:\d+$/);
    expect(channel.subscribed).toBe(true);
    expect(channel.handlers.map((h) => h.filter.table)).toEqual([
      'expenses',
      'settlements',
      'group_members',
      'activity_log',
    ]);
    expect(new Set(channel.handlers.map((h) => h.filter.filter))).toEqual(
      new Set(['group_id=eq.g-1']),
    );

    for (const handler of channel.handlers) handler.cb();
    await vi.waitFor(() => expect(query.client.invalidateQueries).toHaveBeenCalled());
    expect(syncModule.engineFlush).toHaveBeenCalledWith({ groupIds: ['g-1'] });
    expect(query.client.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['group', 'g-1'] });

    unmount();
    expect(realtime.client.removeChannel).toHaveBeenCalledWith(channel);
  });

  it('gives every mount its own channel topic', () => {
    render(() => hooks.useGroupRealtime('g-1'));
    render(() => hooks.useGroupRealtime('g-1'));
    const [a, b] = realtime.channels;
    expect(a?.topic).not.toBe(b?.topic);
  });

  it('subscribes to nothing without a group', () => {
    render(() => hooks.useGroupRealtime(''));
    expect(realtime.client.channel).not.toHaveBeenCalled();
  });
});

describe('invalidateGroup', () => {
  it('still refreshes the network reads when the flush fails', async () => {
    syncModule.engineFlush.mockImplementation(() => Promise.reject(new Error('offline')));
    hooks.invalidateGroup(query.client as never, 'g-9');
    await vi.waitFor(() =>
      expect(query.client.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['group', 'g-9'] }),
    );
  });

  it('waits for the flush before invalidating', async () => {
    let release: () => void = () => undefined;
    syncModule.engineFlush.mockImplementation(
      () => new Promise<void>((resolve) => (release = resolve)),
    );
    hooks.invalidateGroup(query.client as never, 'g-9');
    await Promise.resolve();
    expect(query.client.invalidateQueries).not.toHaveBeenCalled();
    release();
    await vi.waitFor(() => expect(query.client.invalidateQueries).toHaveBeenCalled());
  });
});

describe('personal-scope reads', () => {
  it('useCaptures shows my open captures, including one made offline', () => {
    sync.mirror = mirrorOf({
      [SyncTable.Captures]: [
        {
          id: 'c-server',
          group_id: 'scope',
          owner_user_id: OWNER,
          description: 'Tea',
          expense_date: '2026-02-01',
          currency: 'INR',
          amount: '20',
          status: 'open',
          created_at: '2026-02-01T00:00:00Z',
          deleted_at: null,
        },
        {
          id: 'c-someone-else',
          group_id: 'scope',
          owner_user_id: 'user-other',
          description: 'Not mine',
          status: 'open',
          created_at: '2026-02-01T00:00:00Z',
          deleted_at: null,
        },
      ],
    });
    sync.queue = queueOf({
      id: 'q-c',
      kind: MutationKind.CaptureCreate,
      scope: OWNER,
      payload: hooks.serialiseCapture(
        { description: ' Lunch ', expenseDate: '2026-02-02', currency: 'INR', amount: 350n },
        'c-queued',
      ),
    });
    const ids = render(() => hooks.useCaptures()).data.map((c) => c.id);
    expect(ids.sort()).toEqual(['c-queued', 'c-server']);
  });

  it('useCaptures is empty when signed out', () => {
    auth.value = { session: null, profile: null };
    expect(render(() => hooks.useCaptures()).data).toEqual([]);
  });

  it('useCategoryTags maps rows to the camelCase catalog shape', () => {
    sync.mirror = mirrorOf({
      [SyncTable.CategoryTags]: [
        {
          id: 't-1',
          group_id: 'scope',
          owner_user_id: OWNER,
          builtin_id: null,
          label: 'Coffee',
          icon: 'cafe',
          tint: '#aa0000',
          axis: 'income',
          pack_id: 'pack-x',
          sort_order: '7',
          hidden: true,
          deleted_at: null,
        },
        {
          id: 't-2',
          group_id: 'scope',
          owner_user_id: OWNER,
          builtin_id: 'food',
          sort_order: null,
          deleted_at: null,
        },
      ],
    });
    const rows = render(() => hooks.useCategoryTags()).data;
    expect(rows.find((r) => r.id === 't-1')).toEqual({
      id: 't-1',
      builtinId: null,
      label: 'Coffee',
      icon: 'cafe',
      tint: '#aa0000',
      axis: 'income',
      packId: 'pack-x',
      sortOrder: 7,
      hidden: true,
    });
    expect(rows.find((r) => r.id === 't-2')).toMatchObject({
      builtinId: 'food',
      label: null,
      axis: 'expense',
      sortOrder: 0,
      hidden: false,
    });
  });

  it('useCategoryTags is empty when signed out', () => {
    auth.value = { session: null, profile: null };
    expect(render(() => hooks.useCategoryTags()).data).toEqual([]);
  });

  it('useCategoryCatalog merges built-ins with the custom tags, hiding hidden ones from pickers', () => {
    sync.queue = queueOf({
      id: 'q-t',
      kind: MutationKind.TagCreate,
      scope: categoryTagsScope(OWNER),
      payload: { tagId: 't-new', label: 'Snacks', sortOrder: 999, hidden: false },
    });
    const catalog = render(() => hooks.useCategoryCatalog((id) => `label:${id}`));
    expect(catalog.loading).toBe(false);
    expect(catalog.all.length).toBeGreaterThan(1);
    expect(catalog.visible.some((entry) => entry.label === 'Snacks')).toBe(true);
    expect(catalog.all.some((entry) => entry.label.startsWith('label:'))).toBe(true);
  });
});

describe('trip plan and budgets', () => {
  beforeEach(() => {
    sync.mirror = mirrorOf({
      [SyncTable.Groups]: [
        groupRow('g-1', {
          budget_minor: '500000',
          budget_currency: 'INR',
          category_budgets: {
            travel: { amountMinor: '300', currency: 'INR' },
            food: { amountMinor: '100', currency: 'INR' },
          },
          fx_rates: {
            USD: { num: '8300', den: '100', ts: '2026-02-01T00:00:00Z', source: 'manual' },
            EUR: { num: '9000', den: '100', ts: '2026-02-01T00:00:00Z', source: 'bill' },
          },
        }),
        groupRow('g-bare'),
      ],
      [SyncTable.GroupMembers]: [memberRow('m1', 'g-1', ME), memberRow('m2', 'g-1', 'p-2')],
      [SyncTable.TripPlanItems]: [
        {
          id: 'p1',
          group_id: 'g-1',
          day: '2026-03-01',
          title: 'Beach',
          position: 0,
          deleted_at: null,
          done_at: null,
        },
        {
          id: 'p2',
          group_id: 'g-1',
          day: '2026-03-01',
          title: 'Removed',
          position: 1,
          deleted_at: '2026-02-01T00:00:00Z',
          done_at: null,
        },
      ],
      [SyncTable.TripMemberBudgets]: [
        {
          id: 'b2',
          group_id: 'g-1',
          member_id: 'm2',
          amount_minor: '1000',
          currency: 'INR',
          visibility: 'group',
          deleted_at: null,
        },
      ],
    });
  });

  it('usePlanItems drops removed items', () => {
    expect(render(() => hooks.usePlanItems('g-1')).data.map((p) => p.id)).toEqual(['p1']);
  });

  it('useMemberBudgets overlays my own queued budget by my member id', () => {
    sync.queue = queueOf({
      id: 'q-b',
      kind: MutationKind.MemberBudgetSet,
      scope: 'g-1',
      payload: { amountMinor: '2500', currency: 'INR', visibility: 'private' },
    });
    const rows = render(() => hooks.useMemberBudgets('g-1')).data;
    expect(rows.find((r) => r.member_id === 'm1')?.amount_minor).toBe('2500');
    expect(rows.find((r) => r.member_id === 'm2')?.amount_minor).toBe('1000');
  });

  it('useGroupBudget reads the overall budget off the group row', () => {
    expect(render(() => hooks.useGroupBudget('g-1')).data).toEqual({
      amountMinor: 500000n,
      currency: 'INR',
    });
    expect(render(() => hooks.useGroupBudget('g-bare')).data).toEqual({
      amountMinor: null,
      currency: null,
    });
  });

  it('useCategoryBudgets lists caps alphabetically as bigints', () => {
    expect(render(() => hooks.useCategoryBudgets('g-1')).data).toEqual([
      { category: 'food', amountMinor: 100n, currency: 'INR' },
      { category: 'travel', amountMinor: 300n, currency: 'INR' },
    ]);
    expect(render(() => hooks.useCategoryBudgets('g-bare')).data).toEqual([]);
  });

  it('useGroupFxRates lists pinned rates by currency, as exact rationals', () => {
    expect(render(() => hooks.useGroupFxRates('g-1')).data).toEqual([
      { from: 'EUR', num: 9000n, den: 100n, ts: '2026-02-01T00:00:00Z', source: 'bill' },
      { from: 'USD', num: 8300n, den: 100n, ts: '2026-02-01T00:00:00Z', source: 'manual' },
    ]);
    expect(render(() => hooks.useGroupFxRates('g-bare')).data).toEqual([]);
  });
});

describe('per-expense and per-settlement rows', () => {
  beforeEach(() => {
    sync.mirror = mirrorOf({
      [SyncTable.ExpenseAttachments]: [
        {
          id: 'at-1',
          group_id: 'g-1',
          expense_id: 'e-1',
          storage_path: 'e-1/a.jpg',
          visibility: 'parties',
          uploader_member_id: 'm1',
          annotations: null,
          created_at: '2026-02-01T00:00:00Z',
          deleted_at: null,
        },
        {
          id: 'at-2',
          group_id: 'g-1',
          expense_id: 'e-1',
          storage_path: 'e-1/b.jpg',
          visibility: 'weird',
          uploader_member_id: 'm2',
          annotations: { v: 1, strokes: [], texts: [] },
          preview: 'data:image/png;base64,AA',
          created_at: '2026-02-02T00:00:00Z',
          deleted_at: null,
        },
      ],
      [SyncTable.ExpenseComments]: [
        {
          id: 'c-1',
          group_id: 'g-1',
          expense_id: 'e-1',
          author_member_id: 'm1',
          body: 'hello',
          edited_at: null,
          flagged_at: null,
          flagged_by: null,
          created_at: '2026-02-01T00:00:00Z',
          deleted_at: null,
        },
      ],
      [SyncTable.ExpenseImageEvents]: [
        {
          id: 'ev-1',
          group_id: 'g-1',
          expense_id: 'e-1',
          actor_member_id: 'm1',
          kind: 'attachment',
          action: 'removed',
          visibility: 'parties',
          created_at: '2026-02-01T00:00:00Z',
        },
        {
          id: 'ev-2',
          group_id: 'g-1',
          expense_id: 'e-1',
          actor_member_id: null,
          kind: 'receipt',
          action: 'added',
          visibility: 'group',
          created_at: '2026-02-02T00:00:00Z',
        },
      ],
      [SyncTable.SettlementProofs]: [
        {
          id: 'pr-1',
          group_id: 'g-1',
          settlement_id: 's-1',
          storage_path: 's-1/p.jpg',
          uploader_member_id: 'm1',
          created_at: '2026-02-01T00:00:00Z',
          deleted_at: null,
        },
      ],
    });
  });

  it('useExpenseAttachments maps rows and falls back to group visibility', () => {
    const rows = render(() => hooks.useExpenseAttachments('e-1')).data;
    const first = rows.find((r) => r.id === 'at-1');
    const second = rows.find((r) => r.id === 'at-2');
    expect(first).toMatchObject({
      expenseId: 'e-1',
      groupId: 'g-1',
      storagePath: 'e-1/a.jpg',
      visibility: 'parties',
      uploaderMemberId: 'm1',
      annotations: null,
      preview: null,
    });
    expect(second?.visibility).toBe('group');
    expect(second?.preview).toBe('data:image/png;base64,AA');
    expect(second?.annotations).not.toBeNull();
  });

  it('useExpenseComments maps the thread', () => {
    expect(render(() => hooks.useExpenseComments('e-1')).data).toEqual([
      {
        id: 'c-1',
        expenseId: 'e-1',
        groupId: 'g-1',
        authorMemberId: 'm1',
        body: 'hello',
        editedAt: null,
        flaggedAt: null,
        flaggedBy: null,
        createdAt: '2026-02-01T00:00:00Z',
      },
    ]);
  });

  it('useExpenseImageEvents narrows free-text columns to the known values', () => {
    const rows = render(() => hooks.useExpenseImageEvents('e-1')).data;
    expect(rows.map((r) => [r.id, r.kind, r.action, r.visibility])).toEqual([
      ['ev-1', 'attachment', 'removed', 'parties'],
      ['ev-2', 'receipt', 'added', 'group'],
    ]);
  });

  it('useSettlementProof returns the live proof, or null', () => {
    expect(render(() => hooks.useSettlementProof('s-1')).data).toEqual({
      id: 'pr-1',
      settlementId: 's-1',
      groupId: 'g-1',
      storagePath: 's-1/p.jpg',
      uploaderMemberId: 'm1',
      createdAt: '2026-02-01T00:00:00Z',
    });
    expect(render(() => hooks.useSettlementProof('s-none')).data).toBeNull();
  });
});

describe('network queries', () => {
  const opts = (result: unknown) => (result as CapturedQuery).options;

  it('useExpenseVersions keys by expense and stays off without one', async () => {
    const q = opts(render(() => hooks.useExpenseVersions('e-1')));
    expect(q.queryKey).toEqual(['expense', 'e-1', 'versions']);
    expect(q.enabled).toBe(true);
    await q.queryFn();
    expect(api.fetchExpenseVersions).toHaveBeenCalledWith('e-1');
    expect(opts(render(() => hooks.useExpenseVersions(''))).enabled).toBe(false);
  });

  it('useMemberClaims reads per group and is off for an empty id', async () => {
    const q = opts(render(() => hooks.useMemberClaims('g-1')));
    expect(q.queryKey).toEqual(['group', 'g-1', 'member-claims']);
    await q.queryFn();
    expect(api.fetchMemberClaims).toHaveBeenCalledWith('g-1');
    expect(opts(render(() => hooks.useMemberClaims(''))).enabled).toBe(false);
  });

  it('useReceipt and useOpenReceipts', async () => {
    const receipt = opts(render(() => hooks.useReceipt('r-1')));
    expect(receipt.queryKey).toEqual(['receipt', 'r-1']);
    await receipt.queryFn();
    expect(api.fetchReceipt).toHaveBeenCalledWith('r-1');
    expect(opts(render(() => hooks.useReceipt(null))).enabled).toBe(false);

    const open = opts(render(() => hooks.useOpenReceipts('g-1')));
    expect(open.queryKey).toEqual(['open-receipts', 'g-1']);
    await open.queryFn();
    expect(api.fetchOpenReceipts).toHaveBeenCalledWith('g-1');
    expect(opts(render(() => hooks.useOpenReceipts(''))).enabled).toBe(false);
  });

  it('useItemClaims keeps the claims live over a receipt-scoped channel', async () => {
    const q = opts(render(() => hooks.useItemClaims('r-1')));
    expect(q.queryKey).toEqual(['claims', 'r-1']);
    await q.queryFn();
    expect(api.fetchItemClaims).toHaveBeenCalledWith('r-1');

    const channel = realtime.channels[0]!;
    expect(channel.topic).toMatch(/^receipt:r-1:\d+$/);
    expect(channel.handlers[0]?.filter).toMatchObject({
      table: 'receipt_item_claims',
      filter: 'receipt_id=eq.r-1',
    });
    channel.handlers[0]!.cb();
    expect(query.client.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['claims', 'r-1'] });
    unmount();
    expect(realtime.client.removeChannel).toHaveBeenCalledWith(channel);
  });

  it('useItemClaims without a receipt opens no channel and does not query', () => {
    const q = opts(render(() => hooks.useItemClaims(null)));
    expect(q.enabled).toBe(false);
    expect(realtime.client.channel).not.toHaveBeenCalled();
  });

  it("useVoiceAccess keys by the signed-in profile so one person never reads another's", async () => {
    const q = opts(render(() => hooks.useVoiceAccess()));
    expect(q.queryKey).toEqual(['voiceAccess', ME]);
    expect(q.enabled).toBe(true);
    expect(q.staleTime).toBe(60_000);

    realtime.client.rpc.mockResolvedValueOnce({ data: { tier: 'free' }, error: null });
    await expect(q.queryFn()).resolves.toEqual({ tier: 'free' });
    expect(realtime.client.rpc).toHaveBeenCalledWith('waves_my_voice_access');

    realtime.client.rpc.mockResolvedValueOnce({ data: null, error: { message: 'denied' } });
    await expect(q.queryFn()).rejects.toThrow('denied');

    auth.value = { session: null, profile: null };
    const signedOut = opts(render(() => hooks.useVoiceAccess()));
    expect(signedOut.queryKey).toEqual(['voiceAccess', null]);
    expect(signedOut.enabled).toBe(false);
  });
});
