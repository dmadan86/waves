import { useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useSegments } from 'expo-router';
import { Image, ScrollView, View, useWindowDimensions } from 'react-native';

import {
  Button,
  Card,
  iconSize,
  Screen,
  Text,
  useScreenClearance,
  useTabBarClearance,
  useTheme,
} from '@waves/ui';

import { TranslucentBackButton } from '@/components/ContactPickerScene';
import { useStrings } from '@/i18n';
import { router, useGoBack } from '@/lib/navigation';
import { resolveTabBar } from '@/lib/tabBar';
import { useSync } from '@/sync';

const ART = require('../../assets/images/group-not-found.webp') as number;
/** The artwork's own proportions (960 x 610). */
const ART_RATIO = 610 / 960;

/**
 * The one "this group is not here" screen, shared by the group, its settings,
 * the add-expense form and itemize, so a missing group reads the same wherever
 * it is reached from.
 *
 * Only shown once the group has had its chance to arrive (see `useGroup`) — so
 * "Try again" is a real second look: it pulls this group from the server and, if
 * it lands, the screen that rendered this replaces it with the group.
 */
export function GroupNotFound({ groupId }: { groupId: string }) {
  const theme = useTheme();
  const { t } = useStrings();
  const goBack = useGoBack('/');
  const { flush } = useSync();
  const { width } = useWindowDimensions();
  const segments = useSegments() as readonly string[];
  const [retrying, setRetrying] = useState(false);

  // Nothing may sit under the root bar: keep its room where it is on screen, and
  // an ordinary bottom inset where this route hides it (add-expense, itemize).
  const barClearance = useTabBarClearance();
  const insetClearance = useScreenClearance(theme.spacing.xl);
  const bottom = resolveTabBar(segments).hidden ? insetClearance : barClearance;

  const retry = async (): Promise<void> => {
    if (retrying) return;
    setRetrying(true);
    try {
      await flush(groupId ? [groupId] : undefined);
    } catch {
      // A failed pull leaves the same answer on screen; the sync banner owns the why.
    } finally {
      setRetrying(false);
    }
  };

  const artWidth = Math.min(width - theme.spacing.xl * 2, 420);

  return (
    <Screen edges={['top']}>
      <ScrollView
        contentContainerStyle={{
          flexGrow: 1,
          paddingHorizontal: theme.spacing.xl,
          paddingTop: theme.spacing.md,
          paddingBottom: bottom,
          gap: theme.spacing.lg,
        }}
      >
        {/* Never a dead control: a cold open from a notification or a stale
            invite link has no history to pop, so the chevron falls back to
            home rather than silently doing nothing. */}
        <TranslucentBackButton
          dark={theme.scheme === 'light'}
          label={t.common.back}
          onPress={goBack}
        />

        <View style={{ alignItems: 'center', gap: theme.spacing.md }}>
          <Image
            source={ART}
            accessibilityElementsHidden
            importantForAccessibility="no"
            style={{ width: artWidth, height: artWidth * ART_RATIO }}
            resizeMode="contain"
          />
          <Text variant="title" align="center" accessibilityRole="header">
            {t.group.notFound}
          </Text>
          <Text variant="body" tone="muted" align="center">
            {t.group.notFoundBody}
          </Text>
        </View>

        <View style={{ gap: theme.spacing.md }}>
          <Button
            variant="brand"
            size="lg"
            fullWidth
            label={retrying ? t.group.loading : t.group.notFoundRetry}
            disabled={retrying}
            icon={<Ionicons name="refresh" size={iconSize.md} color={theme.color.onBrand} />}
            onPress={() => void retry()}
          />
          <Button
            variant="secondary"
            size="lg"
            fullWidth
            label={t.group.notFoundHome}
            icon={<Ionicons name="home-outline" size={iconSize.md} color={theme.color.text} />}
            onPress={() => router.replace('/')}
          />
        </View>

        <Card style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}>
          <View
            accessibilityElementsHidden
            importantForAccessibility="no"
            style={{
              width: 40,
              height: 40,
              borderRadius: 20,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: theme.color.brandSoft,
            }}
          >
            <Ionicons name="bulb-outline" size={iconSize.lg} color={theme.color.brand} />
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <Text variant="subheading">{t.group.notFoundHelpTitle}</Text>
            <Text variant="caption" tone="muted">
              {t.group.notFoundHelp}
            </Text>
          </View>
        </Card>
      </ScrollView>
    </Screen>
  );
}
