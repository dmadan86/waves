/**
 * What a person may do about a settlement they are looking at.
 *
 * A settlement is a *claim* that money moved, not a record that it did, so
 * three people can have three different answers about it: the payee says it
 * arrived or it did not, the payer withdraws a claim they should not have made,
 * and anybody else only watches. Getting that wrong shows somebody a button the
 * server will refuse — or, worse, hides the one they need.
 *
 * The permitted transitions come from `canTransition` in `@waves/core`, the
 * same table the phone reads, so a status this screen has not thought about
 * cannot quietly grow a button here. Who is allowed to make each one is the
 * server's rule, mirrored here only so nobody is offered an action that will
 * bounce: `waves_dispute_settlement` refuses anybody but the payee,
 * `waves_cancel_settlement` anybody but the payer.
 *
 * The case worth naming is `auto_confirmed`. A settlement nobody answered in
 * time confirms itself, and the payee may still dispute it afterwards — that is
 * the whole point of the state. Filtering the screen to `initiated` alone left
 * exactly the settlements nobody actively agreed to with no way to say so.
 */

import { canTransition, SettlementTransition } from '@waves/core';

/** The fields this decision reads. Narrower than a full settlement row. */
export interface SettlementFacts {
  readonly status: string;
  readonly from_member_id: string;
  readonly to_member_id: string;
}

export interface SettlementActions {
  /** The payee agreeing that the money arrived. */
  readonly canConfirm: boolean;
  /** The payee saying it never did. */
  readonly canDispute: boolean;
  /** The payer taking back their own claim. */
  readonly canWithdraw: boolean;
  /** Whether this settlement is still waiting on somebody at all. */
  readonly isOpen: boolean;
}

export function settlementActions(
  settlement: SettlementFacts,
  myMemberId: string | null,
): SettlementActions {
  const isPayee = myMemberId !== null && settlement.to_member_id === myMemberId;
  const isPayer = myMemberId !== null && settlement.from_member_id === myMemberId;
  const allows = (transition: SettlementTransition) =>
    canTransition(settlement.status as never, transition);

  return {
    canConfirm: isPayee && allows(SettlementTransition.Confirm),
    canDispute: isPayee && allows(SettlementTransition.Dispute),
    canWithdraw: isPayer && allows(SettlementTransition.Cancel),
    isOpen: allows(SettlementTransition.Confirm) || allows(SettlementTransition.Dispute),
  };
}

/**
 * The settlements worth putting in front of somebody.
 *
 * Anything still answerable: one waiting to be confirmed, one that confirmed
 * itself, one already disputed and waiting to be sorted out. A cancelled or
 * settled one is history and belongs in the ledger, not on a list of things to
 * do.
 */
export function openSettlements<T extends SettlementFacts>(settlements: readonly T[]): T[] {
  return settlements.filter((settlement) => settlementActions(settlement, null).isOpen);
}
