/**
 * One row of the activity feed, shared by the Activity screen and the
 * dashboard's Activity tab so activity reads one way everywhere.
 *
 * A row carries a fully pre-computed `RowView`, not the raw entry: the localized
 * sentence, actor, group label, relative time, tint and parsed amount are all
 * resolved once when the list is built (see `toRowView`), never per render. On a
 * fast fling FlashList recycles a cell onto a new row constantly, so the mount
 * has to be near-free — recomputing all of that per mount is what let a hard
 * fling outrun the recycler into a blank screen.
 */

import { memo } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { type Href } from 'expo-router';
import { Pressable, View } from 'react-native';

import { Badge, iconSize, MoneyText, Row, Text, type useTheme } from '@waves/ui';

import {
  activityHeadline,
  activityTarget,
  activityTimestamp,
  describeActivity,
  parseMoney,
  verbIcon,
  verbTint,
} from '@/data/activity';
import { actorName } from '@/data/types';
import { type useBlockedUsers } from '@/data/blocked';
import { type RecentActivityRow } from '@/data/hooks';
import { type useStrings } from '@/i18n';
import { router } from '@/lib/navigation';

export type RowView = {
  href: Href;
  /** The whole event as one sentence — the spoken (screen-reader) label. */
  label: string;
  /** The visible title, event-first so the feed is skimmable. */
  headline: string;
  who: string | null;
  groupLabel: string | null;
  timestamp: string;
  tintKey: ReturnType<typeof verbTint>;
  icon: ReturnType<typeof verbIcon>;
  money: ReturnType<typeof parseMoney>;
  /** The reader's own stake in this expense, when they are on the bill —
   *  coloured by direction, the way the ledger and Friends show money. */
  stake: RecentActivityRow['stake'];
  archived: boolean;
  unavailable: boolean;
};

export type RowContext = {
  locale: string;
  t: ReturnType<typeof useStrings>['t'];
  myProfileId: string | null;
  blockedIds: ReturnType<typeof useBlockedUsers>['blockedIds'];
  rtf: Intl.RelativeTimeFormat | undefined;
};

// Resolve everything a row shows, once, at list-build time. `describeActivity`
// is called once for the spoken label; the visible title uses the lighter
// `activityHeadline`; `rtf` is the hoisted formatter, never rebuilt per row.
export function toRowView(entry: RecentActivityRow, ctx: RowContext): RowView {
  const g = entry.group;
  return {
    href: activityTarget(entry) as Href,
    label: describeActivity(entry, ctx.myProfileId, ctx.blockedIds, ctx.t.misc.someone),
    headline: activityHeadline(entry),
    // Nobody did an auto-event, so it carries no actor — omit it rather than say
    // "Someone". A blocked or since-left actor still resolves through actorName.
    who: entry.actor
      ? actorName(entry.actor, ctx.myProfileId, ctx.blockedIds, ctx.t.misc.someone)
      : null,
    groupLabel: g
      ? [g.cover_emoji, g.name].filter(Boolean).join(' ').trim() || ctx.t.captures.group
      : null,
    timestamp: activityTimestamp(ctx.locale, entry.created_at, undefined, ctx.rtf),
    tintKey: verbTint(entry.verb),
    icon: verbIcon(entry.verb),
    money: parseMoney(entry.payload),
    stake: entry.stake,
    archived: !!g?.archived_at,
    unavailable: !g,
  };
}

/**
 * One row of the virtualized activity feed — purely presentational over a
 * pre-computed `RowView`, and memoized so a recycled cell that lands on the same
 * row does no work. The render is just JSX assembly (no string-building, no
 * parsing), which is what keeps a hard fling from outrunning the recycler.
 */
export const ActivityFeedRow = memo(function ActivityFeedRow({
  view,
  locale,
  t,
  theme,
}: {
  view: RowView;
  locale: string;
  t: ReturnType<typeof useStrings>['t'];
  theme: ReturnType<typeof useTheme>;
}) {
  // A soft rounded-square tile whose tint leans with the verb — the same row the
  // group's Activity tab and the Expenses tab use, so activity reads one way
  // everywhere. No timeline rail; the day headings above do the sectioning,
  // hairlines do the between-row separation.
  const tint = theme.tint[view.tintKey];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={view.label}
      onPress={() => router.push(view.href)}
      style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
    >
      <Row
        style={{
          gap: theme.spacing.md,
          alignItems: 'center',
          paddingVertical: theme.spacing.sm,
        }}
      >
        <View
          style={{
            width: 40,
            height: 40,
            borderRadius: theme.radius.md,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: tint.bg,
          }}
        >
          <Ionicons name={view.icon} size={iconSize.lg} color={tint.ink} />
        </View>
        <View style={{ flex: 1 }}>
          <Text variant="body" numberOfLines={2}>
            {view.headline}
          </Text>
          {/* Who · which group · when. The actor sits here now, not in the title;
              the group is named because this is a cross-group feed. An archived
              group, or one no longer on this device (left or deleted), gets a
              badge so it is recognisable without opening it. */}
          <Row
            style={{
              gap: theme.spacing.sm,
              alignItems: 'center',
              marginTop: 2,
              flexWrap: 'wrap',
            }}
          >
            {view.who ? (
              <Text variant="caption" tone="muted">
                {view.who}
              </Text>
            ) : null}
            {view.groupLabel ? (
              <Text variant="caption" tone="muted" numberOfLines={1} style={{ flexShrink: 1 }}>
                {`${view.who ? '· ' : ''}${view.groupLabel}`}
              </Text>
            ) : null}
            <Text variant="caption" tone="muted">
              {`${view.who || view.groupLabel ? '· ' : ''}${view.timestamp}`}
            </Text>
            {view.archived ? (
              <Badge label={t.misc.archivedGroup} tone="neutral" />
            ) : view.unavailable ? (
              <Badge label={t.misc.unavailableGroup} tone="neutral" />
            ) : null}
          </Row>
        </View>
        {/* An expense the reader is on shows THEIR side of it — what they lent
            or borrowed — coloured by direction, exactly as the group ledger's
            expense rows and the Friends balances do. That is the figure that
            answers "what did this do to me"; the bill's total answers nobody's
            question and printed in neutral ink it read as disabled.

            Everything else keeps the neutral total: a bill between other people,
            and a settlement (money moves one way and the balance the other, so
            either sign misreads the other). `payload` is an untyped JSON blob,
            so a bad amount must render as no amount, not as a crashed tab. */}
        {view.stake ? (
          <MoneyText
            amount={view.stake.amount}
            currency={view.stake.currency}
            locale={locale}
            variant="subheading"
            mode="balance"
          />
        ) : view.money ? (
          <MoneyText
            amount={view.money.amount}
            currency={view.money.currency}
            locale={locale}
            variant="subheading"
          />
        ) : null}
      </Row>
    </Pressable>
  );
});
