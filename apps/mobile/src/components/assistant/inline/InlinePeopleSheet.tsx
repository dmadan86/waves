/**
 * "Split with ...", "Move to a trip" and "Who was there?", on the voice screen.
 *
 * One sheet over the panel instead of the add-expense screen: pick the group
 * (unless it is fixed) and the people with tap chips, then save. The sheet only
 * collects the choice; the caller writes it (`onConfirm`) and reports a failure
 * back through `error`, so the choice survives and "Try again" is one tap.
 */

import { useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';

import { Button, Sheet, Text, useTheme } from '@waves/ui';

import { fill, useStrings } from '@/i18n';
import { togglePerson, type PersonChoice } from '@/lib/assistantInline';
import { PickChip } from './PickChip';

export interface InlinePeopleSheetProps {
  visible: boolean;
  title: string;
  confirmLabel: string;
  groups: readonly { id: string; name: string }[];
  /** The group cannot be changed (the trip, or the expense's own group). */
  lockGroup?: boolean;
  initialGroupId: string;
  peopleOf: (groupId: string) => PersonChoice[];
  /** Pre-selected people for the first group; 'all' selects everyone. */
  initialSelected: readonly string[] | 'all';
  /** How many people other than you must be picked. */
  minOthers: number;
  /** You may be left out (who was there on a bill you paid but missed). */
  selfOptional?: boolean;
  busy: boolean;
  error: string | null;
  onConfirm: (groupId: string, memberIds: string[]) => void;
  onClose: () => void;
}

export function InlinePeopleSheet({
  visible,
  title,
  confirmLabel,
  groups,
  lockGroup = false,
  initialGroupId,
  peopleOf,
  initialSelected,
  minOthers,
  selfOptional = false,
  busy,
  error,
  onConfirm,
  onClose,
}: InlinePeopleSheetProps) {
  const theme = useTheme();
  const { t } = useStrings();
  const s = t.inline;
  const [groupId, setGroupId] = useState(initialGroupId);
  const people = useMemo(() => peopleOf(groupId), [peopleOf, groupId]);
  const [picked, setPicked] = useState<string[]>(() =>
    initialSelected === 'all' ? peopleOf(initialGroupId).map((p) => p.id) : [...initialSelected],
  );
  const mine = people.find((p) => p.isViewer)?.id ?? null;
  // You are always in; the others are whoever is picked and still in the group.
  const others = people.filter((p) => !p.isViewer && picked.includes(p.id));
  const meIn = mine !== null && (!selfOptional || picked.includes(mine));
  const enough = others.length >= minOthers && (meIn || others.length > 0);

  const changeGroup = (id: string): void => {
    if (id === groupId) return;
    setGroupId(id);
    setPicked(initialSelected === 'all' ? peopleOf(id).map((p) => p.id) : []);
  };

  return (
    <Sheet visible={visible} onClose={onClose} title={title} closeLabel={t.inline.close}>
      <ScrollView
        style={{ maxHeight: 420 }}
        contentContainerStyle={{ gap: theme.spacing.md }}
        keyboardShouldPersistTaps="handled"
      >
        {!lockGroup && groups.length > 1 ? (
          <View style={{ gap: theme.spacing.xs }}>
            <Text variant="micro" tone="muted">
              {s.groupLabel}
            </Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.xs }}>
              {groups.map((g) => (
                <PickChip
                  key={g.id}
                  label={g.name}
                  selected={g.id === groupId}
                  disabled={busy}
                  onPress={() => changeGroup(g.id)}
                />
              ))}
            </View>
          </View>
        ) : null}
        <View style={{ gap: theme.spacing.xs }}>
          <Text variant="micro" tone="muted">
            {s.peopleLabel}
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.xs }}>
            {people.map((p) => (
              <PickChip
                key={p.id}
                label={p.isViewer ? s.you : p.name}
                selected={p.isViewer ? meIn : picked.includes(p.id)}
                disabled={busy || (p.isViewer && !selfOptional)}
                onPress={() => setPicked((now) => togglePerson(now, p.id, people, !selfOptional))}
              />
            ))}
          </View>
        </View>
      </ScrollView>
      {error ? (
        <Text
          variant="caption"
          style={{ color: theme.color.negative }}
          accessibilityLiveRegion="polite"
        >
          {error}
        </Text>
      ) : !enough ? (
        <Text variant="caption" tone="muted">
          {s.needSomeone}
        </Text>
      ) : (
        <Text variant="caption" tone="muted">
          {fill(s.peopleCount, { count: others.length + (meIn ? 1 : 0) })}
        </Text>
      )}
      <Button
        label={error ? s.retry : confirmLabel}
        fullWidth
        disabled={!enough || busy}
        onPress={() =>
          onConfirm(groupId, [
            ...(selfOptional && meIn && mine ? [mine] : []),
            ...others.map((p) => p.id),
          ])
        }
      />
    </Sheet>
  );
}
