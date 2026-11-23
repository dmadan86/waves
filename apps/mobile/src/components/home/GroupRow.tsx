import { useEffect, useState } from 'react';
import { Animated, Pressable, View } from 'react-native';
import { iconSize, Row, Skeleton, Text, useTheme } from '@waves/ui';
import Ionicons from '@expo/vector-icons/Ionicons';
import { GroupMark } from '@/components/GroupMark';
import { GroupTypeTag, useGroupTypeTag, useGroupTypeTagSpoken } from '@/components/GroupTypeTag';
import { UnreadDot } from '@/components/UnreadDot';
import { BALANCE_MASK } from '@/components/home/ScenicBalanceCard';
import { useCoverTile } from '@/lib/groupCoverColor';
import { useReducedMotion } from '@/lib/reducedMotion';
import { useStrings } from '@/i18n';

type Props = {
  title: string;
  memberLabel: string;
  draftLabel?: string | null;
  coverEmoji?: string | null;
  coverColor?: string | null;
  groupType?: string | null;
  eventTemplate?: string | null;
  customTag?: string | null;
  balance?: bigint;
  currency?: string;
  locale: string;
  statusLabel?: string;
  directionLabel: string;
  pendingLabel?: string | null;
  tag?: string | null;
  tagTone?: 'positive' | 'brand' | 'neutral' | 'warning';
  isDemo?: boolean;
  hidden?: boolean;
  pendingBalance?: boolean;
  divider: boolean;
  enter?: boolean;
  unread?: boolean;
  amountText?: string;
  tone?: string;
  icon?: keyof typeof Ionicons.glyphMap;
  iconColor?: string;
  onPress: () => void;
};

/** Shared Home list row. Keeps the former group row's animation, spoken status, and unread cue. */
export function GroupRow({
  title,
  memberLabel,
  draftLabel = null,
  coverEmoji = null,
  coverColor,
  groupType = null,
  eventTemplate = null,
  customTag = null,
  balance = 0n,
  currency = 'INR',
  locale,
  statusLabel = '',
  directionLabel,
  pendingLabel = null,
  tag = null,
  tagTone = 'brand',
  isDemo = false,
  hidden = false,
  divider,
  enter = false,
  pendingBalance = false,
  unread = false,
  amountText,
  tone,
  icon,
  iconColor,
  onPress,
}: Props) {
  const theme = useTheme();
  const reduceMotion = useReducedMotion();
  const { t } = useStrings();
  const animate = enter && !reduceMotion;
  const anim = useState(() => new Animated.Value(animate ? 0 : 1))[0];
  useEffect(() => {
    if (!animate) return;
    const run = Animated.spring(anim, {
      toValue: 1,
      friction: 8,
      tension: 60,
      useNativeDriver: true,
    });
    run.start();
    return () => run.stop();
  }, [animate, anim]);
  const tile = useCoverTile(coverColor, theme.color.surfaceMuted);
  const typeTag = useGroupTypeTag(groupType, eventTemplate, customTag);
  const spokenType = useGroupTypeTagSpoken(typeTag);
  const spoken =
    pendingLabel ?? [spokenType, memberLabel, draftLabel, statusLabel].filter(Boolean).join(' · ');
  return (
    <Animated.View
      style={{
        opacity: anim,
        transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) }],
      }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${title}${unread ? `, ${t.groupNewActivity}` : ''}. ${spoken || directionLabel}`}
        onPress={onPress}
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          gap: theme.spacing.md,
          paddingVertical: theme.spacing.sm,
          paddingHorizontal: theme.spacing.sm,
          borderTopWidth: divider ? 1 : 0,
          borderTopColor: theme.color.border,
          opacity: pressed ? 0.6 : 1,
        })}
      >
        <View
          style={{
            width: 44,
            height: 44,
            borderRadius: 22,
            backgroundColor: icon ? theme.color.brandSoft : tile.backgroundColor,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {icon ? (
            <Ionicons name={icon} size={iconSize.md} color={iconColor ?? theme.color.brand} />
          ) : (
            <GroupMark emoji={coverEmoji} size={22} color={tile.ink} />
          )}
          {unread ? <UnreadDot /> : null}
        </View>
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <Row style={{ alignItems: 'center', gap: theme.spacing.xs }}>
            <Text
              variant="body"
              numberOfLines={1}
              style={{ flexShrink: 1, fontWeight: unread ? '800' : '600' }}
            >
              {title}
            </Text>
            {tag ? (
              <Text
                variant="micro"
                tone={tagTone === 'positive' ? 'positive' : 'brand'}
                style={{
                  fontWeight: '700',
                  color: tagTone === 'warning' ? theme.color.warning : undefined,
                }}
              >
                {tag}
              </Text>
            ) : null}
          </Row>
          <Row style={{ alignItems: 'center', gap: theme.spacing.xs }}>
            {typeTag ? <GroupTypeTag tag={typeTag} /> : null}
            <Text variant="caption" tone="muted" numberOfLines={1} style={{ flexShrink: 1 }}>
              {isDemo ? t.demo.rowSubtitle : (pendingLabel ?? memberLabel)}
              {!pendingLabel && draftLabel ? ` · ${draftLabel}` : ''}
            </Text>
          </Row>
        </View>
        {pendingBalance ? (
          <View style={{ alignItems: 'flex-end', gap: 2 }}>
            <Skeleton width={64} height={16} radius={6} animated={!reduceMotion} />
            <Text variant="micro" tone="muted" numberOfLines={1}>
              {directionLabel}
            </Text>
          </View>
        ) : (
          <View style={{ alignItems: 'flex-end', gap: 2 }}>
            <Text
              numberOfLines={1}
              tone={
                tone === 'positive'
                  ? 'positive'
                  : tone === 'negative'
                    ? 'negative'
                    : hidden
                      ? 'muted'
                      : undefined
              }
              style={{ fontWeight: '700' }}
            >
              {hidden ? BALANCE_MASK : (amountText ?? (balance === 0n ? '0' : String(balance)))}
            </Text>
            <Text variant="micro" tone="muted" numberOfLines={1}>
              {directionLabel}
            </Text>
          </View>
        )}
      </Pressable>
    </Animated.View>
  );
}
