import { format, money, type CurrencyCode } from '@waves/core';

import { fill } from '@/i18n';

/** The four sentences the confirm needs, so the builder stays free of the i18n tables. */
export interface RemoveMemberStrings {
  readonly body: string;
  readonly stillOwes: string;
  readonly isOwed: string;
}

export interface OpenBalance {
  readonly currency: string;
  /** Minor units; positive means owed to them, negative means they owe. */
  readonly balance: bigint;
}

/** Every non-zero balance a member holds, in any currency (not just the group default). */
export function openBalances(
  net: ReadonlyMap<string, ReadonlyMap<string, bigint>>,
  memberId: string | null,
): OpenBalance[] {
  if (memberId === null) return [];
  const open: OpenBalance[] = [];
  for (const [currency, perMember] of net) {
    const balance = perMember.get(memberId) ?? 0n;
    if (balance !== 0n) open.push({ currency, balance });
  }
  return open;
}

/**
 * The body of "Remove {name}?". When the person's balance in this group is not
 * square, it leads with what is still open — they owe, or they are owed —
 * because removing them does not settle it: the expenses and the balance stay in
 * the group's history. The amount is the group's own currency, in minor units.
 */
export function removeMemberBody(input: {
  name: string;
  /** Minor units; positive means owed to them, negative means they owe. */
  balance: bigint;
  currency: string;
  /** Balances in every currency; when given it replaces `balance`/`currency`. */
  open?: readonly OpenBalance[];
  locale: string;
  strings: RemoveMemberStrings;
}): string {
  const { name, balance, currency, locale, strings } = input;
  const base = fill(strings.body, { name });
  const open = input.open ?? (balance === 0n ? [] : [{ currency, balance }]);
  if (open.length === 0) return base;
  const leads = open.map((entry) => {
    const amount = format(
      money(entry.balance < 0n ? -entry.balance : entry.balance, entry.currency as CurrencyCode),
      { locale },
    );
    return fill(entry.balance < 0n ? strings.stillOwes : strings.isOwed, { name, amount });
  });
  return `${leads.join(' ')} ${base}`;
}
