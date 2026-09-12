/**
 * The private ledger's one form (A56) — an expense or an income, once or
 * repeating. No group, no split, no members: an amount, what it was for, when,
 * and whether it happens again.
 *
 * It used to be three forms. "Add expense" and "Add income" were two buttons
 * into this screen, which then asked the same question again with a segmented
 * control; and "Recurring" was a room of its own holding a second editor that
 * forked into expense and income for a third time. Three ways to say the same
 * sentence, each laid out differently, and the person had to answer "which
 * screen am I on" before they could answer "what happened". So: one form.
 * Direction is a control inside it, and repeating is a property of the entry —
 * a row that reads "Never" until it reads "Monthly".
 *
 * The recurring *list* is still its own screen, because a list of rules and the
 * form that writes one are different things; it now opens this form instead of
 * carrying an editor of its own.
 *
 * The fields below the amount are the rows the expense screens use — the same
 * `SettingRow` in the same `Card` that add-expense folds its date, category,
 * rail and currency into. A short answer already filled in, changed from a
 * sheet, read down one column. The private ledger was the last place still
 * asking those questions as stacked captions and chip lanes.
 *
 * Reached from the Me tab's add buttons, from the ledger's "+", from the
 * recurring list (`repeats=1` to create, `recurringId` to edit), and — with a
 * `loanId` — as a loan repayment. A repayment is neither categorised nor
 * repeatable: the loan decides its direction and the schedule belongs to the
 * loan, not to one payment on it.
 */

import { useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, Platform, Pressable, ScrollView, View } from 'react-native';

import {
  FREQUENCIES,
  Frequency,
  frequencyOf,
  type PersonalRecurring,
  type PersonalTxn,
  type TxnKind,
} from '@waves/core';
import {
  AmountField,
  Button,
  Card,
  directionalIcon,
  Divider,
  IconButton,
  iconSize,
  Row,
  Screen,
  SegmentedTabs,
  Text,
  Toggle,
  useTheme,
} from '@waves/ui';

import { CategoryRow, CategorySheet } from '@/components/Category';
import { ChoiceRow, SettingRow, SheetOverlay } from '@/components/expense/SheetOverlay';
import { SourceRow, SourceSheet } from '@/components/IncomeSource';
import { PersonalNoteField } from '@/components/PersonalNoteField';
import {
  localIsoDate,
  todayIso,
  useDeletePersonalRecord,
  usePersonalLedger,
  useUpsertPersonalRecord,
} from '@/data/personal';
import { useDefaultCurrency } from '@/lib/currency';
import { dateFrom, showDate } from '@/lib/expenseDay';
import { router } from '@/lib/navigation';
import { useSync } from '@/sync';
import { useStrings } from '@/i18n';
import { PersonalGuard } from '@/components/PersonalGuard';
import { useBottomClearance } from '@/lib/clearance';
import { useDialog } from '@/lib/dialog';
import { frequencyLabel } from '@/lib/frequencyLabel';
import { entryRecord, NEW_REPEAT, repeatOf, type EntryRepeat } from '@/lib/personalEntry';

function PersonalEntryScreenBody() {
  const theme = useTheme();
  const { t } = useStrings();
  const dc = useDefaultCurrency();
  const params = useLocalSearchParams<{
    kind?: string;
    id?: string;
    loanId?: string;
    recurringId?: string;
    repeats?: string;
  }>();
  const { hydrated } = useSync();
  const { txns, recurrings } = usePersonalLedger();

  const editingTxn = params.id ? txns.find((txn) => txn.id === params.id) : undefined;
  const editingRule = params.recurringId
    ? recurrings.find((rule) => rule.id === params.recurringId)
    : undefined;

  // Editing an id that has not resolved — a transaction or a rule, the same two
  // very different cases either way:
  //  - the mirror is still loading from disk (`!hydrated`): hold a spinner rather
  //    than render a blank form whose Save would overwrite the record with empties;
  //  - hydration is done and the id still isn't there (deleted, or a stale link):
  //    say so and offer a way back, instead of a spinner that never ends.
  if ((params.id || params.recurringId) && !editingTxn && !editingRule) {
    return (
      <Screen>
        <View
          style={{
            flex: 1,
            alignItems: 'center',
            justifyContent: 'center',
            gap: theme.spacing.lg,
            padding: theme.spacing.xl,
          }}
        >
          {hydrated ? (
            <>
              <Text tone="muted" align="center">
                {t.personal.entryMissing}
              </Text>
              <Button label={t.common.back} variant="secondary" onPress={() => router.back()} />
            </>
          ) : (
            <ActivityIndicator color={theme.color.brand} />
          )}
        </View>
      </Screen>
    );
  }

  // Keyed so a create and each distinct edited record mount their own fresh form.
  return (
    <EntryForm
      key={editingTxn?.id ?? editingRule?.id ?? 'new'}
      editingTxn={editingTxn}
      editingRule={editingRule}
      defaultKind={params.kind === 'income' ? 'income' : 'expense'}
      paramLoanId={typeof params.loanId === 'string' ? params.loanId : null}
      startRepeating={params.repeats === '1'}
      currency={editingTxn?.currency ?? editingRule?.currency ?? dc}
      t={t}
    />
  );
}

function EntryForm({
  editingTxn,
  editingRule,
  defaultKind,
  paramLoanId,
  startRepeating,
  currency,
  t,
}: {
  editingTxn?: PersonalTxn;
  editingRule?: PersonalRecurring;
  defaultKind: TxnKind;
  paramLoanId: string | null;
  startRepeating: boolean;
  currency: string;
  t: ReturnType<typeof useStrings>['t'];
}) {
  const theme = useTheme();
  const { locale } = useStrings();
  const { confirm } = useDialog();
  const clearance = useBottomClearance();
  const upsert = useUpsertPersonalRecord();
  const remove = useDeletePersonalRecord();

  const editing = editingTxn ?? editingRule;
  const [kind, setKind] = useState<TxnKind>(
    editingTxn?.kind ?? editingRule?.txnKind ?? defaultKind,
  );
  const [amount, setAmount] = useState<bigint>(editing?.amount ?? 0n);
  const [note, setNote] = useState(editing?.note ?? '');
  const [category, setCategory] = useState<string | null>(editing?.category ?? null);
  // For a one-off this is the day it happened; for a repeating one it is the day
  // the schedule *starts*, which is why an existing rule opens on its anchor and
  // not on its next due date. A rule can only be told it began last year from
  // here, and knowing which months are missing is the whole point of its
  // timeline.
  const [date, setDate] = useState(editingRule?.anchorDate || editingTxn?.date || todayIso());
  const [repeat, setRepeat] = useState<EntryRepeat | null>(
    editingRule
      ? repeatOf(editingRule, frequencyOf(editingRule))
      : startRepeating
        ? NEW_REPEAT
        : null,
  );
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [picking, setPicking] = useState<'what' | 'repeat' | null>(null);

  // A repayment carries the loan it settles through from the loans screen; kept
  // as-is on an edit so the link survives.
  const loanId = editingTxn?.loanId ?? paramLoanId;
  // A repayment answers to its loan, and an existing transaction cannot grow a
  // schedule: the two are different record kinds under different ids, so making
  // one into the other would either orphan the entry or mint a second copy of
  // it. Write a rule from a fresh entry instead, or edit the rule itself.
  const canRepeat = !loanId && !editingTxn;
  // An existing rule has no way back to "Never" either, for the same reason.
  // Stopping one is what pausing and deleting are for, and both are on this
  // screen.
  const canStopRepeating = !editingRule;

  const canSave = amount > 0n && !upsert.isPending;

  const onSave = (): void => {
    if (!canSave) return;
    upsert.mutate(
      entryRecord(
        {
          kind,
          amount,
          currency,
          category: loanId ? null : category,
          note: note.trim() || null,
          date,
          loanId,
          recurringId: editingTxn?.recurringId ?? null,
        },
        // Belt and braces: neither a repayment nor an existing transaction can
        // reach a repeat state at all, and a save is the wrong place to find
        // out that a form let somebody set something it had nowhere to put.
        canRepeat || editingRule !== undefined ? repeat : null,
        { txn: editingTxn, rule: editingRule },
      ),
      { onSuccess: () => router.back() },
    );
  };

  const onDelete = async (): Promise<void> => {
    if (!editing) return;
    const ok = await confirm({
      title: t.common.delete,
      body: t.personal.deleteConfirm,
      confirmLabel: t.common.delete,
      tone: 'danger',
    });
    if (ok) remove.mutate(editing.id, { onSuccess: () => router.back() });
  };

  const title = editingRule
    ? t.personal.editRecurring
    : editingTxn
      ? t.personal.transactions
      : kind === 'income'
        ? t.personal.addIncome
        : t.personal.addExpense;

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
          <Text variant="heading">{title}</Text>
        </View>
        {editing ? (
          <IconButton label={t.common.delete} onPress={onDelete}>
            <Ionicons name="trash-outline" size={iconSize.md} color={theme.color.negative} />
          </IconButton>
        ) : (
          <View style={{ width: iconSize.lg }} />
        )}
      </Row>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          paddingHorizontal: theme.spacing.xl,
          paddingTop: theme.spacing.lg,
          paddingBottom: clearance,
          gap: theme.spacing.lg,
        }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Which way the money went — the one question that has to be answered
            before any other field means anything, so it stays a control at the
            top rather than a row among the details. A repayment's direction is
            fixed by the loan, so only a plain entry chooses. */}
        {loanId ? null : (
          <SegmentedTabs
            value={kind}
            onChange={setKind}
            tabs={[
              { value: 'expense', label: t.personal.expense },
              { value: 'income', label: t.personal.incomeKind },
            ]}
          />
        )}

        <View style={{ alignItems: 'center', paddingVertical: theme.spacing.sm }}>
          <AmountField currency={currency} value={amount} onChange={setAmount} />
        </View>

        <PersonalNoteField
          value={note}
          onChange={setNote}
          placeholder={t.personal.notePlaceholder}
          accessibilityLabel={t.personal.note}
        />

        {/* The entry's facts, as one card of divided rows — the shape the
            expense form wears under its receipt. Each of these is the same kind
            of question: a short answer, already filled in, changed from a sheet.
            They used to be a caption over a horizontally scrolling lane of chips
            and a grey date well, which made three settings look like three
            separate parts of a form.

            Income asks where the money came from and an expense asks what it was
            spent on. The two are different questions and once shared one picker,
            which is how a salary ended up filed under "Other". */}
        <Card style={{ paddingVertical: theme.spacing.xs, gap: 0 }}>
          {loanId ? null : (
            <>
              {kind === 'income' ? (
                <SourceRow value={category} onPress={() => setPicking('what')} />
              ) : (
                <CategoryRow value={category} onPress={() => setPicking('what')} />
              )}
              <Divider />
            </>
          )}

          <SettingRow
            label={repeat ? t.personal.startsOn : t.personal.date}
            value={showDate(date, locale)}
            leading={
              <Ionicons name="calendar-outline" size={iconSize.md} color={theme.color.textMuted} />
            }
            onPress={() => setShowDatePicker(true)}
          />

          {canRepeat || editingRule ? (
            <>
              <Divider />
              <SettingRow
                label={t.personal.repeats}
                value={
                  repeat
                    ? frequencyLabel(t, repeat.frequency, repeat.interval)
                    : t.personal.repeatsNever
                }
                leading={
                  <Ionicons
                    name={repeat ? 'repeat' : 'repeat-outline'}
                    size={iconSize.md}
                    color={repeat ? theme.color.brand : theme.color.textMuted}
                  />
                }
                onPress={() => setPicking('repeat')}
              />
            </>
          ) : null}
        </Card>

        {showDatePicker ? (
          <DateTimePicker
            value={dateFrom(date)}
            mode="date"
            onChange={(event, picked) => {
              // Android fires once and dismisses itself; iOS stays open.
              if (Platform.OS !== 'ios') setShowDatePicker(false);
              if (event.type === 'set' && picked) setDate(localIsoDate(picked));
            }}
          />
        ) : null}

        {/* Everything that only means something once the entry repeats, kept
            below the facts rather than inside the pattern sheet: the sheet
            answers "how often", and these are what the answer then implies. The
            block simply is not there while the entry happens once, which is the
            common case and the reason the form is short again. */}
        {repeat ? (
          <Card style={{ gap: theme.spacing.md }}>
            {repeat.frequency === Frequency.TwiceAMonth ? (
              <DayStepper
                label={t.personal.secondDay}
                value={repeat.secondDay}
                min={1}
                max={31}
                onChange={(secondDay) => setRepeat({ ...repeat, secondDay })}
              />
            ) : null}

            {repeat.frequency === Frequency.EveryNMonths ? (
              <DayStepper
                label={t.personal.everyNMonths}
                value={repeat.interval}
                min={2}
                max={24}
                onChange={(interval) => setRepeat({ ...repeat, interval })}
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
                value={repeat.autoPost}
                onValueChange={(autoPost) => setRepeat({ ...repeat, autoPost })}
                accessibilityLabel={t.personal.autoPost}
              />
            </Row>

            {/* Pausing belongs to a rule that already exists — a new one is
                being written precisely because it is meant to run. */}
            {editingRule ? (
              <Row style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                <Text variant="body">{t.personal.active}</Text>
                <Toggle
                  value={repeat.active}
                  onValueChange={(active) => setRepeat({ ...repeat, active })}
                  accessibilityLabel={t.personal.active}
                />
              </Row>
            ) : null}
          </Card>
        ) : null}

        <Button label={t.personal.save} size="lg" fullWidth onPress={onSave} disabled={!canSave} />
      </ScrollView>

      {picking === 'what' ? (
        kind === 'income' ? (
          <SourceSheet
            value={category}
            onChange={(picked) => {
              setCategory(picked);
              setPicking(null);
            }}
            onClose={() => setPicking(null)}
          />
        ) : (
          <CategorySheet
            value={category}
            onChange={(picked) => {
              setCategory(picked);
              setPicking(null);
            }}
            onClose={() => setPicking(null)}
          />
        )
      ) : null}

      {picking === 'repeat' ? (
        <RepeatSheet
          value={repeat}
          canStop={canStopRepeating}
          onChange={(next) => {
            setRepeat(next);
            setPicking(null);
          }}
          onClose={() => setPicking(null)}
        />
      ) : null}
    </Screen>
  );
}

/**
 * How often, as a sheet of named patterns — the same list of choices with a
 * check against the one in force that every other short answer on this form
 * opens.
 *
 * "Never" leads it, because not repeating is what almost every entry is, and
 * because the row it comes back to has to be able to say so. It is offered only
 * while the form is writing a transaction: a rule cannot become a one-off
 * without abandoning the history filed under its id, so an existing one is
 * stopped by pausing or deleting it instead.
 */
function RepeatSheet({
  value,
  canStop,
  onChange,
  onClose,
}: {
  value: EntryRepeat | null;
  canStop: boolean;
  onChange: (next: EntryRepeat | null) => void;
  onClose: () => void;
}): React.JSX.Element {
  const theme = useTheme();
  const { t } = useStrings();
  const base = value ?? NEW_REPEAT;

  return (
    <SheetOverlay title={t.personal.repeats} onClose={onClose}>
      <View style={{ gap: theme.spacing.xs }}>
        {canStop ? (
          <ChoiceRow
            label={t.personal.repeatsNever}
            selected={value === null}
            leading={
              <Ionicons
                name="close-circle-outline"
                size={iconSize.md}
                color={theme.color.textMuted}
              />
            }
            onPress={() => onChange(null)}
          />
        ) : null}
        {FREQUENCIES.map((option) => (
          <ChoiceRow
            key={option}
            label={frequencyLabel(t, option, base.interval)}
            selected={value?.frequency === option}
            leading={
              <Ionicons
                name="repeat"
                size={iconSize.md}
                color={value?.frequency === option ? theme.color.brand : theme.color.textMuted}
              />
            }
            onPress={() => onChange({ ...base, frequency: option })}
          />
        ))}
      </View>
    </SheetOverlay>
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
        backgroundColor: theme.color.surfaceMuted,
        opacity: disabled ? 0.4 : pressed ? 0.6 : 1,
      })}
    >
      <Ionicons name={icon} size={iconSize.md} color={theme.color.text} />
    </Pressable>
  );

  return (
    <Row style={{ justifyContent: 'space-between', alignItems: 'center' }}>
      <Text variant="body" style={{ flexShrink: 1, minWidth: 0 }}>
        {label}
      </Text>
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

/**
 * Behind the section shield: one unlock covers the Me tab and every room
 * under `personal/`, so arriving here from the ledger never asks again.
 */
export default function PersonalEntryScreen() {
  return (
    <PersonalGuard>
      <PersonalEntryScreenBody />
    </PersonalGuard>
  );
}
