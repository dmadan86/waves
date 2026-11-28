/**
 * Home's "Today" feed: what needs you now, what is coming up, and the people
 * you share money with. The ranking lives in `lib/homeToday`; this draws it.
 */

import { useEffect, useMemo, useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { View } from 'react-native';

import { iconSize, Text, useTheme } from '@waves/ui';
import type { PersonalRecurring, PersonalTxn } from '@waves/core';

import { useSourceLabel } from '@/components/IncomeSource';
import { PersonAvatar } from '@/components/PersonAvatar';
import { CardTitle } from '@/components/personal/PersonalHomeParts';
import type { SnapRow } from '@/lib/homeSnapshot';
import { LIST_TILE, ListCard, ListPill, ListItem, RowTile } from '@/components/standard';
import { BALANCE_MASK } from '@/components/home/ScenicBalanceCard';
import { useCaptures, usePeopleBalances } from '@/data/hooks';
import { useHomeSpaceFigures } from '@/data/homeSpaces';
import { usePostRecurring } from '@/data/postRecurring';
import { fill, useStrings } from '@/i18n';
import { foldedCaptureCount } from '@/lib/captureBatch';
import { billRows, daysBetween } from '@/lib/personalUpcoming';
import {
  isAutoPostOverdue,
  personalNeedKey,
  plainAmount,
  rankNeeds,
  SOON_DAYS,
  type BillNeed,
  type Need,
  type PersonNeed,
} from '@/lib/homeToday';
import { router } from '@/lib/navigation';
import { useNudge } from '@/lib/nudge';
import { useUndoableAction } from '@/lib/useUndoableAction';
import { useToast } from '@/lib/toast';

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
  onSnapshot,
  all = false,
  only,
  currency,
}: {
  ledger: Ledger;
  viewerId: string | null;
  hidden: boolean;
  /** The full list on its own screen: every need, no title or "See all". */
  all?: boolean;
  /** Only the people on one side (To collect / To pay), in one currency. */
  only?: 'owed' | 'owe';
  currency?: string;
  /** Reports the rows as drawn (unmasked), for Home's stored snapshot. */
  onSnapshot?: (rows: SnapRow[], total: number) => void;
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
      .filter((row) => !isAutoPostOverdue(row, ruleById))
      .map((row) => ({
        key: personalNeedKey(row.key),
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
        avatarUrl: row.avatar_url,
      };
      if (net > 0n) owedToYou.push(need);
      else if (net < 0n) youOwe.push(need);
    }
    const ofCurrency = (p: PersonNeed): boolean => !currency || p.currency === currency;
    return rankNeeds(
      {
        bills: only ? [] : [...personal, ...shared],
        owedToYou: only === 'owe' ? [] : owedToYou.filter(ofCurrency),
        youOwe: only === 'owed' ? [] : youOwe.filter(ofCurrency),
        reviewCount: only ? 0 : foldedCaptureCount(captures.data ?? []),
      },
      all ? Infinity : undefined,
    );
    // sourceLabel/t are stable per render of the same strings; keyed on the data.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ledger, myBills, people, captures.data, t, all, only, currency]);

  const rowsJson = onSnapshot
    ? JSON.stringify(
        items.map((need): SnapRow => {
          const money = (amount: bigint, currency: string) => plainAmount(amount, currency, locale);
          const { bill, person } = need;
          const label =
            need.action === 'markPaid'
              ? h.markPaid
              : need.action === 'pay'
                ? h.pay
                : need.action === 'remind'
                  ? h.remind
                  : h.review;
          if (bill) {
            return {
              key: need.key,
              title: bill.title,
              memberLabel: shortDate(bill.date, locale),
              amountText: money(bill.amount, bill.currency),
              directionLabel: label,
              strong: need.action === 'pay',
              icon: need.kind === 'overdue' ? 'alert-circle-outline' : 'home-outline',
              href:
                bill.source === 'group' && bill.groupId
                  ? `/group/${bill.groupId}`
                  : '/personal/upcoming',
            };
          }
          if (person) {
            return {
              key: need.key,
              title: person.name,
              memberLabel: need.kind === 'owed' ? t.youAreOwed : t.youOwe,
              amountText: money(person.amount, person.currency),
              directionLabel: label,
              strong: need.action === 'pay',
              icon: 'person-outline',
              href: `/friends/person/${encodeURIComponent(person.personKey)}?name=${encodeURIComponent(person.name)}`,
            };
          }
          return {
            key: need.key,
            title: fill(h.reviewTitle, { n: need.count ?? 0 }),
            memberLabel: '',
            amountText: '',
            directionLabel: label,
            icon: 'file-tray-full-outline',
            href: '/captures',
          };
        }),
      )
    : null;
  useEffect(() => {
    if (rowsJson) onSnapshot?.(JSON.parse(rowsJson) as SnapRow[], total);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the rows' content
  }, [rowsJson, total]);

  const settled = items.length === 0;
  return (
    <View style={{ gap: theme.spacing.sm }}>
      {settled || all ? null : (
        <CardTitle
          title={h.needsYou}
          action={total > items.length ? h.seeAll : undefined}
          onAction={() => router.push('/needs')}
          count={total}
        />
      )}
      <ListCard>
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
                if (rule && need.bill) {
                  await post(rule, need.bill.date);
                }
              }}
            />
          ))
        )}
      </ListCard>
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
  const toast = useToast();
  const undoable = useUndoableAction();
  const nudgeKey = `nudge:${person?.groupId ?? ''}:${person?.memberId ?? ''}`;
  const remindPending = undoable.isPending(nudgeKey);
  const paidPending = bill ? undoable.isPending(`paid:${bill.ruleId}:${bill.date}`) : false;
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
      label = paidPending ? t.voice.autoUndo : h.markPaid;
      const paidKey = `paid:${bill.ruleId}:${bill.date}`;
      onPress = paidPending
        ? () => undoable.undo(paidKey)
        : () => {
            setPaying(true);
            undoable.run(() => onMarkPaid().catch(() => {}), {
              key: paidKey,
              message: fill(t.common.markedPaid, { title: bill.title }),
            });
            setPaying(false);
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
      title = person.name;
      sub = fill(h.owesYouSub, { amount });
      tint = theme.tint.peach;
      label = remindPending ? t.voice.autoUndo : nudge.outcome?.ok ? h.reminded : h.remind;
      onPress = person.groupId
        ? remindPending
          ? () => undoable.undo(nudgeKey)
          : () =>
              undoable.run(
                async () => {
                  const result = await nudge.send();
                  if (result)
                    toast.show(
                      result.ok && result.label !== t.people.remindedToday
                        ? fill(t.common.reminderSent, { name: person.name })
                        : result.label,
                      result.ok ? 'positive' : 'negative',
                    );
                },
                { key: nudgeKey, message: fill(t.common.remindingName, { name: person.name }) },
              )
        : () =>
            router.push(
              `/friends/person/${encodeURIComponent(person.personKey)}?name=${encodeURIComponent(person.name)}` as never,
            );
    } else {
      title = person.name;
      sub = fill(h.youOweSub, { amount });
      tint = theme.tint.sky;
      label = h.pay;
      onPress = () => router.push('/settle-up');
    }
  } else {
    title = fill(h.reviewTitle, { n: need.count ?? 0 });
    icon = 'file-tray-full-outline';
    tint = theme.tint.peach;
    label = h.review;
    onPress = () => router.navigate('/captures');
    open = onPress;
  }

  return (
    <ListItem
      accessibilityLabel={title}
      onPress={open}
      divider={!first}
      leading={
        person ? (
          <PersonAvatar name={person.name} avatarUrl={person.avatarUrl} size={LIST_TILE} />
        ) : (
          <RowTile tint={tint.bg}>
            <Ionicons name={icon} size={iconSize.md} color={tint.ink} />
          </RowTile>
        )
      }
      title={title}
      subtitle={sub || undefined}
      trailing={
        <ListPill
          label={label}
          accessibilityLabel={`${label}, ${title}`}
          disabled={
            paying ||
            nudge.pending ||
            (need.kind === 'owed' && nudge.outcome?.ok === true && !remindPending)
          }
          onPress={onPress}
          filled={need.action === 'pay'}
        />
      }
    />
  );
}
