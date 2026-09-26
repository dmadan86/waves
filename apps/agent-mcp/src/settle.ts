/**
 * Who should pay whom, from balances the database already derived.
 *
 * The same two readings the app gives (`apps/mobile/src/data/hooks.ts`): a
 * group with "simplify debts" on is settled by the fewest transfers that leave
 * every net position where it was, and one with it off is settled edge by edge
 * along the real pairwise debts. Inlined rather than imported from
 * `@waves/core` because this server deliberately depends on nothing in the
 * workspace; the algorithm is `simplify()` there, line for line, so two
 * devices and an agent all propose the same transfers.
 */

export interface Transfer {
  readonly from: string;
  readonly to: string;
  readonly currency: string;
  readonly amount: bigint;
}

/** One `group_balances` row: positive is owed to the member, negative owes. */
export interface NetRow {
  readonly member_id: string;
  readonly currency: string;
  readonly balance: string | number | bigint;
}

/** One `pairwise_balances` row: `from_member_id` owes `to_member_id`. */
export interface PairRow {
  readonly from_member_id: string;
  readonly to_member_id: string;
  readonly currency: string;
  readonly amount: string | number | bigint;
}

/** Greedy max-debtor ↔ max-creditor matching, per currency, ties by member id. */
export function simplifyNet(rows: readonly NetRow[]): Transfer[] {
  const byCurrency = new Map<string, Map<string, bigint>>();
  for (const row of rows) {
    const perCurrency = byCurrency.get(row.currency) ?? new Map<string, bigint>();
    perCurrency.set(row.member_id, (perCurrency.get(row.member_id) ?? 0n) + BigInt(row.balance));
    byCurrency.set(row.currency, perCurrency);
  }

  const transfers: Transfer[] = [];
  for (const currency of [...byCurrency.keys()].sort()) {
    const perCurrency = byCurrency.get(currency) ?? new Map<string, bigint>();
    const debtors: { member: string; amount: bigint }[] = [];
    const creditors: { member: string; amount: bigint }[] = [];
    for (const member of [...perCurrency.keys()].sort()) {
      const balance = perCurrency.get(member) ?? 0n;
      if (balance < 0n) debtors.push({ member, amount: -balance });
      else if (balance > 0n) creditors.push({ member, amount: balance });
    }

    const byAmountThenId = (
      a: { member: string; amount: bigint },
      b: { member: string; amount: bigint },
    ): number =>
      a.amount > b.amount ? -1 : a.amount < b.amount ? 1 : a.member.localeCompare(b.member);

    while (debtors.length > 0 && creditors.length > 0) {
      debtors.sort(byAmountThenId);
      creditors.sort(byAmountThenId);
      const debtor = debtors[0];
      const creditor = creditors[0];
      if (!debtor || !creditor) break;

      const amount = debtor.amount < creditor.amount ? debtor.amount : creditor.amount;
      transfers.push({ from: debtor.member, to: creditor.member, currency, amount });
      debtor.amount -= amount;
      creditor.amount -= amount;
      if (debtor.amount === 0n) debtors.shift();
      if (creditor.amount === 0n) creditors.shift();
    }
  }
  return transfers;
}

/** The real debts as they stand, largest first; a zero edge is no debt. */
export function pairwiseTransfers(rows: readonly PairRow[]): Transfer[] {
  return rows
    .map((row) => ({
      from: row.from_member_id,
      to: row.to_member_id,
      currency: row.currency,
      amount: BigInt(row.amount),
    }))
    .filter((edge) => edge.amount > 0n)
    .sort((a, b) =>
      a.currency !== b.currency
        ? a.currency.localeCompare(b.currency)
        : a.amount > b.amount
          ? -1
          : a.amount < b.amount
            ? 1
            : `${a.from}${a.to}`.localeCompare(`${b.from}${b.to}`),
    );
}
