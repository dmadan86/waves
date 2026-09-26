/**
 * Which of the caller's groups is "them and this person" — the home of an
 * individual expense.
 *
 * Waves has no friend list and no groupless expense. An expense with one person
 * lives in a group with exactly the two of them in it, and the app's People tab
 * shows that group as the person. Nothing on the server marks such a group; the
 * app recognises one by its live membership, and so does this.
 *
 * The agent MCP server has the same rule in `apps/agent-mcp/src/pair.ts`. It
 * deliberately depends on nothing in the workspace, so the two are twins kept
 * honest by their tests rather than one import.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export interface PairMember {
  readonly memberId: string;
  readonly profileId: string | null;
  readonly name: string;
}

export interface PairGroup {
  readonly groupId: string;
  readonly groupName: string | null;
  readonly currency: string;
  /** The group's live members — nobody who has left. */
  readonly members: readonly PairMember[];
}

export type PairLookup =
  | {
      readonly kind: 'found';
      readonly group: PairGroup;
      readonly me: PairMember;
      readonly them: PairMember;
    }
  | { readonly kind: 'none' }
  | {
      readonly kind: 'ambiguous';
      readonly candidates: readonly { groupId: string; name: string; groupName: string | null }[];
    };

/** What people call themselves when they mean the caller. */
export const SELF = new Set(['me', 'i', 'myself']);

/**
 * A name as people compare names: trimmed, spaces collapsed, accents folded and
 * case ignored — the folding the app uses to match people to groups.
 */
export function foldName(name: string): string {
  return name.normalize('NFKD').replace(/\p{M}/gu, '').trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * The caller's one-to-one group with the person named, if there is exactly one.
 *
 * A pair is a group with two live members, one of them the caller. The other is
 * matched by whole name first, then — for a single word — by first name, so
 * "Renny" finds Renny Benita. More than one pair answering to the name is
 * returned as ambiguous rather than picked from: the app's Friends screen makes
 * a new group every time somebody is added, so two "Rennys" can be two people.
 */
export function findPair(
  groups: readonly PairGroup[],
  meProfileId: string,
  said: string,
): PairLookup {
  const pairs = groups.flatMap((group) => {
    if (group.members.length !== 2) return [];
    const me = group.members.find((m) => m.profileId === meProfileId);
    const them = group.members.find((m) => m !== me);
    return me && them ? [{ group, me, them }] : [];
  });

  const wanted = foldName(said);
  let matches = pairs.filter((p) => foldName(p.them.name) === wanted);
  if (matches.length === 0 && !wanted.includes(' ')) {
    matches = pairs.filter((p) => foldName(p.them.name).split(' ')[0] === wanted);
  }

  if (matches.length === 0) return { kind: 'none' };
  if (matches.length === 1) return { kind: 'found', ...matches[0]! };
  return {
    kind: 'ambiguous',
    candidates: matches.map((p) => ({
      groupId: p.group.groupId,
      name: p.them.name,
      groupName: p.group.groupName,
    })),
  };
}

/**
 * Every live group of the caller's with its live members. RLS already limits
 * both reads to groups the caller is in; a deleted group is dropped so an
 * individual expense never lands in something they removed.
 */
export async function loadPairGroups(supabase: SupabaseClient): Promise<PairGroup[]> {
  const { data: groups, error } = await supabase
    .from('groups')
    .select('id, name, default_currency')
    .is('deleted_at', null);
  if (error) throw error;
  if (!groups?.length) return [];

  const { data: rows, error: membersError } = await supabase
    .from('group_members')
    .select('id, group_id, profile_id, ghost_name, profile:profiles!profile_id ( display_name )')
    .in(
      'group_id',
      groups.map((g) => g.id as string),
    )
    .is('left_at', null);
  if (membersError) throw membersError;

  return groups.map((g) => ({
    groupId: g.id as string,
    groupName: (g.name as string | null) ?? null,
    currency: String(g.default_currency),
    members: (rows ?? [])
      .filter((m) => m.group_id === g.id)
      .map((m) => {
        const profile = m.profile as { display_name?: string } | null;
        return {
          memberId: m.id as string,
          profileId: (m.profile_id as string | null) ?? null,
          name: (profile?.display_name ?? (m.ghost_name as string | null) ?? 'Unnamed').trim(),
        };
      }),
  }));
}
