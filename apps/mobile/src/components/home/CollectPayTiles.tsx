/**
 * The Home hero's two tiles: what to collect and what to pay, by people (the
 * same netting as "Needs you"). Each opens that list; a zero side reads "All
 * settled" and does nothing. Other currencies get one muted line, never a sum.
 */

import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, View } from 'react-native';

import { format, money } from '@waves/core';
import { iconSize, Row, Skeleton, Text, useTheme } from '@waves/ui';

import { BALANCE_MASK } from '@/components/home/ScenicBalanceCard';
import { fill, plural, useStrings } from '@/i18n';
import { router } from '@/lib/navigation';
import type { CollectPay } from '@/lib/homeCollectPay';

const whole = (amount: bigint, currency: string, locale: string): string =>
  format(money(amount, currency as never), { locale, whole: true, trimZeros: true });

export function CollectPayTiles({
  data,
  currency,
  locale,
  hidden,
  loading,
}: {
  data: CollectPay;
  currency: string;
  locale: string;
  hidden: boolean;
  loading: boolean;
}) {
  const theme = useTheme();
  const { t } = useStrings();
  const d = t.homeDash;
  const also = data.others.flatMap((o) => [
    ...(o.owed > 0n ? [fill(d.alsoOwed, { amount: whole(o.owed, o.currency, locale) })] : []),
    ...(o.owing > 0n ? [fill(d.alsoOwe, { amount: whole(o.owing, o.currency, locale) })] : []),
  ]);

  const tile = (kind: 'owed' | 'owe') => {
    const side = kind === 'owed' ? data.collect : data.pay;
    const tint = kind === 'owed' ? theme.color.positive : theme.color.negative;
    const soft = kind === 'owed' ? theme.color.positiveSoft : theme.color.negativeSoft;
    const label = kind === 'owed' ? d.toCollect : d.toPay;
    const open = side.people > 0 && !loading;
    const caption = plural(locale, side.people, kind === 'owed' ? d.acrossPeople : d.toPeople);
    return (
      <Pressable
        accessibilityRole={open ? 'button' : undefined}
        accessibilityLabel={`${label} ${hidden ? '' : whole(side.amount, currency, locale)} ${caption}`}
        disabled={!open}
        onPress={() => router.push(`/needs?only=${kind}&currency=${currency}`)}
        style={({ pressed }) => ({
          flex: 1,
          borderRadius: theme.radius.md,
          backgroundColor: soft,
          paddingHorizontal: theme.spacing.md,
          paddingVertical: theme.spacing.sm,
          gap: 2,
          opacity: pressed ? 0.7 : 1,
        })}
      >
        <Text variant="caption" tone="muted">
          {label}
        </Text>
        {loading ? (
          <Skeleton width={80} height={18} radius={6} />
        ) : side.people === 0 ? (
          <Text variant="caption" tone="muted">
            {d.allSettled}
          </Text>
        ) : (
          <>
            <Text
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.6}
              style={{ color: tint, fontSize: 20, lineHeight: 25, fontWeight: '800' }}
            >
              {hidden ? BALANCE_MASK : whole(side.amount, currency, locale)}
            </Text>
            <Row style={{ alignItems: 'center' }}>
              <Text variant="caption" tone="muted" numberOfLines={1} style={{ flexShrink: 1 }}>
                {caption}
              </Text>
              <Ionicons name="chevron-forward" size={iconSize.xs} color={theme.color.textMuted} />
            </Row>
          </>
        )}
      </Pressable>
    );
  };

  return (
    <View style={{ gap: theme.spacing.xs, paddingHorizontal: theme.spacing.lg }}>
      <Row style={{ gap: theme.spacing.sm }}>
        {tile('owed')}
        {tile('owe')}
      </Row>
      {also.length > 0 && !loading && !hidden ? (
        <Text variant="caption" tone="muted" numberOfLines={1}>
          {also.join(' · ')}
        </Text>
      ) : null}
    </View>
  );
}
