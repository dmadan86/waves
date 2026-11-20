/**
 * "What I heard", on the Added card: the sentence in quotes on one muted line,
 * each name that matched a person underlined. Tap a name to say who it really
 * was; the swap is written like any other edit of the expense, and every swap
 * of one person for another (here, on the Split chip, in the saved bar) is
 * remembered for next time, so the same words find the same person.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { View } from 'react-native';

import { Sheet, Text, useTheme } from '@waves/ui';

import { PickChip } from '@/components/assistant/inline/PickChip';
import { fill, useStrings } from '@/i18n';
import { useViewerId } from '@/lib/auth';
import type { SavedState } from '@/lib/followUpApply';
import type { AgentLocalData } from '@/lib/voiceAgentPlan';
import {
  findHeardNames,
  heardSegments,
  savedPeople,
  swappedName,
  swapPerson,
  type HeardName,
} from '@/lib/voiceHeardPure';
import { learnedForGroup, withAliases } from '@/lib/voiceNames';
import { rememberNamePick, useVoiceNameMemory } from '@/lib/voiceNameStore';

export interface HeardLineProps {
  transcript: string;
  saved: SavedState;
  local: AgentLocalData;
  busy: boolean;
  /** Write the expense with the swap; true once it is saved. */
  onFix: (next: SavedState) => Promise<boolean>;
}

export function HeardLine({ transcript, saved, local, busy, onFix }: HeardLineProps) {
  const theme = useTheme();
  const { t } = useStrings();
  const viewerId = useViewerId();
  const memory = useVoiceNameMemory(viewerId);
  const groupId = saved.groupId;
  const group = local.groups.find((g) => g.id === groupId);
  const members = useMemo(
    () =>
      withAliases(
        (group?.members ?? []).map((m) => ({ id: m.id, name: m.name, isMe: m.isViewer })),
        memory,
        groupId,
      ),
    [group, memory, groupId],
  );
  // The spans are read once, from the expense as it was added.
  const [names, setNames] = useState<readonly HeardName[]>(() =>
    saved.kind === 'group'
      ? findHeardNames(transcript, members, savedPeople(saved), learnedForGroup(memory, groupId))
      : [],
  );
  const [startGroup] = useState(groupId);
  const people = useRef(savedPeople(saved));
  const [picking, setPicking] = useState<HeardName | null>(null);

  // Whoever the expense changes hands to (a chip, the sheet, a typed fix): one
  // heard name's person swapped for one other is that name, corrected.
  const peopleKey = savedPeople(saved).join(',');
  useEffect(() => {
    const before = people.current;
    const after = savedPeople(saved);
    people.current = after;
    if (before.join(',') === peopleKey) return;
    const swap = swappedName(names, before, after);
    if (swap && groupId)
      void rememberNamePick(viewerId, { heard: swap.heard, memberId: swap.to, groupId, members });
    setNames(
      swap
        ? names.map((n) => (n.memberId === swap.from ? { ...n, memberId: swap.to } : n))
        : names.filter((n) => after.includes(n.memberId)),
    );
    // Runs on a change of who is in the expense, not on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [peopleKey]);

  if (saved.kind !== 'group' || groupId !== startGroup || names.length === 0) return null;
  const nameOf = (id: string): string => members.find((m) => m.id === id)?.name ?? '';

  return (
    <>
      <Text variant="caption" tone="muted" numberOfLines={1}>
        {'“'}
        {heardSegments(transcript, names).map((segment, index) =>
          segment.name ? (
            <Text
              key={index}
              variant="caption"
              accessibilityRole="button"
              accessibilityLabel={fill(t.voice.heardSpan, {
                word: segment.text,
                name: nameOf(segment.name.memberId),
              })}
              onPress={busy ? undefined : () => setPicking(segment.name ?? null)}
              style={{ color: theme.color.brand, textDecorationLine: 'underline' }}
            >
              {segment.text}
            </Text>
          ) : (
            segment.text
          ),
        )}
        {'”'}
      </Text>
      <Sheet
        visible={picking !== null}
        onClose={() => setPicking(null)}
        title={fill(t.voice.heardPick, { word: picking?.text ?? '' })}
        closeLabel={t.inline.close}
      >
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.xs }}>
          {members
            .filter((m) => !m.isMe)
            .map((m) => (
              <PickChip
                key={m.id}
                label={m.name}
                selected={m.id === picking?.memberId}
                disabled={busy}
                onPress={() => {
                  const from = picking;
                  setPicking(null);
                  if (from && m.id !== from.memberId)
                    void onFix(swapPerson(saved, from.memberId, m.id));
                }}
              />
            ))}
        </View>
      </Sheet>
    </>
  );
}
