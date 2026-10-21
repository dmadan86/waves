import { useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, ScrollView, TextInput, View } from 'react-native';

import { iconSize, Text, useTheme } from '@waves/ui';

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
  card = false,
}: {
  value: string;
  onChange: (next: string) => void;
  onCommit?: (next: string) => void;
  /** The group's type, which picks the suggestions. */
  type: string | null | undefined;
  /** The create screen's look: a tag icon on the label, a filled 44pt pill
   *  input and pill chips, instead of settings' underlined field. */
  filled?: boolean;
  /** Settings' standard-card look: a collapsible "Tag (optional)" title, a tag icon
   *  on a lavender round tile beside a bare input, and lavender suggestion pills. */
  card?: boolean;
}) {
  const theme = useTheme();
  const { t } = useStrings();
  const [focused, setFocused] = useState(false);
  // Open while empty so the suggestions are one tap away; folded once a tag is set.
  const [open, setOpen] = useState(value.trim() === '');
  const suggestions =
    (t.extras.tagSuggestions as Record<string, readonly string[]>)[type ?? 'other'] ??
    t.extras.tagSuggestions.other;

  if (card) {
    // "Tag (optional)": the bracketed part is set muted, in whatever language it comes.
    const match = /^(.*?)\s*([(（].*)$/.exec(t.extras.tagLabel);
    const head = match?.[1] || t.extras.tagLabel;
    const note = match?.[2] ?? '';
    return (
      <View style={{ gap: theme.spacing.md }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t.extras.tagLabel}
          accessibilityState={{ expanded: open }}
          onPress={() => setOpen(!open)}
          style={{ flexDirection: 'row', alignItems: 'center', minHeight: 32 }}
        >
          <Text style={{ flex: 1, fontSize: 17, fontWeight: '700' }}>
            {head}
            {note ? (
              <Text tone="muted" style={{ fontSize: 17, fontWeight: '400' }}>
                {` ${note}`}
              </Text>
            ) : null}
          </Text>
          <Ionicons
            name={open ? 'chevron-up' : 'chevron-down'}
            size={iconSize.lg}
            color={theme.color.textMuted}
          />
        </Pressable>
        {open ? (
          <>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}>
              <View
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 20,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: theme.color.brandSoft,
                }}
              >
                <Ionicons name="pricetag-outline" size={iconSize.md} color={theme.color.brand} />
              </View>
              <TextInput
                value={value}
                onChangeText={onChange}
                onBlur={() => onCommit?.(value)}
                accessibilityLabel={t.extras.tagLabel}
                placeholder={t.extras.tagPlaceholder}
                placeholderTextColor={theme.color.textFaint}
                maxLength={GROUP_TAG_MAX}
                returnKeyType="done"
                autoCorrect={false}
                style={{ flex: 1, fontSize: 16, color: theme.color.text, paddingVertical: 8 }}
              />
            </View>
            {/* One line that scrolls sideways, so the suggestions never take two rows. */}
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={{ gap: theme.spacing.sm }}
            >
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
                      paddingHorizontal: theme.spacing.lg,
                      height: 36,
                      justifyContent: 'center',
                      borderRadius: theme.radius.pill,
                      backgroundColor: theme.color.brandSoft,
                      borderWidth: selected ? 1.5 : 0,
                      borderColor: theme.color.brand,
                      opacity: pressed ? 0.6 : 1,
                    })}
                  >
                    <Text variant="caption" style={{ color: theme.color.brand, fontWeight: '600' }}>
                      {suggestion}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </>
        ) : null}
      </View>
    );
  }

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
