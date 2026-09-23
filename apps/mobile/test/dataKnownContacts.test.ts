/**
 * Who Waves already has, built from the mirror alone.
 *
 * The index must list the people in your groups by the address you gave them,
 * never list you, and label a nameless group by its members. The per-group
 * membership rides along so the picker's "which group?" step needs no second
 * pass. `useMemo` is stood in for by its identity.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { emptyMirror, type MirrorState } from '@waves/core';

const state = vi.hoisted(() => ({
  mirror: null as unknown,
  queue: [] as unknown[],
  profile: null as { id: string } | null,
}));

vi.mock('react', () => ({ useMemo: (fn: () => unknown) => fn() }));
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ profile: state.profile }) }));
vi.mock('@/sync', () => ({ useSync: () => ({ mirror: state.mirror, queue: state.queue }) }));

const { useKnownContacts } = await import('@/data/knownContacts');

function member(id: string, groupId: string, over: Record<string, unknown> = {}) {
  return {
    id,
    group_id: groupId,
    profile_id: null,
    ghost_name: null,
    role: 'member',
    vpa: null,
    left_at: null,
    invite_email: null,
    invite_phone: null,
    ...over,
  };
}

function mirror(): MirrorState {
  const m = emptyMirror();
  Object.assign(m.tables.groups, {
    goa: { id: 'goa', name: 'Goa', created_at: '2026-09-02T00:00:00.000Z', archived_at: null },
    pair: { id: 'pair', name: null, created_at: '2026-09-01T00:00:00.000Z', archived_at: null },
  });
  Object.assign(m.tables.group_members, {
    me1: member('me1', 'goa', {
      profile_id: 'p-me',
      profile: { id: 'p-me', display_name: 'Asha' },
    }),
    priya: member('priya', 'goa', { ghost_name: 'Priya', invite_email: 'priya@example.com' }),
    ravi: member('ravi', 'goa', {
      profile_id: 'p-ravi',
      profile: { id: 'p-ravi', display_name: 'Ravi' },
    }),
    me2: member('me2', 'pair', {
      profile_id: 'p-me',
      profile: { id: 'p-me', display_name: 'Asha' },
    }),
    priya2: member('priya2', 'pair', { ghost_name: 'Priya', invite_email: 'priya@example.com' }),
  });
  return m;
}

beforeEach(() => {
  state.mirror = mirror();
  state.queue = [];
  state.profile = { id: 'p-me' };
});

describe('useKnownContacts', () => {
  it('indexes everyone but me, merging one address across groups', () => {
    // When the index is built for me
    const { index, membersByGroup } = useKnownContacts();

    // Then Priya appears once, in both groups, and I do not appear at all
    const names = index.people.map((p) => p.name).sort();
    expect(names).toEqual(['Priya', 'Ravi']);
    const priya = index.people.find((p) => p.name === 'Priya');
    expect(priya?.email).toBe('priya@example.com');
    expect([...(priya?.groupIds ?? [])].sort()).toEqual(['goa', 'pair']);

    // The nameless 1:1 group is labelled by the other person in it
    expect(priya?.groupNames).toContain('You and Priya');
    expect(priya?.groupNames).toContain('Goa');

    // And the live membership of each group rides along
    expect(
      membersByGroup
        .get('goa')
        ?.map((m) => m.id)
        .sort(),
    ).toEqual(['me1', 'priya', 'ravi']);
    expect(membersByGroup.get('pair')).toHaveLength(2);
  });

  it('with no profile, nobody is "me", so every member is indexed', () => {
    state.profile = null;
    const { index } = useKnownContacts();
    expect(index.people.map((p) => p.name).sort()).toEqual(['Asha', 'Priya', 'Ravi']);
  });

  it('is empty for an empty mirror', () => {
    state.mirror = emptyMirror();
    const { index, membersByGroup } = useKnownContacts();
    expect(index.people).toEqual([]);
    expect(membersByGroup.size).toBe(0);
  });
});
