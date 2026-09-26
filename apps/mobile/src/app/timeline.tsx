/**
 * Your timeline: every expense you can see, across every group, as a day-by-day
 * list or as places on a map, with one switch between the two.
 *
 * Reached from an expense ("Timeline" in its facts, "See on my map" on its
 * place), and it opens on that expense: scrolled to it and outlined in the list,
 * centred and selected on the map. The filters (range, group, only mine) and
 * the switch are shared, so turning to the map keeps the same set of bills.
 *
 * Everything is read from the local mirror (`useMyTimeline`), so it works with
 * no network. The decisions are pure and tested in lib/timeline.ts.
 */

import Ionicons from '@expo/vector-icons/Ionicons';
import { useLocalSearchParams } from 'expo-router';

import { directionalIcon, IconButton, iconSize, Row, Screen, Text, useTheme } from '@waves/ui';

import { TimelineBody } from '@/components/timeline/TimelineBody';
import { useStrings } from '@/i18n';
import { router } from '@/lib/navigation';

export default function TimelineScreen() {
  const theme = useTheme();
  const { t } = useStrings();
  const params = useLocalSearchParams<{ focus?: string; view?: string }>();
  const focusId = typeof params.focus === 'string' && params.focus ? params.focus : null;

  return (
    <Screen>
      <Row
        style={{
          paddingHorizontal: theme.spacing.xl,
          paddingTop: theme.spacing.md,
          gap: theme.spacing.sm,
        }}
      >
        <IconButton label={t.common.back} onPress={() => router.back()}>
          <Ionicons
            name={directionalIcon('chevron-back')}
            size={iconSize.lg}
            color={theme.color.text}
          />
        </IconButton>
        <Text variant="heading" style={{ flex: 1 }} numberOfLines={1}>
          {t.timeline.title}
        </Text>
      </Row>

      <TimelineBody focusId={focusId} initialView={params.view === 'map' ? 'map' : 'timeline'} />
    </Screen>
  );
}
