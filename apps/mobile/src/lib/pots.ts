import {
  formatParts,
  minorUnitExponent,
  money,
  potBalances,
  potPaymentLabel,
  type PotExpense,
  type PotSettlement,
  type PotInput,
  type PotMemberBalance,
  type CurrencyCode,
} from '@waves/core';

export { potExpensePayers } from '@waves/api-client';

type DisplayPot = PotInput & {
  readonly status: 'open' | 'closed' | 'carried';
  readonly treasurerName: string;
};

/** Keep paise when present; whole rupees read as ₹6,400 in compact copy. */
export function potMoney(amount: bigint, currency: CurrencyCode, locale = 'en-IN'): string {
  const parts = formatParts(money(amount, currency), { locale });
  const whole = amount % 10n ** BigInt(minorUnitExponent(currency)) === 0n;
  return parts.lead + (whole ? '' : parts.fraction) + parts.trail;
}

export function potSummaryLabel(
  balance: bigint,
  progress: string,
  treasurerName: string,
  currency: CurrencyCode,
  locale = 'en-IN',
): string {
  return `${potMoney(balance, currency, locale)} in the pot · ${progress} · ${treasurerName} holds the money`;
}

export function potPersonLabel(
  member: Pick<PotMemberBalance, 'paidIn' | 'used' | 'getsBack' | 'owes'>,
  currency: CurrencyCode,
  locale = 'en-IN',
): string {
  const money = (amount: bigint) => potMoney(amount, currency, locale);
  const remaining =
    member.owes > 0n ? `owes ${money(member.owes)}` : `gets back ${money(member.getsBack)}`;
  return `paid ${money(member.paidIn)} · used ${money(member.used)} · ${remaining}`;
}

/** Reference source never changes this copy or promotes a pending payment. */
export function potContributionStatusLabel(status: string, treasurerName: string): string {
  if (status === 'confirmed' || status === 'auto_confirmed')
    return potPaymentLabel(true, treasurerName);
  if (status === 'cancelled') return 'Cancelled';
  if (status === 'disputed') return `Disputed by ${treasurerName}`;
  return potPaymentLabel(false, treasurerName);
}

/**
 * Call BEFORE computing balances or simplifying the settle plan. Filtering a
 * finished plan loses provenance once pot debts net against ordinary bills.
 * Unknown pot ids stay visible; closed/carried pots return to ordinary settling.
 * One summary per open pot carries its separate cash and member positions.
 */
export function partitionPotLedger<E extends PotExpense, S extends PotSettlement>(
  pots: readonly DisplayPot[],
  expenses: readonly E[],
  settlements: readonly S[],
) {
  const open = pots.filter((pot) => pot.status === 'open');
  const openIds = new Set(open.map((pot) => pot.id));
  const visible = (row: { readonly potId?: string | null }) =>
    !row.potId || !openIds.has(row.potId);
  return {
    expenses: expenses.filter(visible),
    settlements: settlements.filter(visible),
    potLines: open.map((pot) => ({
      potId: pot.id,
      treasurerMemberId: pot.treasurerMemberId,
      currency: pot.currency,
      label: `In the pot, held by ${pot.treasurerName}`,
      ...potBalances(pot, expenses, settlements),
    })),
  };
}
