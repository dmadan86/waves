/**
 * The Home hero's two sides: what to collect and what to pay, by people (the
 * same netting as "Needs you"). Drawn like the earlier hero — round ↑/↓ icons,
 * two halves split by a divider — and each half opens its list. Other
 * currencies show as small chips under the figure, never summed in.
 */

import { Pressable, View } from 'react-native';

import { format, money } from '@waves/core';
import { useTheme } from '@waves/ui';

import { BALANCE_MASK } from '@/components/home/ScenicBalanceCard';

import { BalanceSide } from '@/components/home/BalanceSide';
import { plural, useStrings } from '@/i18n';
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

  const half = (kind: 'owed' | 'owe') => {
    const side = kind === 'owed' ? data.collect : data.pay;
    const label = kind === 'owed' ? d.toCollect : d.toPay;
    const open = side.people > 0 && !loading;
    const detail =
      side.people === 0
        ? d.allSettled
        : plural(locale, side.people, kind === 'owed' ? d.acrossPeople : d.toPeople);
    const chips = data.others
      .map((o) => ({ currency: o.currency, amount: kind === 'owed' ? o.owed : o.owing }))
      .filter((c) => c.amount > 0n);
    return (
      <Pressable
        accessibilityRole={open ? 'button' : undefined}
        accessibilityLabel={`${label} ${hidden ? BALANCE_MASK : whole(side.amount, currency, locale)}, ${detail}`}
        disabled={!open}
        onPress={() => router.push(`/needs?only=${kind}&currency=${currency}`)}
        style={({ pressed }) => ({ flex: 1, opacity: pressed ? 0.7 : 1 })}
      >
        <BalanceSide
          iconDisc
          uniformDecimals
          icon={kind === 'owed' ? 'arrow-up' : 'arrow-down'}
          color={kind === 'owed' ? theme.color.positive : theme.color.negative}
          amount={side.amount}
          label={label}
          detail={detail}
          chips={chips}
          currency={currency}
          locale={locale}
          hidden={hidden}
          loading={loading}
          trailing={kind === 'owe'}
        />
      </Pressable>
    );
  };

  return (
    <View
      style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: theme.spacing.lg }}
    >
      {half('owed')}
      <View style={{ width: 1, alignSelf: 'stretch', backgroundColor: theme.color.border }} />
      {half('owe')}
    </View>
  );
}
