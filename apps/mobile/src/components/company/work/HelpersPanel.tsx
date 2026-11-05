/** "Also working on it" (optional): up to 5 more people besides the responsible one. Shared by the add and edit sheets. */
import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, ScrollView, View } from 'react-native';
import { Button, iconSize, Text, useTheme } from '@waves/ui';

import { PersonAvatar } from '@/components/PersonAvatar';
import { displayName, isGhost, type MemberRow } from '@/data/types';
import { useStrings } from '@/i18n';
import { toggleHelper } from '@/lib/companyWork';

export function HelpersPanel({
  people,
  responsibleId,
  value,
  onChange,
  onDone,
}: {
  people: readonly MemberRow[];
  /** Left out of the list: they are already responsible. */
  responsibleId: string;
  value: readonly string[];
  onChange: (next: string[]) => void;
  onDone: () => void;
}) {
  const theme = useTheme();
  const { t } = useStrings();
  return (
    <View style={{ gap: theme.spacing.md }}>
      <Text variant="title">{t.company.taskHelpers}</Text>
      <Text variant="caption" tone="muted">
        {t.company.taskHelpersMax}
      </Text>
      <ScrollView style={{ maxHeight: 360 }} contentContainerStyle={{ gap: theme.spacing.xs }}>
        {people
          .filter((p) => p.id !== responsibleId)
          .map((person) => {
            const on = value.includes(person.id);
            return (
              <Pressable
                key={person.id}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: on }}
                onPress={() => onChange(toggleHelper(value, person.id, responsibleId))}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: theme.spacing.md,
                  minHeight: 52,
                }}
              >
                <PersonAvatar
                  name={displayName(person)}
                  member={person}
                  ghost={isGhost(person)}
                  size={36}
                />
                <Text style={{ flex: 1 }}>{displayName(person)}</Text>
                <Ionicons
                  name={on ? 'checkmark-circle' : 'ellipse-outline'}
                  size={iconSize.lg}
                  color={on ? theme.color.brand : theme.color.textFaint}
                />
              </Pressable>
            );
          })}
      </ScrollView>
      <Button label={t.common.done} onPress={onDone} />
    </View>
  );
}

/** The one-line summary shown on the form's "Also working on it" button. */
export function helpersSummary(
  people: readonly MemberRow[],
  ids: readonly string[],
  none: string,
): string {
  const names = ids.map((id) => people.find((p) => p.id === id)).filter(Boolean) as MemberRow[];
  return names.length === 0 ? none : names.map((p) => displayName(p)).join(', ');
}
