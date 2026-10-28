/**
 * Settle up from the dashboard and Friends. Settling happens inside a group —
 * that is where the debts are — so it first asks which one: the groups where
 * you owe or are owed, each opening that group's settle screen. A person square
 * everywhere is told so rather than shown an empty list.
 *
 * The body of the `/settle-up` screen, under its header.
 */

import { coverTone } from '@/lib/groupCoverColor';
import { useMemo } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { FlatList, Pressable, View } from 'react-native';

import { directionalIcon, iconSize, Text, useTheme } from '@waves/ui';

import { GROUP_TYPE_ICON } from '@/components/DestinationPicker';
import { GroupPhoto } from '@/components/GroupPhoto';
import { SplitMoney } from '@/components/SplitMoney';
import { relativeTime } from '@/data/activity';
import { GroupType } from '@/data/types';
import { plural, useStrings } from '@/i18n';
import { useBottomClearance } from '@/lib/clearance';
import { router } from '@/lib/navigation';
import { settleHref } from '@/lib/groupTab';

export interface SettleCandidate {
  id: string;
  title: string;
  coverEmoji: string | null;
  coverColor?: string | null;
  photoPath: string | null;
  balance: bigint;
  currency: string;
  memberCount: number;
  /** Latest ledger activity in ms; 0 when unknown. */
  lastActivityAt: number;
  type: GroupType;
  /** The signed-in person administers the group ("Your groups"). */
  isAdmin: boolean;
}

/** The disc a group's picture sits in. */
const DISC = 44;

const absBig = (n: bigint): bigint => (n < 0n ? -n : n);

export function SettleGroupList({
  groups,
  narrowed = false,
}: {
  groups: readonly SettleCandidate[];
  /** A search or chip hid every group — say so instead of "square everywhere". */
  narrowed?: boolean;
}) {
  const theme = useTheme();
  const { t, locale } = useStrings();
  const clearance = useBottomClearance();
  const d = t.homeDash;

  // Biggest balance first — the order people want — with ties keeping the
  // given order (stable sort).
  const visible = useMemo(
    () =>
      [...groups].sort((a, b) => {
        const x = absBig(a.balance);
        const y = absBig(b.balance);
        return x === y ? 0 : y > x ? 1 : -1;
      }),
    [groups],
  );

  const tintFor = (type: GroupType) => {
    switch (type) {
      case GroupType.Trip:
        return theme.tint.lilac;
      case GroupType.Home:
      case GroupType.Couple:
        return theme.tint.sky;
      case GroupType.Friends:
        return theme.tint.mint;
      case GroupType.Event:
        return theme.tint.pink;
      default:
        return theme.tint.peach;
    }
  };

  const renderRow = ({ item }: { item: SettleCandidate }) => {
    const owed = item.balance > 0n;
    const members = plural(locale, item.memberCount, t.memberCount);
    const meta =
      item.lastActivityAt > 0
        ? d.settleMeta
            .replace('{members}', members)
            .replace('{when}', relativeTime(locale, new Date(item.lastActivityAt).toISOString()))
        : members;
    const status = owed ? t.youAreOwed : t.youOwe;
    const tint = tintFor(item.type);
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${item.title}, ${meta}, ${status}`}
        onPress={() => router.push(settleHref(item.id))}
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          gap: theme.spacing.md,
          paddingVertical: theme.spacing.md,
          paddingHorizontal: theme.spacing.md,
          borderRadius: theme.radius.lg,
          backgroundColor: theme.color.surface,
          ...theme.shadow.soft,
          opacity: pressed ? 0.7 : 1,
        })}
      >
        <View
          style={{
            width: DISC,
            height: DISC,
            borderRadius: DISC / 2,
            overflow: 'hidden',
            backgroundColor: coverTone(item.coverColor, theme)?.bg ?? tint.bg,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {item.photoPath || item.coverEmoji ? (
            <GroupPhoto
              photoPath={item.photoPath}
              emoji={item.coverEmoji}
              color={item.coverColor}
              bare
              size={DISC}
              background="transparent"
            />
          ) : (
            <Ionicons
              name={GROUP_TYPE_ICON[item.type] ?? 'people-outline'}
              size={iconSize.lg}
              color={tint.ink}
            />
          )}
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text
            numberOfLines={1}
            style={{ fontSize: 16, fontWeight: '700', color: theme.color.text }}
          >
            {item.title}
          </Text>
          <Text numberOfLines={2} variant="caption" tone="muted" style={{ marginTop: 2 }}>
            {meta}
          </Text>
        </View>
        <View style={{ alignItems: 'flex-end', flexShrink: 0 }}>
          <SplitMoney
            amount={item.balance}
            currency={item.currency}
            locale={locale}
            color={owed ? theme.color.positive : theme.color.negative}
            fontSize={16}
          />
          <Text
            variant="caption"
            style={{ color: owed ? theme.color.textMuted : theme.color.negative, marginTop: 2 }}
          >
            {status}
          </Text>
        </View>
        <Ionicons
          name={directionalIcon('chevron-forward')}
          size={iconSize.md}
          color={theme.color.textFaint}
        />
      </Pressable>
    );
  };

  const empty = (
    <Text variant="body" tone="muted" align="center" style={{ paddingVertical: theme.spacing.xl }}>
      {narrowed ? t.noGroupsMatch : d.settleEmpty}
    </Text>
  );

  return (
    <FlatList
      data={visible}
      keyExtractor={(item) => item.id}
      renderItem={renderRow}
      ListEmptyComponent={empty}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
      style={{ flex: 1 }}
      contentContainerStyle={{
        paddingHorizontal: theme.spacing.lg,
        paddingTop: theme.spacing.xs,
        paddingBottom: clearance,
        gap: theme.spacing.sm,
      }}
    />
  );
}
