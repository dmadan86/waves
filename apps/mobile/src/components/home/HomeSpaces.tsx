/**
 * Home's "Spaces" grid: Personal first, then one tile per group (most recently
 * used first), then a dashed "New space" tile. Pooled groups (couple, family,
 * home) show what is left or the next bill; the rest show where you stand.
 * A new person with nothing yet sees three starter tiles instead.
 */

import { useRef } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, View } from 'react-native';

import { monthOutlook, personalBudgetProgress, type PersonalBudget } from '@waves/core';
import { iconSize, Row, Text, useTheme } from '@waves/ui';

import { GroupMark } from '@/components/GroupMark';
import { GroupTypeTag, useGroupTypeTag, useGroupTypeTagSpoken } from '@/components/GroupTypeTag';
import { CardTitle } from '@/components/personal/PersonalHomeParts';
import { BALANCE_MASK } from '@/components/home/ScenicBalanceCard';
import { UnreadDot } from '@/components/UnreadDot';
import type { PoolFigure } from '@/data/homeSpaces';
import type { useHomeSummary } from '@/data/hooks';
import { groupLabel, type GroupRow } from '@/data/types';
import { fill, useStrings } from '@/i18n';
import { useCoverTile } from '@/lib/groupCoverColor';
import { capSpaces, plainAmount } from '@/lib/homeToday';
import { measureAnchor } from '@/lib/measureAnchor';
import { router, switchTab } from '@/lib/navigation';
import { TourTarget } from '@/lib/tour';
import type { MenuAnchor } from '@/components/home/NewGroupMenu';

type Tone = 'ink' | 'positive' | 'negative' | 'warning' | 'muted';

interface TileProps {
  avatar: React.ReactNode;
  name: string;
  badge: React.ReactNode;
  number?: string;
  tone?: Tone;
  label?: string;
  /** 0..1 progress bar under the figure (Personal's budget). */
  ratio?: number | null;
  onPress: () => void;
  a11y: string;
}

function Tile({
  avatar,
  name,
  badge,
  number,
  tone = 'ink',
  label,
  ratio,
  onPress,
  a11y,
}: TileProps) {
  const theme = useTheme();
  const ink = {
    ink: theme.color.text,
    positive: theme.color.positive,
    negative: theme.color.negative,
    warning: theme.color.warning,
    muted: theme.color.textMuted,
  }[tone];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={a11y}
      onPress={onPress}
      style={({ pressed }) => ({
        width: '48.5%',
        gap: theme.spacing.xs,
        padding: theme.spacing.md,
        borderRadius: theme.radius.lg,
        borderWidth: 1,
        borderColor: theme.color.border,
        backgroundColor: theme.color.surface,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <Row style={{ alignItems: 'center', gap: theme.spacing.sm }}>
        {avatar}
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <Text numberOfLines={1} style={{ fontWeight: '700' }}>
            {name}
          </Text>
          {badge}
        </View>
      </Row>
      {number !== undefined ? (
        <Text
          numberOfLines={1}
          style={{ fontSize: 18, lineHeight: 24, fontWeight: '800', color: ink }}
        >
          {number}
        </Text>
      ) : null}
      {label ? (
        <Text variant="caption" tone="muted" numberOfLines={1}>
          {label}
        </Text>
      ) : null}
      {ratio != null ? (
        <View
          style={{
            height: 5,
            borderRadius: 3,
            overflow: 'hidden',
            backgroundColor: theme.color.brandSoft,
          }}
        >
          <View
            style={{
              width: `${Math.round(Math.min(1, Math.max(0, ratio)) * 100)}%`,
              height: 5,
              backgroundColor: ratio > 1 ? theme.color.negative : theme.color.brand,
            }}
          />
        </View>
      ) : null}
    </Pressable>
  );
}

function Chip({ children, bg }: { children: React.ReactNode; bg: string }) {
  return (
    <View
      style={{
        width: 36,
        height: 36,
        borderRadius: 18,
        backgroundColor: bg,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {children}
    </View>
  );
}

function GroupTile({
  group,
  summary,
  viewerId,
  pool,
  hidden,
  locale,
  unread,
}: {
  group: GroupRow;
  summary: ReturnType<typeof useHomeSummary>;
  viewerId: string | null;
  pool: PoolFigure | undefined;
  hidden: boolean;
  locale: string;
  unread: boolean;
}) {
  const theme = useTheme();
  const { t } = useStrings();
  const h = t.homeToday;
  const tile = useCoverTile(group.cover_color, theme.color.surfaceMuted);
  const typeTag = useGroupTypeTag(group.type, group.event_template, group.custom_tag);
  const typeSpoken = useGroupTypeTagSpoken(typeTag);
  const currency = group.default_currency ?? 'INR';
  const show = (amount: bigint, cur = currency): string =>
    hidden ? BALANCE_MASK : plainAmount(amount < 0n ? -amount : amount, cur, locale);

  let number: string;
  let tone: Tone = 'ink';
  let label: string;
  if (pool) {
    if (pool.left !== null) {
      number = show(pool.left, pool.currency);
      label = h.leftPool;
    } else if (pool.nextBill) {
      number = show(pool.nextBill.amount, pool.currency);
      tone = 'warning';
      label = fill(h.billDue, {
        date: new Date(`${pool.nextBill.date}T12:00:00`).toLocaleDateString(locale, {
          day: 'numeric',
          month: 'short',
        }),
      });
    } else {
      number = show(pool.spent, pool.currency);
      label = h.spentPool;
    }
  } else {
    const balance = summary.balanceFor(group.id);
    const sign = hidden ? '' : balance > 0n ? '+' : balance < 0n ? '−' : '';
    number = sign + show(balance);
    tone = balance > 0n ? 'positive' : balance < 0n ? 'negative' : 'muted';
    label = balance > 0n ? t.group.rowOwed : balance < 0n ? t.group.rowYouOwe : t.group.rowSettled;
  }
  const name = groupLabel(group, summary.membersFor(group.id), viewerId);
  return (
    <Tile
      avatar={
        <View
          style={{
            width: 36,
            height: 36,
            borderRadius: 18,
            backgroundColor: tile.backgroundColor,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <GroupMark emoji={group.cover_emoji} size={20} color={tile.ink} />
          {unread ? <UnreadDot /> : null}
        </View>
      }
      name={name}
      badge={typeTag ? <GroupTypeTag tag={typeTag} /> : null}
      number={number}
      tone={tone}
      label={label}
      onPress={() => router.push(`/group/${group.id}`)}
      a11y={[name, typeSpoken, `${number} ${label}`].filter(Boolean).join('. ')}
    />
  );
}

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
}) {
  const theme = useTheme();
  const { t } = useStrings();
  const h = t.homeToday;
  const plusRef = useRef<View>(null);
  const tileRef = useRef<View>(null);
  const { shown, more } = capSpaces(groups);

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
  const personalNumber = progress ? personalShow(progress.remaining) : personalShow(spent);
  const personalLabel = progress ? h.leftMonth : h.spentMonth;

  const starter = (
    tint: 'lilac' | 'sky' | 'peach',
    icon: keyof typeof Ionicons.glyphMap,
    name: string,
    sub: string,
    onPress: () => void,
  ) => (
    <Tile
      key={name}
      avatar={
        <Chip bg={theme.tint[tint].bg}>
          <Ionicons name={icon} size={iconSize.md} color={theme.tint[tint].ink} />
        </Chip>
      }
      name={name}
      badge={null}
      label={sub}
      onPress={onPress}
      a11y={`${name}. ${sub}`}
    />
  );

  return (
    <View style={{ gap: theme.spacing.sm }}>
      <CardTitle
        title={h.spaces}
        action={newUser ? undefined : t.allGroups}
        onAction={() => router.navigate('/groups')}
      >
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
      <Row style={{ flexWrap: 'wrap', justifyContent: 'space-between', rowGap: theme.spacing.sm }}>
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
            <Tile
              avatar={
                <Chip bg={theme.color.brandSoft}>
                  <Ionicons name="wallet-outline" size={iconSize.md} color={theme.color.brand} />
                </Chip>
              }
              name={h.personal}
              badge={
                <Text variant="micro" tone="muted" numberOfLines={1}>
                  {h.justMe}
                </Text>
              }
              number={personalNumber}
              tone={progress && progress.remaining < 0n ? 'negative' : 'ink'}
              label={personalLabel}
              ratio={progress ? progress.ratio : null}
              onPress={() => switchTab('/(tabs)/me')}
              a11y={`${h.personal}. ${personalNumber} ${personalLabel}`}
            />
            {shown.map((group) => (
              <GroupTile
                key={group.id}
                group={group}
                summary={summary}
                viewerId={viewerId}
                pool={pool.get(group.id)}
                hidden={hidden}
                locale={locale}
                unread={unreadGroups.has(group.id)}
              />
            ))}
            {more ? (
              <Tile
                avatar={
                  <Chip bg={theme.color.surfaceMuted}>
                    <Ionicons
                      name="grid-outline"
                      size={iconSize.md}
                      color={theme.color.textMuted}
                    />
                  </Chip>
                }
                name={h.seeAll}
                badge={null}
                label={String(groups.length)}
                onPress={() => router.navigate('/groups')}
                a11y={`${h.seeAll}, ${t.allGroups}`}
              />
            ) : null}
            <Pressable
              ref={tileRef}
              accessibilityRole="button"
              accessibilityLabel={h.newSpace}
              onPress={() => measureAnchor(tileRef, onNewSpace)}
              style={({ pressed }) => ({
                width: '48.5%',
                minHeight: 92,
                alignItems: 'center',
                justifyContent: 'center',
                gap: 2,
                padding: theme.spacing.md,
                borderRadius: theme.radius.lg,
                borderWidth: 1.5,
                borderStyle: 'dashed',
                borderColor: theme.color.brand,
                opacity: pressed ? 0.6 : 1,
              })}
            >
              <Ionicons name="add-circle-outline" size={iconSize.lg} color={theme.color.brand} />
              <Text style={{ fontWeight: '700', color: theme.color.brand }}>{h.newSpace}</Text>
              <Text variant="micro" tone="muted" align="center" numberOfLines={2}>
                {h.newSpaceHint}
              </Text>
            </Pressable>
          </>
        )}
      </Row>
    </View>
  );
}
