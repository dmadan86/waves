import { parseNarration } from '../statement/narration';
import { isLive } from '../balances/balances';
import { isSettled, type ExpenseSnapshot, type SettlementSnapshot } from '../balances/types';

export interface PotInput {
  readonly id: string;
  readonly currency: string;
  readonly treasurerMemberId: string;
  readonly memberIds: readonly string[];
  readonly perHeadMinor: bigint;
}
export type PotExpense = ExpenseSnapshot & { readonly potId?: string | null };
export type PotSettlement = SettlementSnapshot & { readonly potId?: string | null };
export interface PotMemberBalance {
  readonly memberId: string;
  readonly paidIn: bigint;
  readonly used: bigint;
  readonly refunded: bigint;
  readonly balance: bigint;
  readonly getsBack: bigint;
  readonly owes: bigint;
}

/** Only socially confirmed transfers count. Top-ups and contributions have the
 * same direction; refunds run the other way. The treasurer's own funding is
 * implicit in the cash they hold, never a settlement to themselves. */
export function potBalances(
  pot: PotInput,
  expenses: readonly PotExpense[],
  settlements: readonly PotSettlement[],
): { balance: bigint; members: PotMemberBalance[]; progress: string } {
  if (pot.perHeadMinor <= 0n) throw new Error('INVALID_AMOUNT');
  const live = expenses.filter((e) => e.potId === pot.id && isLive(e));
  const paid = settlements.filter((s) => s.potId === pot.id && isSettled(s.status));
  for (const e of live) {
    if (
      e.currency !== pot.currency ||
      Object.keys(e.payers).length !== 1 ||
      e.payers[pot.treasurerMemberId] !== e.amount
    ) {
      throw new Error('POT_PAYER_MUST_BE_TREASURER');
    }
  }
  for (const s of paid) {
    if (
      s.currency !== pot.currency ||
      s.amount <= 0n ||
      s.from === s.to ||
      (s.from !== pot.treasurerMemberId && s.to !== pot.treasurerMemberId)
    ) {
      throw new Error('INVALID_POT_SETTLEMENT');
    }
  }
  const ids = new Set([...pot.memberIds, pot.treasurerMemberId]);
  for (const e of live) for (const id of Object.keys(e.shares)) ids.add(id);
  for (const s of paid) {
    ids.add(s.from);
    ids.add(s.to);
  }
  const members = [...ids].sort().map((memberId) => {
    const paidIn = paid.filter((s) => s.from === memberId).reduce((n, s) => n + s.amount, 0n);
    const refunded = paid
      .filter((s) => s.to === memberId && s.from === pot.treasurerMemberId)
      .reduce((n, s) => n + s.amount, 0n);
    const used = live.reduce((n, e) => n + (e.shares[memberId] ?? 0n), 0n);
    // The treasurer's position is the ordinary ledger position, including the
    // cash held for everyone else. A transfer to themselves would double count.
    const balance =
      memberId === pot.treasurerMemberId
        ? live.reduce((n, e) => n + e.amount, 0n) -
          used +
          paidIn -
          paid.filter((s) => s.to === memberId).reduce((n, s) => n + s.amount, 0n)
        : paidIn - used - refunded;
    return {
      memberId,
      paidIn: memberId === pot.treasurerMemberId ? 0n : paidIn,
      used,
      refunded,
      balance,
      getsBack: balance > 0n ? balance : 0n,
      owes: balance < 0n ? -balance : 0n,
    };
  });
  const participants = members.filter(
    (m) => pot.memberIds.includes(m.memberId) && m.memberId !== pot.treasurerMemberId,
  );
  return {
    balance:
      paid.reduce((n, s) => n + (s.to === pot.treasurerMemberId ? s.amount : -s.amount), 0n) -
      live.reduce((n, e) => n + e.amount, 0n),
    members,
    progress: `${participants.filter((m) => m.paidIn >= pot.perHeadMinor).length} of ${participants.length} paid in`,
  };
}

/** Every close transfer goes through the treasurer. Never auto-confirms. */
export function potClosePlan(
  pot: PotInput,
  expenses: readonly PotExpense[],
  settlements: readonly PotSettlement[],
) {
  return potBalances(pot, expenses, settlements)
    .members.filter((m) => m.memberId !== pot.treasurerMemberId && m.balance !== 0n)
    .map((m) => ({
      from: m.balance > 0n ? pot.treasurerMemberId : m.memberId,
      to: m.balance > 0n ? m.memberId : pot.treasurerMemberId,
      amount: m.balance > 0n ? m.balance : -m.balance,
      currency: pot.currency,
      status: 'initiated' as const,
    }));
}

export function potPaymentLabel(confirmed: boolean, treasurerName: string): string {
  return confirmed ? `Confirmed by ${treasurerName}` : `says paid · waiting for ${treasurerName}`;
}

/** Accept a bare RRN/UTR using the statement parser's existing bank patterns.
 * This is a reconciliation reference, never evidence that money arrived. */
export function normalisePotUtr(value: string): string | null {
  const raw = value.trim().toUpperCase();
  if (!raw || raw.length > 64) return null;
  const ref = parseNarration(raw).ref ?? parseNarration(`UPI/${raw}`).ref;
  return ref === raw ? ref : null;
}
