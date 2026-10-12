import { format, money, type CurrencyCode } from '@waves/core';

import { fill } from '@/i18n';

/** The four sentences the confirm needs, so the builder stays free of the i18n tables. */
export interface RemoveMemberStrings {
  readonly body: string;
  readonly stillOwes: string;
  readonly isOwed: string;
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
  locale: string;
  strings: RemoveMemberStrings;
}): string {
  const { name, balance, currency, locale, strings } = input;
  const base = fill(strings.body, { name });
  if (balance === 0n) return base;
  const amount = format(money(balance < 0n ? -balance : balance, currency as CurrencyCode), {
    locale,
  });
  const lead = fill(balance < 0n ? strings.stillOwes : strings.isOwed, { name, amount });
  return `${lead} ${base}`;
}
