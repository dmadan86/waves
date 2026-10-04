import type { CurrencyTotal } from '@/lib/friendsTotals';

/** One group the person shares with you, with its per-currency nets. */
export interface ActionGroup {
  readonly groupId: string;
  readonly groupName: string | null;
  readonly lines: readonly CurrencyTotal[];
}

/** Where a Remind / Pay / Settle up from the person screen lands. */
export interface ActionTarget {
  readonly groupId: string;
  readonly groupName: string | null;
  /** What is outstanding in that one group, in the head currency. Always positive. */
  readonly amount: bigint;
}

/**
 * The one group an action from the person screen is aimed at.
 *
 * Reminders, payments and settlements are all written against a single group
 * (that is where the ledger lives), while this screen shows a person rolled up
 * across several. So the action goes to the group holding the most of the
 * headline direction in the headline currency — the biggest real debt, which is
 * the one worth chasing or paying first. Groups running the other way, or in
 * another currency, are never chosen: acting on them would nudge for or pay a
 * sum the headline does not say.
 */
export function actionTarget(
  groups: readonly ActionGroup[],
  head: CurrencyTotal | undefined,
): ActionTarget | null {
  if (!head) return null;
  const owed = head.net > 0n;
  let best: ActionTarget | null = null;
  for (const group of groups) {
    const line = group.lines.find((candidate) => candidate.currency === head.currency);
    if (!line || line.net === 0n || line.net > 0n !== owed) continue;
    const amount = line.net < 0n ? -line.net : line.net;
    if (!best || amount > best.amount) {
      best = { groupId: group.groupId, groupName: group.groupName, amount };
    }
  }
  return best;
}

/**
 * Who in a group is this person. A person key is their profile id when they have
 * an account, and their membership id when they are a guest; a ghost merged by
 * the caller is keyed on the merge instead, which no member row carries, so that
 * case finds nobody and the screen offers only the actions that need no member.
 */
export function findPersonMember<
  M extends { id: string; profile_id: string | null; left_at: string | null },
>(members: readonly M[], personKey: string): M | undefined {
  return members.find(
    (member) =>
      !member.left_at &&
      // A person key, not the viewer's id: the rule guards the viewer comparison.
      // eslint-disable-next-line no-restricted-syntax
      (member.profile_id === personKey || member.id === personKey),
  );
}

/**
 * Whether to show the "not on Waves yet" invite prompt.
 *
 * Only for somebody known to have no account. While the profile is still absent
 * the group rows decide (every row a guest); with neither there is nothing to
 * say, and the screen's own empty state speaks instead.
 */
export function isUnregistered(
  profile: { is_ghost: boolean } | null,
  rows: readonly { is_ghost: boolean }[],
): boolean {
  if (profile) return profile.is_ghost;
  return rows.length > 0 && rows.every((row) => row.is_ghost);
}
