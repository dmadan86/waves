import { describe, expect, it } from 'vitest';

import {
  buildMergeCandidates,
  canMerge,
  defaultMergeName,
  hasContact,
  isMergeable,
  memberIdsForMerge,
  mergeErrorMessage,
  type MergeableMember,
  type MergeErrorStrings,
  type RecordedMerge,
} from '@/data/mergePeople';

/** A minimal picked person — only the fields the merge logic reads. */
function row(
  over: Partial<{
    person_key: string;
    member_ids: readonly string[];
    display_name: string;
    phone: string | null;
    email: string | null;
    group_count: number;
  }> = {},
) {
  const key = over.person_key ?? 'm1';
  return {
    person_key: key,
    member_ids: over.member_ids ?? [key],
    display_name: over.display_name ?? 'person1',
    phone: over.phone ?? null,
    email: over.email ?? null,
    group_count: over.group_count ?? 1,
  };
}

/** A membership as `buildMergeCandidates` takes them. */
function member(over: Partial<MergeableMember> = {}): MergeableMember {
  return {
    id: over.id ?? 'm1',
    group_id: over.group_id ?? 'g1',
    profile_id: over.profile_id ?? null,
    ghost_name: 'ghost_name' in over ? (over.ghost_name ?? null) : 'person1',
    left_at: over.left_at ?? null,
    invite_email: over.invite_email ?? null,
    invite_phone: over.invite_phone ?? null,
  };
}

const noMerges = new Map<string, RecordedMerge>();

describe('isMergeable', () => {
  it('allows a ghost', () => {
    expect(isMergeable({ is_ghost: true })).toBe(true);
  });

  it('refuses a real person — they are already one identity by their profile', () => {
    expect(isMergeable({ is_ghost: false })).toBe(false);
  });
});

describe('hasContact', () => {
  it('is true for a number or an address', () => {
    expect(hasContact({ phone: '+919876543210', email: null })).toBe(true);
    expect(hasContact({ phone: null, email: 'ravi@example.com' })).toBe(true);
  });

  it('is false for nothing, and for whitespace pretending to be something', () => {
    expect(hasContact({ phone: null, email: null })).toBe(false);
    expect(hasContact({ phone: '  ', email: '' })).toBe(false);
  });
});

describe('buildMergeCandidates', () => {
  it('offers a guest carrying a phone number — the person you are merging into', () => {
    // The bug this fixes: this guest had a number and no debt, so the balance
    // list the screen used to read dropped them entirely.
    const candidates = buildMergeCandidates(
      [member({ id: 'a', ghost_name: 'Ravi', invite_phone: '+919876543210' })],
      noMerges,
    );
    expect(candidates).toEqual([
      {
        person_key: 'a',
        member_ids: ['a'],
        group_ids: ['g1'],
        display_name: 'Ravi',
        phone: '+919876543210',
        email: null,
      },
    ]);
  });

  it('refuses a real account holder — a profile id is already one identity', () => {
    const candidates = buildMergeCandidates(
      [member({ id: 'a', profile_id: 'p1', ghost_name: null })],
      noMerges,
    );
    expect(candidates).toEqual([]);
  });

  it('drops somebody who has left', () => {
    expect(
      buildMergeCandidates([member({ id: 'a', left_at: '2026-01-01T00:00:00Z' })], noMerges),
    ).toEqual([]);
  });

  it('folds a person the viewer already merged into one candidate, carrying every membership', () => {
    const merges = new Map<string, RecordedMerge>([
      ['a', { person_id: 'P', display_name: 'Ravi' }],
      ['b', { person_id: 'P', display_name: 'Ravi' }],
    ]);
    const candidates = buildMergeCandidates(
      [
        member({ id: 'a', group_id: 'g1', ghost_name: 'person1' }),
        member({ id: 'b', group_id: 'g2', ghost_name: 'ravi' }),
      ],
      merges,
    );
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.person_key).toBe('P');
    expect(candidates[0]?.member_ids).toEqual(['a', 'b']);
    expect(candidates[0]?.group_ids).toEqual(['g1', 'g2']);
    // The name the viewer gave the merge outranks either ghost's own name.
    expect(candidates[0]?.display_name).toBe('Ravi');
  });

  it('never folds two unmerged ghosts who happen to share a name', () => {
    const candidates = buildMergeCandidates(
      [
        member({ id: 'a', group_id: 'g1', ghost_name: 'Ravi' }),
        member({ id: 'b', group_id: 'g2', ghost_name: 'Ravi' }),
      ],
      noMerges,
    );
    expect(candidates.map((c) => c.person_key)).toEqual(['a', 'b']);
  });

  it('falls back to the given label for a nameless ghost', () => {
    const candidates = buildMergeCandidates([member({ ghost_name: null })], noMerges, 'Someone');
    expect(candidates[0]?.display_name).toBe('Someone');
  });

  it('leads with the identified person, then the widest reach, then the name', () => {
    const merges = new Map<string, RecordedMerge>([
      ['b', { person_id: 'P', display_name: 'Bea' }],
      ['c', { person_id: 'P', display_name: 'Bea' }],
    ]);
    const candidates = buildMergeCandidates(
      [
        member({ id: 'a', group_id: 'g1', ghost_name: 'Zoya' }),
        member({ id: 'b', group_id: 'g1', ghost_name: 'Bea' }),
        member({ id: 'c', group_id: 'g2', ghost_name: 'Bea' }),
        member({ id: 'd', group_id: 'g1', ghost_name: 'Ravi', invite_phone: '+919876543210' }),
      ],
      merges,
    );
    expect(candidates.map((c) => c.display_name)).toEqual(['Ravi', 'Bea', 'Zoya']);
  });
});

describe('memberIdsForMerge', () => {
  it('returns the distinct member ids', () => {
    expect(memberIdsForMerge([row({ member_ids: ['a'] }), row({ member_ids: ['b'] })])).toEqual([
      'a',
      'b',
    ]);
  });

  it('carries every membership of an already-merged person, not just one', () => {
    // A person merged across two groups is two member ids and one person; the
    // RPC has to be handed both or the merge extends only half of them.
    expect(
      memberIdsForMerge([
        row({ person_key: 'P', member_ids: ['a', 'b'] }),
        row({ member_ids: ['c'] }),
      ]),
    ).toEqual(['a', 'b', 'c']);
  });

  it('counts a membership two picks share only once', () => {
    expect(memberIdsForMerge([row({ member_ids: ['a'] }), row({ member_ids: ['a'] })])).toEqual([
      'a',
    ]);
  });

  it('is empty for no selection', () => {
    expect(memberIdsForMerge([])).toEqual([]);
  });
});

describe('canMerge', () => {
  it('needs at least two distinct people', () => {
    expect(canMerge([])).toBe(false);
    expect(canMerge([row({ person_key: 'a' })])).toBe(false);
    expect(canMerge([row({ person_key: 'a' }), row({ person_key: 'b' })])).toBe(true);
  });

  it('does not count one already-merged person as two, however many groups they span', () => {
    expect(canMerge([row({ person_key: 'P', member_ids: ['a', 'b'] })])).toBe(false);
  });

  it('allows three or more', () => {
    expect(
      canMerge([row({ person_key: 'a' }), row({ person_key: 'b' }), row({ person_key: 'c' })]),
    ).toBe(true);
  });
});

describe('defaultMergeName', () => {
  it('keeps the name of the person whose number we have, over the more common one', () => {
    // The report this rule comes from: one guest has a phone number, the others
    // are strays. The known name is the one worth keeping.
    const rows = [
      row({ person_key: 'a', display_name: 'person1' }),
      row({ person_key: 'b', display_name: 'person1' }),
      row({ person_key: 'c', display_name: 'Ravi', phone: '+919876543210' }),
    ];
    expect(defaultMergeName(rows)).toBe('Ravi');
  });

  it('takes an email as identity too', () => {
    const rows = [
      row({ person_key: 'a', display_name: 'person1' }),
      row({ person_key: 'b', display_name: 'Ravi', email: 'ravi@example.com' }),
    ];
    expect(defaultMergeName(rows)).toBe('Ravi');
  });

  it('prefers the most common name among the identified, not across everyone', () => {
    const rows = [
      row({ person_key: 'a', display_name: 'person1' }),
      row({ person_key: 'b', display_name: 'person1' }),
      row({ person_key: 'c', display_name: 'Ravi', phone: '+911111111111' }),
      row({ person_key: 'd', display_name: 'Ravi K', email: 'ravi@example.com' }),
      row({ person_key: 'e', display_name: 'Ravi', phone: '+912222222222' }),
    ];
    expect(defaultMergeName(rows)).toBe('Ravi');
  });

  it('falls back to whoever reaches the most groups when nobody has an address', () => {
    const rows = [
      row({ person_key: 'a', display_name: 'person1', group_count: 1 }),
      row({ person_key: 'b', display_name: 'person1', group_count: 1 }),
      row({ person_key: 'c', display_name: 'Ravi', group_count: 3 }),
    ];
    expect(defaultMergeName(rows)).toBe('Ravi');
  });

  it('does not treat being in one group as reach — that says nothing about anybody', () => {
    const rows = [
      row({ person_key: 'a', display_name: 'Ravi', group_count: 1 }),
      row({ person_key: 'b', display_name: 'person1', group_count: 1 }),
      row({ person_key: 'c', display_name: 'person1', group_count: 1 }),
    ];
    expect(defaultMergeName(rows)).toBe('person1');
  });

  it('picks the most common name when nothing distinguishes anybody', () => {
    const rows = [
      row({ display_name: 'Ravi' }),
      row({ display_name: 'person1' }),
      row({ display_name: 'person1' }),
    ];
    expect(defaultMergeName(rows)).toBe('person1');
  });

  it('breaks a tie by the order picked', () => {
    const rows = [row({ display_name: 'Ravi' }), row({ display_name: 'person1' })];
    expect(defaultMergeName(rows)).toBe('Ravi');
  });

  it('ignores blank and whitespace-only names', () => {
    const rows = [
      row({ display_name: '   ' }),
      row({ display_name: '' }),
      row({ display_name: 'person1' }),
    ];
    expect(defaultMergeName(rows)).toBe('person1');
  });

  it('trims the chosen name', () => {
    expect(defaultMergeName([row({ display_name: '  person1  ' })])).toBe('person1');
  });

  it('works on a bare list of names — the Friends tab has nothing else to give', () => {
    expect(defaultMergeName([{ display_name: 'Ravi' }, { display_name: 'Ravi' }])).toBe('Ravi');
  });

  it('returns empty string when nothing usable remains', () => {
    expect(defaultMergeName([row({ display_name: '   ' }), row({ display_name: '' })])).toBe('');
    expect(defaultMergeName([])).toBe('');
  });
});

describe('mergeErrorMessage', () => {
  const t: MergeErrorStrings = {
    errorTooFew: 'pick two',
    errorNotMergeable: 'guests only',
    errorNameRequired: 'name needed',
    errorNotSignedIn: 'signed out',
    errorGeneric: 'something went wrong',
  };

  it('maps each RPC error prefix', () => {
    expect(mergeErrorMessage(new Error('TOO_FEW: pick at least two people to merge'), t)).toBe(
      'pick two',
    );
    expect(
      mergeErrorMessage(
        new Error('NOT_MERGEABLE: every person must be a guest you share a group with'),
        t,
      ),
    ).toBe('guests only');
    expect(mergeErrorMessage(new Error('NAME_REQUIRED: the merged person needs a name'), t)).toBe(
      'name needed',
    );
    expect(mergeErrorMessage(new Error('NOT_SIGNED_IN'), t)).toBe('signed out');
  });

  it('falls back to the generic line for an unrecognised error, leaking nothing', () => {
    // Raw Postgres/network text is developer detail — never surfaced to a person.
    expect(mergeErrorMessage(new Error('Network request failed'), t)).toBe('something went wrong');
    expect(
      mergeErrorMessage(new Error('function public.waves_merge_ghosts does not exist'), t),
    ).toBe('something went wrong');
  });

  it('handles a non-Error thrown value', () => {
    expect(mergeErrorMessage('boom', t)).toBe('something went wrong');
    expect(mergeErrorMessage(null, t)).toBe('something went wrong');
  });
});
