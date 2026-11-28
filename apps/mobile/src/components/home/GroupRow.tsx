import { useEffect, useState } from 'react';
import { Animated, View } from 'react-native';
import { iconSize, Row, Skeleton, Text, useTheme } from '@waves/ui';
import Ionicons from '@expo/vector-icons/Ionicons';
import { GroupMark } from '@/components/GroupMark';
import { GroupTypeTag, useGroupTypeTag, useGroupTypeTagSpoken } from '@/components/GroupTypeTag';
import { LIST_TILE, ListItem } from '@/components/standard/ListItem';
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
  directionTone?: 'negative' | 'muted';
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
  chevron?: boolean;
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
  directionTone = 'muted',
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
  chevron = false,
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
      <ListItem
        accessibilityLabel={`${title}${unread ? `, ${t.groupNewActivity}` : ''}. ${spoken || directionLabel}`}
        onPress={onPress}
        divider={divider}
        strong={unread}
        leading={
          <View
            style={{
              width: LIST_TILE,
              height: LIST_TILE,
              borderRadius: LIST_TILE / 2,
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
        }
        title={title}
        titleAccessory={
          tag ? (
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
          ) : null
        }
        subtitle={
          <Row style={{ alignItems: 'center', gap: theme.spacing.xs }}>
            {typeTag ? <GroupTypeTag tag={typeTag} /> : null}
            <Text variant="caption" tone="muted" numberOfLines={1} style={{ flexShrink: 1 }}>
              {isDemo ? t.demo.rowSubtitle : (pendingLabel ?? memberLabel)}
              {!pendingLabel && draftLabel ? ` · ${draftLabel}` : ''}
            </Text>
          </Row>
        }
        amount={
          pendingBalance ? (
            <Skeleton width={64} height={16} radius={6} animated={!reduceMotion} />
          ) : hidden ? (
            BALANCE_MASK
          ) : (
            (amountText ?? (balance === 0n ? '0' : String(balance)))
          )
        }
        amountTone={
          pendingBalance
            ? undefined
            : tone === 'positive'
              ? 'positive'
              : tone === 'negative'
                ? 'negative'
                : hidden
                  ? 'muted'
                  : undefined
        }
        caption={directionLabel}
        captionTone={directionTone}
        chevron={chevron}
      />
    </Animated.View>
  );
}
