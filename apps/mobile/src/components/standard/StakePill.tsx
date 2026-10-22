/**
 * The standard "Lent" / "Borrowed" pill, and the colour of the stake it sits
 * under. Every expense-row-like place (a group's expense row, the timeline)
 * shows your stake as a bold amount in this colour plus this pill, never as the
 * long "you lent ₹X" sentence; that stays in the accessibility label only.
 */

import { View } from 'react-native';

import { Text, useTheme, type Theme } from '@waves/ui';

import { expenseCaption, type CaptionKind, type CaptionStrings } from '@/lib/expenseCaption';

/** Blue when you lent, the negative red when you borrowed, muted when even. */
export function stakeColorFor(stake: bigint | null, theme: Theme): string {
  if (stake === null || stake === 0n) return theme.color.textMuted;
  if (stake > 0n) return theme.scheme === 'dark' ? '#7AA2FF' : '#2563EB';
  return theme.color.negative;
}

export function StakePill({
  label,
  kind,
  color,
}: {
  label: string;
  kind: CaptionKind;
  color: string;
}) {
  const theme = useTheme();
  return (
    <View
      style={{
        flexShrink: 1,
        minWidth: 0,
        paddingHorizontal: 6,
        paddingVertical: 2,
        borderRadius: 999,
        backgroundColor: kind === 'neutral' ? theme.color.border : `${color}1F`,
      }}
    >
      <Text
        numberOfLines={1}
        style={{
          fontSize: 11,
          lineHeight: 14,
          fontWeight: '600',
          color: kind === 'neutral' ? theme.color.textMuted : color,
        }}
      >
        {label}
      </Text>
    </View>
  );
}

/** The pill for a plain stake (positive lent, negative borrowed). */
export function StakeCaptionPill({ stake, strings }: { stake: bigint; strings: CaptionStrings }) {
  const theme = useTheme();
  const caption = expenseCaption(stake, strings);
  return (
    <StakePill label={caption.label} kind={caption.kind} color={stakeColorFor(stake, theme)} />
  );
}
