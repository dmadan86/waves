import { useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, TextInput, View } from 'react-native';

import { Text, useTheme } from '@waves/ui';

import { useStrings } from '@/i18n';
import { GROUP_TAG_MAX } from '@/lib/groupTypeTag';

/**
 * "Tag (optional)": one short word of the member's own for organising groups,
 * with a few suggestion chips that follow the group's type. Controlled; the
 * host decides when to save — `onCommit` fires on blur and on a chip tap, with
 * the value that should be saved.
 */
export function GroupTagField({
  value,
  onChange,
  onCommit,
  type,
  filled = false,
}: {
  value: string;
  onChange: (next: string) => void;
  onCommit?: (next: string) => void;
  /** The group's type, which picks the suggestions. */
  type: string | null | undefined;
  /** The create screen's look: a tag icon on the label, a filled 44pt pill
   *  input and pill chips, instead of settings' underlined field. */
  filled?: boolean;
}) {
  const theme = useTheme();
  const { t } = useStrings();
  const [focused, setFocused] = useState(false);
  const suggestions =
    (t.extras.tagSuggestions as Record<string, readonly string[]>)[type ?? 'other'] ??
    t.extras.tagSuggestions.other;

  return (
    <View style={{ gap: theme.spacing.xs }}>
      {filled ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
          <Ionicons name="pricetag-outline" size={20} color={theme.color.textMuted} />
          <Text style={{ fontSize: 15, lineHeight: 20, fontWeight: '600' }} tone="muted">
            {t.extras.tagLabel}
          </Text>
        </View>
      ) : (
        <Text variant="caption" tone="muted">
          {t.extras.tagLabel}
        </Text>
      )}
      <TextInput
        value={value}
        onChangeText={onChange}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          onCommit?.(value);
        }}
        accessibilityLabel={t.extras.tagLabel}
        placeholder={t.extras.tagPlaceholder}
        placeholderTextColor={theme.color.textFaint}
        maxLength={GROUP_TAG_MAX}
        returnKeyType="done"
        autoCorrect={false}
        style={
          filled
            ? {
                fontSize: 15,
                color: theme.color.text,
                height: 44,
                paddingVertical: 0,
                paddingHorizontal: theme.spacing.md,
                borderRadius: 22,
                borderWidth: 1.5,
                borderColor: focused ? theme.color.brand : 'transparent',
                backgroundColor: theme.color.surfaceMuted,
              }
            : {
                fontSize: 16,
                color: theme.color.text,
                paddingVertical: theme.spacing.xs,
                borderBottomWidth: 1.5,
                borderBottomColor: focused ? theme.color.brand : theme.color.border,
              }
        }
      />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.xs }}>
        {suggestions.map((suggestion) => {
          const selected = value.trim() === suggestion;
          return (
            <Pressable
              key={suggestion}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              accessibilityLabel={suggestion}
              onPress={() => {
                const next = selected ? '' : suggestion;
                onChange(next);
                onCommit?.(next);
              }}
              style={({ pressed }) => ({
                paddingHorizontal: theme.spacing.sm,
                paddingVertical: filled ? 6 : 3,
                borderRadius: theme.radius.pill,
                backgroundColor: selected ? theme.color.brandSoft : theme.color.surfaceMuted,
                opacity: pressed ? 0.6 : 1,
              })}
            >
              <Text
                variant="caption"
                style={{
                  color: selected ? theme.color.brand : theme.color.textMuted,
                  fontWeight: selected ? '700' : '500',
                }}
              >
                {suggestion}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
