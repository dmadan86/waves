export interface BalanceRowActionState {
  readonly balance: bigint;
  readonly isGhost: boolean;
  readonly memberId: string;
  readonly myMemberId: string | null;
}

/**
 * The nudge chip is visually inside a navigable balance row, but screen readers
 * need it as its own action because nested accessible controls are unreliable,
 * especially on iOS. Keep the eligibility rule in one pure place so touch and
 * accessibility affordances cannot drift apart.
 */
export function canRemindFromBalanceRow(state: BalanceRowActionState): boolean {
  return state.balance < 0n && !state.isGhost && state.memberId !== state.myMemberId;
}
