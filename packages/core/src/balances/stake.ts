/**
 * What one person's part in one expense was.
 *
 * This lived in the phone's data layer until the web grew a ledger that had to
 * answer the same question. It is pure arithmetic over the two sides of a bill,
 * so it belongs here beside the balances rather than in either client — the
 * coloured figure on an expense row has to mean the same thing wherever it is
 * read.
 */

/**
 * The two sides of a bill this file reads.
 *
 * Typed structurally rather than as an expense version, so a narrower
 * projection — an audit row from the expense history, which carries the payers
 * and the shares but no split params or note — can ask the same question
 * without either caller growing its own copy of the answer.
 */
export interface StakeSides {
  readonly payers: readonly { readonly member_id: string; readonly amount: string }[];
  readonly shares: readonly { readonly member_id: string; readonly amount: string }[];
}

/**
 * What one expense did to that person's balance: what they put in beyond their
 * share (positive — they lent), or their share of what somebody else put in
 * (negative — they borrowed).
 *
 * `null` means they are in neither column: a bill between other people. That is
 * a blank on the row, not a zero — a zero reads as "square on this one", which
 * is a different sentence, and the one you get when somebody paid and owed the
 * same non-zero amount.
 */
export function myStake(
  version: StakeSides | null | undefined,
  memberId: string | null,
): bigint | null {
  if (!version || !memberId) return null;
  const paid = BigInt(version.payers.find((row) => row.member_id === memberId)?.amount ?? 0);
  const share = BigInt(version.shares.find((row) => row.member_id === memberId)?.amount ?? 0);
  // "Put nothing in, owe nothing" covers both the member absent from the bill
  // and a member written into the split with a zero share, which some imports
  // still list. Either way there is no stake.
  if (paid === 0n && share === 0n) return null;
  return paid - share;
}
