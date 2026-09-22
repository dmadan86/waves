/**
 * Which drafts belong to a group.
 *
 * A draft (A34) belongs to the person who caught it, not to a group: the
 * captures read returns every open one this account holds, and a group screen
 * has to pick out the ones addressed to it. The rule is one line, and it lives
 * here rather than in the component for the usual reason — a `.tsx` cannot be
 * imported by a test without dragging React Native in with it, and this is the
 * part worth pinning.
 *
 * Getting it wrong is bad in two different ways. Too loose and a draft meant
 * for another group, or for nowhere yet, surfaces inside a shared ledger. Too
 * tight and money somebody deliberately kept for this group is invisible in the
 * one place they will look for it.
 */

import type { CaptureRow } from '@/data/types';

export function draftsForGroup(
  captures: readonly CaptureRow[],
  groupId: string,
): readonly CaptureRow[] {
  // An unaddressed draft stays in Review. It is the case the inbox exists for,
  // and deciding it inside one group's ledger would be deciding it by accident.
  return captures.filter((capture) => capture.target_group_id === groupId);
}
