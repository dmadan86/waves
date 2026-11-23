/** Post one occurrence of a manual recurring rule now (the "Post now" / "Mark as paid" write). */

import {
  encodeRecurring,
  encodeTxn,
  recurringOccurrenceId,
  stepOccurrence,
  type PersonalRecurring,
} from '@waves/core';

import { useUpsertPersonalRecord } from '@/data/personal';

export function usePostRecurring() {
  const upsert = useUpsertPersonalRecord();
  // The occurrence id is deterministic per (rule, date), so posting a date the
  // auto catch-up also posts collapses to one row rather than two. A date before
  // the rule's next one (a late bill) leaves `nextDate` where it is.
  const post = async (rule: PersonalRecurring, dueDate: string = rule.nextDate): Promise<void> => {
    await upsert.mutateAsync({
      recordId: recurringOccurrenceId(rule.id, dueDate),
      recordKind: 'txn',
      data: encodeTxn({
        kind: rule.txnKind,
        amount: rule.amount,
        currency: rule.currency,
        category: rule.category,
        note: rule.note,
        date: dueDate,
        loanId: null,
        recurringId: rule.id,
        ...(rule.investmentId ? { investmentId: rule.investmentId } : {}),
      }),
    });
    if (dueDate < rule.nextDate) return;
    await upsert.mutateAsync({
      recordId: rule.id,
      recordKind: 'recurring',
      data: encodeRecurring({ ...rule, nextDate: stepOccurrence(rule, dueDate) }),
    });
  };
  return { post, isPending: upsert.isPending };
}
