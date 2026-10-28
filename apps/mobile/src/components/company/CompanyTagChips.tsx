/**
 * The company entry's tag row: the six most-used tags as chips, "All tags" for the
 * rest, and a "+" that turns into a text field in place (no sheet, no route) so
 * anyone can add a shared tag in two taps plus the name.
 */

import { useState } from 'react';
import { TextInput, View } from 'react-native';

import { Button, Chip, useTheme } from '@waves/ui';

import { useStrings } from '@/i18n';

export const VISIBLE_TAG_CHIPS = 6;

export interface TagChip {
  readonly key: string;
  readonly label: string;
}

export function CompanyTagChips({
  tags,
  value,
  onChange,
  onCreate,
  onMore,
  canAdd,
  showMore,
}: {
  /** Visible tags, best first. */
  tags: readonly TagChip[];
  value: string | null;
  onChange: (key: string) => void;
  /** Creates (or finds) a tag by name and returns its key. */
  onCreate: (label: string) => string | null;
  onMore: () => void;
  canAdd: boolean;
  /** Offer "All tags": more than the chips can show, or an admin who manages them. */
  showMore: boolean;
}) {
  const theme = useTheme();
  const { t } = useStrings();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');

  // The chosen tag always shows, even when it ranks below the sixth.
  const shown = tags.slice(0, VISIBLE_TAG_CHIPS);
  const chosen = tags.find((tag) => tag.key === value);
  if (chosen && !shown.includes(chosen)) shown[shown.length - 1] = chosen;

  const submit = (): void => {
    const label = name.trim();
    if (label) {
      const key = onCreate(label);
      if (key) onChange(key);
    }
    setName('');
    setAdding(false);
  };

  return (
    <View style={{ gap: theme.spacing.sm }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm }}>
        {shown.map((tag) => (
          <Chip
            key={tag.key}
            label={tag.label}
            selected={tag.key === value}
            onPress={() => onChange(tag.key)}
            onCard
            repeatable
          />
        ))}
        {showMore ? <Chip label={t.company.tagAll} onPress={onMore} onCard /> : null}
        {canAdd && !adding ? <Chip label="+" onPress={() => setAdding(true)} onCard /> : null}
      </View>
      {adding ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
          <TextInput
            autoFocus
            value={name}
            onChangeText={setName}
            onSubmitEditing={submit}
            returnKeyType="done"
            placeholder={t.company.tagNamePh}
            placeholderTextColor={theme.color.textMuted}
            maxLength={40}
            accessibilityLabel={t.company.tagNew}
            style={{
              flex: 1,
              color: theme.color.text,
              fontSize: 16,
              paddingVertical: theme.spacing.sm,
              borderBottomWidth: 1,
              borderBottomColor: theme.color.border,
            }}
          />
          <Button label={t.company.tagAdd} onPress={submit} />
          <Chip
            label={t.company.tagsCancel}
            onCard
            onPress={() => {
              setName('');
              setAdding(false);
            }}
          />
        </View>
      ) : null}
    </View>
  );
}
