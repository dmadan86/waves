/**
 * A soft rounded card of short "good to know" rows: a tinted round icon disc,
 * a bold title and a muted one-line subtitle. Used under an empty state to say
 * what the feature is for (e.g. the archived groups shelf).
 */

import Ionicons from '@expo/vector-icons/Ionicons';
import { View } from 'react-native';

import { iconSize, Text, useTheme } from '@waves/ui';
import type { TintName } from '@waves/ui';

export interface InfoRow {
  readonly icon: keyof typeof Ionicons.glyphMap;
  readonly tint: TintName;
  readonly title: string;
  readonly body: string;
}

export function InfoRowsCard({ rows }: { readonly rows: readonly InfoRow[] }) {
  const theme = useTheme();
  return (
    <View
      style={{
        alignSelf: 'stretch',
        backgroundColor: theme.color.surfaceMuted,
        borderRadius: theme.radius.xl,
        paddingVertical: theme.spacing.md,
        paddingHorizontal: theme.spacing.lg,
        gap: theme.spacing.md,
      }}
    >
      {rows.map((row) => {
        const tint = theme.tint[row.tint];
        return (
          <View
            key={row.title}
            accessible
            accessibilityLabel={`${row.title}. ${row.body}`}
            style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}
          >
            <View
              style={{
                width: 36,
                height: 36,
                borderRadius: theme.radius.pill,
                backgroundColor: tint.bg,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Ionicons name={row.icon} size={iconSize.lg} color={tint.ink} />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text variant="subheading">{row.title}</Text>
              <Text variant="caption" tone="muted">
                {row.body}
              </Text>
            </View>
          </View>
        );
      })}
    </View>
  );
}
