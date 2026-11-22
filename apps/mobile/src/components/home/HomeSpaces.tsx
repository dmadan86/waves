/**
 * Home's "Spaces" grid: Personal first, then one tile per group (most recently
 * used first), then a dashed "New space" tile. Pooled groups (couple, family,
 * home) show what is left or the next bill; the rest show where you stand.
 * A new person with nothing yet sees three starter tiles instead.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, View } from 'react-native';

import { monthOutlook, personalBudgetProgress, type PersonalBudget } from '@waves/core';
import { iconSize, useTheme } from '@waves/ui';

import { GroupRow as SpaceRow } from '@/components/home/GroupRow';
import { CardTitle } from '@/components/personal/PersonalHomeParts';
import { BALANCE_MASK } from '@/components/home/ScenicBalanceCard';
import type { PoolFigure } from '@/data/homeSpaces';
import { useCaptures, type useHomeSummary } from '@/data/hooks';
import type { SnapRow } from '@/lib/homeSnapshot';
import { groupLabel, type GroupRow } from '@/data/types';
import { fill, plural, useStrings } from '@/i18n';
import { capSpaces, plainAmount } from '@/lib/homeToday';
import { measureAnchor } from '@/lib/measureAnchor';
import { router, switchTab } from '@/lib/navigation';
import { TourTarget } from '@/lib/tour';
import type { MenuAnchor } from '@/components/home/NewGroupMenu';
import { useImportedGroupId } from '@/lib/importProgress';
import { useVoiceDefaultSpace, useVoiceNewCount } from '@/lib/voiceSpaceStore';

export function SpacesGrid({
  groups,
  summary,
  viewerId,
  pool,
  ledger,
  hidden,
  personalHidden,
  locale,
  newUser,
  unreadGroups,
  onNewSpace,
  onNewGroup,
  onSnapshot,
}: {
  groups: readonly GroupRow[];
  summary: ReturnType<typeof useHomeSummary>;
  viewerId: string | null;
  pool: ReadonlyMap<string, PoolFigure>;
  ledger: {
    txns: Parameters<typeof monthOutlook>[0];
    recurrings: Parameters<typeof monthOutlook>[1];
    budgets: readonly PersonalBudget[];
    currency: string;
    today: string;
  };
  hidden: boolean;
  /** The Personal tab's own eye: shuts the Personal tile's figure too. */
  personalHidden: boolean;
  locale: string;
  newUser: boolean;
  unreadGroups: ReadonlySet<string>;
  /** Opens the create / scan / join menu from the button's own position. */
  onNewSpace: (anchor: MenuAnchor | null) => void;
  /** Straight into the new-group form, optionally for one group type. */
  onNewGroup: (type?: string) => void;
  /** Reports the rows as drawn (unmasked), for Home's stored snapshot. */
  onSnapshot?: (personal: SnapRow, groups: SnapRow[]) => void;
}) {
  const theme = useTheme();
  const { t } = useStrings();
  const h = t.homeToday;
  const plusRef = useRef<View>(null);
  const { shown } = capSpaces(groups);
  const { draftsByGroup, voiceNewCount, env } = useGroupRowEnv();

  const month = ledger.today.slice(0, 7);
  const overall = ledger.budgets.find((b) => b.category === null && b.currency === ledger.currency);
  const progress = overall ? personalBudgetProgress(overall, ledger.txns as never, month) : null;
  const spent = monthOutlook(
    ledger.txns,
    ledger.recurrings,
    month,
    ledger.currency as never,
    ledger.today,
  ).expense;
  const personalShow = (amount: bigint): string =>
    hidden || personalHidden
      ? BALANCE_MASK
      : plainAmount(amount < 0n ? -amount : amount, ledger.currency, locale);
  const personalFigure = progress ? progress.remaining : spent;
  const personalRaw = plainAmount(
    personalFigure < 0n ? -personalFigure : personalFigure,
    ledger.currency,
    locale,
  );
  const personalNumber = progress ? personalShow(progress.remaining) : personalShow(spent);
  const personalLabel = progress ? h.leftMonth : h.spentMonth;

  const rowsJson = onSnapshot
    ? JSON.stringify([
        {
          key: 'personal',
          title: h.personal,
          memberLabel: h.justMe,
          icon: 'wallet-outline',
          amountText: personalRaw,
          directionLabel: personalLabel,
          tone: progress && progress.remaining < 0n ? 'negative' : undefined,
          href: '/(tabs)/me',
        } satisfies SnapRow,
        shown.map((group) => {
          const { tagTone, ...row } = buildGroupRow({
            group,
            summary,
            viewerId,
            figure: pool.get(group.id),
            drafts: draftsByGroup.get(group.id) ?? 0,
            locale,
            t,
            env,
          });
          return row;
        }),
      ])
    : null;
  useEffect(() => {
    if (!rowsJson || newUser) return;
    const [personal, rows] = JSON.parse(rowsJson) as [SnapRow, SnapRow[]];
    onSnapshot?.(personal, rows);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the rows' content
  }, [rowsJson, newUser]);

  const starter = (
    tint: 'lilac' | 'sky' | 'peach',
    icon: keyof typeof Ionicons.glyphMap,
    name: string,
    sub: string,
    onPress: () => void,
  ) => (
    <SpaceRow
      key={name}
      icon={icon}
      iconColor={theme.tint[tint].ink}
      title={name}
      memberLabel={sub}
      amountText=""
      directionLabel=""
      locale={locale}
      divider={false}
      onPress={onPress}
    />
  );

  return (
    <View style={{ gap: theme.spacing.sm }}>
      <CardTitle title={h.spaces} action={h.seeAll} onAction={() => router.navigate('/groups')}>
        <TourTarget id="addGroup">
          <Pressable
            ref={plusRef}
            accessibilityRole="button"
            accessibilityLabel={h.addSpace}
            onPress={() => measureAnchor(plusRef, onNewSpace)}
            hitSlop={8}
            style={({ pressed }) => ({
              width: 28,
              height: 28,
              borderRadius: 14,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: theme.color.brandSoft,
              opacity: pressed ? 0.6 : 1,
            })}
          >
            <Ionicons name="add" size={iconSize.md} color={theme.color.brand} />
          </Pressable>
        </TourTarget>
      </CardTitle>
      <View
        style={{
          borderRadius: theme.radius.lg,
          borderWidth: 1,
          borderColor: theme.color.border,
          backgroundColor: theme.color.surface,
          overflow: 'hidden',
        }}
      >
        {newUser ? (
          <>
            {starter('lilac', 'wallet-outline', h.startMine, h.startMineSub, () =>
              router.push('/personal/setup'),
            )}
            {starter('sky', 'people-outline', h.startSplit, h.startSplitSub, () => onNewGroup())}
            {starter('peach', 'home-outline', h.startHome, h.startHomeSub, () =>
              onNewGroup('couple'),
            )}
          </>
        ) : (
          <>
            <SpaceRow
              title={h.personal}
              memberLabel={h.justMe}
              icon="wallet-outline"
              amountText={personalNumber}
              directionLabel={personalLabel}
              locale={locale}
              hidden={hidden || personalHidden}
              tone={progress && progress.remaining < 0n ? 'negative' : undefined}
              divider={false}
              onPress={() => switchTab('/(tabs)/me')}
            />
            {shown.map((group, index) => (
              <GroupSpaceRow
                key={group.id}
                group={group}
                summary={summary}
                viewerId={viewerId}
                figure={pool.get(group.id)}
                drafts={draftsByGroup.get(group.id) ?? 0}
                locale={locale}
                hidden={hidden}
                divider={index >= 0}
                unread={unreadGroups.has(group.id) || voiceNewCount(group.id) > 0}
                env={env}
              />
            ))}
          </>
        )}
      </View>
    </View>
  );
}

/** The facts about "now" a group row shares across the list. */
export type GroupRowEnv = {
  nowMs: number;
  voiceDefaultId: string | null;
  justAddedId: string | null;
};

/** Drafts waiting per group, and the rest of what a group row reads from outside. */
export function useGroupRowEnv(): {
  draftsByGroup: ReadonlyMap<string, number>;
  voiceNewCount: (groupId: string) => number;
  env: GroupRowEnv;
} {
  const [nowMs] = useState(() => Date.now());
  const captures = useCaptures();
  const justAddedId = useImportedGroupId();
  const voiceNewCount = useVoiceNewCount();
  const { defaultId: voiceDefaultId } = useVoiceDefaultSpace();
  const draftsByGroup = useMemo(() => {
    const counts = new Map<string, number>();
    for (const capture of captures.data) {
      if (capture.target_group_id) {
        counts.set(capture.target_group_id, (counts.get(capture.target_group_id) ?? 0) + 1);
      }
    }
    return counts;
  }, [captures.data]);
  return { draftsByGroup, voiceNewCount, env: { nowMs, voiceDefaultId, justAddedId } };
}

/** One group as Home's Groups list draws it — shared with the All groups screen. */
export function buildGroupRow({
  group,
  summary,
  viewerId,
  figure,
  drafts,
  locale,
  t,
  env: { nowMs, voiceDefaultId },
}: {
  group: GroupRow;
  summary: ReturnType<typeof useHomeSummary>;
  viewerId: string | null;
  figure: PoolFigure | undefined;
  drafts: number;
  locale: string;
  t: ReturnType<typeof useStrings>['t'];
  env: GroupRowEnv;
}): SnapRow & { tagTone: 'warning' | 'brand' } {
  const h = t.homeToday;
  {
    const balance = summary.balanceFor(group.id);
    let amountText: string;
    let directionLabel: string;
    if (figure) {
      if (figure.left !== null) {
        amountText = plainAmount(
          figure.left < 0n ? -figure.left : figure.left,
          figure.currency,
          locale,
        );
        directionLabel = h.leftPool;
      } else if (figure.nextBill) {
        amountText = plainAmount(figure.nextBill.amount, figure.currency, locale);
        directionLabel = fill(h.billDue, {
          date: new Date(`${figure.nextBill.date}T12:00:00`).toLocaleDateString(locale, {
            day: 'numeric',
            month: 'short',
          }),
        });
      } else {
        amountText = plainAmount(
          figure.spent < 0n ? -figure.spent : figure.spent,
          figure.currency,
          locale,
        );
        directionLabel = h.spentPool;
      }
    } else {
      amountText = plainAmount(
        balance < 0n ? -balance : balance,
        group.default_currency ?? 'INR',
        locale,
      );
      directionLabel =
        balance === 0n ? t.group.rowSettled : balance > 0n ? t.group.rowOwed : t.group.rowYouOwe;
    }
    const isNew = nowMs - Date.parse(group.created_at) < 2 * 24 * 60 * 60 * 1000;
    const tag = group.isDemo
      ? t.demo.badge
      : group.id === voiceDefaultId
        ? t.spaces.defaultTag
        : isNew
          ? t.tagNew
          : null;
    return {
      key: group.id,
      title: groupLabel(group, summary.membersFor(group.id), viewerId),
      memberLabel: plural(locale, summary.memberCountFor(group.id), t.memberCount),
      draftLabel: drafts ? plural(locale, drafts, t.draftCount) : null,
      coverEmoji: group.cover_emoji,
      coverColor: group.cover_color,
      groupType: group.type,
      eventTemplate: group.event_template,
      customTag: group.custom_tag,
      balance: balance.toString(),
      currency: group.default_currency ?? 'INR',
      statusLabel: balance === 0n ? t.allSettled : balance > 0n ? t.youAreOwed : t.youOwe,
      directionLabel,
      amountText,
      tone: figure ? 'ink' : balance > 0n ? 'positive' : balance < 0n ? 'negative' : 'muted',
      pendingLabel: summary.hasPending(group.id) ? t.pendingConfirmation : null,
      tag,
      tagTone: group.isDemo ? 'warning' : 'brand',
      isDemo: group.isDemo === true,
    };
  }
}

/** One group row from its view model: live (`GroupSpaceRow`) or from the snapshot. */
export function GroupRowView({
  row,
  locale,
  hidden,
  divider,
  unread = false,
  tagTone = 'brand',
  enter = false,
  pendingBalance = false,
}: {
  row: SnapRow;
  locale: string;
  hidden: boolean;
  divider: boolean;
  unread?: boolean;
  tagTone?: 'warning' | 'brand';
  enter?: boolean;
  pendingBalance?: boolean;
}) {
  return (
    <SpaceRow
      title={row.title}
      memberLabel={row.memberLabel}
      draftLabel={row.draftLabel}
      coverEmoji={row.coverEmoji}
      coverColor={row.coverColor}
      groupType={row.groupType}
      eventTemplate={row.eventTemplate}
      customTag={row.customTag}
      balance={row.balance === undefined ? undefined : BigInt(row.balance)}
      currency={row.currency}
      locale={locale}
      statusLabel={row.statusLabel}
      directionLabel={row.directionLabel}
      amountText={row.amountText}
      tone={row.tone}
      icon={row.icon as never}
      pendingLabel={row.pendingLabel}
      tag={row.tag}
      tagTone={tagTone}
      isDemo={row.isDemo}
      divider={divider}
      hidden={hidden}
      pendingBalance={pendingBalance}
      enter={enter}
      unread={unread}
      onPress={() => router.push((row.href ?? `/group/${row.key}`) as never)}
    />
  );
}

/** One group as Home's Groups list draws it — shared with the All groups screen. */
export function GroupSpaceRow({
  group,
  summary,
  viewerId,
  figure,
  drafts,
  locale,
  hidden,
  divider,
  unread,
  env,
}: {
  group: GroupRow;
  summary: ReturnType<typeof useHomeSummary>;
  viewerId: string | null;
  figure: PoolFigure | undefined;
  drafts: number;
  locale: string;
  hidden: boolean;
  divider: boolean;
  unread: boolean;
  env: GroupRowEnv;
}) {
  const { t } = useStrings();
  const { tagTone, ...row } = buildGroupRow({
    group,
    summary,
    viewerId,
    figure,
    drafts,
    locale,
    t,
    env,
  });
  return (
    <GroupRowView
      row={row}
      locale={locale}
      hidden={hidden}
      divider={divider}
      unread={unread}
      tagTone={tagTone}
      enter={group.id === env.justAddedId}
      pendingBalance={group.id === env.justAddedId && !summary.hasLedger(group.id)}
    />
  );
}
