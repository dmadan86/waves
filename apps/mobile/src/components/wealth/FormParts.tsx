import { Pressable, View } from 'react-native';

import { AmountField, Row, Text, useTheme } from '@waves/ui';

/** A bordered amount box that sits two to a row. */
export function MoneyBox({
  currency,
  value,
  onChange,
}: {
  currency: Parameters<typeof AmountField>[0]['currency'];
  value: bigint;
  onChange: (v: bigint) => void;
}) {
  const theme = useTheme();
  return (
    <View
      style={{
        minHeight: 46,
        justifyContent: 'center',
        paddingHorizontal: theme.spacing.md,
        borderRadius: theme.radius.lg,
        borderWidth: 1,
        borderColor: theme.color.border,
      }}
    >
      <AmountField
        currency={currency}
        value={value}
        onChange={onChange}
        size="compact"
        align="start"
      />
    </View>
  );
}

/** Two equal pills; the chosen one is filled with the brand colour (owner's mockup). */
export function YesNoPills({
  value,
  onChange,
  options,
}: {
  value: 'yes' | 'no';
  onChange: (v: 'yes' | 'no') => void;
  options: readonly { value: 'yes' | 'no'; label: string }[];
}) {
  const theme = useTheme();
  return (
    <Row accessibilityRole="radiogroup" style={{ gap: theme.spacing.sm }}>
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            accessibilityLabel={o.label}
            onPress={() => onChange(o.value)}
            style={{
              flex: 1,
              minHeight: 44,
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: theme.radius.lg,
              backgroundColor: selected ? theme.color.brand : theme.color.surfaceMuted,
            }}
          >
            <Text
              variant="body"
              style={{
                fontWeight: '700',
                color: selected ? theme.color.onBrand : theme.color.textMuted,
              }}
            >
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </Row>
  );
}
