/** Expense or income as a two-way pill: the chosen side filled in the accent
 *  with its arrow, the other quiet on the track. Shared by the Add recurring
 *  form and the recurring list's tabs. */

import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable } from 'react-native';

import { Row, Text, useTheme } from '@waves/ui';
import type { TxnKind } from '@waves/core';

import { SPEC_ACCENT, SPEC_INK } from '@/lib/specPalette';

export function KindPills({
  value,
  onChange,
  expenseLabel,
  incomeLabel,
}: {
  value: TxnKind;
  onChange: (next: TxnKind) => void;
  expenseLabel: string;
  incomeLabel: string;
}) {
  const theme = useTheme();
  const dark = theme.scheme === 'dark';
  const options: { value: TxnKind; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
    { value: 'expense', label: expenseLabel, icon: 'arrow-up' },
    { value: 'income', label: incomeLabel, icon: 'arrow-down' },
  ];
  return (
    <Row
      accessibilityRole="tablist"
      style={{
        padding: 3,
        borderRadius: theme.radius.md,
        backgroundColor: dark ? theme.color.surfaceMuted : '#EEF3FB',
      }}
    >
      {options.map((option) => {
        const active = option.value === value;
        const ink = active ? '#FFFFFF' : dark ? theme.color.text : SPEC_INK;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            accessibilityLabel={option.label}
            onPress={() => onChange(option.value)}
            style={({ pressed }) => ({
              flex: 1,
              height: 34,
              borderRadius: 20,
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: theme.spacing.sm,
              backgroundColor: active ? (dark ? theme.color.brand : SPEC_ACCENT) : 'transparent',
              opacity: pressed ? 0.8 : 1,
            })}
          >
            {/* The arrow tilts the way the money goes: out and up for a spend,
                in and down for money received. */}
            <Ionicons
              name={option.icon}
              size={16}
              color={ink}
              style={{ transform: [{ rotate: '45deg' }] }}
            />
            <Text style={{ fontSize: 15, fontWeight: '600', color: ink }}>{option.label}</Text>
          </Pressable>
        );
      })}
    </Row>
  );
}
