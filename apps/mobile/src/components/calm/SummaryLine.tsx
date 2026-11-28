/** One line that leads a calm screen: a number plus a verdict, and optionally one thin bar. */

import { View } from 'react-native';

import { Text, useTheme } from '@waves/ui';

export function CalmBar({ ratio, over = false }: { ratio: number; over?: boolean }) {
  const theme = useTheme();
  const pct = Math.max(0, Math.min(1, ratio)) * 100;
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: 100, now: Math.round(pct) }}
      style={{
        height: 6,
        borderRadius: 3,
        overflow: 'hidden',
        backgroundColor: theme.color.border,
      }}
    >
      <View
        style={{
          width: `${pct}%`,
          height: 6,
          borderRadius: 3,
          backgroundColor: over ? theme.color.negative : theme.color.brand,
        }}
      />
    </View>
  );
}

export function SummaryLine({
  text,
  verdict,
  warn = false,
  ratio,
}: {
  text: string;
  /** The quiet tail after the number: "on track". */
  verdict?: string | null;
  /** Amber, for an over-pace verdict. */
  warn?: boolean;
  ratio?: number;
}) {
  const theme = useTheme();
  return (
    <View style={{ gap: theme.spacing.sm }}>
      <Text variant="body" style={{ fontWeight: '600' }}>
        {text}
        {verdict ? (
          <Text
            variant="body"
            style={{ color: warn ? theme.color.warning : theme.color.textMuted, fontWeight: '500' }}
          >
            {` · ${verdict}`}
          </Text>
        ) : null}
      </Text>
      {ratio !== undefined ? <CalmBar ratio={ratio} /> : null}
    </View>
  );
}
