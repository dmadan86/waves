/**
 * The pieces of the Bank messages screen that are not the list itself: the
 * total card, the three pile tabs, a day's heading, and the bar at the foot.
 *
 * Light, on the screen's own background rather than a brand panel: this is a
 * list people read and work down, and the card at the top is a figure about
 * that list, not a banner over it.
 */

import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, View } from 'react-native';

import { SmsKind } from '@waves/core';
import { Gradient, iconSize, MoneyText, Row, Text, useTheme } from '@waves/ui';

/** Counts on a tab or a bar: the number, or "99+" past it. */
export function capped(n: number): string {
  return n > 99 ? '99+' : String(n);
}

/** A phone holding a bank message: the card's picture. Drawn, so it themes. */
function InboxIllustration(): React.JSX.Element {
  const theme = useTheme();
  return (
    <View
      pointerEvents="none"
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      style={{ position: 'absolute', right: 104, bottom: -44, width: 112, height: 150 }}
    >
      <View
        style={{
          position: 'absolute',
          right: 14,
          top: 8,
          width: 72,
          height: 128,
          borderRadius: 20,
          borderWidth: 3,
          borderColor: theme.color.brand,
          backgroundColor: theme.color.surface,
          transform: [{ rotate: '-14deg' }],
          opacity: 0.95,
        }}
      />
      <View
        style={{
          position: 'absolute',
          right: 30,
          top: 46,
          width: 74,
          height: 44,
          borderRadius: 10,
          backgroundColor: theme.color.surface,
          transform: [{ rotate: '-14deg' }],
          flexDirection: 'row',
          alignItems: 'center',
          gap: 6,
          padding: 8,
          ...theme.shadow.lifted,
        }}
      >
        <View
          style={{
            width: 24,
            height: 24,
            borderRadius: 6,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: theme.color.brand,
          }}
        >
          <Ionicons name="business" size={13} color={theme.color.onBrand} />
        </View>
        <View style={{ flex: 1, gap: 4 }}>
          <View style={{ height: 4, borderRadius: 2, backgroundColor: theme.color.brandSoft }} />
          <View
            style={{
              height: 4,
              width: '70%',
              borderRadius: 2,
              backgroundColor: theme.color.brandSoft,
            }}
          />
        </View>
      </View>
    </View>
  );
}

/**
 * The figure for the pile on screen, with "Select all" beside it. While rows
 * are ticked, the figure is what is ticked.
 */
export function SmsTotalCard({
  label,
  amount,
  currency,
  countText,
  uncountedText,
  onUncountedInfo,
  selectLabel,
  onSelect,
  locale,
}: {
  label: string;
  /** Null when the pile has no money figure (the third pile): `countText` shows instead. */
  amount: bigint | null;
  currency: string;
  countText: string;
  uncountedText: string | null;
  onUncountedInfo: () => void;
  selectLabel: string | null;
  onSelect: () => void;
  locale: string;
}): React.JSX.Element {
  const theme = useTheme();
  return (
    <View
      style={{
        overflow: 'hidden',
        borderRadius: theme.radius.xl,
        backgroundColor: theme.color.brandSoft,
        paddingHorizontal: theme.spacing.lg,
        paddingVertical: theme.spacing.md,
        minHeight: 88,
        justifyContent: 'center',
      }}
    >
      <InboxIllustration />
      <View style={{ gap: 4, paddingEnd: 150 }}>
        <Text variant="caption" tone="muted" numberOfLines={1}>
          {label}
        </Text>
        {amount !== null ? (
          <MoneyText
            amount={amount}
            currency={currency}
            locale={locale}
            variant="title"
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.6}
            style={{ fontSize: 26, fontWeight: '800' }}
          />
        ) : (
          <Text style={{ fontSize: 26, fontWeight: '800', color: theme.color.text }}>
            {countText}
          </Text>
        )}
        {uncountedText ? (
          <Pressable
            accessibilityRole="button"
            onPress={onUncountedInfo}
            hitSlop={8}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}
          >
            <Text variant="caption" tone="muted">
              {uncountedText}
            </Text>
            <Ionicons
              name="information-circle-outline"
              size={iconSize.sm}
              color={theme.color.textMuted}
            />
          </Pressable>
        ) : null}
      </View>
      {selectLabel ? (
        <Pressable
          accessibilityRole="button"
          onPress={onSelect}
          style={({ pressed }) => ({
            position: 'absolute',
            right: theme.spacing.md,
            top: '50%',
            marginTop: -18,
            height: 34,
            paddingHorizontal: theme.spacing.lg,
            justifyContent: 'center',
            borderRadius: theme.radius.pill,
            backgroundColor: theme.color.surface,
            opacity: pressed ? 0.8 : 1,
            ...theme.shadow.lifted,
          })}
        >
          <Text style={{ fontSize: 14, fontWeight: '700', color: theme.color.brand }}>
            {selectLabel}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const KIND_ICON: Record<SmsKind, keyof typeof Ionicons.glyphMap> = {
  [SmsKind.Expense]: 'arrow-up',
  [SmsKind.Income]: 'arrow-down',
  [SmsKind.Other]: 'swap-horizontal',
};

/** The three piles as pills: the chosen one filled, each with its count. */
export function SmsKindTabs({
  value,
  onChange,
  tabs,
}: {
  value: SmsKind;
  onChange: (kind: SmsKind) => void;
  tabs: readonly { value: SmsKind; label: string; count: number }[];
}): React.JSX.Element {
  const theme = useTheme();
  return (
    <Row style={{ gap: theme.spacing.sm }} accessibilityRole="tablist">
      {tabs.map((tab) => {
        const on = tab.value === value;
        const ink = on ? theme.color.onBrand : theme.color.text;
        return (
          <Pressable
            key={tab.value}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            accessibilityLabel={`${tab.label}, ${tab.count}`}
            onPress={() => onChange(tab.value)}
            style={({ pressed }) => ({
              flex: 1,
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 4,
              height: 38,
              paddingHorizontal: 8,
              borderRadius: theme.radius.pill,
              backgroundColor: on ? theme.color.brand : theme.color.surface,
              borderWidth: on ? 0 : 1,
              borderColor: theme.color.border,
              opacity: pressed ? 0.85 : 1,
            })}
          >
            <Ionicons
              name={KIND_ICON[tab.value]}
              size={15}
              color={on ? theme.color.onBrand : theme.color.brand}
              style={
                tab.value === SmsKind.Expense ? { transform: [{ rotate: '45deg' }] } : undefined
              }
            />
            <Text
              numberOfLines={1}
              style={{ fontSize: 14, fontWeight: '600', color: ink, flexShrink: 1 }}
            >
              {tab.label}
            </Text>
            {tab.count > 0 ? (
              <View
                style={{
                  paddingHorizontal: on ? 6 : 0,
                  height: 20,
                  minWidth: on ? 20 : 0,
                  borderRadius: 10,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: on ? 'rgba(255,255,255,0.22)' : 'transparent',
                }}
              >
                <Text
                  style={{
                    fontSize: 12,
                    fontWeight: '700',
                    color: on ? theme.color.onBrand : theme.color.textMuted,
                  }}
                >
                  {capped(tab.count)}
                </Text>
              </View>
            ) : null}
          </Pressable>
        );
      })}
    </Row>
  );
}

/** "TODAY ₹22,033.38": a day, and what it adds up to. */
export function SmsDayHeader({
  label,
  total,
  currency,
  locale,
}: {
  label: string;
  total: bigint | null;
  currency: string;
  locale: string;
}): React.JSX.Element {
  const theme = useTheme();
  return (
    <Row
      accessibilityRole="header"
      style={{
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingTop: theme.spacing.sm,
        paddingBottom: theme.spacing.sm,
        paddingHorizontal: 2,
      }}
    >
      <Text
        variant="micro"
        tone="muted"
        style={{ textTransform: 'uppercase', letterSpacing: 0.6, fontWeight: '600' }}
      >
        {label}
      </Text>
      {total !== null ? (
        <MoneyText
          amount={total}
          currency={currency}
          locale={locale}
          variant="caption"
          tone="muted"
        />
      ) : null}
    </Row>
  );
}

/**
 * The bar at the foot, always there while the pile has rows: how many are
 * waiting (or, while ticking, what is ticked and a way to set it aside), and
 * the one action.
 */
export function SmsAddBar({
  title,
  subtitle,
  actionLabel,
  onAction,
  disabled,
  secondaryLabel,
  onSecondary,
  bottom,
}: {
  title: React.ReactNode;
  subtitle: string;
  actionLabel: string;
  onAction: () => void;
  disabled: boolean;
  /** "Set aside", while rows are ticked. */
  secondaryLabel: string | null;
  onSecondary: () => void;
  bottom: number;
}): React.JSX.Element {
  const theme = useTheme();
  return (
    <View
      style={{
        position: 'absolute',
        left: theme.spacing.md,
        right: theme.spacing.md,
        bottom,
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.spacing.sm,
        padding: 6,
        paddingStart: theme.spacing.md,
        borderRadius: theme.radius.xl,
        backgroundColor: theme.color.surface,
        borderWidth: 1,
        borderColor: theme.color.border,
        ...theme.shadow.lifted,
      }}
    >
      <Ionicons name="sparkles" size={iconSize.md} color={theme.color.brand} />
      <View style={{ flex: 1, minWidth: 0 }}>
        {typeof title === 'string' ? (
          <Text
            numberOfLines={1}
            style={{ fontSize: 15, fontWeight: '700', color: theme.color.text }}
          >
            {title}
          </Text>
        ) : (
          title
        )}
        {secondaryLabel ? (
          <Pressable accessibilityRole="button" onPress={onSecondary} hitSlop={8}>
            <Text
              numberOfLines={1}
              style={{ fontSize: 12, fontWeight: '600', color: theme.color.brand }}
            >
              {secondaryLabel}
            </Text>
          </Pressable>
        ) : (
          <Text variant="micro" tone="muted" numberOfLines={1}>
            {subtitle}
          </Text>
        )}
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={onAction}
        style={({ pressed }) => ({ opacity: disabled ? 0.8 : pressed ? 0.85 : 1 })}
      >
        <Gradient
          colors={theme.gradient.brand}
          radius={theme.radius.pill}
          style={{ height: 40, paddingStart: 14, paddingEnd: 10, justifyContent: 'center' }}
        >
          <Row style={{ alignItems: 'center', gap: 6 }}>
            <Text style={{ fontSize: 14, fontWeight: '700', color: theme.color.onBrand }}>
              {actionLabel}
            </Text>
            <Ionicons name="arrow-forward" size={16} color={theme.color.onBrand} />
          </Row>
        </Gradient>
      </Pressable>
    </View>
  );
}
