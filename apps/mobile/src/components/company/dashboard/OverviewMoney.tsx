/**
 * The owner's money half of the Overview: pending payments and paid this month side by side, then one
 * horizontal card for outstanding advances. Headings wrap, amounts scale down; nothing is truncated.
 * Waves only records money.
 */

import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, View } from 'react-native';

import { directionalIcon, iconSize, Text, useTheme } from '@waves/ui';

import {
  AMBER,
  IconDisc,
  RED,
  Skeleton,
  TintCard,
} from '@/components/company/dashboard/overviewKit';
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
  if (!o.ready || !o.money)
    return (
      <View style={{ gap: 8 }}>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {[0, 1].map((i) => (
            <Skeleton key={i} height={96} flex={1} />
          ))}
        </View>
        <Skeleton height={64} />
      </View>
    );
  const m = o.money;
  const empty = moneyEmpty(m);
  const fmt = (minor: bigint) => compactMoney(minor, o.currency, locale, t.company.ovCrore);
  const payments = `/group/${groupId}/company-payments`;
  return (
    <View style={{ gap: 8 }}>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <MoneyCard
          ink={theme.color.brand}
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
        <MoneyCard
          ink={GREEN}
          label={t.company.ovPaidMonth}
          value={fmt(m.paidMonth)}
          caption={
            empty.paid
              ? t.company.ovNoPaymentsYet
              : m.paidChange
                ? t.company.ovVsLast.replace(
                    '{pct}',
                    `${m.paidChange.dir === 'up' ? '+' : '-'}${m.paidChange.pct}%`,
                  )
                : null
          }
          captionInk={m.paidChange?.dir === 'down' ? RED : m.paidChange ? GREEN : undefined}
          onPress={() => router.push(payments)}
        />
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${t.company.ovAdvances}: ${fmt(m.advances)}, ${
          empty.advances
            ? t.company.ovNoAdvancesOut
            : plural(locale, m.advanceHolders, t.company.employeeCount)
        }`}
        onPress={() => router.push(`/group/${groupId}/company-people`)}
      >
        <TintCard
          ink={AMBER}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 10,
            padding: 10,
            minHeight: 52,
          }}
        >
          <IconDisc ink={AMBER} size={28}>
            <Ionicons name="time-outline" size={iconSize.sm} color={AMBER} />
          </IconDisc>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text variant="micro" style={{ fontSize: 12, lineHeight: 15, color: theme.color.text }}>
              {t.company.ovAdvances}
            </Text>
            <Text variant="micro" style={{ color: theme.color.textMuted }}>
              {empty.advances
                ? t.company.ovNoAdvancesOut
                : plural(locale, m.advanceHolders, t.company.employeeCount)}
            </Text>
          </View>
          <Text
            variant="title"
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.6}
            style={{ fontSize: 19, fontWeight: '800', flexShrink: 1, maxWidth: '45%' }}
          >
            {fmt(m.advances)}
          </Text>
          <Ionicons
            name={directionalIcon('chevron-forward')}
            size={iconSize.sm}
            color={theme.color.textMuted}
          />
        </TintCard>
      </Pressable>
    </View>
  );
}

function MoneyCard({
  ink,
  label,
  value,
  caption,
  captionInk,
  onPress,
}: {
  ink: string;
  label: string;
  value: string;
  /** null hides the line (nothing to compare with). */
  caption: string | null;
  captionInk?: string;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={caption ? `${label}: ${value}, ${caption}` : `${label}: ${value}`}
      onPress={onPress}
      style={{ flex: 1, minWidth: 0 }}
    >
      <TintCard ink={ink} style={{ flex: 1, padding: 12, gap: 4 }}>
        <Text variant="micro" style={{ fontSize: 12, lineHeight: 15, color: theme.color.text }}>
          {label}
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
          <Text
            variant="title"
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.6}
            style={{ fontSize: 20, fontWeight: '800', flexShrink: 1 }}
          >
            {value}
          </Text>
          <Ionicons
            name={directionalIcon('chevron-forward')}
            size={iconSize.sm}
            color={theme.color.textMuted}
          />
        </View>
        {caption ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
            <Text
              variant="micro"
              style={{ flexShrink: 1, color: captionInk ?? theme.color.textMuted }}
            >
              {caption}
            </Text>
          </View>
        ) : null}
      </TintCard>
    </Pressable>
  );
}
