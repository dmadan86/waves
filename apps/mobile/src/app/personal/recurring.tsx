/**
 * Recurring rules (A48): bills and income that repeat — a phone bill, a salary,
 * a subscription. A rule set to "add automatically" posts its entry on its own
 * when due (handled on the Me tab's open); a manual one just shows as due here,
 * to add with one tap. The editor is an inline sheet.
 */

import { useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Platform, Pressable, ScrollView, TextInput, View } from 'react-native';

import {
  encodeRecurring,
  encodeTxn,
  format,
  Frequency,
  FREQUENCIES,
  frequencyOf,
  isRecurringDue,
  money,
  occurrences,
  recurringOccurrenceId,
  scheduleFor,
  stepOccurrence,
  type PersonalRecurring,
  type TxnKind,
} from '@waves/core';
import {
  AmountField,
  Button,
  Card,
  directionalIcon,
  Divider,
  EmptyState,
  IconButton,
  iconSize,
  Row,
  Screen,
  Sheet,
  SegmentedTabs,
  Text,
  Toggle,
  useTheme,
} from '@waves/ui';

import { CategoryPicker } from '@/components/Category';
import { SourcePicker, useSourceLabel } from '@/components/IncomeSource';
import { OccurrenceStrip } from '@/components/OccurrenceStrip';
import {
  localIsoDate,
  todayIso,
  usePersonalLedger,
  useDeletePersonalRecord,
  useUpsertPersonalRecord,
} from '@/data/personal';
import { useDefaultCurrency } from '@/lib/currency';
import { fill, useStrings } from '@/i18n';
import { PersonalGuard } from '@/components/PersonalGuard';
import { useBottomClearance } from '@/lib/clearance';
import { router } from '@/lib/navigation';
import { useDialog } from '@/lib/dialog';

/** A repeat pattern in words. The open-ended one names its own interval, so
 *  "every 5 months" never reads as the vaguer "every few months". */
export function frequencyLabel(
  t: ReturnType<typeof useStrings>['t'],
  frequency: Frequency,
  interval: number,
): string {
  switch (frequency) {
    case Frequency.Weekly:
      return t.personal.weekly;
    case Frequency.Fortnightly:
      return t.personal.fortnightly;
    case Frequency.TwiceAMonth:
      return t.personal.twiceAMonth;
    case Frequency.Quarterly:
      return t.personal.quarterly;
    case Frequency.HalfYearly:
      return t.personal.halfYearly;
    case Frequency.Yearly:
      return t.personal.yearly;
    case Frequency.EveryNMonths:
      return fill(t.personal.monthsInterval, { n: String(interval) });
    default:
      return t.personal.monthly;
  }
}

function RecurringScreenBody() {
  const theme = useTheme();
  const clearance = useBottomClearance();
  const { t, locale } = useStrings();
  const dc = useDefaultCurrency();
  const { recurrings, txns } = usePersonalLedger();
  const sourceLabel = useSourceLabel();
  const upsert = useUpsertPersonalRecord();

  const [today] = useState(() => todayIso());
  const [editing, setEditing] = useState<PersonalRecurring | null>(null);
  const [creating, setCreating] = useState(false);

  const cadenceLabel = (rule: PersonalRecurring): string =>
    frequencyLabel(t, frequencyOf(rule), rule.interval);

  // Post one occurrence of a manual rule now, and advance its next date. The
  // occurrence id is deterministic per (rule, date), so this posting the same
  // date the auto catch-up also posts collapses to one row rather than two.
  const postOnce = async (rule: PersonalRecurring): Promise<void> => {
    await upsert.mutateAsync({
      recordId: recurringOccurrenceId(rule.id, rule.nextDate),
      recordKind: 'txn',
      data: encodeTxn({
        kind: rule.txnKind,
        amount: rule.amount,
        currency: rule.currency,
        category: rule.category,
        note: rule.note,
        date: rule.nextDate,
        loanId: null,
        recurringId: rule.id,
      }),
    });
    await upsert.mutateAsync({
      recordId: rule.id,
      recordKind: 'recurring',
      data: encodeRecurring({
        ...rule,
        nextDate: stepOccurrence(rule, rule.nextDate),
      }),
    });
  };

  return (
    <Screen>
      <Row
        style={{
          paddingHorizontal: theme.spacing.xl,
          paddingTop: theme.spacing.md,
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
          <Text variant="heading">{t.personal.recurring}</Text>
        </View>
        <IconButton label={t.personal.addRecurring} onPress={() => setCreating(true)}>
          <Ionicons name="add" size={iconSize.xxl} color={theme.color.brand} />
        </IconButton>
      </Row>

      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: theme.spacing.xl,
          paddingBottom: clearance,
          gap: theme.spacing.md,
        }}
        showsVerticalScrollIndicator={false}
      >
        <Text
          variant="caption"
          tone="muted"
          align="center"
          style={{ marginBottom: theme.spacing.sm }}
        >
          {t.personal.recurringSub}
        </Text>

        {recurrings.length === 0 ? (
          <View style={{ paddingTop: theme.spacing.xxxl }}>
            <EmptyState title={t.personal.noRecurring} />
          </View>
        ) : (
          recurrings.map((rule) => {
            const due = isRecurringDue(rule, today);
            const income = rule.txnKind === 'income';
            // The recent history this rule has actually had. A year is plenty to
            // fill the strip and cheap to walk.
            const recent = occurrences(
              rule,
              txns,
              { from: `${Number(today.slice(0, 4)) - 1}${today.slice(4, 7)}-01`, to: today },
              today,
            );
            return (
              <Card key={rule.id} style={{ gap: theme.spacing.sm }}>
                {/* The card opens the rule's history — the question people have
                    about a rent or a salary is whether it has been arriving, not
                    how it is configured. Editing is the pencil. */}
                <Row style={{ alignItems: 'center', gap: theme.spacing.sm }}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t.personal.history}
                    style={{ flex: 1 }}
                    onPress={() => router.push(`/personal/source/${rule.id}`)}
                  >
                    <Row style={{ alignItems: 'center', gap: theme.spacing.md }}>
                      <View style={{ flex: 1 }}>
                        <Text variant="body" numberOfLines={1} style={{ fontWeight: '600' }}>
                          {rule.note?.trim() ||
                            sourceLabel(rule.category) ||
                            (income ? t.personal.incomeKind : t.personal.expense)}
                        </Text>
                        <Text variant="micro" tone="muted">
                          {cadenceLabel(rule)} · {t.personal.nextDue} {rule.nextDate}
                          {rule.active ? '' : ` · ${t.personal.paused}`}
                        </Text>
                        <View style={{ marginTop: theme.spacing.xs }}>
                          <OccurrenceStrip occurrences={recent} />
                        </View>
                      </View>
                      <Text
                        variant="body"
                        style={{
                          fontWeight: '700',
                          color: income ? theme.color.positive : theme.color.text,
                        }}
                      >
                        {income ? '+' : '−'}
                        {format(money(rule.amount, rule.currency), {
                          locale,
                          compactFraction: true,
                        })}
                      </Text>
                    </Row>
                  </Pressable>
                  <IconButton label={t.personal.editRecurring} onPress={() => setEditing(rule)}>
                    <Ionicons
                      name="create-outline"
                      size={iconSize.md}
                      color={theme.color.textMuted}
                    />
                  </IconButton>
                </Row>
                {due && !rule.autoPost && rule.active ? (
                  <>
                    <Divider />
                    <Row style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                      <Text variant="caption" tone="brand" style={{ fontWeight: '600' }}>
                        {t.personal.due}
                      </Text>
                      <Button
                        label={t.personal.postNow}
                        size="sm"
                        onPress={() => void postOnce(rule)}
                        disabled={upsert.isPending}
                      />
                    </Row>
                  </>
                ) : null}
              </Card>
            );
          })
        )}
      </ScrollView>

      {creating ? (
        <RecurringEditor currency={dc} today={today} onClose={() => setCreating(false)} />
      ) : null}
      {editing ? (
        <RecurringEditor
          rule={editing}
          currency={dc}
          today={today}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </Screen>
  );
}

/** A plain number stepper. Two 44pt targets beat a keyboard for a value that
 *  only ever moves a step at a time, and it cannot be typed into an invalid
 *  state. */
function DayStepper({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (next: number) => void;
}) {
  const theme = useTheme();
  const step = (delta: number): void => {
    const next = value + delta;
    if (next >= min && next <= max) onChange(next);
  };
  const button = (delta: number, icon: 'remove' | 'add', disabled: boolean) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label} ${icon === 'add' ? '+' : '−'}`}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={() => step(delta)}
      hitSlop={6}
      style={({ pressed }) => ({
        width: 44,
        height: 44,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: theme.radius.md,
        backgroundColor: theme.color.surface,
        opacity: disabled ? 0.4 : pressed ? 0.6 : 1,
      })}
    >
      <Ionicons name={icon} size={iconSize.md} color={theme.color.text} />
    </Pressable>
  );

  return (
    <Row
      style={{
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingVertical: theme.spacing.sm,
        paddingHorizontal: theme.spacing.lg,
        backgroundColor: theme.color.surfaceMuted,
        borderRadius: theme.radius.md,
      }}
    >
      <Text variant="body">{label}</Text>
      <Row style={{ gap: theme.spacing.sm, alignItems: 'center' }}>
        {button(-1, 'remove', value <= min)}
        <Text variant="body" style={{ fontWeight: '700', minWidth: 28, textAlign: 'center' }}>
          {value}
        </Text>
        {button(1, 'add', value >= max)}
      </Row>
    </Row>
  );
}

function RecurringEditor({
  rule,
  currency,
  today,
  onClose,
}: {
  rule?: PersonalRecurring;
  currency: string;
  today: string;
  onClose: () => void;
}) {
  const theme = useTheme();
  const { t } = useStrings();
  const { confirm } = useDialog();
  const upsert = useUpsertPersonalRecord();
  const remove = useDeletePersonalRecord();

  const [txnKind, setTxnKind] = useState<TxnKind>(rule?.txnKind ?? 'expense');
  const [amount, setAmount] = useState<bigint>(rule?.amount ?? 0n);
  const [note, setNote] = useState(rule?.note ?? '');
  const [category, setCategory] = useState<string | null>(rule?.category ?? null);
  const [frequency, setFrequency] = useState<Frequency>(
    rule ? frequencyOf(rule) : Frequency.Monthly,
  );
  const [months, setMonths] = useState(() => (rule && rule.interval > 1 ? rule.interval : 2));
  const [secondDay, setSecondDay] = useState(rule?.secondDay ?? 15);
  // The date the schedule *starts*, not the next one due. It used to be seeded
  // from `nextDate`, which meant a rule could never be told it began last year —
  // and knowing which months are missing is the whole point of the timeline.
  // Moving the start back reveals that history; it does not disturb a rule that
  // is already ahead of it (see `nextDate` below).
  const [startDate, setStartDate] = useState(rule?.anchorDate || today);
  const [showDate, setShowDate] = useState(false);
  const [autoPost, setAutoPost] = useState(rule?.autoPost ?? false);
  const [active, setActive] = useState(rule?.active ?? true);

  const canSave = amount > 0n && !upsert.isPending;

  const onSave = (): void => {
    if (!canSave) return;
    upsert.mutate(
      {
        recordId: rule?.id,
        recordKind: 'recurring',
        data: encodeRecurring({
          txnKind,
          amount,
          currency: rule?.currency ?? currency,
          category,
          note: note.trim() || null,
          ...scheduleFor(frequency, { interval: months, secondDay }),
          anchorDate: startDate,
          // A rule already ahead of its start keeps its place in the queue; one
          // whose start has moved forward past it is pulled along with it. Either
          // way the auto-post path never goes backwards and re-mints months the
          // timeline can already show.
          nextDate: rule && rule.nextDate >= startDate ? rule.nextDate : startDate,
          endDate: rule?.endDate ?? null,
          autoPost,
          active,
        }),
      },
      { onSuccess: onClose },
    );
  };

  return (
    <Sheet visible onClose={onClose} padded={false} style={{ maxHeight: '90%' }}>
      <ScrollView
        contentContainerStyle={{ padding: theme.spacing.xl, gap: theme.spacing.lg }}
        keyboardShouldPersistTaps="handled"
      >
        <Row style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <Text variant="heading">{rule ? t.personal.editRecurring : t.personal.addRecurring}</Text>
          <IconButton label={t.common.close} onPress={onClose}>
            <Ionicons name="close" size={iconSize.lg} color={theme.color.text} />
          </IconButton>
        </Row>

        <SegmentedTabs
          value={txnKind}
          onChange={setTxnKind}
          tabs={[
            { value: 'expense', label: t.personal.expense },
            { value: 'income', label: t.personal.incomeKind },
          ]}
        />

        <View style={{ alignItems: 'center', paddingVertical: theme.spacing.md }}>
          <AmountField currency={rule?.currency ?? currency} value={amount} onChange={setAmount} />
        </View>

        <TextInput
          value={note}
          onChangeText={setNote}
          placeholder={t.personal.notePlaceholder}
          placeholderTextColor={theme.color.textFaint}
          style={{
            fontSize: 16,
            color: theme.color.text,
            paddingVertical: theme.spacing.md,
            paddingHorizontal: theme.spacing.lg,
            backgroundColor: theme.color.surfaceMuted,
            borderRadius: theme.radius.md,
          }}
        />

        {txnKind === 'expense' ? (
          <CategoryPicker value={category} onChange={(picked) => setCategory(picked)} />
        ) : (
          <View style={{ gap: theme.spacing.sm }}>
            <Text variant="caption" tone="muted">
              {t.personal.source}
            </Text>
            <SourcePicker value={category} onChange={setCategory} />
          </View>
        )}

        <View style={{ gap: theme.spacing.sm }}>
          <Text variant="caption" tone="muted">
            {t.personal.repeats}
          </Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ gap: theme.spacing.sm, paddingRight: theme.spacing.xl }}
          >
            {FREQUENCIES.map((option) => {
              const selected = option === frequency;
              const label = frequencyLabel(t, option, months);
              return (
                <Pressable
                  key={option}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  accessibilityLabel={label}
                  onPress={() => setFrequency(option)}
                  style={({ pressed }) => ({
                    minHeight: 44,
                    justifyContent: 'center',
                    paddingHorizontal: theme.spacing.md,
                    borderRadius: theme.radius.md,
                    borderWidth: 1,
                    borderColor: selected ? theme.color.brand : theme.color.border,
                    backgroundColor: selected ? theme.color.brandSoft : theme.color.surface,
                    opacity: pressed ? 0.7 : 1,
                  })}
                >
                  <Text
                    variant="body"
                    style={{ color: selected ? theme.color.brand : theme.color.text }}
                  >
                    {label}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>

          {/* Twice a month is two days of the month, so it asks for the second
              one. The first is whatever day the start date falls on. */}
          {frequency === Frequency.TwiceAMonth ? (
            <DayStepper
              label={t.personal.secondDay}
              value={secondDay}
              min={1}
              max={31}
              onChange={setSecondDay}
            />
          ) : null}

          {frequency === Frequency.EveryNMonths ? (
            <DayStepper
              label={t.personal.everyNMonths}
              value={months}
              min={2}
              max={24}
              onChange={setMonths}
            />
          ) : null}
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
          <Text variant="body">
            {t.personal.startsOn}: {startDate}
          </Text>
          <Ionicons name="calendar-outline" size={iconSize.md} color={theme.color.textMuted} />
        </Pressable>
        {showDate ? (
          <DateTimePicker
            value={new Date(`${startDate}T00:00:00`)}
            mode="date"
            onChange={(event, picked) => {
              if (Platform.OS !== 'ios') setShowDate(false);
              if (event.type === 'set' && picked) setStartDate(localIsoDate(picked));
            }}
          />
        ) : null}

        <Row style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <View style={{ flex: 1, paddingRight: theme.spacing.md }}>
            <Text variant="body">{t.personal.autoPost}</Text>
            <Text variant="micro" tone="muted">
              {t.personal.autoPostHint}
            </Text>
          </View>
          <Toggle
            value={autoPost}
            onValueChange={setAutoPost}
            accessibilityLabel={t.personal.autoPost}
          />
        </Row>

        {rule ? (
          <Row style={{ justifyContent: 'space-between', alignItems: 'center' }}>
            <Text variant="body">{t.personal.active}</Text>
            <Toggle
              value={active}
              onValueChange={setActive}
              accessibilityLabel={t.personal.active}
            />
          </Row>
        ) : null}

        <Button label={t.personal.save} size="lg" fullWidth onPress={onSave} disabled={!canSave} />

        {rule ? (
          <Button
            label={t.common.delete}
            variant="danger"
            fullWidth
            onPress={() =>
              void confirm({
                title: t.common.delete,
                body: t.personal.deleteConfirm,
                confirmLabel: t.common.delete,
                tone: 'danger',
              }).then((ok) => {
                if (ok) remove.mutate(rule.id, { onSuccess: onClose });
              })
            }
          />
        ) : null}
      </ScrollView>
    </Sheet>
  );
}

/**
 * Behind the section shield: one unlock covers the Me tab and every room
 * under `personal/`, so arriving here from the ledger never asks again.
 */
export default function RecurringScreen() {
  return (
    <PersonalGuard>
      <RecurringScreenBody />
    </PersonalGuard>
  );
}
