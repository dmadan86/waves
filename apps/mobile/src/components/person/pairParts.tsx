/**
 * The pieces the person screen and the Who-pays-whom screen share, so the same
 * group reads the same way on both: its cover, its name, who is in it and when,
 * and the one amount `pairBalances` settled on for it.
 *
 * Nothing here computes money. A row is handed a `PairGroupRow` (the figures
 * from core, plus the group's own facts) and draws it.
 */
import { useState, type ReactNode } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { directionalIcon, iconSize, MoneyText, Row, Sheet, Text, useTheme } from '@waves/ui';

import { FriendsHeroBackground } from '@/components/home/FriendsHeroBackground';
import { GroupPhoto } from '@/components/GroupPhoto';
import { GROUP_TYPE_ICON } from '@/components/DestinationPicker';
import { useHeroStatusBar } from '@/components/ScreenHero';
import type { CurrencyCode } from '@waves/core';
import { fill, plural, useStrings } from '@/i18n';
import { useHeroScene } from '@/lib/heroScenePreference';
import { formatShortDateRange } from '@/lib/tripDateRange';
import type { PairGroupRow } from '@/lib/usePairPerson';

/** How far the page's sheet rides up over the scene, as Friends' balance card does. */
export const HERO_OVERLAP = 28;

/** A subtle dark lift under white text, so it holds over the brighter sky. */
export const HERO_TEXT_SHADOW = {
  textShadowColor: 'rgba(0, 0, 0, 0.35)',
  textShadowOffset: { width: 0, height: 1 },
  textShadowRadius: 3,
} as const;

/**
 * The scene a person page opens on: the same time-of-day photograph Home and
 * Friends wear, with the page's own content laid over it. `children` is the
 * hero's content; the caller follows it with a `PairSheet`.
 */
export function PairHero({ children }: { children: ReactNode }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const scene = useHeroScene();
  useHeroStatusBar('light');
  const [height, setHeight] = useState(insets.top + 150);

  return (
    <View>
      <View
        pointerEvents="none"
        style={{ position: 'absolute', top: 0, left: 0, right: 0, height }}
      >
        <FriendsHeroBackground
          scene={scene}
          width={width}
          height={height}
          horizon={height - HERO_OVERLAP}
          headerBottom={insets.top + 30}
          pageColor={theme.color.bg}
        />
      </View>
      <View
        onLayout={(event) => setHeight(event.nativeEvent.layout.height)}
        style={{
          paddingTop: insets.top + theme.spacing.sm,
          paddingHorizontal: theme.spacing.lg,
          paddingBottom: HERO_OVERLAP + theme.spacing.sm,
          gap: theme.spacing.sm,
        }}
      >
        {children}
      </View>
    </View>
  );
}

/** The rounded page that rides up over the scene's foot. */
export function PairSheet({ children }: { children: ReactNode }) {
  const theme = useTheme();
  return (
    <View
      style={{
        marginTop: -HERO_OVERLAP,
        backgroundColor: theme.color.bg,
        borderTopLeftRadius: theme.radius.xl,
        borderTopRightRadius: theme.radius.xl,
        paddingHorizontal: theme.spacing.lg,
        paddingTop: theme.spacing.lg,
        gap: theme.spacing.md,
      }}
    >
      {children}
    </View>
  );
}

/** A round white control on the scene: back, more. */
export function HeroCircleButton({
  icon,
  label,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={4}
      style={({ pressed }) => [
        {
          width: 40,
          height: 40,
          borderRadius: 20,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: theme.color.surface,
          opacity: pressed ? 0.8 : 1,
        },
        theme.shadow.soft,
      ]}
    >
      <Ionicons name={icon} size={iconSize.lg} color={theme.color.text} />
    </Pressable>
  );
}

/** The shared chevron, flipped for right-to-left. */
export function Chevron() {
  const theme = useTheme();
  return (
    <Ionicons
      name={directionalIcon('chevron-forward')}
      size={iconSize.md}
      color={theme.color.textFaint}
    />
  );
}

/** "3 members · 11–18 Oct" — the line under a group's name. */
export function useGroupSubline(group: PairGroupRow): string {
  const { t, locale } = useStrings();
  const members = plural(locale, group.memberCount, t.memberCount);
  const dates = formatShortDateRange(group.startDate, group.endDate, locale);
  return dates ? `${members} · ${dates}` : members;
}

/**
 * One shared group with what the pair owes in it: cover, name, who and when,
 * the amount (and the "after simplifying" note when that is what the figure is),
 * and a chevron into the group.
 */
export function PairGroupCard({
  group,
  onPress,
  hint,
}: {
  group: PairGroupRow;
  onPress: () => void;
  hint?: string;
}) {
  const theme = useTheme();
  const { t, locale } = useStrings();
  const subline = useGroupSubline(group);
  const [head, ...rest] = group.lines;
  const simplified = group.lines.some((line) => line.basis === 'simplified');

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${group.name}. ${subline}`}
      accessibilityHint={hint}
      onPress={onPress}
      style={({ pressed }) => ({
        opacity: pressed ? 0.75 : 1,
        backgroundColor: theme.color.surface,
        borderRadius: theme.radius.md,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: theme.color.border,
        paddingVertical: theme.spacing.sm,
        paddingHorizontal: theme.spacing.md,
      })}
    >
      <Row style={{ alignItems: 'center', gap: theme.spacing.md }}>
        <GroupPhoto photoPath={group.photoPath} emoji={group.coverEmoji} size={44} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text variant="subheading" numberOfLines={1}>
            {group.name}
          </Text>
          <Text variant="caption" tone="muted" numberOfLines={1}>
            {subline}
          </Text>
        </View>
        {head ? (
          <View style={{ alignItems: 'flex-end', maxWidth: '40%' }}>
            <MoneyText
              amount={head.net}
              currency={head.currency as CurrencyCode}
              locale={locale}
              variant="subheading"
              mode="balance"
              numberOfLines={1}
            />
            {rest.map((line) => (
              <MoneyText
                key={line.currency}
                amount={line.net}
                currency={line.currency as CurrencyCode}
                locale={locale}
                variant="caption"
                mode="balance"
                numberOfLines={1}
              />
            ))}
            {simplified ? (
              <Text variant="micro" tone="muted" numberOfLines={1}>
                {t.person.afterSimplifying}
              </Text>
            ) : null}
          </View>
        ) : null}
        <Chevron />
      </Row>
    </Pressable>
  );
}

/** A group's type glyph and name, as a small pill. */
export function GroupChip({ group }: { group: PairGroupRow }) {
  const theme = useTheme();
  return (
    <Row
      style={{
        alignItems: 'center',
        gap: 4,
        paddingHorizontal: theme.spacing.sm,
        height: 28,
        borderRadius: theme.radius.pill,
        backgroundColor: theme.color.surface,
        maxWidth: 160,
      }}
    >
      <Ionicons
        name={GROUP_TYPE_ICON[group.type] ?? 'people-outline'}
        size={iconSize.sm}
        color={theme.color.brand}
      />
      <Text variant="caption" numberOfLines={1} style={{ flexShrink: 1 }}>
        {group.name}
      </Text>
    </Row>
  );
}

/** A card row that leads somewhere: a tinted glyph, a title, a line under it. */
export function NavRow({
  icon,
  title,
  body,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  body: string;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${body}`}
      onPress={onPress}
      style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
    >
      <Row
        style={{
          alignItems: 'center',
          gap: theme.spacing.md,
          minHeight: 56,
          paddingVertical: theme.spacing.sm,
        }}
      >
        <View
          style={{
            width: 40,
            height: 40,
            borderRadius: 20,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: theme.color.brandSoft,
          }}
        >
          <Ionicons name={icon} size={iconSize.lg} color={theme.color.brand} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text variant="subheading" numberOfLines={1}>
            {title}
          </Text>
          <Text variant="caption" tone="muted" numberOfLines={2}>
            {body}
          </Text>
        </View>
        <Chevron />
      </Row>
    </Pressable>
  );
}

/**
 * Which group, when an action is written against one group's ledger and the
 * pair spans several. Lists the groups with their amounts; a tap picks one.
 */
export function PickGroupSheet({
  visible,
  onClose,
  groups,
  onPick,
  name,
}: {
  visible: boolean;
  onClose: () => void;
  groups: readonly PairGroupRow[];
  onPick: (group: PairGroupRow) => void;
  name: string;
}) {
  const theme = useTheme();
  const { t } = useStrings();
  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      closeLabel={t.common.close}
      title={t.person.pickGroupTitle}
    >
      <View style={{ gap: theme.spacing.sm, paddingBottom: theme.spacing.md }}>
        <Text variant="caption" tone="muted">
          {fill(t.person.pickGroupBody, { name })}
        </Text>
        {groups.map((group) => (
          <PairGroupCard key={group.groupId} group={group} onPress={() => onPick(group)} />
        ))}
      </View>
    </Sheet>
  );
}
