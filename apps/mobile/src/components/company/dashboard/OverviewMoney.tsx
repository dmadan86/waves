/**
 * The owner's money half of the Overview: pending payments, paid this month and outstanding advances
 * as three divided rows in one card. Amounts scale down; nothing is truncated.
 * Waves only records money.
 */

import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, View } from 'react-native';

import { directionalIcon, iconSize, Text, useTheme } from '@waves/ui';

import { RED, Skeleton, TintCard } from '@/components/company/dashboard/overviewKit';
import { GREEN } from '@/components/company/dashboard/parts';
import { useOverview } from '@/data/companyOverview';
import { todayIso } from '@/data/personal';
import { plural, useStrings } from '@/i18n';
import { router } from '@/lib/navigation';
import { compactMoney, moneyEmpty } from '@/lib/overviewMath';

export function MoneyCards({ groupId }: { groupId: string }) {
  const theme = useTheme();
  const { t, locale } = useStrings();
  const o = useOverview(groupId, todayIso());
  if (!o.isOwner) return null;
  if (!o.ready || !o.money) return <Skeleton height={168} />;
  const m = o.money;
  const empty = moneyEmpty(m);
  const fmt = (minor: bigint) => compactMoney(minor, o.currency, locale, t.company.ovCrore);
  const payments = `/group/${groupId}/company-payments`;
  const paidCaption = empty.paid
    ? t.company.ovNoPaymentsYet
    : m.paidChange
      ? t.company.ovVsLast.replace(
          '{pct}',
          `${m.paidChange.dir === 'up' ? '+' : '-'}${m.paidChange.pct}%`,
        )
      : null;
  return (
    <TintCard style={{ padding: 0 }}>
      <MoneyRow
        label={t.company.ovPendingPayments}
        value={fmt(m.owes)}
        caption={
          empty.owes
            ? t.company.ovNothingToPay
            : plural(locale, m.pendingPayments, t.company.ovPaymentsPendingN)
        }
        captionInk={empty.owes ? undefined : theme.color.brand}
        onPress={() => router.push(payments)}
      />
      <MoneyRow
        divided
        label={t.company.ovPaidMonth}
        value={fmt(m.paidMonth)}
        caption={paidCaption}
        captionInk={m.paidChange?.dir === 'down' ? RED : m.paidChange ? GREEN : undefined}
        onPress={() => router.push(payments)}
      />
      <MoneyRow
        divided
        label={t.company.ovAdvances}
        value={fmt(m.advances)}
        caption={
          empty.advances
            ? t.company.ovNoAdvancesOut
            : plural(locale, m.advanceHolders, t.company.employeeCount)
        }
        onPress={() => router.push(`/group/${groupId}/company-people`)}
      />
    </TintCard>
  );
}

function MoneyRow({
  label,
  value,
  caption,
  captionInk,
  divided,
  onPress,
}: {
  label: string;
  value: string;
  /** null hides the line (nothing to compare with). */
  caption: string | null;
  captionInk?: string;
  divided?: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={caption ? `${label}: ${value}, ${caption}` : `${label}: ${value}`}
      onPress={onPress}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        minHeight: 52,
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderTopWidth: divided ? 1 : 0,
        borderTopColor: theme.color.border,
      }}
    >
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text variant="body">{label}</Text>
        {caption ? (
          <Text variant="micro" style={{ color: captionInk ?? theme.color.textMuted }}>
            {caption}
          </Text>
        ) : null}
      </View>
      <Text
        variant="title"
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.6}
        style={{ fontSize: 17, fontWeight: '700', flexShrink: 1, maxWidth: '45%' }}
      >
        {value}
      </Text>
      <Ionicons
        name={directionalIcon('chevron-forward')}
        size={iconSize.sm}
        color={theme.color.textMuted}
      />
    </Pressable>
  );
}
