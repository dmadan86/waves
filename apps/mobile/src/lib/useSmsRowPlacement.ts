/**
 * "Create expense", for one bank message at a time — the detail screen's own
 * copy of the Bank messages inbox's placement gesture
 * (`app/captures/sms/index.tsx#placeInGroup`/`assignToPeople`), scoped to a
 * single row rather than a ticked batch.
 *
 * It is a copy rather than a shared extraction on purpose, for now: the inbox
 * screen's version is exercised by real traffic already, and reshaping it to
 * take an array of one would touch a screen this change has no other reason
 * to risk. The two must still agree on what "placed" means — same capture id
 * (`smsCaptureId`), same adapter (`smsRowAsCapture`), same planner
 * (`captureBulkAssign.planCaptureAssign`), same settlement
 * (`smsMessageStore.settleMessages`) — so a message placed from the list and
 * one placed from its own detail screen land as the same shape of expense.
 */

import { useCallback, useMemo, useState } from 'react';
import { randomUUID } from 'expo-crypto';

import { MutationKind, peopleSignatureKey, type CategoryMeta } from '@waves/core';

import {
  useAddGhostMember,
  useAssignCapture,
  useCaptures,
  useCreateGroup,
  useGroupPeopleSignatures,
  useGroups,
  useHomeSummary,
  useOneToOneGroupIds,
  usePeopleBalances,
} from '@/data/hooks';
import { groupLabel, GroupType, isViewer, type GroupRow } from '@/data/types';
import type { PersonChoice } from '@/components/DestinationPicker';
import { plural, useStrings } from '@/i18n';
import { friendlyError } from '@/lib/errors';
import { useGuestGuard } from '@/lib/guestGuard';
import { planCaptureAssign, type AssignMember } from '@/lib/captureBulkAssign';
import { smsCaptureId } from '@/lib/smsCaptureId';
import { reloadMessages } from '@/lib/smsMessages';
import { smsRowAsCapture, splitPlaceable } from '@/lib/smsPlacement';
import { settleMessages } from '@/lib/smsMessageStore';
import { SmsSettlement, type StoredSms } from '@/lib/smsMessageTypes';
import { useToast } from '@/lib/toast';
import { usePlaceInPersonal } from '@/lib/usePlaceInPersonal';
import { useSync } from '@/sync';

/** The category the quick-pick row chose, overriding the guess
 *  `smsRowAsCapture` would otherwise make from the merchant's name. Null
 *  means "use the guess", not "no category". */
export interface CategoryChoice {
  readonly id: string;
  readonly meta: CategoryMeta | null;
}

/** `smsRowAsCapture`, with the quick-pick's category substituted for the
 *  guessed one when the person chose a different one. */
function captureFor(row: StoredSms, ownerId: string, id: string, category: CategoryChoice | null) {
  const capture = smsRowAsCapture(row, ownerId, id);
  if (!category) return capture;
  return { ...capture, category: category.id, category_meta: category.meta };
}

export function useSmsRowPlacement(ownerId: string, viewerId: string | null) {
  const { t, locale } = useStrings();
  const toast = useToast();
  const guard = useGuestGuard();
  const groups = useGroups();
  const summary = useHomeSummary(viewerId);
  const people = usePeopleBalances(viewerId);
  const oneToOne = useOneToOneGroupIds();
  const signatures = useGroupPeopleSignatures(viewerId);
  const createGroup = useCreateGroup();
  const assignCapture = useAssignCapture();
  const captures = useCaptures();
  const { mutate } = useSync();
  const placeInPersonal = usePlaceInPersonal();

  const [placing, setPlacing] = useState(false);
  const [newGroupId, setNewGroupId] = useState(() => randomUUID());
  const [newMemberId, setNewMemberId] = useState(() => randomUUID());
  const addGhost = useAddGhostMember(newGroupId);

  // Only groups the viewer still belongs to — same rule the inbox list uses.
  const assignableGroups = useMemo(
    () =>
      (groups.data ?? []).filter((group) =>
        summary.membersFor(group.id).some((member) => isViewer(member, viewerId)),
      ),
    [groups.data, summary, viewerId],
  );

  const peopleChoices = useMemo(() => {
    const byGroup = new Map<string, PersonChoice>();
    for (const row of people.data ?? []) {
      if (!row.only_group_id || !oneToOne.data.has(row.only_group_id)) continue;
      byGroup.set(row.only_group_id, {
        personKey: row.person_key,
        name: row.display_name,
        groupId: row.only_group_id,
      });
    }
    return [...byGroup.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [people.data, oneToOne.data]);

  const groupBySignature = useMemo(() => {
    const map = new Map<string, string>();
    for (const sig of signatures.data) {
      const key = peopleSignatureKey(sig.names);
      if (!map.has(key)) map.set(key, sig.groupId);
    }
    return map;
  }, [signatures.data]);

  /** One message, into one group, as an ordinary expense. Mirrors the inbox
   *  list's `placeInGroup`, for a single row. */
  const placeInGroup = useCallback(
    async (
      row: StoredSms,
      input: {
        groupId: string;
        label: string;
        members: readonly AssignMember[];
        myMemberId: string | null;
        currency: string;
      },
      category: CategoryChoice | null = null,
    ): Promise<boolean> => {
      if (placing) return false;
      if (guard.blockWrite()) return false;
      setPlacing(true);
      try {
        const { placeable } = splitPlaceable([row]);
        if (placeable.length === 0) {
          // A parser bug, not a network failure: the amount this row carries
          // is not a whole number of minor units, so there is nothing to
          // write. Reported so it can be looked at, same as the batch path.
          toast.show(t.captures.couldNotSave, 'negative');
          return false;
        }
        const captureId = await smsCaptureId(ownerId, row.dedupeKey);
        const plan = planCaptureAssign({
          captures: [captureFor(row, ownerId, captureId, category)],
          members: input.members,
          myMemberId: input.myMemberId,
          currency: input.currency,
        });
        const openCaptureIds = new Set((captures.data ?? []).map((capture) => capture.id));

        let placed = false;
        let firstError: unknown;
        for (const write of plan.writes) {
          try {
            await mutate(MutationKind.ExpenseCreate, input.groupId, write.payload);
            if (openCaptureIds.has(write.captureId)) {
              await assignCapture.mutateAsync({
                captureId: write.captureId,
                groupId: input.groupId,
                expenseId: write.expenseId,
              });
            }
            placed = true;
          } catch (caught) {
            firstError = caught;
          }
        }

        if (placed) {
          await settleMessages(ownerId, [row.dedupeKey], SmsSettlement.Placed, () => captureId);
          await reloadMessages(ownerId);
          toast.show(plural(locale, 1, t.smsInbox.placed).replaceAll('{name}', input.label));
          return true;
        }
        toast.show(
          friendlyError(firstError, t.captures.couldNotSave, 'sms.detail.place'),
          'negative',
        );
        return false;
      } catch (caught) {
        toast.show(friendlyError(caught, t.captures.couldNotSave, 'sms.detail.place'), 'negative');
        return false;
      } finally {
        setPlacing(false);
      }
    },
    [assignCapture, captures.data, guard, locale, mutate, ownerId, placing, t, toast],
  );

  /** An existing group, chosen from the picker. */
  const chooseExistingGroup = useCallback(
    (row: StoredSms, groupId: string, category: CategoryChoice | null = null): Promise<boolean> => {
      const members = summary.membersFor(groupId);
      const group: GroupRow | undefined = assignableGroups.find((each) => each.id === groupId);
      return placeInGroup(
        row,
        {
          groupId,
          label: group ? groupLabel(group, members, viewerId) : '',
          members,
          myMemberId: members.find((member) => isViewer(member, viewerId))?.id ?? null,
          currency: group?.default_currency ?? row.currency,
        },
        category,
      );
    },
    [assignableGroups, placeInGroup, summary, viewerId],
  );

  /** "Just me" — the private ledger, through the one shared write path. */
  const placePersonal = useCallback(
    async (row: StoredSms, category: CategoryChoice | null = null): Promise<boolean> => {
      const id = await smsCaptureId(ownerId, row.dedupeKey);
      const done = await placeInPersonal({
        lockKey: row.dedupeKey,
        items: [captureFor(row, ownerId, id, category)],
      });
      if (done.length === 0) return false;
      await settleMessages(ownerId, [row.dedupeKey], SmsSettlement.Placed, () => id);
      await reloadMessages(ownerId);
      return true;
    },
    [ownerId, placeInPersonal],
  );

  /** People who do not already share a group — the signature is reused if one
   *  matches, else a fresh group (and any ghosts) is made and the message is
   *  placed into it. */
  const assignToNewPeople = useCallback(
    async (
      row: StoredSms,
      names: string[],
      category: CategoryChoice | null = null,
    ): Promise<boolean> => {
      const clean = [...new Set(names.map((name) => name.trim()).filter(Boolean))];
      if (clean.length === 0) return false;

      const shared = groupBySignature.get(peopleSignatureKey(clean));
      if (shared) return chooseExistingGroup(row, shared, category);

      const groupId = newGroupId;
      const currency = row.currency;
      const ghostIds: string[] = [];
      try {
        await createGroup.mutateAsync({
          groupId,
          creatorMemberId: newMemberId,
          name: clean.join(', '),
          type: GroupType.Other,
          currency,
        });
        for (const name of clean) ghostIds.push(await addGhost.mutateAsync(name));
      } catch (caught) {
        toast.show(
          friendlyError(caught, t.captures.couldNotSave, 'sms.detail.newPeopleGroup'),
          'negative',
        );
        return false;
      }
      setNewGroupId(randomUUID());
      setNewMemberId(randomUUID());
      return placeInGroup(
        row,
        {
          groupId,
          label: clean.join(', '),
          members: [{ id: newMemberId }, ...ghostIds.map((id) => ({ id }))],
          myMemberId: newMemberId,
          currency,
        },
        category,
      );
    },
    [
      addGhost,
      chooseExistingGroup,
      createGroup,
      groupBySignature,
      newGroupId,
      newMemberId,
      placeInGroup,
      t,
      toast,
    ],
  );

  return {
    assignableGroups,
    peopleChoices,
    placing,
    chooseExistingGroup,
    placePersonal,
    assignToNewPeople,
  };
}
