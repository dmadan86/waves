/**
 * "Move to…": a bottom sheet of the viewer's other spaces. A tap moves the entry there
 * and closes the sheet; a space the viewer cannot add to is simply not listed.
 * One busy indicator (on the tapped row), and a plain retry line if it did not work.
 */

import { useRef, useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { randomUUID } from 'expo-crypto';
import { ActivityIndicator, Pressable, ScrollView, View } from 'react-native';

import { Sheet, Text, iconSize, useTheme } from '@waves/ui';

import { useAllGroupMembers, useGroupLabeller, useGroups } from '@/data/hooks';
import { useMoveToSpace, type MoveArgs } from '@/data/moveSpace';
import { isViewer, type GroupRow } from '@/data/types';
import { fill, useStrings } from '@/i18n';
import { useViewerId } from '@/lib/auth';
import { useToast } from '@/lib/toast';
import { useVoiceAdded } from '@/lib/voiceSpaceStore';
import { canMoveInto, moveTargets } from '@/lib/voiceSpace';

export function MoveToSheet({
  visible,
  onClose,
  onMoved,
  move,
}: {
  visible: boolean;
  onClose: () => void;
  onMoved: () => void;
  /** What is being moved; the target is filled in by the tap. */
  move: Omit<MoveArgs, 'to' | 'newId'>;
}) {
  const theme = useTheme();
  const { t } = useStrings();
  const toast = useToast();
  const viewerId = useViewerId();
  const groups = useGroups().data;
  const everyMember = useAllGroupMembers();
  const run = useMoveToSpace();
  const labelOf = useGroupLabeller();
  const { forget } = useVoiceAdded();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  // One new id per target for the life of the sheet, so a retry never duplicates.
  const ids = useRef(new Map<string, string>());

  const targets = moveTargets(groups, move.from.groupId).filter((group) => {
    const role = everyMember.find(
      (m) => m.group_id === group.id && isViewer(m, viewerId) && !m.left_at,
    )?.role;
    return canMoveInto(group, role ?? null, move.currency);
  });

  const go = async (target: GroupRow): Promise<void> => {
    if (busyId) return;
    setBusyId(target.id);
    setFailed(false);
    let newId = ids.current.get(target.id);
    if (!newId) ids.current.set(target.id, (newId = randomUUID()));
    try {
      await run({ ...move, to: target, newId });
      forget(move.from.id);
      toast.show(fill(t.spaces.movedTo, { name: labelOf(target) }));
      onClose();
      onMoved();
    } catch {
      // Never the raw reason: say nothing changed and let them tap again.
      setFailed(true);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      closeLabel={t.common.close}
      title={t.spaces.moveTitle}
    >
      <ScrollView contentContainerStyle={{ gap: 8 }}>
        <Text variant="caption" tone="muted">
          {targets.length > 0 ? t.spaces.moveBody : t.spaces.moveEmpty}
        </Text>
        {targets.map((target) => (
          <Pressable
            key={target.id}
            accessibilityRole="button"
            disabled={busyId !== null}
            onPress={() => void go(target)}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 12,
              minHeight: 48,
              paddingHorizontal: 12,
              borderRadius: theme.radius.md,
              borderWidth: 1,
              borderColor: theme.color.border,
              backgroundColor: theme.color.surface,
              opacity: busyId !== null && busyId !== target.id ? 0.5 : 1,
            }}
          >
            <Ionicons
              name={target.type === 'company' ? 'business-outline' : 'people-outline'}
              size={iconSize.lg}
              color={theme.color.brand}
            />
            <Text numberOfLines={1} style={{ flex: 1, fontWeight: '600' }}>
              {labelOf(target)}
            </Text>
            {busyId === target.id ? (
              <ActivityIndicator color={theme.color.brand} />
            ) : (
              <Ionicons name="chevron-forward" size={iconSize.md} color={theme.color.textMuted} />
            )}
          </Pressable>
        ))}
        {failed ? (
          <View>
            <Text variant="caption" tone="negative">
              {t.spaces.moveRetry}
            </Text>
          </View>
        ) : null}
      </ScrollView>
    </Sheet>
  );
}
