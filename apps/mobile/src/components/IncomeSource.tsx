/**
 * Where money came from — the income counterpart of `CategoryPicker`.
 *
 * Deliberately the same chip, the same size, the same selected state as the
 * spend picker next door: choosing a source is the same gesture as choosing a
 * category, and making it look like a different kind of control would suggest
 * it is a different kind of decision. What differs is only the vocabulary —
 * `INCOME_SOURCES` rather than the spend categories — because filing a salary
 * under "Food & drink" was the whole problem.
 */

import { Pressable, ScrollView, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';

import { INCOME_SOURCES, incomeSource, type IncomeSource } from '@waves/core';
import { iconSize, Text, useTheme } from '@waves/ui';

import { useStrings, type UiStrings } from '@/i18n';

/** The stored id carries an `inc.` prefix so the two vocabularies can share one
 *  column without ever colliding; the string table keys off the bare name. */
function labelKey(id: string): keyof UiStrings['personal']['sources'] {
  return id.replace(/^inc\./, '') as keyof UiStrings['personal']['sources'];
}

export function useSourceLabel(): (id: string | null) => string | null {
  const { t } = useStrings();
  return (id) => {
    if (id === null) return null;
    const source = incomeSource(id);
    // A source we do not know is one the person made themselves: their own
    // words are the best label there is, so show them rather than "Other".
    return source ? t.personal.sources[labelKey(source.id)] : id;
  };
}

export function SourcePicker({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (id: string) => void;
}) {
  const theme = useTheme();
  const { t } = useStrings();

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ gap: theme.spacing.sm, paddingRight: theme.spacing.xl }}
    >
      {INCOME_SOURCES.map((source: IncomeSource) => {
        const selected = source.id === value;
        const label = t.personal.sources[labelKey(source.id)];
        return (
          <Pressable
            key={source.id}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            accessibilityLabel={label}
            onPress={() => onChange(source.id)}
            style={({ pressed }) => ({
              flexDirection: 'row',
              alignItems: 'center',
              gap: theme.spacing.xs,
              minHeight: 44,
              paddingVertical: theme.spacing.sm,
              paddingHorizontal: theme.spacing.md,
              borderRadius: theme.radius.md,
              borderWidth: 1,
              borderColor: selected ? theme.color.brand : theme.color.border,
              backgroundColor: selected ? theme.color.brandSoft : theme.color.surface,
              opacity: pressed ? 0.7 : 1,
            })}
          >
            <Ionicons
              name={source.icon as keyof typeof Ionicons.glyphMap}
              size={iconSize.md}
              color={selected ? theme.color.brand : theme.color.textMuted}
            />
            <Text variant="body" style={{ color: selected ? theme.color.brand : theme.color.text }}>
              {label}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

/** The small round glyph a source wears in a list, tinted like its chip. */
export function SourceGlyph({ id, size = 40 }: { id: string | null; size?: number }) {
  const theme = useTheme();
  const source = incomeSource(id);
  // An unknown id is a source the person made; it still gets a circle, in the
  // neutral tint, so a custom source is not visually second class.
  const tint = source ? theme.tint[source.tint] : theme.tint.mint;
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: tint.bg,
      }}
    >
      <Ionicons
        name={(source?.icon ?? 'cash-outline') as keyof typeof Ionicons.glyphMap}
        size={iconSize.md}
        color={tint.ink}
      />
    </View>
  );
}
