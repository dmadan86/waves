/**
 * Writes for a loan shared with the other person (core: `personal/syncedLoan`).
 *
 * Nothing here is a new kind of record. Sharing "Ravi owes me ₹5,000" is the
 * same three primitives the Add-a-person screen uses — create a one-to-one
 * group, add the person to it (a ghost by name, linked to their account when the
 * contact's email or number matches one), write one expense — plus the link on
 * the personal loan that ties the two halves together. All of it rides the
 * offline queue, under ids chosen here, so it works offline and lands intact.
 */

import { useMutation } from '@tanstack/react-query';
import { randomUUID } from 'expo-crypto';

import {
  cleanCounterpart,
  encodeLoan,
  MutationKind,
  reusableLink,
  shareBlocker,
  syncedLoanExpense,
  withoutLink,
  type PersonalLoan,
  type SyncedLoanLink,
} from '@waves/core';

import { useAuth, useViewerId } from '@/lib/auth';
import { normaliseContactPhone } from '@/lib/phone';
import { useSync } from '@/sync';

import { useSyncedLoanNets } from './hooks';
import { serialiseExpense } from './serialiseExpense';
import { useUpsertPersonalRecord } from './personal';
import { GroupType } from './types';

/** Who a loan is shared with. Email or number lets Waves link a real account. */
export interface LoanPerson {
  readonly name: string;
  readonly email?: string | null;
  readonly phone?: string | null;
}

export class ShareLoanError extends Error {
  constructor(readonly reason: NonNullable<ReturnType<typeof shareBlocker>>) {
    super(`LOAN_NOT_SHAREABLE: ${reason}`);
  }
}

/** The loan's personal record with a new link (or none). */
function loanData(loan: PersonalLoan, over: Partial<PersonalLoan>): Record<string, unknown> {
  const { id: _id, ...rest } = { ...loan, ...over };
  return encodeLoan(rest);
}

/**
 * Share a personal loan: book it as a debt in a 1:1 group with the person and
 * link the two. Returns the link. A second loan to the same person (same
 * currency) goes into the group the first one made, so balances add up in one
 * place.
 */
export function useShareLoan(loans: readonly PersonalLoan[]) {
  const { mutate } = useSync();
  const { profile } = useAuth();
  const viewerId = useViewerId();
  const upsert = useUpsertPersonalRecord();
  const known = useSyncedLoanNets(
    viewerId,
    loans.flatMap((loan) => (loan.synced ? [loan.synced] : [])),
  );

  return useMutation({
    mutationFn: async (input: {
      loan: PersonalLoan;
      person?: LoanPerson;
    }): Promise<SyncedLoanLink> => {
      const { loan } = input;
      const blocked = shareBlocker({
        ...loan,
        counterpart: input.person?.name ?? loan.counterpart,
      });
      if (blocked) throw new ShareLoanError(blocked);
      const name = cleanCounterpart(input.person?.name ?? loan.counterpart);

      let link = reusableLink(loans, name, loan.currency, (id) => known.groups.has(id));
      const expenseId = randomUUID();
      if (link) {
        link = { ...link, expenseId };
      } else {
        const groupId = randomUUID();
        const myMemberId = randomUUID();
        const otherMemberId = randomUUID();
        await mutate(MutationKind.GroupCreate, groupId, {
          name,
          type: GroupType.Other,
          currency: loan.currency,
          emoji: null,
          simplify: true,
          photoPath: null,
          country: null,
          creatorMemberId: myMemberId,
          creatorProfileId: profile?.id ?? null,
        });
        const phone = input.person?.phone
          ? normaliseContactPhone(input.person.phone, profile?.country_code)
          : null;
        await mutate(MutationKind.MemberAddGhost, groupId, {
          memberId: otherMemberId,
          name,
          email: input.person?.email ?? null,
          phone,
        });
        link = { groupId, expenseId, myMemberId, otherMemberId };
      }

      const expense = syncedLoanExpense({
        direction: loan.direction,
        amount: loan.principal,
        currency: loan.currency,
        date: loan.startDate,
        myMemberId: link.myMemberId,
        otherMemberId: link.otherMemberId,
        note: loan.note,
        counterpart: name,
      });
      await mutate(MutationKind.ExpenseCreate, link.groupId, {
        ...serialiseExpense({ ...expense, paymentMethod: null }),
        expenseId,
      });
      await upsert.mutateAsync({
        recordId: loan.id,
        recordKind: 'loan',
        data: loanData(loan, { counterpart: name, synced: link }),
      });
      return link;
    },
  });
}

/**
 * Take the shared debt back out of the group and keep the loan private. The
 * caller checks `canUnlink` first: this removes the expense outright.
 */
export function useUnshareLoan() {
  const { mutate } = useSync();
  const upsert = useUpsertPersonalRecord();
  return useMutation({
    mutationFn: async (loan: PersonalLoan): Promise<void> => {
      if (!loan.synced) return;
      await mutate(MutationKind.ExpenseDelete, loan.synced.groupId, {
        expenseId: loan.synced.expenseId,
      });
      await upsert.mutateAsync({
        recordId: loan.id,
        recordKind: 'loan',
        data: loanData(withoutLink(loan), {}),
      });
    },
  });
}
