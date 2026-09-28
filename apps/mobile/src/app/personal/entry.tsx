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
 * `DetailRows` in the same `Card` that add-expense folds its date, category,
 * rail and currency into, and that the expense screen states a filed bill's
 * facts in. A short answer already filled in, changed from a sheet, read down
 * one column. The private ledger was the last place still asking those
 * questions as stacked captions and chip lanes.
 *
 * Reached from the Me tab's add buttons, from the ledger's "+", from the
 * recurring list (`repeats=1` to create, `recurringId` to edit), and — with a
 * `loanId` — as a loan repayment. A repayment is neither categorised nor
 * repeatable: the loan decides its direction and the schedule belongs to the
 * loan, not to one payment on it.
 */

import { useState, type ReactNode } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useLocalSearchParams } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import {
  ActivityIndicator,
  Image,
  Platform,
  Pressable,
  ScrollView,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  currencySymbol,
  FREQUENCIES,
  Frequency,
  frequencyOf,
  incomeSource,
  IncomeSourceId,
  type CurrencyCode,
  type PersonalRecurring,
  type PersonalTxn,
  type TxnKind,
} from '@waves/core';
import {
  AmountField,
  AmountKeypad,
  Button,
  Card,
  directionalIcon,
  IconButton,
  iconSize,
  Row,
  Screen,
  Text,
  Toggle,
  useTheme,
} from '@waves/ui';

import { CategoryBadge, CategorySheet } from '@/components/Category';
import { ChoiceRow, SheetOverlay } from '@/components/expense/SheetOverlay';
import { DetailRow, DetailRows } from '@/components/DetailRows';
import { PersonalNoteField } from '@/components/PersonalNoteField';
import { SourceSheet, useSourceLabel } from '@/components/IncomeSource';
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
import { routeAmount } from '@/lib/routeAmount';
import { useSync } from '@/sync';
import { useStrings } from '@/i18n';
import { PersonalGuard } from '@/components/PersonalGuard';
import { useBottomClearance } from '@/lib/clearance';
import { useDialog } from '@/lib/dialog';
import { frequencyLabel } from '@/lib/frequencyLabel';
import { entryRecord, NEW_REPEAT, repeatOf, type EntryRepeat } from '@/lib/personalEntry';
import { SPEC_ACCENT, SPEC_INK, SPEC_MUTED } from '@/lib/specPalette';

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
    /** Handed over by the quick sheet's "More details": what was already typed
        there, so the form opens on it rather than throwing it away. */
    amount?: string;
    currency?: string;
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
      startAmount={routeAmount(params.amount)}
      currency={editingTxn?.currency ?? editingRule?.currency ?? params.currency ?? dc}
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
  startAmount,
  currency,
  t,
}: {
  editingTxn?: PersonalTxn;
  editingRule?: PersonalRecurring;
  defaultKind: TxnKind;
  paramLoanId: string | null;
  startRepeating: boolean;
  /** What a hand-off already knows the amount to be; zero for a bare new entry. */
  startAmount: bigint;
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
  const [amount, setAmount] = useState<bigint>(editing?.amount ?? startAmount);
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
  const [picking, setPicking] = useState<'what' | 'repeat' | 'method' | null>(null);
  // How it was paid. A new entry starts on cash, the answer most spends have;
  // an existing one keeps what it has, or none.
  const [paymentMethod, setPaymentMethod] = useState<string | null>(
    editingTxn ? (editingTxn.paymentMethod ?? null) : 'cash',
  );

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
          paymentMethod: loanId ? null : paymentMethod,
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
    <Screen edges={[]}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: clearance }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <EntryHeader
          title={title}
          subtitle={
            editing
              ? null
              : kind === 'income'
                ? t.personal.entryScreen.incomeSub
                : t.personal.entryScreen.expenseSub
          }
          onDelete={editing ? onDelete : undefined}
        />

        <View
          style={{
            paddingHorizontal: theme.spacing.lg,
            marginTop: -theme.spacing.lg,
            gap: theme.spacing.lg,
          }}
        >
          {/* Which way the money went — the one question that has to be answered
              before any other field means anything, so it stays a control at the
              top. A repayment's direction is fixed by the loan, so only a plain
              entry chooses. */}
          {loanId ? null : <KindToggle value={kind} onChange={setKind} t={t} />}

          <AmountCard
            currency={currency}
            amount={amount}
            onChange={setAmount}
            calculatorLabel={t.personal.entryScreen.calculator}
          />

          {/* What it was for, as a row of the usual answers — the five most
              reached-for and More — with "View all" opening the whole list.
              Income asks where the money came from and an expense what it was
              spent on: two different questions, two different lists. */}
          {loanId ? null : (
            <QuickPicks
              kind={kind}
              value={category}
              onPick={setCategory}
              onMore={() => setPicking('what')}
              t={t}
            />
          )}

          <NoteCard value={note} onChange={setNote} t={t} />

          {/* The entry's facts, as one card of divided rows. */}
          <FormCard style={{ paddingVertical: 0, paddingHorizontal: theme.spacing.lg }}>
            <DetailRows>
              <DetailRow
                icon="calendar-outline"
                label={repeat ? t.personal.startsOn : t.personal.date}
                value={showDate(date, locale)}
                onPress={() => setShowDatePicker(true)}
              />

              {canRepeat || editingRule ? (
                <DetailRow
                  icon={repeat ? 'repeat' : 'repeat-outline'}
                  // Brand only once it actually repeats: the mark is then saying
                  // something the word beside it also says.
                  iconColor={repeat ? theme.color.brand : undefined}
                  label={t.personal.repeats}
                  value={
                    repeat
                      ? frequencyLabel(t, repeat.frequency, repeat.interval)
                      : t.personal.repeatsNever
                  }
                  onPress={() => setPicking('repeat')}
                />
              ) : null}

              {/* How it was paid belongs to a single entry; a repeating rule and
                  a loan repayment carry none. */}
              {repeat || loanId ? null : (
                <DetailRow
                  icon="wallet-outline"
                  label={t.personal.entryScreen.paymentMethod}
                  value={
                    paymentMethod ? methodLabel(t, paymentMethod) : t.personal.entryScreen.notSet
                  }
                  onPress={() => setPicking('method')}
                />
              )}
            </DetailRows>
          </FormCard>

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

          <SaveButton
            label={
              editing
                ? t.personal.save
                : kind === 'income'
                  ? t.personal.entryScreen.saveIncome
                  : t.personal.entryScreen.saveExpense
            }
            disabled={!canSave}
            onPress={onSave}
          />
        </View>
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

      {picking === 'method' ? (
        <PaymentMethodSheet
          value={paymentMethod}
          onChange={(next) => {
            setPaymentMethod(next);
            setPicking(null);
          }}
          onClose={() => setPicking(null)}
        />
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

// ───────────────────────────────────────────────────────────── the form's parts ──

/** The spec's violet and text colours, and the soft fill the amount sits in. */
const ACCENT = SPEC_ACCENT;
const accentOf = (theme: Theme): string => (theme.scheme === 'dark' ? theme.color.brand : ACCENT);
const inkOf = (theme: Theme): string => (theme.scheme === 'dark' ? theme.color.text : SPEC_INK);
const mutedOf = (theme: Theme): string =>
  theme.scheme === 'dark' ? theme.color.textMuted : SPEC_MUTED;

type Theme = ReturnType<typeof useTheme>;

/**
 * The header: the scene across the top (a calm desk by the water), the back
 * chevron, the title big and bold, and the line under it — then the page runs
 * on underneath. The picture is decoration, hidden from screen readers.
 */
function EntryHeader({
  title,
  subtitle,
  onDelete,
}: {
  title: string;
  subtitle: string | null;
  onDelete?: () => void;
}) {
  const theme = useTheme();
  const { t } = useStrings();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  // The picture fills the header: its natural height at this width, or the room
  // the title needs, whichever is taller — `cover` then crops the sides rather
  // than ever stretching it.
  const artHeight = Math.max(Math.round(width / ENTRY_ART_RATIO), insets.top + 230);
  return (
    <View style={{ minHeight: artHeight }}>
      <Image
        source={ENTRY_ART}
        resizeMode="cover"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={{ position: 'absolute', top: 0, left: 0, right: 0, height: artHeight }}
      />
      {/* A wash from the left so the dark title always reads over the picture,
          and the picture's foot fading into the page. */}
      <LinearGradient
        colors={[`${theme.color.bg}F2`, `${theme.color.bg}B3`, `${theme.color.bg}00`]}
        locations={[0, 0.45, 0.8]}
        start={{ x: 0, y: 0.5 }}
        end={{ x: 1, y: 0.5 }}
        style={{ position: 'absolute', top: 0, left: 0, right: 0, height: artHeight }}
      />
      <LinearGradient
        colors={[`${theme.color.bg}00`, theme.color.bg]}
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: artHeight * 0.72,
          height: artHeight * 0.28 + 1,
        }}
      />
      <View
        style={{
          paddingTop: insets.top + theme.spacing.sm,
          paddingHorizontal: theme.spacing.lg,
          paddingBottom: theme.spacing.xxl,
        }}
      >
        <Row style={{ alignItems: 'center', justifyContent: 'space-between' }}>
          <IconButton label={t.common.back} onPress={() => router.back()}>
            <Ionicons
              name={directionalIcon('chevron-back')}
              size={iconSize.xl}
              color={inkOf(theme)}
            />
          </IconButton>
          {onDelete ? (
            <IconButton label={t.common.delete} onPress={onDelete}>
              <Ionicons name="trash-outline" size={iconSize.md} color={theme.color.negative} />
            </IconButton>
          ) : null}
        </Row>
        <Text
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.8}
          style={{
            marginTop: theme.spacing.lg,
            maxWidth: '72%',
            fontSize: 34,
            lineHeight: 40,
            fontWeight: '800',
            color: inkOf(theme),
          }}
        >
          {title}
        </Text>
        {subtitle ? (
          <Text
            style={{
              marginTop: 4,
              maxWidth: '64%',
              fontSize: 17,
              lineHeight: 23,
              color: mutedOf(theme),
            }}
          >
            {subtitle}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

/** Expense or income, as a two-way pill: the chosen side filled in the accent
 *  with its arrow, the other quiet on the track. */
function KindToggle({
  value,
  onChange,
  t,
}: {
  value: TxnKind;
  onChange: (next: TxnKind) => void;
  t: ReturnType<typeof useStrings>['t'];
}) {
  const theme = useTheme();
  const options: { value: TxnKind; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
    { value: 'expense', label: t.personal.expense, icon: 'arrow-up' },
    { value: 'income', label: t.personal.incomeKind, icon: 'arrow-down' },
  ];
  return (
    <Row
      accessibilityRole="tablist"
      style={{
        padding: 4,
        borderRadius: 30,
        backgroundColor: theme.scheme === 'dark' ? theme.color.surfaceMuted : '#ECEBF6',
      }}
    >
      {options.map((option) => {
        const active = option.value === value;
        const ink = active ? '#FFFFFF' : inkOf(theme);
        return (
          <Pressable
            key={option.value}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            accessibilityLabel={option.label}
            onPress={() => onChange(option.value)}
            style={({ pressed }) => ({
              flex: 1,
              height: 50,
              borderRadius: 26,
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: theme.spacing.sm,
              backgroundColor: active ? accentOf(theme) : 'transparent',
              opacity: pressed ? 0.8 : 1,
            })}
          >
            {/* The arrow tilts the way the money goes: out and up for a spend,
                in and down for money received. */}
            <Ionicons
              name={option.icon}
              size={18}
              color={ink}
              style={{ transform: [{ rotate: '45deg' }] }}
            />
            <Text style={{ fontSize: 17, fontWeight: '600', color: ink }}>{option.label}</Text>
          </Pressable>
        );
      })}
    </Row>
  );
}

/** The amount on a soft card: the currency in a disc, a rule, the figure big and
 *  left-set, and a calculator that opens the keypad under it. */
function AmountCard({
  currency,
  amount,
  onChange,
  calculatorLabel,
}: {
  currency: string;
  amount: bigint;
  onChange: (next: bigint) => void;
  calculatorLabel: string;
}) {
  const theme = useTheme();
  const [calculating, setCalculating] = useState(false);
  // The keypad keeps its own pending entry. An amount typed straight into the
  // field starts it afresh, or the next key would append to the old entry and
  // overwrite what was just typed.
  const [keypadRun, setKeypadRun] = useState(0);
  return (
    <View
      style={{
        gap: theme.spacing.md,
        padding: theme.spacing.lg,
        borderRadius: 24,
        backgroundColor: theme.scheme === 'dark' ? theme.color.surfaceMuted : '#F1F0FA',
      }}
    >
      <Row style={{ alignItems: 'center', gap: theme.spacing.md }}>
        <View
          style={{
            width: 48,
            height: 48,
            borderRadius: 24,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: theme.color.brandSoft,
          }}
        >
          <Text style={{ fontSize: 22, fontWeight: '700', color: accentOf(theme) }}>
            {currencySymbol(currency as CurrencyCode)}
          </Text>
        </View>
        <View style={{ width: 1.5, height: 44, backgroundColor: accentOf(theme), opacity: 0.6 }} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <AmountField
            currency={currency as CurrencyCode}
            value={amount}
            onChange={(next) => {
              onChange(next);
              setKeypadRun((run) => run + 1);
            }}
            showSymbol={false}
            align="start"
          />
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={calculatorLabel}
          accessibilityState={{ expanded: calculating }}
          onPress={() => setCalculating((open) => !open)}
          hitSlop={4}
          style={({ pressed }) => ({
            width: 46,
            height: 46,
            borderRadius: 23,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: calculating ? theme.color.brandSoft : theme.color.surface,
            opacity: pressed ? 0.7 : 1,
          })}
        >
          <Ionicons
            name="calculator-outline"
            size={iconSize.md}
            color={calculating ? accentOf(theme) : inkOf(theme)}
          />
        </Pressable>
      </Row>
      {calculating ? (
        <AmountKeypad
          key={keypadRun}
          currency={currency as CurrencyCode}
          value={amount}
          onChange={onChange}
        />
      ) : null}
    </View>
  );
}

/** The five everyday answers and More, as tinted discs over their names. The
 *  chosen one is framed; one picked from the full list takes the first place. */
function QuickPicks({
  kind,
  value,
  onPick,
  onMore,
  t,
}: {
  kind: TxnKind;
  value: string | null;
  onPick: (next: string) => void;
  onMore: () => void;
  t: ReturnType<typeof useStrings>['t'];
}) {
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const sourceLabel = useSourceLabel();
  const income = kind === 'income';
  // Five picks and More need about 320pt before the form's padding; a narrower
  // phone shows four, so no disc overflows its tile.
  const shown = width < NARROW_PICKS ? 4 : 5;
  const all = income ? QUICK_SOURCES : QUICK_CATEGORIES;
  const base = all.slice(0, shown);
  const ids = value && !base.includes(value) ? [value, ...base.slice(0, shown - 1)] : base;
  const labelOf = (id: string): string =>
    (income
      ? sourceLabel(id)
      : (t.categories[id as keyof typeof t.categories] as string | undefined)) ??
    t.categories.other;
  return (
    <View style={{ gap: theme.spacing.md }}>
      <Row style={{ alignItems: 'center', justifyContent: 'space-between' }}>
        <Text style={{ fontSize: 19, fontWeight: '600', color: inkOf(theme) }}>
          {income ? t.personal.entryScreen.source : t.personal.entryScreen.category}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t.personal.entryScreen.viewAll}
          onPress={onMore}
          hitSlop={8}
          style={({ pressed }) => ({
            flexDirection: 'row',
            alignItems: 'center',
            gap: 2,
            opacity: pressed ? 0.5 : 1,
          })}
        >
          <Text style={{ fontSize: 15, color: mutedOf(theme) }}>
            {t.personal.entryScreen.viewAll}
          </Text>
          <Ionicons
            name={directionalIcon('chevron-forward')}
            size={iconSize.sm}
            color={mutedOf(theme)}
          />
        </Pressable>
      </Row>
      <Row style={{ gap: 4 }}>
        {ids.map((id) => (
          <PickTile
            key={id}
            label={labelOf(id)}
            selected={id === value}
            onPress={() => onPick(id)}
            disc={
              income ? (
                <SourceDisc id={id} />
              ) : (
                <CategoryBadge category={id} meta={null} size={PICK_DISC} />
              )
            }
          />
        ))}
        <PickTile
          label={t.personal.entryScreen.more}
          selected={false}
          onPress={onMore}
          disc={
            <View
              style={{
                width: PICK_DISC,
                height: PICK_DISC,
                borderRadius: PICK_DISC / 2,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: theme.color.surfaceMuted,
              }}
            >
              <Ionicons name="ellipsis-horizontal" size={22} color={inkOf(theme)} />
            </View>
          }
        />
      </Row>
    </View>
  );
}

/** One quick pick: its disc over its name, framed in the accent when chosen. */
function PickTile({
  label,
  selected,
  onPress,
  disc,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  disc: ReactNode;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: selected, selected }}
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => ({
        flex: 1,
        minWidth: 0,
        alignItems: 'center',
        gap: 6,
        paddingVertical: 8,
        borderRadius: 18,
        borderWidth: 1.5,
        borderColor: selected ? accentOf(theme) : 'transparent',
        backgroundColor: selected && theme.scheme !== 'dark' ? '#FFFFFF' : 'transparent',
        opacity: pressed ? 0.7 : 1,
      })}
    >
      {disc}
      <Text
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.8}
        style={{
          fontSize: 13,
          fontWeight: selected ? '600' : '500',
          color: selected ? accentOf(theme) : inkOf(theme),
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

/** An income source's disc: its glyph on its own pastel. */
function SourceDisc({ id }: { id: string }) {
  const theme = useTheme();
  const source = incomeSource(id);
  const tint = theme.tint[source?.tint ?? 'lilac'];
  return (
    <View
      style={{
        width: PICK_DISC,
        height: PICK_DISC,
        borderRadius: PICK_DISC / 2,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: tint.bg,
      }}
    >
      <Ionicons
        name={(source?.icon ?? 'cash-outline') as keyof typeof Ionicons.glyphMap}
        size={22}
        color={tint.ink}
      />
    </View>
  );
}

/** What it was for: a glyph, the question, and the note typed under it. */
function NoteCard({
  value,
  onChange,
  t,
}: {
  value: string;
  onChange: (next: string) => void;
  t: ReturnType<typeof useStrings>['t'];
}) {
  const theme = useTheme();
  return (
    <FormCard style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.lg }}>
      <Ionicons name="document-text-outline" size={26} color={inkOf(theme)} />
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Text style={{ fontSize: 17, fontWeight: '600', color: mutedOf(theme) }}>
          {t.personal.entryScreen.whatFor}
        </Text>
        {/* The shared note field, so the note can be spoken as well as typed —
            the mic sits at the end of the line. */}
        <PersonalNoteField
          value={value}
          onChange={onChange}
          placeholder={t.personal.entryScreen.notePlaceholder}
          accessibilityLabel={t.personal.note}
          plain
        />
      </View>
    </FormCard>
  );
}

/** A white card with the redesign's soft corners and lift. */
function FormCard({ children, style }: { children: ReactNode; style?: object }) {
  const theme = useTheme();
  return (
    <View
      style={[
        {
          backgroundColor: theme.color.surface,
          borderRadius: 22,
          padding: theme.spacing.lg,
          shadowColor: '#2A1E6B',
          shadowOpacity: 0.05,
          shadowRadius: 12,
          shadowOffset: { width: 0, height: 4 },
          elevation: 1,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

/** Save, as a full-width solid pill in the accent. */
function SaveButton({
  label,
  disabled,
  onPress,
}: {
  label: string;
  disabled: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        height: 58,
        borderRadius: 29,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: accentOf(theme),
        shadowColor: ACCENT,
        shadowOpacity: 0.28,
        shadowRadius: 12,
        shadowOffset: { width: 0, height: 6 },
        elevation: 3,
        opacity: disabled ? 0.5 : pressed ? 0.85 : 1,
      })}
    >
      <Text style={{ fontSize: 18, fontWeight: '700', color: '#FFFFFF' }}>{label}</Text>
    </Pressable>
  );
}

/** How it was paid, as a sheet of the usual answers. */
function PaymentMethodSheet({
  value,
  onChange,
  onClose,
}: {
  value: string | null;
  onChange: (next: string | null) => void;
  onClose: () => void;
}): React.JSX.Element {
  const theme = useTheme();
  const { t } = useStrings();
  return (
    <SheetOverlay title={t.personal.entryScreen.paymentMethod} onClose={onClose}>
      <View style={{ gap: theme.spacing.xs }}>
        {/* Unset, so a method picked by mistake can be taken back. */}
        <ChoiceRow
          label={t.personal.entryScreen.notSet}
          selected={value === null}
          leading={
            <Ionicons
              name="remove-circle-outline"
              size={iconSize.md}
              color={value === null ? theme.color.brand : theme.color.textMuted}
            />
          }
          onPress={() => onChange(null)}
        />
        {PAYMENT_METHODS.map((method) => (
          <ChoiceRow
            key={method.id}
            label={methodLabel(t, method.id)}
            selected={value === method.id}
            leading={
              <Ionicons
                name={method.icon}
                size={iconSize.md}
                color={value === method.id ? theme.color.brand : theme.color.textMuted}
              />
            }
            onPress={() => onChange(method.id)}
          />
        ))}
      </View>
    </SheetOverlay>
  );
}

type MethodId = 'cash' | 'upi' | 'card' | 'bank' | 'wallet' | 'other';

const PAYMENT_METHODS: readonly { id: MethodId; icon: keyof typeof Ionicons.glyphMap }[] = [
  { id: 'cash', icon: 'cash-outline' },
  { id: 'upi', icon: 'phone-portrait-outline' },
  { id: 'card', icon: 'card-outline' },
  { id: 'bank', icon: 'business-outline' },
  { id: 'wallet', icon: 'wallet-outline' },
  { id: 'other', icon: 'ellipsis-horizontal' },
];

/** A stored method in words; one this version does not know reads "Other". */
function methodLabel(t: ReturnType<typeof useStrings>['t'], id: string): string {
  const known = t.personal.entryScreen.methods as Record<string, string>;
  return known[id] ?? t.personal.entryScreen.methods.other;
}

/** The everyday answers the quick row offers, before "More". */
const QUICK_CATEGORIES: readonly string[] = ['food', 'shopping', 'travel', 'home', 'health'];
const QUICK_SOURCES: readonly string[] = [
  IncomeSourceId.Salary,
  IncomeSourceId.Business,
  IncomeSourceId.Freelance,
  IncomeSourceId.Bonus,
  IncomeSourceId.Refund,
];

/** A quick pick's disc. */
const PICK_DISC = 50;
/** Below this window width the quick row offers four picks rather than five. */
const NARROW_PICKS = 375;

/** The header's picture — a lake at sunrise, a cup of coffee and a notebook on
 *  a table — and its shape (width over height). */
const ENTRY_ART = require('../../../assets/images/entry-header.webp') as number;
const ENTRY_ART_RATIO = 1852 / 849;

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
