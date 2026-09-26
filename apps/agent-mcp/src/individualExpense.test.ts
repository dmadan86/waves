/**
 * Individual expenses: "I paid ₹1,000 for dinner with Renny", with no group.
 *
 * Two layers. `findPair` is the rule for which group is "you and Renny", tested
 * on its own. Then the tool, end to end through a real MCP client over a small
 * Waves with several groups, where what matters is which group the expense
 * lands in, whether a new one was made, and that nothing is written when the
 * request has to stop.
 */

import { randomUUID } from 'node:crypto';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';

import { findPair, foldName, pairIds, type PairGroup } from './pair';
import { buildWavesServer } from './tools';

const ME = 'profile-me';

const pair = (groupId: string, them: string, extra: Partial<PairGroup> = {}): PairGroup => ({
  groupId,
  groupName: them,
  currency: 'INR',
  members: [
    { memberId: `${groupId}-me`, profileId: ME, name: 'Madan Deivasigmani' },
    { memberId: `${groupId}-them`, profileId: null, name: them },
  ],
  ...extra,
});

describe('findPair', () => {
  it('finds the group with just you and them', () => {
    const found = findPair([pair('g1', 'Renny Benita')], ME, 'Renny Benita');
    expect(found).toMatchObject({ kind: 'found', group: { groupId: 'g1' } });
  });

  it('matches a first name, any case, and folds accents', () => {
    expect(findPair([pair('g1', 'Renny Benita')], ME, 'renny')).toMatchObject({ kind: 'found' });
    expect(findPair([pair('g1', 'Renée')], ME, 'renee')).toMatchObject({ kind: 'found' });
    expect(foldName('  Renée   Benita ')).toBe('renee benita');
  });

  it('does not treat a group of three as a pair, even when the name matches', () => {
    const trip: PairGroup = {
      ...pair('trip', 'Renny'),
      members: [...pair('trip', 'Renny').members, { memberId: 'x', profileId: null, name: 'Matt' }],
    };
    expect(findPair([trip], ME, 'Renny')).toEqual({ kind: 'none' });
  });

  it("does not treat two other people's group as yours", () => {
    const theirs: PairGroup = {
      ...pair('g1', 'Renny'),
      members: [
        { memberId: 'a', profileId: 'someone-else', name: 'Matt' },
        { memberId: 'b', profileId: null, name: 'Renny' },
      ],
    };
    expect(findPair([theirs], ME, 'Renny')).toEqual({ kind: 'none' });
  });

  it('prefers the whole name over a first name', () => {
    const found = findPair([pair('raj', 'Raj'), pair('rajk', 'Raj Kumar')], ME, 'Raj');
    expect(found).toMatchObject({ kind: 'found', group: { groupId: 'raj' } });
  });

  it('returns every candidate instead of choosing between two pairs', () => {
    const found = findPair([pair('g1', 'Renny Benita'), pair('g2', 'Renny Joseph')], ME, 'Renny');
    expect(found).toEqual({
      kind: 'ambiguous',
      candidates: [
        { groupId: 'g1', name: 'Renny Benita', groupName: 'Renny Benita' },
        { groupId: 'g2', name: 'Renny Joseph', groupName: 'Renny Joseph' },
      ],
    });
  });

  it('is not ambiguous when one of them is called exactly that', () => {
    const found = findPair([pair('g1', 'Renny Benita'), pair('g2', 'Renny')], ME, 'Renny');
    expect(found).toMatchObject({ kind: 'found', group: { groupId: 'g2' } });
  });

  it('does not guess from part of a longer name', () => {
    expect(findPair([pair('g1', 'Renny Benita')], ME, 'Renny B')).toEqual({ kind: 'none' });
  });
});

/**
 * A Waves with several groups. Each group lists its live members; new groups
 * and ghosts really appear, so a second request finds what the first made.
 */
function waves(
  groups: { id?: string; name?: string; currency?: string; others: string[] }[],
  opts: { ghostFailures?: number } = {},
) {
  let ghostFailures = opts.ghostFailures ?? 0;
  const myMember = new Map<string, string>();
  type Row = {
    id: string;
    profile_id: string | null;
    ghost_name: string | null;
    profile: { display_name: string } | null;
  };
  const state: {
    id: string;
    name: string;
    default_currency: string;
    deleted?: boolean;
    members: Row[];
  }[] = groups.map((g) => {
    const id = g.id ?? randomUUID();
    const me = randomUUID();
    myMember.set(id, me);
    return {
      id,
      name: g.name ?? g.others.join(', '),
      default_currency: g.currency ?? 'INR',
      members: [
        {
          id: me,
          profile_id: ME,
          ghost_name: null,
          profile: { display_name: 'Madan Deivasigmani' },
        },
        ...g.others.map((n) => ({
          id: randomUUID(),
          profile_id: null,
          ghost_name: n,
          profile: null,
        })),
      ],
    };
  });
  const writes = {
    groups: [] as Record<string, unknown>[],
    ghosts: [] as string[],
    expenses: [] as Record<string, unknown>[],
    deletedGroups: [] as string[],
  };

  const query = (table: string) => {
    let groupIds: string[] | null = null;
    let idIs: string | null = null;
    const live = () => state.filter((g) => !g.deleted);
    const q: Record<string, unknown> = {
      then: (resolve: (v: unknown) => unknown) => {
        if (table === 'groups') {
          return resolve({
            data: live().map(({ id, name, default_currency }) => ({ id, name, default_currency })),
            error: null,
          });
        }
        const rows = live()
          .filter((g) => !groupIds || groupIds.includes(g.id))
          .flatMap((g) => g.members.map((m) => ({ ...m, group_id: g.id })));
        return resolve({ data: rows, error: null });
      },
      maybeSingle: async () => {
        if (table === 'groups' && idIs) {
          const g = live().find((x) => x.id === idIs);
          return { data: g ? { id: g.id } : null, error: null };
        }
        return { data: { default_currency: 'INR' }, error: null };
      },
      in: (_col: string, ids: string[]) => {
        groupIds = ids;
        return q;
      },
      eq: (col: string, value: string) => {
        if (col === 'id') idIs = value;
        return q;
      },
    };
    for (const m of ['select', 'is']) q[m] = () => q;
    return q;
  };

  const supabase = {
    from: query,
    rpc: async (fn: string, args: Record<string, unknown>) => {
      if (fn === 'waves_create_group') {
        // As the RPC does: an id already taken comes straight back when you
        // are in that group (deleted or not), and is refused when you are not.
        const known = state.find((g) => g.id === args.p_group_id);
        if (known) {
          return known.members.some((m) => m.profile_id === ME)
            ? { data: known.id, error: null }
            : { data: null, error: { message: 'GROUP_EXISTS: that group id is already taken' } };
        }
        writes.groups.push(args);
        state.push({
          id: String(args.p_group_id),
          name: String(args.p_name),
          default_currency: String(args.p_currency),
          members: [
            {
              id: String(args.p_creator_member_id),
              profile_id: ME,
              ghost_name: null,
              profile: { display_name: 'Madan Deivasigmani' },
            },
          ],
        });
        return { data: args.p_group_id, error: null };
      }
      if (fn === 'waves_add_ghost_member') {
        if (ghostFailures > 0) {
          ghostFailures -= 1;
          return { data: null, error: { message: 'NOT_A_MEMBER: you are not in that group' } };
        }
        const group = state.find((g) => g.id === args.p_group_id)!;
        const id = (args.p_member_id as string | undefined) ?? randomUUID();
        if (group.members.some((m) => m.id === id)) return { data: id, error: null };
        group.members.push({
          id,
          profile_id: null,
          ghost_name: String(args.p_name),
          profile: null,
        });
        writes.ghosts.push(String(args.p_name));
        return { data: id, error: null };
      }
      if (fn === 'waves_delete_group') {
        state.find((g) => g.id === args.p_group_id)!.deleted = true;
        writes.deletedGroups.push(String(args.p_group_id));
        return { data: null, error: null };
      }
      return { data: null, error: { message: `unexpected rpc ${fn}` } };
    },
    functions: {
      invoke: async (_fn: string, { body }: { body: Record<string, unknown> }) => {
        writes.expenses.push(body);
        return { data: { versionNo: 1 }, error: null };
      },
    },
  } as unknown as SupabaseClient;

  const say = async (args: Record<string, unknown>) => {
    const server = buildWavesServer(supabase, ME, false);
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'test', version: '0.0.0' });
    await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
    const result = await client.callTool({ name: 'add_expense_with_person', arguments: args });
    await client.close();
    const text = (result.content as { text: string }[])[0]?.text ?? '';
    let json: Record<string, unknown> = {};
    try {
      json = JSON.parse(text);
    } catch {
      /* an error message */
    }
    return { isError: Boolean(result.isError), text, json };
  };

  const memberNamed = (groupId: string, name: string) =>
    state
      .find((g) => g.id === groupId)!
      .members.find((m) => (m.profile?.display_name ?? m.ghost_name) === name)!.id;

  return { say, writes, state, memberNamed, myMember };
}

describe('"₹1,000 for dinner with Renny, she paid"', () => {
  it('lands in my one-to-one with Renny, not the trip she is also on', async () => {
    const w = waves([
      { id: 'trip', others: ['Renny', 'Matt', 'Lokesh'] },
      { id: 'pair', others: ['Renny Benita'] },
    ]);

    const { isError, json } = await w.say({
      person: 'Renny',
      description: 'Dinner',
      amount: '100000',
      paidBy: 'them',
    });

    expect(isError).toBe(false);
    expect(json).toMatchObject({
      groupId: 'pair',
      createdGroup: false,
      person: { name: 'Renny Benita' },
    });
    expect(w.writes.groups).toHaveLength(0);
    const [expense] = w.writes.expenses;
    const renny = w.memberNamed('pair', 'Renny Benita');
    expect(expense).toMatchObject({ groupId: 'pair', amount: '100000', currency: 'INR' });
    expect(expense!.payers).toEqual({ [renny]: '100000' });
    expect(new Set(expense!.participants as string[])).toEqual(
      new Set([w.myMember.get('pair'), renny]),
    );
    expect(expense!.splitParams).toEqual({ kind: 'equal' });
  });

  it('starts a one-to-one, named after them, the first time', async () => {
    const w = waves([{ id: 'trip', others: ['Priya', 'Matt'] }]);

    const { json } = await w.say({ person: 'Priya', description: 'Coffee', amount: '30000' });

    expect(json.createdGroup).toBe(true);
    expect(w.writes.groups).toEqual([
      expect.objectContaining({ p_name: 'Priya', p_type: 'other', p_currency: 'INR' }),
    ]);
    expect(w.writes.ghosts).toEqual(['Priya']);
    const [expense] = w.writes.expenses;
    expect(expense!.groupId).toBe(json.groupId);
    expect(expense!.payers).toEqual({ [String(w.writes.groups[0]!.p_creator_member_id)]: '30000' });
  });

  it('uses that new one-to-one the next time, instead of making another', async () => {
    const w = waves([]);

    const first = await w.say({ person: 'Priya', description: 'Coffee', amount: '30000' });
    const second = await w.say({ person: 'priya', description: 'Cake', amount: '20000' });

    expect(second.json).toMatchObject({ groupId: first.json.groupId, createdGroup: false });
    expect(w.writes.groups).toHaveLength(1);
    expect(w.writes.ghosts).toEqual(['Priya']);
  });

  it("keeps the one-to-one's currency unless another is said", async () => {
    const w = waves([{ id: 'pair', others: ['Matt'], currency: 'USD' }]);

    await w.say({ person: 'Matt', description: 'Lunch', amount: '2000' });
    await w.say({ person: 'Matt', description: 'Chai', amount: '5000', currency: 'inr' });

    expect(w.writes.expenses.map((e) => e.currency)).toEqual(['USD', 'INR']);
  });

  it('"I had ₹700 of it" sends exact shares keyed to the right people', async () => {
    const w = waves([{ id: 'pair', others: ['Renny Benita'] }]);

    await w.say({
      person: 'Renny',
      description: 'Dinner',
      amount: '100000',
      split: { kind: 'exact', mine: '70000', theirs: '30000' },
    });

    expect(w.writes.expenses[0]!.splitParams).toEqual({
      kind: 'exact',
      amounts: {
        [w.myMember.get('pair')!]: '70000',
        [w.memberNamed('pair', 'Renny Benita')]: '30000',
      },
    });
  });
});

describe('individual expenses that should stop before anything is written', () => {
  const nothingWritten = (w: ReturnType<typeof waves>) => {
    expect(w.writes.groups).toHaveLength(0);
    expect(w.writes.ghosts).toHaveLength(0);
    expect(w.writes.expenses).toHaveLength(0);
  };

  it('asks which Renny when two one-to-ones answer to the name', async () => {
    const w = waves([
      { id: 'g1', others: ['Renny Benita'] },
      { id: 'g2', others: ['Renny Joseph'] },
    ]);

    const { isError, text } = await w.say({
      person: 'Renny',
      description: 'Dinner',
      amount: '100000',
    });

    expect(isError).toBe(true);
    expect(text).toContain('2 one-to-one groups with "Renny"');
    expect(text).toContain('groupId g1');
    expect(text).toContain('groupId g2');
    nothingWritten(w);
  });

  it('refuses "me" as the other person', async () => {
    const w = waves([]);

    const { isError, text } = await w.say({ person: 'me', description: 'Chai', amount: '100' });

    expect(isError).toBe(true);
    expect(text).toContain('is you');
    nothingWritten(w);
  });

  it('refuses an amount that is not minor units', async () => {
    const w = waves([{ id: 'pair', others: ['Matt'] }]);

    const { isError } = await w.say({ person: 'Matt', description: 'Chai', amount: '₹200' });

    expect(isError).toBe(true);
    nothingWritten(w);
  });
});

describe('making a one-to-one survives retries and races', () => {
  it('refuses a name that is only spaces, before anything is written', async () => {
    const w = waves([]);
    const { isError } = await w.say({ person: '   ', description: 'Coffee', amount: '100' });
    expect(isError).toBe(true);
    expect(w.writes.groups).toHaveLength(0);
    expect(w.writes.ghosts).toHaveLength(0);
  });

  it('derives the same ids for the same person however the name is typed', () => {
    expect(pairIds(ME, 'Priya', 0)).toEqual(pairIds(ME, '  priya ', 0));
    expect(pairIds(ME, 'Priya', 0).groupId).not.toBe(pairIds(ME, 'Priya', 1).groupId);
    expect(pairIds(ME, 'Priya', 0).groupId).not.toBe(pairIds('someone-else', 'Priya', 0).groupId);
    expect(pairIds(ME, 'Priya', 0).groupId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it('two requests at once for somebody new make one group between them', async () => {
    const w = waves([]);
    const [a, b] = await Promise.all([
      w.say({ person: 'Priya', description: 'Coffee', amount: '30000' }),
      w.say({ person: 'Priya', description: 'Cake', amount: '20000' }),
    ]);
    expect(a.isError || b.isError).toBe(false);
    expect(a.json.groupId).toBe(b.json.groupId);
    expect(w.state.filter((g) => !g.deleted)).toHaveLength(1);
    expect(w.state[0]!.members).toHaveLength(2);
    expect(w.writes.expenses).toHaveLength(2);
  });

  it('a retried add of the person gets through without a second group', async () => {
    const w = waves([], { ghostFailures: 1 });
    const { isError, json } = await w.say({
      person: 'Priya',
      description: 'Coffee',
      amount: '100',
    });
    expect(isError).toBe(false);
    expect(json.groupId).toBe(pairIds(ME, 'Priya', 0).groupId);
    expect(w.state).toHaveLength(1);
    expect(w.writes.deletedGroups).toHaveLength(0);
  });

  it('removes the group it made when the person cannot be added, and writes no expense', async () => {
    const w = waves([], { ghostFailures: 2 });
    const { isError } = await w.say({ person: 'Priya', description: 'Coffee', amount: '100' });
    expect(isError).toBe(true);
    expect(w.writes.deletedGroups).toEqual([pairIds(ME, 'Priya', 0).groupId]);
    expect(w.state.filter((g) => !g.deleted)).toHaveLength(0);
    expect(w.writes.expenses).toHaveLength(0);

    // And asking again starts cleanly, under fresh ids.
    const again = await w.say({ person: 'Priya', description: 'Coffee', amount: '100' });
    expect(again.isError).toBe(false);
    expect(again.json.groupId).toBe(pairIds(ME, 'Priya', 1).groupId);
  });

  it('finishes a pair an earlier call left half made', async () => {
    const half = pairIds(ME, 'Priya', 0);
    const w = waves([]);
    w.state.push({
      id: half.groupId,
      name: 'Priya',
      default_currency: 'INR',
      members: [
        {
          id: half.myMemberId,
          profile_id: ME,
          ghost_name: null,
          profile: { display_name: 'Madan' },
        },
      ],
    });
    const { json } = await w.say({ person: 'Priya', description: 'Coffee', amount: '100' });
    expect(json.groupId).toBe(half.groupId);
    expect(w.writes.groups).toHaveLength(0);
    expect(w.state[0]!.members.map((m) => m.id)).toEqual([half.myMemberId, half.theirMemberId]);
  });

  it('does not reuse a derived group that has grown past two people', async () => {
    const taken = pairIds(ME, 'Priya', 0);
    const w = waves([]);
    w.state.push({
      id: taken.groupId,
      name: 'Priya and friends',
      default_currency: 'INR',
      members: [
        {
          id: taken.myMemberId,
          profile_id: ME,
          ghost_name: null,
          profile: { display_name: 'Madan' },
        },
        { id: 'raj', profile_id: null, ghost_name: 'Raj', profile: null },
        { id: 'arun', profile_id: null, ghost_name: 'Arun', profile: null },
      ],
    });
    const { json } = await w.say({ person: 'Priya', description: 'Coffee', amount: '100' });
    expect(json.groupId).toBe(pairIds(ME, 'Priya', 1).groupId);
  });

  it('does not put an expense in a deleted group that still answers to the id', async () => {
    const gone = pairIds(ME, 'Priya', 0);
    const w = waves([]);
    w.state.push({
      id: gone.groupId,
      name: 'Priya',
      default_currency: 'INR',
      deleted: true,
      members: [
        {
          id: gone.myMemberId,
          profile_id: ME,
          ghost_name: null,
          profile: { display_name: 'Madan' },
        },
      ],
    });
    const { json } = await w.say({ person: 'Priya', description: 'Coffee', amount: '100' });
    expect(json.groupId).toBe(pairIds(ME, 'Priya', 1).groupId);
    expect(w.writes.expenses[0]!.groupId).toBe(pairIds(ME, 'Priya', 1).groupId);
  });
});
