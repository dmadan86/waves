/**
 * "Split with friends…": one sheet to turn a saved Personal expense into a shared
 * one. Friends (1:1), Groups, or a new group made right here from picked people.
 * The group expense is queued (equal split, you paid) and the Personal original is
 * deleted by `PendingMoveCleanup` once the server has accepted it, so it works
 * offline and nothing is ever counted twice.
 */
import { useMemo, useRef, useState } from 'react';
import { randomUUID } from 'expo-crypto';
import { ScrollView } from 'react-native';

import { MutationKind, peopleSignatureKey } from '@waves/core';
import { Sheet, Text, useTheme } from '@waves/ui';

import {
  DestinationPicker,
  type DestinationChoice,
  type PersonChoice,
} from '@/components/DestinationPicker';
import {
  useAddGhostMember,
  useAllGroupMembers,
  useCreateGroup,
  useExpenseGroups,
  useGroupPeopleSignatures,
  useGroupLabeller,
  useOneToOneGroupIds,
} from '@/data/hooks';
import { GroupType } from '@/data/types';
import { useStrings } from '@/i18n';
import { useViewerId } from '@/lib/auth';
import { AdGateCancelledError } from '@/lib/adGateBridge';
import { friendlyError } from '@/lib/errors';
import { addPendingMove } from '@/lib/pendingMoves';
import {
  friendChoices,
  movableGroups,
  partiesFor,
  pendingMoveFor,
  personalMoveWrite,
  type MoveEntry,
  type MoveParties,
} from '@/lib/personalMove';
import { useSync } from '@/sync';

export function PersonalMoveSheet({
  visible,
  entry,
  onClose,
  onMoved,
}: {
  visible: boolean;
  entry: MoveEntry;
  onClose: () => void;
  /** Where the new group expense is, so the caller can open it. */
  onMoved: (groupId: string, expenseId: string) => void;
}) {
  const theme = useTheme();
  const { t } = useStrings();
  const { mutate, flush } = useSync();
  const viewerId = useViewerId();
  const labelOf = useGroupLabeller();
  const groups = useExpenseGroups().data;
  const members = useAllGroupMembers();
  const oneToOne = useOneToOneGroupIds().data;
  const signatures = useGroupPeopleSignatures(viewerId).data;
  const createGroup = useCreateGroup();
  const [newGroupId, setNewGroupId] = useState(() => randomUUID());
  const [newMemberId, setNewMemberId] = useState(() => randomUUID());
  const addGhost = useAddGhostMember(newGroupId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // "New group" opens the People tab: pick or type who, and the group is made here.
  const [seed, setSeed] = useState(0);
  const busyRef = useRef(false);

  const offered = useMemo(
    () => movableGroups(groups ?? [], members, viewerId, entry.currency),
    [groups, members, viewerId, entry.currency],
  );
  const friends: PersonChoice[] = useMemo(
    () => friendChoices(signatures ?? [], oneToOne, new Set(offered.map((g) => g.id))),
    [signatures, oneToOne, offered],
  );
  const bySignature = useMemo(() => {
    const map = new Map<string, string>();
    for (const sig of signatures ?? []) {
      const key = peopleSignatureKey(sig.names);
      if (!map.has(key)) map.set(key, sig.groupId);
    }
    return map;
  }, [signatures]);

  const send = async (
    groupId: string,
    parties: MoveParties | null,
    make?: () => Promise<MoveParties>,
  ): Promise<void> => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      const who = parties ?? (await make!());
      const expenseId = randomUUID();
      const cmid = await mutate(
        MutationKind.ExpenseCreate,
        groupId,
        personalMoveWrite(entry, who, expenseId),
      );
      // The Personal original goes only after the server accepts this (PendingMoveCleanup).
      await addPendingMove(pendingMoveFor(cmid, entry, groupId, expenseId));
      void flush([groupId]);
      onClose();
      onMoved(groupId, expenseId);
    } catch (caught) {
      if (!(caught instanceof AdGateCancelledError))
        setError(friendlyError(caught, t.household.moveFailed, 'personal.move'));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const toGroup = (groupId: string): void => {
    const group = offered.find((g) => g.id === groupId);
    const parties = group ? partiesFor(group, members, viewerId) : null;
    if (!parties) setError(t.household.moveFailed);
    else void send(groupId, parties);
  };

  const onChoose = (choice: DestinationChoice): void => {
    if (choice.kind === 'existing') toGroup(choice.groupId);
    else if (choice.kind === 'create') setSeed((n) => n + 1);
  };

  const toPeople = (names: string[]): void => {
    const clean = [...new Set(names.map((n) => n.trim()).filter(Boolean))];
    if (clean.length === 0) return;
    const shared = bySignature.get(peopleSignatureKey(clean));
    if (shared) {
      toGroup(shared);
      return;
    }
    const groupId = newGroupId;
    void send(groupId, null, async () => {
      await createGroup.mutateAsync({
        groupId,
        creatorMemberId: newMemberId,
        name: clean.join(', '),
        type: GroupType.Other,
        currency: entry.currency,
      });
      const ghostIds: string[] = [];
      for (const name of clean) ghostIds.push(await addGhost.mutateAsync(name));
      const who = { payerId: newMemberId, participantIds: [newMemberId, ...ghostIds] };
      // Spent: the next new group needs its own ids.
      setNewGroupId(randomUUID());
      setNewMemberId(randomUUID());
      return who;
    });
  };

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      padded={false}
      closeLabel={t.common.close}
      title={t.personal.splitTitle}
      style={{ paddingHorizontal: theme.spacing.xl, gap: theme.spacing.md, maxHeight: '80%' }}
    >
      <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <DestinationPicker
          key={seed}
          selection={seed > 0 ? { kind: 'people', names: [] } : { kind: 'none' }}
          eyebrow={null}
          pinned={[]}
          createRow={{ label: t.captures.assignNew }}
          emptyGroups={t.captures.noGroups}
          labelFor={labelOf}
          groups={offered}
          people={friends}
          t={t}
          onChoose={onChoose}
          onResolvePeople={toPeople}
        />
        {busy ? null : error ? (
          <Text variant="caption" tone="negative">
            {error}
          </Text>
        ) : null}
      </ScrollView>
    </Sheet>
  );
}
