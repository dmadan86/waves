/**
 * The pieces of the employee detail screen an admin opens: the "Amount to pay" card,
 * a selectable pending row, the green ready note, and the three action tiles.
 */

import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, View } from 'react-native';
import Svg, { Circle, Path, Rect } from 'react-native-svg';

import { directionalIcon, iconSize, Text, useTheme } from '@waves/ui';

import { StandardCard } from '@/components/standard';

import { GREEN, GREEN_SOFT } from './dashboard/parts';

type Icon = keyof typeof Ionicons.glyphMap;

/** A receipt with a rupee and a timer badge, in the house violet palette. */
export function ReceiptTimerArt({ size = 96 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 96 96" accessibilityElementsHidden>
      <Rect x="10" y="26" width="34" height="40" rx="8" fill="#E4DEFB" />
      <Rect
        x="26"
        y="10"
        width="46"
        height="62"
        rx="9"
        fill="#F1EDFF"
        stroke="#C9BEF5"
        strokeWidth="2"
      />
      <Circle cx="49" cy="30" r="9" fill="#C9BEF5" />
      <Path
        d="M45 26h8M45 30h8M47 26l6 8"
        stroke="#6C4FD8"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
      <Rect x="36" y="46" width="26" height="4" rx="2" fill="#C9BEF5" />
      <Rect x="36" y="55" width="18" height="4" rx="2" fill="#C9BEF5" />
      <Circle cx="68" cy="66" r="16" fill="#6C4FD8" />
      <Circle cx="68" cy="66" r="9" fill="none" stroke="#FFFFFF" strokeWidth="2.4" />
      <Path d="M68 61v5l3 2" stroke="#FFFFFF" strokeWidth="2.4" strokeLinecap="round" fill="none" />
    </Svg>
  );
}

export function AmountCard({
  label,
  lead,
  fraction,
  caption,
}: {
  label: string;
  lead: string;
  fraction: string;
  caption: string;
}) {
  const theme = useTheme();
  return (
    <StandardCard style={{ flexDirection: 'row', alignItems: 'center', padding: 14 }}>
      <View style={{ flex: 1, gap: 2 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Ionicons name="wallet-outline" size={iconSize.base} color={theme.color.textMuted} />
          <Text variant="caption" tone="muted">
            {label}
          </Text>
        </View>
        <Text
          variant="heading"
          accessibilityLabel={`${label}: ${lead}${fraction}`}
          style={{ fontSize: 30, lineHeight: 36, fontWeight: '800' }}
        >
          {lead}
          <Text
            variant="heading"
            tone="faint"
            style={{ fontSize: 30, lineHeight: 36, fontWeight: '500' }}
          >
            {fraction}
          </Text>
        </Text>
        <Text variant="caption" tone="muted">
          {caption}
        </Text>
      </View>
      <ReceiptTimerArt size={88} />
    </StandardCard>
  );
}

export function DueRow({
  checked,
  icon,
  title,
  date,
  receipt,
  amount,
  onToggle,
  onOpen,
}: {
  checked: boolean;
  icon: Icon;
  title: string;
  date: string;
  receipt?: string;
  amount: string;
  onToggle: () => void;
  onOpen: () => void;
}) {
  const theme = useTheme();
  return (
    <StandardCard style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10 }}>
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked }}
        accessibilityLabel={title}
        hitSlop={8}
        onPress={onToggle}
      >
        <Ionicons
          name={checked ? 'checkbox' : 'square-outline'}
          size={iconSize.lg}
          color={checked ? theme.color.brand : theme.color.textMuted}
        />
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${title}, ${amount}`}
        onPress={onOpen}
        style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 }}
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
          <Ionicons name={icon} size={iconSize.md} color={theme.color.brand} />
        </View>
        <View style={{ flex: 1 }}>
          <Text variant="body" numberOfLines={1} style={{ fontWeight: '700' }}>
            {title}
          </Text>
          <Text variant="caption" tone="muted" numberOfLines={1}>
            {date}
          </Text>
          {receipt ? (
            <Text variant="micro" tone="muted">
              {`${receipt} \u{1F4F7}`}
            </Text>
          ) : null}
        </View>
        <Text variant="body" tone="negative" style={{ fontWeight: '700' }}>
          {amount}
        </Text>
        <Ionicons
          name={directionalIcon('chevron-forward')}
          size={iconSize.sm}
          color={theme.color.textMuted}
        />
      </Pressable>
    </StandardCard>
  );
}

export function ReadyNote({ title, body }: { title: string; body: string }) {
  const theme = useTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        padding: 10,
        borderRadius: theme.radius.lg,
        backgroundColor: theme.scheme === 'dark' ? 'rgba(21,128,61,0.18)' : GREEN_SOFT,
      }}
    >
      <Ionicons name="shield-checkmark" size={iconSize.lg} color={GREEN} />
      <View style={{ flex: 1 }}>
        <Text variant="body" style={{ color: GREEN, fontWeight: '700' }}>
          {title}
        </Text>
        <Text variant="caption" tone="muted">
          {body}
        </Text>
      </View>
    </View>
  );
}

export function ActionTile({
  icon,
  title,
  sub,
  onPress,
}: {
  icon: Icon;
  title: string;
  sub: string;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title}, ${sub}`}
      onPress={onPress}
      style={{ flex: 1 }}
    >
      <StandardCard style={{ alignItems: 'center', gap: 2, padding: 10 }}>
        <View
          style={{
            width: 36,
            height: 36,
            borderRadius: 18,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: theme.color.brandSoft,
          }}
        >
          <Ionicons name={icon} size={iconSize.md} color={theme.color.brand} />
        </View>
        <Text variant="caption" align="center" numberOfLines={1} style={{ fontWeight: '700' }}>
          {title}
        </Text>
        <Text variant="micro" tone="muted" align="center" numberOfLines={1}>
          {sub}
        </Text>
      </StandardCard>
    </Pressable>
  );
}
