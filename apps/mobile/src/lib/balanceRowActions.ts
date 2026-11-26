export interface BalanceRowActionState {
  readonly balance: bigint;
  readonly memberId: string;
  readonly myMemberId: string | null;
  /** The settle plan has this member paying the viewer, in the row's currency. */
  readonly owesViewer: boolean;
}

/**
 * The nudge chip is visually inside a navigable balance row, but screen readers
 * need it as its own action because nested accessible controls are unreliable,
 * especially on iOS. Anybody who owes can be reminded, ghosts included: the
 * Remind sheet offers them WhatsApp, SMS or Share instead of the push. Keep the eligibility rule in one pure place so touch and
 * accessibility affordances cannot drift apart.
 */
export function canRemindFromBalanceRow(state: BalanceRowActionState): boolean {
  // Owing the group is not owing the viewer: only a debt to the viewer can be nudged.
  return state.balance < 0n && state.memberId !== state.myMemberId && state.owesViewer;
}
