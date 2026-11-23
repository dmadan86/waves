/**
 * Small pieces the household home and its forms share: a selectable chip and
 * the "Add family member" card (a ghost member with a relation, who can claim
 * their profile later).
 */
import { useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, TextInput, View } from 'react-native';

import { Button, Card, iconSize, Row, Text, useTheme } from '@waves/ui';

import { useAddGhostMember } from '@/data/hooks';
import { useStrings } from '@/i18n';
import { friendlyError } from '@/lib/errors';

export function Chip({
  label,
  selected,
  onPress,
  icon,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  icon?: string;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.spacing.xs,
        minHeight: 40,
        paddingHorizontal: theme.spacing.md,
        borderRadius: theme.radius.pill,
        borderWidth: selected ? 2 : 1,
        borderColor: selected ? theme.color.brand : theme.color.border,
        backgroundColor: selected ? theme.color.brandSoft : theme.color.surface,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      {icon ? (
        <Ionicons
          name={icon as keyof typeof Ionicons.glyphMap}
          size={iconSize.md}
          color={selected ? theme.color.brand : theme.color.textMuted}
        />
      ) : null}
      <Text variant="caption" style={{ fontWeight: selected ? '700' : '500' }} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

const RELATIONS = ['Partner', 'Father', 'Mother', 'Son', 'Daughter', 'Other'] as const;

/** Collapsed to a "+ Add family member" row; opens to a name and a relation chip. */
export function AddFamilyMember({
  groupId,
  onAdded,
}: {
  groupId: string;
  onAdded?: (memberId: string) => void;
}) {
  const theme = useTheme();
  const { t } = useStrings();
  const h = t.hhome;
  const addGhost = useAddGhostMember(groupId);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [relation, setRelation] = useState<(typeof RELATIONS)[number] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const relationLabel = (r: (typeof RELATIONS)[number]): string => h[`rel${r}` as 'relOther'];

  if (!open) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={h.addMember}
        onPress={() => setOpen(true)}
        style={{ minHeight: 44, justifyContent: 'center' }}
      >
        <Row style={{ alignItems: 'center', gap: theme.spacing.sm }}>
          <Ionicons name="person-add-outline" size={iconSize.md} color={theme.color.brand} />
          <Text tone="brand" style={{ fontWeight: '600' }}>
            {h.addMember}
          </Text>
        </Row>
      </Pressable>
    );
  }

  // Blank name falls back to the relation word, so "Father" alone is enough.
  const finalName = name.trim() || (relation ? relationLabel(relation) : '');
  const save = async (): Promise<void> => {
    if (!finalName || addGhost.isPending) return;
    setError(null);
    try {
      const memberId = await addGhost.mutateAsync({ name: finalName });
      setOpen(false);
      setName('');
      setRelation(null);
      onAdded?.(memberId);
    } catch (caught) {
      setError(friendlyError(caught, t.misc.couldNotAddGeneric, 'household.addMember'));
    }
  };

  return (
    <Card style={{ gap: theme.spacing.md }}>
      <Text variant="subheading" accessibilityRole="header">
        {h.addMember}
      </Text>
      <Row style={{ flexWrap: 'wrap', gap: theme.spacing.sm }}>
        {RELATIONS.map((r) => (
          <Chip
            key={r}
            label={relationLabel(r)}
            selected={relation === r}
            onPress={() => setRelation(relation === r ? null : r)}
          />
        ))}
      </Row>
      <TextInput
        value={name}
        onChangeText={setName}
        placeholder={h.memberName}
        placeholderTextColor={theme.color.textFaint}
        accessibilityLabel={h.memberName}
        maxLength={40}
        returnKeyType="done"
        onSubmitEditing={() => void save()}
        style={{
          fontSize: 16,
          color: theme.color.text,
          minHeight: 44,
          borderBottomWidth: 1,
          borderBottomColor: theme.color.border,
        }}
      />
      <Text variant="caption" tone="muted">
        {h.memberHint}
      </Text>
      {error ? (
        <Text variant="caption" tone="negative">
          {error}
        </Text>
      ) : null}
      <View style={{ gap: theme.spacing.xs }}>
        <Button label={h.memberAdd} disabled={!finalName || addGhost.isPending} onPress={save} />
        <Button label={t.common.cancel} variant="ghost" onPress={() => setOpen(false)} />
      </View>
    </Card>
  );
}
