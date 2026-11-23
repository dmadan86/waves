/**
 * "Split it / Share it": the one question that decides whether a household
 * tracks who owes whom or keeps one pot. Two big cards, one lit.
 */
import { Pressable, View } from 'react-native';
import { Text, useTheme } from '@waves/ui';
import type { LedgerMode } from '@waves/core';

import { useStrings } from '@/i18n';

export function LedgerModeCards({
  value,
  onChange,
  disabled = false,
}: {
  value: LedgerMode;
  onChange: (next: LedgerMode) => void;
  disabled?: boolean;
}) {
  const theme = useTheme();
  const { t } = useStrings();
  const options: { id: LedgerMode; title: string; body: string }[] = [
    { id: 'split', title: t.household.splitTitle, body: t.household.splitBody },
    { id: 'pool', title: t.household.shareTitle, body: t.household.shareBody },
  ];
  return (
    <View accessibilityRole="radiogroup" style={{ gap: theme.spacing.sm }}>
      {options.map((option) => {
        const lit = value === option.id;
        return (
          <Pressable
            key={option.id}
            accessibilityRole="radio"
            accessibilityLabel={`${option.title}. ${option.body}`}
            accessibilityState={{ selected: lit, disabled }}
            disabled={disabled}
            onPress={() => onChange(option.id)}
            style={({ pressed }) => ({
              backgroundColor: lit ? theme.color.brandSoft : theme.color.surface,
              borderRadius: theme.radius.lg,
              borderWidth: 2,
              borderColor: lit ? theme.color.brand : 'transparent',
              paddingHorizontal: theme.spacing.lg,
              paddingVertical: theme.spacing.md,
              gap: 4,
              opacity: disabled ? 0.5 : pressed ? 0.85 : 1,
            })}
          >
            <Text style={{ fontSize: 17, fontWeight: '700', color: theme.color.text }}>
              {option.title}
            </Text>
            <Text style={{ fontSize: 14, lineHeight: 20, color: theme.color.textMuted }}>
              {option.body}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
