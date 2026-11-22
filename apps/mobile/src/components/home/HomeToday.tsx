/**
 * Home's "Today" feed: what needs you now, what is coming up, and the people
 * you share money with. The ranking lives in `lib/homeToday`; this draws it.
 */

import { useMemo, useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, View } from 'react-native';

import { Card, iconSize, Row, Text, useTheme } from '@waves/ui';
import {
  pickUpcoming,
  type PersonalRecurring,
  type PersonalTxn,
  type UpcomingItem,
} from '@waves/core';

import { useSourceLabel } from '@/components/IncomeSource';
import { CardTitle, ICON_FOR } from '@/components/personal/PersonalHomeParts';
import { GroupRow } from '@/components/home/GroupRow';
import { BALANCE_MASK } from '@/components/home/ScenicBalanceCard';
import { useCaptures, usePeopleBalances } from '@/data/hooks';
import { useHomeSpaceFigures } from '@/data/homeSpaces';
import { useDateOccurrences } from '@/data/personalDates';
import { usePostRecurring } from '@/data/postRecurring';
import { fill, plural, useStrings } from '@/i18n';
import { useAuth } from '@/lib/auth';
import { foldedCaptureCount } from '@/lib/captureBatch';
import { subtitleOf, titleOf } from '@/lib/dateReminders/text';
import { billRows, daysBetween, dateRows } from '@/lib/personalUpcoming';
import {
  plainAmount,
  rankNeeds,
  SOON_DAYS,
  type BillNeed,
  type Need,
  type PersonNeed,
} from '@/lib/homeToday';
import { router } from '@/lib/navigation';
import { useNudge } from '@/lib/nudge';

interface Ledger {
  readonly txns: readonly PersonalTxn[];
  readonly recurrings: readonly PersonalRecurring[];
  readonly currency: string;
  readonly today: string;
}

/** Day and month in the reader's language, e.g. "29 Nov". */
const shortDate = (date: string, locale: string): string =>
  new Date(`${date}T12:00:00`).toLocaleDateString(locale, { day: 'numeric', month: 'short' });

// ───────────────────────────────────────────────────────────── Needs you ──

export function NeedsYouCard({
  ledger,
  viewerId,
  hidden,
}: {
  ledger: Ledger;
  viewerId: string | null;
  hidden: boolean;
}) {
  const theme = useTheme();
  const { t, locale } = useStrings();
  const h = t.homeToday;
  const sourceLabel = useSourceLabel();
  const people = usePeopleBalances(viewerId).data;
  const captures = useCaptures();
  const { myBills } = useHomeSpaceFigures();
  const { post } = usePostRecurring();

  const { items, total } = useMemo(() => {
    const ruleById = new Map(ledger.recurrings.map((r) => [r.id, r]));
    const personal: BillNeed[] = billRows(
      ledger.txns,
      ledger.recurrings,
      ledger.currency,
      ledger.today,
      SOON_DAYS,
    )
      // An auto-post rule's missed day is posted by the catch-up, not by hand.
      .filter((row) => !(row.inDays < 0 && ruleById.get(row.ruleId ?? '')?.autoPost))
      .map((row) => ({
        key: `p:${row.key}`,
        source: 'personal' as const,
        title: row.title || sourceLabel(row.category ?? null) || t.personal.expense,
        amount: row.amount ?? 0n,
        currency: row.currency ?? ledger.currency,
        inDays: row.inDays,
        date: row.date ?? ledger.today,
        ruleId: row.ruleId ?? '',
      }));
    const shared: BillNeed[] = myBills.map((b) => ({
      key: `g:${b.ruleId}:${b.date}`,
      source: 'group',
      title: b.description,
      amount: b.amount,
      currency: b.currency,
      inDays: daysBetween(ledger.today, b.date),
      date: b.date,
      ruleId: b.ruleId,
      groupId: b.groupId,
    }));
    const owedToYou: PersonNeed[] = [];
    const youOwe: PersonNeed[] = [];
    for (const row of people) {
      if (row.is_demo) continue;
      const net = BigInt(row.net);
      const need: PersonNeed = {
        key: `${row.person_key}:${row.currency}`,
        name: row.display_name,
        amount: net < 0n ? -net : net,
        currency: row.currency,
        groupId: row.only_group_id,
        memberId: row.member_id,
        personKey: row.person_key,
      };
      if (net > 0n) owedToYou.push(need);
      else if (net < 0n) youOwe.push(need);
    }
    return rankNeeds({
      bills: [...personal, ...shared],
      owedToYou,
      youOwe,
      reviewCount: foldedCaptureCount(captures.data ?? []),
    });
    // sourceLabel/t are stable per render of the same strings; keyed on the data.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ledger, myBills, people, captures.data, t]);

  const settled = items.length === 0;
  return (
    <View style={{ gap: theme.spacing.sm }}>
      {settled ? null : (
        <CardTitle title={h.needsYou}>
          <Text variant="caption" tone="muted" style={{ fontWeight: '700' }}>
            {total}
          </Text>
        </CardTitle>
      )}
      <Card style={{ padding: 0, overflow: 'hidden' }}>
        {settled ? (
          <View
            accessible
            accessibilityLabel={h.nothingNeeds}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: theme.spacing.md,
              padding: theme.spacing.md,
              backgroundColor: theme.color.positiveSoft,
            }}
          >
            <Ionicons name="checkmark-circle" size={iconSize.lg} color={theme.color.positive} />
            <Text style={{ fontWeight: '700', color: theme.color.positive }}>{h.nothingNeeds}</Text>
          </View>
        ) : (
          items.map((need, i) => (
            <NeedRow
              key={need.key}
              need={need}
              first={i === 0}
              hidden={hidden}
              locale={locale}
              onMarkPaid={async () => {
                const rule = ledger.recurrings.find((r) => r.id === need.bill?.ruleId);
                if (rule && need.bill) await post(rule, need.bill.date).catch(() => {});
              }}
            />
          ))
        )}
      </Card>
    </View>
  );
}

function NeedRow({
  need,
  first,
  hidden,
  locale,
  onMarkPaid,
}: {
  need: Need;
  first: boolean;
  hidden: boolean;
  locale: string;
  onMarkPaid: () => Promise<void>;
}) {
  const theme = useTheme();
  const { t } = useStrings();
  const h = t.homeToday;
  const { bill, person } = need;
  const nudge = useNudge({
    groupId: person?.groupId ?? '',
    memberId: person?.memberId ?? '',
    currency: person?.currency ?? '',
  });
  const [paying, setPaying] = useState(false);
  const money = (amount: bigint, currency: string): string =>
    hidden ? BALANCE_MASK : plainAmount(amount, currency, locale);

  let icon: keyof typeof Ionicons.glyphMap = 'receipt-outline';
  let tint = theme.tint.lilac;
  let title = '';
  let sub = '';
  let label = '';
  let onPress: () => void = () => {};
  // Tapping the row itself opens where the item lives; the pill does the action.
  let open: () => void = () => {};
  if (bill) {
    open =
      bill.source === 'group' && bill.groupId
        ? () => router.push(`/group/${bill.groupId}`)
        : () => router.push('/personal/upcoming');
    const amount = money(bill.amount, bill.currency);
    title = bill.title;
    sub =
      need.kind === 'overdue'
        ? fill(h.overdueSub, { amount })
        : fill(h.dueSub, { date: shortDate(bill.date, locale), amount });
    tint = need.kind === 'overdue' ? theme.tint.coral : theme.tint.mint;
    icon = need.kind === 'overdue' ? 'alert-circle-outline' : 'home-outline';
    if (need.action === 'markPaid') {
      label = h.markPaid;
      onPress = () => {
        setPaying(true);
        void onMarkPaid().finally(() => setPaying(false));
      };
    } else {
      label = h.pay;
      onPress = () => router.push(`/group/${bill.groupId}`);
    }
  } else if (person) {
    const amount = money(person.amount, person.currency);
    open = () =>
      router.push(
        `/friends/person/${encodeURIComponent(person.personKey)}?name=${encodeURIComponent(person.name)}` as never,
      );
    icon = 'person-outline';
    if (need.kind === 'owed') {
      title = fill(h.owesYou, { name: person.name, amount });
      tint = theme.tint.peach;
      label = nudge.outcome?.ok ? h.reminded : h.remind;
      onPress = person.groupId
        ? nudge.send
        : () =>
            router.push(
              `/friends/person/${encodeURIComponent(person.personKey)}?name=${encodeURIComponent(person.name)}` as never,
            );
    } else {
      title = fill(h.youOweName, { name: person.name, amount });
      tint = theme.tint.sky;
      label = h.pay;
      onPress = () => router.push('/settle-up');
    }
    sub = '';
  } else {
    title = fill(h.reviewTitle, { n: need.count ?? 0 });
    icon = 'file-tray-full-outline';
    tint = theme.tint.peach;
    label = h.review;
    onPress = () => router.navigate('/captures');
    open = onPress;
  }

  return (
    <Row
      style={{
        alignItems: 'center',
        gap: theme.spacing.md,
        paddingVertical: theme.spacing.sm,
        paddingHorizontal: theme.spacing.md,
        borderTopWidth: first ? 0 : 1,
        borderTopColor: theme.color.border,
      }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={title}
        onPress={open}
        style={({ pressed }) => ({
          flex: 1,
          minWidth: 0,
          flexDirection: 'row',
          alignItems: 'center',
          gap: theme.spacing.md,
          opacity: pressed ? 0.7 : 1,
        })}
      >
        <View
          style={{
            width: 36,
            height: 36,
            borderRadius: theme.radius.md,
            backgroundColor: tint.bg,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Ionicons name={icon} size={iconSize.md} color={tint.ink} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text numberOfLines={1} style={{ fontWeight: '700' }}>
            {title}
          </Text>
          {sub ? (
            <Text variant="caption" tone="muted" numberOfLines={1}>
              {sub}
            </Text>
          ) : null}
        </View>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}, ${title}`}
        disabled={paying || nudge.pending || (need.kind === 'owed' && nudge.outcome?.ok === true)}
        onPress={onPress}
        hitSlop={6}
        style={({ pressed }) => ({
          paddingHorizontal: theme.spacing.md,
          height: 32,
          borderRadius: theme.radius.pill,
          justifyContent: 'center',
          backgroundColor: need.action === 'pay' ? theme.color.brand : theme.color.brandSoft,
          opacity: pressed || paying ? 0.6 : 1,
        })}
      >
        <Text
          variant="caption"
          style={{
            fontWeight: '700',
            color: need.action === 'pay' ? theme.color.onBrand : theme.color.brand,
          }}
        >
          {label}
        </Text>
      </Pressable>
    </Row>
  );
}

// ───────────────────────────────────────────────────────────── Coming up ──

interface Chip {
  readonly key: string;
  readonly top: string;
  /** The day, ISO, for the date badge. */
  readonly iso: string;
  /** Days from today: 0 is today. */
  readonly inDays: number;
  /** The right-hand figure: a bill's amount, empty for a date. */
  readonly amount: string;
  /** The grey line under the title. */
  readonly detail: string;
  readonly title: string;
  readonly sub: string;
  readonly emoji: keyof typeof Ionicons.glyphMap | null;
  readonly onPress: () => void;
}

export function ComingUpChips({ ledger, hidden }: { ledger: Ledger; hidden: boolean }) {
  const theme = useTheme();
  const { t, locale } = useStrings();
  const { session, isGuest } = useAuth();
  const sourceLabel = useSourceLabel();
  const occurrences = useDateOccurrences();
  if (!session || isGuest) return null;

  const dates: UpcomingItem[] = pickUpcoming(occurrences, 6);
  const rows = [
    ...billRows(ledger.txns, ledger.recurrings, ledger.currency, ledger.today, 14),
    ...dateRows(dates),
  ]
    .filter((r) => r.inDays >= 0)
    .sort((a, b) => a.inDays - b.inDays || (a.key < b.key ? -1 : 1))
    .slice(0, 6);
  const chips: Chip[] = rows.map((row) => {
    const iso = row.date ?? ledger.today;
    const top = shortDate(iso, locale).toUpperCase();
    if (row.item) {
      const item = row.item;
      return {
        key: row.key,
        top,
        iso,
        inDays: row.inDays,
        amount: '',
        detail: subtitleOf(item, t.dates, locale),
        title: titleOf(item, t.dates),
        sub: subtitleOf(item, t.dates, locale),
        emoji: ICON_FOR[item.kind] ?? null,
        onPress: () =>
          item.source === 'date'
            ? router.push({ pathname: '/dates/edit', params: { id: item.id } })
            : router.push('/dates'),
      };
    }
    return {
      key: row.key,
      top,
      iso,
      inDays: row.inDays,
      amount: hidden
        ? BALANCE_MASK
        : plainAmount(row.amount ?? 0n, row.currency ?? ledger.currency, locale),
      detail: new Date(`${iso}T12:00:00`).toLocaleDateString(locale, {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
      }),
      title: row.title || sourceLabel(row.category ?? null) || t.personal.expense,
      sub: hidden
        ? BALANCE_MASK
        : plainAmount(row.amount ?? 0n, row.currency ?? ledger.currency, locale),
      emoji: 'receipt-outline',
      onPress: () => router.push('/personal/upcoming'),
    };
  });

  // A short list, nearest first; the full view is one tap away.
  const shown = chips.slice(0, COMING_UP_ROWS);

  return (
    <View style={{ gap: theme.spacing.sm }}>
      <CardTitle
        title={t.homeToday.comingUp}
        action={t.homeToday.seeAll}
        onAction={() => router.push('/personal/upcoming')}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t.homeToday.addReminder}
          onPress={() => router.push('/dates/edit')}
          hitSlop={8}
          style={({ pressed }) => ({
            width: 28,
            height: 28,
            borderRadius: 14,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: theme.color.brandSoft,
            opacity: pressed ? 0.6 : 1,
          })}
        >
          <Ionicons name="add" size={iconSize.md} color={theme.color.brand} />
        </Pressable>
      </CardTitle>
      {shown.length ? (
        // The same card and rows as Groups below, so the two read as one design.
        <View
          style={{
            borderRadius: theme.radius.lg,
            borderWidth: 1,
            borderColor: theme.color.border,
            backgroundColor: theme.color.surface,
            overflow: 'hidden',
          }}
        >
          {shown.map((chip, index) => (
            <GroupRow
              key={chip.key}
              icon={chip.emoji ?? 'calendar-outline'}
              iconColor={theme.color.brand}
              title={chip.title}
              memberLabel={chip.detail}
              amountText={chip.amount}
              directionLabel={
                chip.inDays === 0 ? t.dates.today : plural(locale, chip.inDays, t.dates.inDays)
              }
              locale={locale}
              divider={index > 0}
              onPress={chip.onPress}
            />
          ))}
        </View>
      ) : (
        <Text variant="caption" tone="muted">
          {t.dates.empty}
        </Text>
      )}
    </View>
  );
}

/** How many upcoming items Home lists before "See all". */
const COMING_UP_ROWS = 4;
