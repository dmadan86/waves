/**
 * Step 3: who in the file is who in the group.
 *
 * Each name is a row with a dropdown. Names the app matched on its own wear a
 * "Matched by name" badge so it is never a silent guess; everyone else waits to
 * be chosen. "Add as new person" is a real answer (a placeholder to invite
 * later), never the default.
 */

import { useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, View } from 'react-native';

import { Avatar, Callout, Card, iconSize, Text, tintForKey, useTheme } from '@waves/ui';

import { ChoiceRow, SheetOverlay } from '@/components/expense/SheetOverlay';
import { useStrings } from '@/i18n';
import { GHOST } from '@/lib/groupImport/people';

export interface MemberChoice {
  id: string;
  /** What to call them on screen ("You" for the viewer). */
  label: string;
}

export function PeopleMapper({
  people,
  mapping,
  matched,
  members,
  merged,
  onMap,
  onRestAsNew,
}: {
  people: readonly string[];
  mapping: Readonly<Record<string, string>>;
  matched: Readonly<Record<string, true>>;
  members: readonly MemberChoice[];
  /** Groups of file names that were mapped to one member. */
  merged: readonly (readonly string[])[];
  onMap: (name: string, target: string) => void;
  onRestAsNew: () => void;
}): React.JSX.Element {
  const theme = useTheme();
  const { t } = useStrings();
  const g = t.groupImport;
  const [picking, setPicking] = useState<string | null>(null);

  const targetLabel = (name: string): string | null => {
    const target = mapping[name];
    if (target === undefined) return null;
    if (target === GHOST) return g.addAsNew;
    return members.find((member) => member.id === target)?.label ?? g.addAsNew;
  };
  const unanswered = people.filter((name) => mapping[name] === undefined);

  return (
    <View style={{ gap: theme.spacing.lg }}>
      <Text variant="body" tone="muted">
        {people.length === 0 ? t.importLedger.problemNoPeople : g.peopleHint}
      </Text>

      {merged.map((names) => (
        <Callout key={names.join('|')} tone="warning">
          {g.mergeWarning.replace('{names}', names.join(' · '))}
        </Callout>
      ))}

      {people.length > 0 ? (
        <Card padded={false}>
          {people.map((name, index) => {
            const label = targetLabel(name);
            return (
              <Pressable
                key={name}
                accessibilityRole="button"
                accessibilityLabel={
                  label
                    ? g.personMapped.replace('{name}', name).replace('{who}', label)
                    : `${name}. ${g.chooseWho}`
                }
                onPress={() => setPicking(name)}
                style={({ pressed }) => ({
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: theme.spacing.md,
                  minHeight: 56,
                  paddingHorizontal: theme.spacing.lg,
                  paddingVertical: theme.spacing.sm,
                  borderTopWidth: index === 0 ? 0 : 1,
                  borderTopColor: theme.color.border,
                  opacity: pressed ? 0.7 : 1,
                })}
              >
                <Avatar name={name} size={36} tint={tintForKey(name)} />
                <View style={{ flex: 1, gap: 2 }}>
                  <Text variant="body" numberOfLines={1} style={{ fontWeight: '600' }}>
                    {name}
                  </Text>
                  {matched[name] ? (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                      <Ionicons name="sparkles" size={iconSize.xs} color={theme.color.brand} />
                      <Text variant="micro" tone="brand">
                        {g.matchedByName}
                      </Text>
                    </View>
                  ) : null}
                </View>
                <Text
                  variant="caption"
                  tone={label ? 'default' : 'brand'}
                  numberOfLines={1}
                  style={{ maxWidth: '44%', fontWeight: '600' }}
                >
                  {label ?? g.chooseWho}
                </Text>
                <Ionicons name="chevron-down" size={iconSize.sm} color={theme.color.textFaint} />
              </Pressable>
            );
          })}
        </Card>
      ) : null}

      {unanswered.length > 0 ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={g.addRestAsNew}
          onPress={onRestAsNew}
          style={({ pressed }) => ({
            flexDirection: 'row',
            alignItems: 'center',
            gap: theme.spacing.sm,
            minHeight: 44,
            opacity: pressed ? 0.6 : 1,
          })}
        >
          <Ionicons name="person-add-outline" size={iconSize.md} color={theme.color.brand} />
          <Text variant="body" tone="brand" style={{ fontWeight: '600' }}>
            {g.addRestAsNew}
          </Text>
        </Pressable>
      ) : null}

      {picking !== null ? (
        <SheetOverlay
          title={g.whoIsName.replace('{name}', picking)}
          onClose={() => setPicking(null)}
        >
          {members.map((member) => (
            <ChoiceRow
              key={member.id}
              leading={<Avatar name={member.label} size={28} tint={tintForKey(member.id)} />}
              label={member.label}
              selected={mapping[picking] === member.id}
              onPress={() => {
                onMap(picking, member.id);
                setPicking(null);
              }}
            />
          ))}
          <ChoiceRow
            leading={
              <View style={{ width: 28, alignItems: 'center' }}>
                <Ionicons name="person-add-outline" size={iconSize.md} color={theme.color.brand} />
              </View>
            }
            label={g.addAsNew}
            selected={mapping[picking] === GHOST}
            onPress={() => {
              onMap(picking, GHOST);
              setPicking(null);
            }}
          />
        </SheetOverlay>
      ) : null}
    </View>
  );
}
