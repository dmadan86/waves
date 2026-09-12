/**
 * One recurring rule, month by month (A48).
 *
 * This is the screen the recurring feature was missing. A rule used to say only
 * when it was next due, so "did the tenant pay in July?" and "which months am I
 * still missing?" had no answer anywhere in the app — and a year of collected
 * rent could only be entered by remembering, one date at a time, which months
 * were already in.
 *
 * Every period the rule has ever expected is listed, newest first, in one of
 * four states. Tapping a period that has not arrived opens a sheet with the
 * amount and that period's own date already filled in; confirming writes an
 * ordinary entry, linked back to this rule. Tapping one that has opens the entry
 * itself. Nothing here invents money: an occurrence only counts as received when
 * a real entry exists for it.
 */

import { useMemo, useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useLocalSearchParams } from 'expo-router';
import { FlashList } from '@shopify/flash-list';
import { Platform, Pressable, View } from 'react-native';

import {
  encodeTxn,
  format,
  frequencyOf,
  money,
  monthKey,
  occurrences,
  recurringOccurrenceId,
  type Occurrence,
  type OccurrenceStatus,
  type PersonalRecurring,
} from '@waves/core';
import {
  AmountField,
  Button,
  Card,
  directionalIcon,
  EmptyState,
  IconButton,
  iconSize,
  Row,
  Screen,
  Sheet,
  Text,
  useTheme,
} from '@waves/ui';

import { frequencyLabel } from '@/app/personal/recurring';
import { SourceGlyph, useSourceLabel } from '@/components/IncomeSource';
import {
  localIsoDate,
  todayIso,
  usePersonalLedger,
  useUpsertPersonalRecord,
} from '@/data/personal';
import { fill, useStrings } from '@/i18n';
import { PersonalGuard } from '@/components/PersonalGuard';
import { useBottomClearance } from '@/lib/clearance';
import { router } from '@/lib/navigation';

/**
 * How far back the timeline looks: five years of months.
 *
 * Long enough that "add last year's rent" — the thing this screen exists for —
 * is never cut off, and bounded so a rule anchored in 1970 cannot render ten
 * thousand rows. The walk in core is capped independently.
 */
const LOOKBACK_YEARS = 5;

function SourceTimelineScreenBody() {
  const theme = useTheme();
  const clearance = useBottomClearance();
  const { t, locale } = useStrings();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { txns, recurrings } = usePersonalLedger();
  const sourceLabel = useSourceLabel();

  const [today] = useState(() => todayIso());
  const [recording, setRecording] = useState<Occurrence | null>(null);

  const rule = recurrings.find((candidate) => candidate.id === id) ?? null;

  // Newest first: the month somebody opens this screen to check is nearly always
  // the current one, and it should not be at the bottom of five years.
  const timeline = useMemo(() => {
    if (!rule) return [];
    const from = `${Number(today.slice(0, 4)) - LOOKBACK_YEARS}${today.slice(4, 7)}-01`;
    return occurrences(rule, txns, { from, to: today }, today).reverse();
  }, [rule, txns, today]);

  if (!rule) {
    return (
      <Screen>
        <Header title={t.personal.recurring} />
        <View style={{ paddingTop: theme.spacing.xxxl }}>
          <EmptyState title={t.personal.entryMissing} />
        </View>
      </Screen>
    );
  }

  const income = rule.txnKind === 'income';
  const title = rule.note?.trim() || sourceLabel(rule.category) || t.personal.recurring;

  return (
    <Screen>
      <Header title={title} />

      <FlashList
        data={timeline}
        keyExtractor={(item) => item.periodKey}
        extraData={[locale, theme.scheme]}
        drawDistance={1500}
        contentContainerStyle={{
          paddingHorizontal: theme.spacing.xl,
          paddingBottom: clearance,
        }}
        ListHeaderComponent={
          <View style={{ gap: theme.spacing.md, paddingBottom: theme.spacing.lg }}>
            <Card style={{ gap: theme.spacing.sm }}>
              <Row style={{ gap: theme.spacing.md, alignItems: 'center' }}>
                <SourceGlyph id={rule.category} />
                <View style={{ flex: 1 }}>
                  <Text variant="subheading" numberOfLines={1}>
                    {title}
                  </Text>
                  <Text variant="micro" tone="muted">
                    {frequencyLabel(t, frequencyOf(rule), rule.interval)}
                    {rule.anchorDate
                      ? ` · ${fill(t.personal.everySince, { date: rule.anchorDate })}`
                      : ''}
                  </Text>
                </View>
                <Text
                  variant="subheading"
                  style={{ color: income ? theme.color.positive : theme.color.text }}
                >
                  {income ? '+' : '−'}
                  {format(money(rule.amount, rule.currency), { locale })}
                </Text>
              </Row>
            </Card>
            <Text variant="caption" tone="muted">
              {t.personal.historySub}
            </Text>
          </View>
        }
        ListEmptyComponent={
          <View style={{ paddingTop: theme.spacing.xxxl }}>
            <EmptyState title={t.personal.noHistory} />
          </View>
        }
        renderItem={({ item }) => (
          <PeriodRow
            occurrence={item}
            currency={rule.currency}
            income={income}
            onPress={() => {
              if (item.txn) router.push(`/personal/entry?id=${item.txn.id}`);
              else setRecording(item);
            }}
          />
        )}
      />

      {recording ? (
        <RecordSheet
          rule={rule}
          occurrence={recording}
          onClose={() => setRecording(null)}
          today={today}
        />
      ) : null}
    </Screen>
  );
}

function Header({ title }: { title: string }) {
  const theme = useTheme();
  const { t } = useStrings();
  return (
    <Row
      style={{
        paddingHorizontal: theme.spacing.xl,
        paddingTop: theme.spacing.md,
        paddingBottom: theme.spacing.sm,
        alignItems: 'center',
      }}
    >
      <IconButton label={t.common.back} onPress={() => router.back()}>
        <Ionicons
          name={directionalIcon('chevron-back')}
          size={iconSize.lg}
          color={theme.color.text}
        />
      </IconButton>
      <View style={{ flex: 1, alignItems: 'center' }}>
        <Text variant="heading" numberOfLines={1}>
          {title}
        </Text>
      </View>
      <View style={{ width: iconSize.lg + theme.spacing.md }} />
    </Row>
  );
}

/** One period, and what became of it. */
function PeriodRow({
  occurrence,
  currency,
  income,
  onPress,
}: {
  occurrence: Occurrence;
  currency: string;
  income: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  const { t, locale } = useStrings();

  const marks: Record<OccurrenceStatus, { icon: string; color: string; label: string }> = {
    received: {
      icon: 'checkmark-circle',
      color: theme.color.positive,
      label: t.personal.received,
    },
    missed: { icon: 'alert-circle', color: theme.color.negative, label: t.personal.missed },
    due: { icon: 'ellipse-outline', color: theme.color.brand, label: t.personal.due },
    future: {
      icon: 'ellipse-outline',
      color: theme.color.textFaint,
      label: t.personal.expected,
    },
  };
  const mark = marks[occurrence.status];
  const shown = occurrence.actual ?? occurrence.expected;
  // A future period is not something to act on, so it does not offer a tap.
  const actionable = occurrence.status !== 'future';

  return (
    <Pressable
      accessibilityRole={actionable ? 'button' : 'text'}
      accessibilityLabel={`${occurrence.periodKey} · ${mark.label}`}
      disabled={!actionable}
      onPress={onPress}
      style={({ pressed }) => ({ opacity: pressed && actionable ? 0.6 : 1 })}
    >
      <Card flat style={{ marginBottom: theme.spacing.sm }}>
        <Row style={{ gap: theme.spacing.md, alignItems: 'center' }}>
          <Ionicons
            name={mark.icon as keyof typeof Ionicons.glyphMap}
            size={iconSize.lg}
            color={mark.color}
          />
          <View style={{ flex: 1 }}>
            <Text variant="body" style={{ fontWeight: '600' }}>
              {monthKey(occurrence.dueDate)}
            </Text>
            <Text variant="micro" tone="muted">
              {occurrence.txn
                ? fill(t.personal.receivedOn, { date: occurrence.txn.date })
                : fill(t.personal.expectedOn, { date: occurrence.dueDate })}
            </Text>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text
              variant="body"
              style={{
                fontWeight: '700',
                color: occurrence.txn
                  ? income
                    ? theme.color.positive
                    : theme.color.text
                  : theme.color.textMuted,
              }}
            >
              {format(money(shown, currency), { locale })}
            </Text>
            {/* Only worth saying when it differs — a payment that matched needs
                no commentary. */}
            {occurrence.actual !== null && occurrence.actual !== occurrence.expected ? (
              <Text variant="micro" tone="muted">
                {fill(t.personal.ofExpected, {
                  amount: format(money(occurrence.expected, currency), {
                    locale,
                  }),
                })}
              </Text>
            ) : null}
          </View>
        </Row>
      </Card>
    </Pressable>
  );
}

/**
 * Confirm what actually arrived.
 *
 * Prefilled with the rule's amount and the period's own due date, because that
 * is right nine times in ten — but both are editable, because the tenth time the
 * tenant paid short, or paid late, and a ledger that cannot record that is a
 * ledger people stop trusting. The record id is the deterministic occurrence id,
 * so confirming twice (or racing the auto-post path) writes one entry.
 */
function RecordSheet({
  rule,
  occurrence,
  onClose,
  today,
}: {
  rule: PersonalRecurring;
  occurrence: Occurrence;
  onClose: () => void;
  today: string;
}) {
  const theme = useTheme();
  const { t } = useStrings();
  const upsert = useUpsertPersonalRecord();

  const [amount, setAmount] = useState<bigint>(occurrence.expected);
  // Money that arrived cannot have arrived in the future; a period due later
  // this month is recorded as of today, not as of its due date.
  const [date, setDate] = useState(occurrence.dueDate > today ? today : occurrence.dueDate);
  const [showDate, setShowDate] = useState(false);

  const income = rule.txnKind === 'income';
  const canSave = amount > 0n && !upsert.isPending;

  const onSave = (): void => {
    if (!canSave) return;
    upsert.mutate(
      {
        recordId: recurringOccurrenceId(rule.id, occurrence.dueDate),
        recordKind: 'txn',
        data: encodeTxn({
          kind: rule.txnKind,
          amount,
          currency: rule.currency,
          category: rule.category,
          note: rule.note,
          date,
          loanId: null,
          recurringId: rule.id,
        }),
      },
      { onSuccess: onClose },
    );
  };

  return (
    <Sheet visible onClose={onClose} padded={false} style={{ maxHeight: '90%' }}>
      <View style={{ padding: theme.spacing.xl, gap: theme.spacing.lg }}>
        <Row style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <Text variant="heading">{income ? t.personal.recordReceipt : t.personal.recordPaid}</Text>
          <IconButton label={t.common.close} onPress={onClose}>
            <Ionicons name="close" size={iconSize.lg} color={theme.color.text} />
          </IconButton>
        </Row>

        <Text variant="caption" tone="muted">
          {fill(t.personal.expectedOn, { date: occurrence.dueDate })}
        </Text>

        <View style={{ alignItems: 'center', paddingVertical: theme.spacing.md }}>
          <AmountField currency={rule.currency} value={amount} onChange={setAmount} />
        </View>

        <Pressable
          accessibilityRole="button"
          onPress={() => setShowDate(true)}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            paddingVertical: theme.spacing.md,
            paddingHorizontal: theme.spacing.lg,
            backgroundColor: theme.color.surfaceMuted,
            borderRadius: theme.radius.md,
          }}
        >
          <Text variant="body">{date}</Text>
          <Ionicons name="calendar-outline" size={iconSize.md} color={theme.color.textMuted} />
        </Pressable>
        {showDate ? (
          <DateTimePicker
            value={new Date(`${date}T00:00:00`)}
            mode="date"
            onChange={(event, picked) => {
              if (Platform.OS !== 'ios') setShowDate(false);
              if (event.type === 'set' && picked) setDate(localIsoDate(picked));
            }}
          />
        ) : null}

        <Button
          label={income ? t.personal.markReceived : t.personal.markPaid}
          size="lg"
          fullWidth
          onPress={onSave}
          disabled={!canSave}
        />
      </View>
    </Sheet>
  );
}

/**
 * Behind the section shield: one unlock covers the Me tab and every room
 * under `personal/`, so arriving here from the ledger never asks again.
 */
export default function SourceTimelineScreen() {
  return (
    <PersonalGuard>
      <SourceTimelineScreenBody />
    </PersonalGuard>
  );
}
