/**
 * "Only me" on a couple or family expense: the entry goes to the person's own
 * Personal records and never touches the group, so the partner is not told.
 */

import { isPrivateSpaceType, type CurrencyCode } from '@waves/core';

import { entryRecord, type EntryRecord } from '@/lib/personalEntry';

/** Only when adding (an existing group expense is already shared) in a couple or family group. */
export function canOfferOnlyMe(input: {
  groupType: string | null | undefined;
  editing: boolean;
}): boolean {
  return !input.editing && isPrivateSpaceType(input.groupType);
}

/** The Personal `txn` an "Only me" expense saves as: the description becomes its note. */
export function onlyMeRecord(input: {
  amount: bigint;
  currency: CurrencyCode;
  category: string | null;
  description: string;
  date: string;
  paymentMethod: string | null;
}): EntryRecord {
  return entryRecord(
    {
      kind: 'expense',
      amount: input.amount,
      currency: input.currency,
      category: input.category,
      note: input.description.trim() || null,
      date: input.date,
      loanId: null,
      recurringId: null,
      paymentMethod: input.paymentMethod,
    },
    null,
  );
}
