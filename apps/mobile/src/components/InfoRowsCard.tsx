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

const DISC = 36;
const DOTS = 3;

/**
 * `connected` joins the discs with a dotted vertical line and top-aligns each
 * row (for multi-line bodies, e.g. the voice consent steps).
 */
export function InfoRowsCard({
  rows,
  connected = false,
}: {
  readonly rows: readonly InfoRow[];
  readonly connected?: boolean;
}) {
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
      {rows.map((row, index) => {
        const tint = theme.tint[row.tint];
        return (
          <View
            key={row.title}
            accessible
            accessibilityLabel={`${row.title}. ${row.body}`}
            style={{
              flexDirection: 'row',
              alignItems: connected ? 'flex-start' : 'center',
              gap: theme.spacing.md,
            }}
          >
            <View
              style={{
                width: DISC,
                height: DISC,
                borderRadius: theme.radius.pill,
                backgroundColor: tint.bg,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Ionicons name={row.icon} size={iconSize.lg} color={tint.ink} />
              {connected && index < rows.length - 1 ? (
                <View
                  pointerEvents="none"
                  style={{
                    position: 'absolute',
                    top: DISC + 2,
                    left: DISC / 2 - 1.5,
                    width: 3,
                    height: theme.spacing.md + 8,
                    justifyContent: 'space-between',
                  }}
                >
                  {Array.from({ length: DOTS }, (_, d) => (
                    <View
                      key={d}
                      style={{
                        width: 3,
                        height: 3,
                        borderRadius: 1.5,
                        backgroundColor: tint.inkMuted,
                        opacity: 0.45,
                      }}
                    />
                  ))}
                </View>
              ) : null}
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
