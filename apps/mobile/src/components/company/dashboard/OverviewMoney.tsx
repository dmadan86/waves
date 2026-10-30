/**
 * The owner's money half of the Overview: three tinted cards (owed, paid this month, advances) and
 * the upcoming payments list. Waves only records money, so every button says "Record".
 */

import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, View } from 'react-native';

import { directionalIcon, iconSize, Text, useTheme } from '@waves/ui';

import {
  AMBER,
  IconDisc,
  Skeleton,
  TintCard,
  withAlpha,
} from '@/components/company/dashboard/overviewKit';
import { GREEN } from '@/components/company/dashboard/parts';
import { PersonAvatar } from '@/components/PersonAvatar';
import { StandardCard } from '@/components/standard';
import { useOverview, type UpcomingRow } from '@/data/companyOverview';
import { todayIso } from '@/data/personal';
import { displayName, isGhost } from '@/data/types';
import { fill, plural, useStrings } from '@/i18n';
import { showDate } from '@/lib/expenseDay';
import { router } from '@/lib/navigation';
import { compactMoney, dueText } from '@/lib/overviewMath';

const TINTS = ['lilac', 'peach', 'sky', 'pink', 'mint', 'coral'] as const;

export function MoneyCards({ groupId }: { groupId: string }) {
  const theme = useTheme();
  const { t, locale } = useStrings();
  const o = useOverview(groupId, todayIso());
  if (!o.isOwner) return null;
  if (!o.ready || !o.money)
    return (
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} height={116} flex={1} />
        ))}
      </View>
    );
  const m = o.money;
  const fmt = (minor: bigint) => compactMoney(minor, o.currency, locale, t.company.ovCrore);
  const payments = `/group/${groupId}/company-payments`;
  return (
    <View style={{ flexDirection: 'row', gap: 8 }}>
      <MoneyCard
        icon="wallet-outline"
        ink={theme.color.brand}
        label={t.company.statOwes}
        value={fmt(m.owes)}
        caption={plural(locale, m.pendingPayments, t.company.ovPaymentsPendingN)}
        onPress={() => router.push(payments)}
      />
      <MoneyCard
        icon="arrow-up"
        ink={GREEN}
        label={t.company.ovPaidMonth}
        value={fmt(m.paidMonth)}
        caption={
          m.lastPaymentOn
            ? fill(t.company.ovLastPayment, { date: showDate(m.lastPaymentOn, locale) })
            : t.company.ovNoPaymentYet
        }
        onPress={() => router.push(payments)}
      />
      <MoneyCard
        icon="time-outline"
        ink={AMBER}
        label={t.company.ovAdvances}
        value={fmt(m.advances)}
        caption={plural(locale, m.advanceHolders, t.company.employeeCount)}
        onPress={() => router.push(`/group/${groupId}/company-people`)}
      />
    </View>
  );
}

export function DuePaymentsCard({ groupId }: { groupId: string }) {
  const theme = useTheme();
  const { t, locale } = useStrings();
  const today = todayIso();
  const o = useOverview(groupId, today);
  if (!o.isOwner || !o.ready || o.upcoming.length === 0) return null;
  const fmt = (minor: bigint) => compactMoney(minor, o.currency, locale, t.company.ovCrore);
  const payments = `/group/${groupId}/company-payments`;
  return (
    <StandardCard style={{ paddingHorizontal: 12, paddingVertical: 12, borderRadius: 22 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text
          variant="title"
          numberOfLines={1}
          style={{ fontSize: 17, fontWeight: '700', flexShrink: 1 }}
        >
          {t.company.ovUpcoming}
        </Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push(payments)}
          hitSlop={8}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}
        >
          <Text variant="caption" style={{ color: theme.color.brand, fontWeight: '600' }}>
            {t.company.ovSeeAll}
          </Text>
          <Ionicons
            name={directionalIcon('chevron-forward')}
            size={iconSize.sm}
            color={theme.color.brand}
          />
        </Pressable>
      </View>
      {o.upcoming.map((row, i) => (
        <UpcomingLine
          key={row.key}
          row={row}
          index={i}
          today={today}
          amount={fmt(row.amountMinor)}
          canRecord={!o.suspended}
          onRecord={() =>
            router.push(
              row.kind === 'salary'
                ? `/group/${groupId}/company-wages`
                : `/group/${groupId}/recurring`,
            )
          }
        />
      ))}
    </StandardCard>
  );
}

function MoneyCard({
  icon,
  ink,
  label,
  value,
  caption,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  ink: string;
  label: string;
  value: string;
  caption: string;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${value}, ${caption}`}
      onPress={onPress}
      style={{ flex: 1, minWidth: 0 }}
    >
      <TintCard ink={ink} style={{ flex: 1, padding: 10, gap: 4 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <IconDisc ink={ink} size={30}>
            <Ionicons name={icon} size={iconSize.sm} color={ink} />
          </IconDisc>
          <Text
            variant="micro"
            numberOfLines={2}
            style={{ flex: 1, fontSize: 12, lineHeight: 15, color: theme.color.text }}
          >
            {label}
          </Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
          <Text
            variant="title"
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.6}
            style={{ fontSize: 19, fontWeight: '800', flexShrink: 1 }}
          >
            {value}
          </Text>
          <Ionicons
            name={directionalIcon('chevron-forward')}
            size={iconSize.sm}
            color={theme.color.textMuted}
          />
        </View>
        <Text variant="micro" tone="muted" numberOfLines={2}>
          {caption}
        </Text>
      </TintCard>
    </Pressable>
  );
}

function UpcomingLine({
  row,
  index,
  today,
  amount,
  canRecord,
  onRecord,
}: {
  row: UpcomingRow;
  index: number;
  today: string;
  amount: string;
  canRecord: boolean;
  onRecord: () => void;
}) {
  const theme = useTheme();
  const { t } = useStrings();
  const due = dueText(row.date, today);
  const dueLabel =
    due.kind === 'owedNow'
      ? t.company.ovOwedNow
      : due.kind === 'overdue'
        ? t.company.ovOverdue
        : due.kind === 'today'
          ? t.company.ovDueToday
          : due.kind === 'tomorrow'
            ? t.company.ovDueTomorrow
            : fill(t.company.ovDueIn, { n: due.n });
  const name = row.member
    ? displayName(row.member, null, null, t.misc.someone)
    : row.title || t.company.ovKindBill;
  const first = index === 0;
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        paddingVertical: 9,
        borderTopWidth: 1,
        borderTopColor: theme.color.border,
        marginTop: index === 0 ? 8 : 0,
      }}
    >
      {row.member ? (
        <PersonAvatar
          member={row.member}
          name={displayName(row.member)}
          ghost={isGhost(row.member)}
          size={40}
          tint={TINTS[index % TINTS.length]}
        />
      ) : (
        <IconDisc ink={theme.color.brand} size={40}>
          <Ionicons name="receipt-outline" size={iconSize.base} color={theme.color.brand} />
        </IconDisc>
      )}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text variant="body" numberOfLines={1} style={{ fontWeight: '600', fontSize: 15 }}>
          {name}
        </Text>
        <Text variant="micro" tone="muted" numberOfLines={1}>
          {row.kind === 'salary' ? t.company.ovKindSalary : t.company.ovKindBill}
        </Text>
      </View>
      <View style={{ alignItems: 'flex-end', flexShrink: 0, maxWidth: '38%' }}>
        <Text
          variant="body"
          numberOfLines={1}
          adjustsFontSizeToFit
          style={{ fontWeight: '700', fontSize: 15 }}
        >
          {amount}
        </Text>
        <Text variant="micro" tone="muted" numberOfLines={1}>
          {dueLabel}
        </Text>
      </View>
      {canRecord ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${t.company.ovRecord}: ${name}, ${amount}`}
          onPress={onRecord}
          style={{
            height: 34,
            minWidth: 64,
            paddingHorizontal: 12,
            borderRadius: 12,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: first ? theme.color.brand : withAlpha(theme.color.brand, 0.14),
          }}
        >
          <Text
            numberOfLines={1}
            style={{
              fontSize: 14,
              fontWeight: '600',
              color: first ? theme.color.onBrand : theme.color.brand,
            }}
          >
            {t.company.ovRecord}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}
