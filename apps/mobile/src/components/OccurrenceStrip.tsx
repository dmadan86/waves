/**
 * The last few periods of a recurring rule, as a row of marks.
 *
 * A rule's card used to say only when it is next due, which answers "what is
 * coming" and not "has it been arriving" — and for a rent or a salary the second
 * question is the one people actually have. Six marks is enough to see a habit
 * or a gap at a glance, and small enough to sit inside a list row.
 *
 * Colour is never the only signal (a red dot and a green dot are the same dot to
 * a lot of people): each state has its own glyph, and the strip carries a spoken
 * label naming the counts.
 */

import { View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';

import type { Occurrence } from '@waves/core';
import { Row, useTheme } from '@waves/ui';

import { useStrings } from '@/i18n';

const MARK_SIZE = 18;

export function OccurrenceStrip({
  occurrences,
  limit = 6,
}: {
  occurrences: readonly Occurrence[];
  limit?: number;
}) {
  const theme = useTheme();
  const { t } = useStrings();

  // The most recent `limit`, oldest first — the shape a timeline reads in.
  const shown = occurrences.slice(-limit);
  if (shown.length === 0) return null;

  const counts = shown.reduce(
    (acc, o) => ({ ...acc, [o.status]: (acc[o.status] ?? 0) + 1 }),
    {} as Record<string, number>,
  );
  const label = [
    counts.received ? `${counts.received} ${t.personal.received}` : null,
    counts.missed ? `${counts.missed} ${t.personal.missed}` : null,
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <Row
      accessibilityRole="image"
      accessibilityLabel={label || t.personal.expected}
      style={{ gap: theme.spacing.xs }}
    >
      {shown.map((occurrence) => {
        const { icon, color } =
          occurrence.status === 'received'
            ? { icon: 'checkmark-circle' as const, color: theme.color.positive }
            : occurrence.status === 'missed'
              ? { icon: 'alert-circle' as const, color: theme.color.negative }
              : occurrence.status === 'due'
                ? { icon: 'ellipse-outline' as const, color: theme.color.brand }
                : { icon: 'ellipse-outline' as const, color: theme.color.textFaint };
        return (
          <View key={occurrence.periodKey}>
            <Ionicons name={icon} size={MARK_SIZE} color={color} />
          </View>
        );
      })}
    </Row>
  );
}
