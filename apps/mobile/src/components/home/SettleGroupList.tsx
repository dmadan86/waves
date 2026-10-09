/**
 * Settle up from the dashboard and Friends. Settling happens inside a group —
 * that is where the debts are — so it first asks which one: the groups where
 * you owe or are owed, each opening that group's settle screen. A search field
 * and type chips narrow the list; a sort sheet reorders it. A person square
 * everywhere is told so rather than shown an empty list.
 *
 * The body of the `/settle-up` screen, under its header.
 */

import { useMemo, useState, type ReactNode } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { FlatList, Modal, Pressable, TextInput, View } from 'react-native';

import { ChipRow, directionalIcon, iconSize, MODAL_ORIENTATIONS, Text, useTheme } from '@waves/ui';

import { GroupPhoto } from '@/components/GroupPhoto';
import { SplitMoney } from '@/components/SplitMoney';
import { relativeTime } from '@/data/activity';
import { GroupType } from '@/data/types';
import { plural, useStrings } from '@/i18n';
import { useBottomClearance } from '@/lib/clearance';
import { router } from '@/lib/navigation';
import {
  arrangeSettleCandidates,
  SETTLE_SORTS,
  type SettleChip,
  type SettleSort,
} from '@/lib/settlePicker';

export interface SettleCandidate {
  id: string;
  title: string;
  coverEmoji: string | null;
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
const DISC = 48;
const ROW_HEIGHT = 74;
const CONTROL = 48;

const chipIcon = (name: keyof typeof Ionicons.glyphMap) =>
  function ChipIcon(color: string) {
    return <Ionicons name={name} size={iconSize.sm} color={color} />;
  };

function Separator() {
  return <View style={{ height: 8 }} />;
}

export function SettleGroupList({ groups }: { groups: readonly SettleCandidate[] }) {
  const theme = useTheme();
  const { t, locale } = useStrings();
  const clearance = useBottomClearance();
  const [query, setQuery] = useState('');
  const [chip, setChip] = useState<SettleChip>('all');
  const [sort, setSort] = useState<SettleSort>('balance');
  const [sortOpen, setSortOpen] = useState(false);
  const d = t.homeDash;

  const visible = useMemo(
    () => arrangeSettleCandidates(groups, { query, chip, sort, locale }),
    [groups, query, chip, sort, locale],
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

  const sortLabel = (s: SettleSort) =>
    s === 'balance' ? d.settleSortBalance : s === 'recent' ? d.settleSortRecent : d.settleSortName;

  const chipOptions: readonly {
    value: SettleChip;
    label: string;
    icon?: (c: string) => ReactNode;
  }[] = [
    { value: 'all', label: d.settleChipAll },
    { value: 'yours', label: d.settleChipYours, icon: chipIcon('person-outline') },
    { value: 'trips', label: d.settleChipTrips, icon: chipIcon('paper-plane-outline') },
    { value: 'family', label: d.settleChipFamily, icon: chipIcon('home-outline') },
    { value: 'friends', label: d.settleChipFriends, icon: chipIcon('people-outline') },
  ];

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
        onPress={() => router.push(`/group/${item.id}/settle`)}
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          gap: theme.spacing.md,
          height: ROW_HEIGHT,
          paddingHorizontal: theme.spacing.md,
          borderRadius: theme.radius.lg,
          borderWidth: 1,
          borderColor: theme.color.border,
          backgroundColor: theme.color.surface,
          opacity: pressed ? 0.7 : 1,
        })}
      >
        <View
          style={{
            width: DISC,
            height: DISC,
            borderRadius: DISC / 2,
            overflow: 'hidden',
            backgroundColor: tint.bg,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <GroupPhoto
            photoPath={item.photoPath}
            emoji={item.coverEmoji}
            size={DISC}
            background="transparent"
          />
        </View>
        <View style={{ flex: 1 }}>
          <Text
            numberOfLines={1}
            style={{ fontSize: 16, fontWeight: '700', color: theme.color.text }}
          >
            {item.title}
          </Text>
          <Text numberOfLines={1} variant="caption" tone="muted" style={{ marginTop: 2 }}>
            {meta}
          </Text>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
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
      {groups.length === 0 ? d.settleEmpty : t.captures.assignNoMatch}
    </Text>
  );

  return (
    <View style={{ flex: 1 }}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: theme.spacing.md,
          paddingHorizontal: theme.spacing.xl,
        }}
      >
        <View
          style={{
            flex: 1,
            height: CONTROL,
            flexDirection: 'row',
            alignItems: 'center',
            gap: theme.spacing.sm,
            paddingHorizontal: theme.spacing.md,
            borderRadius: theme.radius.lg,
            backgroundColor: theme.color.surface,
            borderWidth: 1,
            borderColor: theme.color.border,
          }}
        >
          <Ionicons name="search" size={iconSize.md} color={theme.color.textFaint} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder={d.settleSearch}
            placeholderTextColor={theme.color.textFaint}
            accessibilityLabel={d.settleSearch}
            autoCorrect={false}
            returnKeyType="search"
            style={{ flex: 1, fontSize: 15, color: theme.color.text, paddingVertical: 0 }}
          />
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={d.settleSortTitle}
          onPress={() => setSortOpen(true)}
          style={({ pressed }) => ({
            width: CONTROL,
            height: CONTROL,
            borderRadius: theme.radius.lg,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: theme.color.surface,
            borderWidth: 1,
            borderColor: theme.color.border,
            opacity: pressed ? 0.7 : 1,
          })}
        >
          <Ionicons
            name="options-outline"
            size={iconSize.md}
            color={sort === 'balance' ? theme.color.text : theme.color.brand}
          />
        </Pressable>
      </View>
      <View style={{ paddingHorizontal: theme.spacing.xl, paddingTop: theme.spacing.md }}>
        <ChipRow options={chipOptions} value={chip} onChange={setChip} variant="brand" />
      </View>
      <FlatList
        data={visible}
        keyExtractor={(item) => item.id}
        renderItem={renderRow}
        ListEmptyComponent={empty}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        ItemSeparatorComponent={Separator}
        style={{ flex: 1 }}
        contentContainerStyle={{
          paddingHorizontal: theme.spacing.xl,
          paddingTop: theme.spacing.md,
          paddingBottom: clearance,
        }}
      />
      <Modal
        visible={sortOpen}
        transparent
        supportedOrientations={MODAL_ORIENTATIONS}
        animationType="fade"
        onRequestClose={() => setSortOpen(false)}
      >
        <Pressable
          accessibilityLabel={t.common.back}
          onPress={() => setSortOpen(false)}
          style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(8, 12, 28, 0.4)' }}
        >
          <Pressable
            // Swallows taps so only the scrim closes the sheet.
            onPress={() => {}}
            style={{
              backgroundColor: theme.color.surface,
              borderTopStartRadius: theme.radius.xl,
              borderTopEndRadius: theme.radius.xl,
              padding: theme.spacing.xl,
              paddingBottom: clearance,
              gap: theme.spacing.xs,
            }}
          >
            <Text variant="heading" style={{ marginBottom: theme.spacing.sm }}>
              {d.settleSortTitle}
            </Text>
            {SETTLE_SORTS.map((option) => (
              <Pressable
                key={option}
                accessibilityRole="button"
                accessibilityState={{ selected: sort === option }}
                onPress={() => {
                  setSort(option);
                  setSortOpen(false);
                }}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  height: 48,
                }}
              >
                <Text style={{ fontSize: 16, color: theme.color.text }}>{sortLabel(option)}</Text>
                {sort === option ? (
                  <Ionicons name="checkmark" size={iconSize.md} color={theme.color.brand} />
                ) : null}
              </Pressable>
            ))}
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}
