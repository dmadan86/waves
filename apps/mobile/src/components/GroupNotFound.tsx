import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, View } from 'react-native';

import { Button, directionalIcon, iconSize, Row, Screen, Text, useTheme } from '@waves/ui';

import { useStrings } from '@/i18n';
import { router, useGoBack } from '@/lib/navigation';
import { useTabBarStandDown } from '@/lib/useTabBarStandDown';

/**
 * The one "this group is not here" screen, shared by the group, its settings,
 * the add-expense form and itemize, so a missing group reads the same wherever
 * it is reached from.
 *
 * Only shown once the group has had its chance to arrive (see `useGroup`).
 *
 * It has a full-width action of its own at the bottom, so the root bar stands
 * down: left up, its raised centre button peeked out from behind this screen's
 * own bar and read as a second, stray call to action.
 */
export function GroupNotFound() {
  const theme = useTheme();
  const { t } = useStrings();
  const goBack = useGoBack('/');
  useTabBarStandDown(true);

  // A group can vanish for ordinary reasons — archived, left, a link that has
  // gone stale — so this is a place to step back from, not a crash. It wears
  // the shape the category's own not-found screens use: an escape at the top,
  // a soft-tinted tile so the state looks like the app rather than a failure,
  // and the one way out as a full-width bar under the thumb rather than a pill
  // adrift in the middle of the page.
  return (
    <Screen edges={['top', 'bottom']}>
      <View style={{ flex: 1, paddingHorizontal: theme.spacing.xl }}>
        <Row style={{ paddingTop: theme.spacing.md }}>
          {/* Never a dead control: a cold open from a notification or a stale
              invite link has no history to pop, so the chevron falls back to
              home rather than silently doing nothing. */}
          <Pressable
            onPress={goBack}
            accessibilityRole="button"
            accessibilityLabel={t.common.back}
            hitSlop={10}
          >
            <Ionicons
              name={directionalIcon('chevron-back')}
              size={iconSize.xxl}
              color={theme.color.text}
            />
          </Pressable>
        </Row>

        <View
          style={{
            flex: 1,
            alignItems: 'center',
            justifyContent: 'center',
            gap: theme.spacing.md,
          }}
        >
          {/* Decorative: the title carries the meaning. A tile the size of a
              group cover, in the soft brand tint the app uses for its empty
              states. */}
          <View
            accessibilityElementsHidden
            importantForAccessibility="no"
            style={{
              width: 96,
              height: 96,
              borderRadius: theme.radius.xl,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: theme.color.buttonPrimary,
              marginBottom: theme.spacing.sm,
            }}
          >
            <Ionicons name="compass-outline" size={48} color={theme.color.onBrand} />
          </View>
          <Text variant="title" align="center" accessibilityRole="header">
            {t.group.notFound}
          </Text>
          <Text variant="body" tone="muted" align="center">
            {t.group.notFoundBody}
          </Text>
        </View>

        {/* The reliable way out. This state is most often reached by following
            a link to a group that has gone, where there is no back stack — so
            the primary action goes home for certain, the way join.tsx does. */}
        <Button
          label={t.misc.goToWaves}
          onPress={() => router.replace('/')}
          fullWidth
          style={{ marginBottom: theme.spacing.xl }}
        />
      </View>
    </Screen>
  );
}
