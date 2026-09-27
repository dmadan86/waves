/**
 * The dashboard's Activity list: the latest few things that happened across
 * every group, in the same rows the Activity screen draws, with a way through
 * to the whole feed. Read from the local mirror, so it is there offline.
 */

import { useMemo } from 'react';
import { View } from 'react-native';

import { Button, EmptyState, useTheme } from '@waves/ui';

import { ActivityFeedRow, toRowView } from '@/components/activity/ActivityFeedRow';
import { useBlockedUsers } from '@/data/blocked';
import { useRecentActivity } from '@/data/hooks';
import { useStrings } from '@/i18n';
import { router } from '@/lib/navigation';

/** How many events the dashboard shows before handing over to the full feed. */
const PREVIEW = 8;

export function HomeActivity({ myProfileId }: { myProfileId: string | null }) {
  const theme = useTheme();
  const { t, locale } = useStrings();
  const { blockedIds } = useBlockedUsers();
  const feed = useRecentActivity(myProfileId);
  const rtf = useMemo(
    () =>
      typeof Intl.RelativeTimeFormat === 'function'
        ? new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
        : undefined,
    [locale],
  );
  const views = useMemo(
    () =>
      feed.slice(0, PREVIEW).map((entry) => ({
        key: entry.id,
        view: toRowView(entry, { locale, t, myProfileId, blockedIds, rtf }),
      })),
    [feed, locale, t, myProfileId, blockedIds, rtf],
  );

  if (views.length === 0) {
    return <EmptyState title={t.homeDash.noActivity} />;
  }

  return (
    <View style={{ gap: theme.spacing.sm }}>
      <View
        style={{
          backgroundColor: theme.color.surface,
          borderRadius: theme.radius.lg,
          borderWidth: 1,
          borderColor: theme.color.border,
          paddingHorizontal: theme.spacing.md,
        }}
      >
        {views.map(({ key, view }, index) => (
          <View
            key={key}
            style={{ borderTopWidth: index === 0 ? 0 : 1, borderTopColor: theme.color.border }}
          >
            <ActivityFeedRow view={view} locale={locale} t={t} theme={theme} />
          </View>
        ))}
      </View>
      {feed.length > PREVIEW ? (
        <Button
          label={t.homeDash.seeAllActivity}
          variant="ghost"
          onPress={() => router.navigate('/activity')}
        />
      ) : null}
    </View>
  );
}
