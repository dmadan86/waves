/**
 * Change a repeating group expense: every part of it.
 *
 * Built from the expense form's own pieces rather than a lookalike — the same
 * description field, amount field, category list, split chips and participant
 * rows, driven by the same `ExpenseEditState` — plus the repeat sheet the
 * personal ledger uses for "how often". The state becomes a template, the core
 * validates it and diffs it against the saved rule (`recurringFullPatch`), and
 * only what changed is sent. The server makes the editor the author of what
 * posts next, and never back-pays: a new schedule starts from today.
 *
 * The currency is not editable (a repeating expense never converts and a rule
 * has no exchange rate), and an adjusted or itemised split is kept as saved.
 */

import { useMemo, useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { useLocalSearchParams } from 'expo-router';
import { Platform, Pressable, ScrollView, TextInput, View } from 'react-native';

import {
  editFromRule,
  Frequency,
  recurringEditProblem,
  recurringFullPatch,
  type CurrencyCode,
  type GroupRecurringWhen,
  type MemberId,
} from '@waves/core';
import {
  AmountField,
  Avatar,
  Button,
  Callout,
  Card,
  directionalIcon,
  IconButton,
  iconSize,
  Row,
  Screen,
  Text,
  useTheme,
} from '@waves/ui';

import { CategoryRow, CategorySheet } from '@/components/Category';
import { DetailRow, DetailRows } from '@/components/DetailRows';
import { DescriptionField } from '@/components/expense/DescriptionField';
import { ChoiceRow, SheetOverlay } from '@/components/expense/SheetOverlay';
import { SplitKindChips, SplitParticipants } from '@/components/expense/SplitEditor';
import { DayStepper, RepeatSheet } from '@/components/RepeatPicker';
import { useGroupRecurring, useUpdateGroupRecurring } from '@/data/groupRecurring';
import { useGroup } from '@/data/hooks';
import { displayName, isGhost } from '@/data/types';
import { fill, useStrings } from '@/i18n';
import { useBottomClearance } from '@/lib/clearance';
import { friendlyError } from '@/lib/errors';
import {
  editBlocker,
  entriesFor,
  lineAmountFor,
  previewShares,
  splitIssueFor,
  splitParamsFor,
  type ExpenseEditState,
} from '@/lib/expenseEdit';
import { dateFrom, isoDate, showDate } from '@/lib/expenseDay';
import { frequencyLabel } from '@/lib/frequencyLabel';
import { editStateFromRule, splitIsEditable, templateFromState } from '@/lib/groupRecurringEdit';
import { fillEntries, SplitKind, type SplitEntries } from '@/lib/split';
import { useViewerId } from '@/lib/auth';
import { router } from '@/lib/navigation';

export default function GroupRecurringEditScreen() {
  const { id, ruleId } = useLocalSearchParams<{ id: string; ruleId?: string }>();
  const groupId = id ?? '';
  const { rules, isLoading } = useGroupRecurring(groupId);
  const rule = rules.find((candidate) => candidate.id === ruleId);
  const theme = useTheme();
  const { t } = useStrings();

  if (!rule) {
    return (
      <Screen>
        <Row style={{ paddingHorizontal: theme.spacing.xl, paddingTop: theme.spacing.md }}>
          <IconButton label={t.common.back} onPress={() => router.back()}>
            <Ionicons
              name={directionalIcon('chevron-back')}
              size={iconSize.lg}
              color={theme.color.text}
            />
          </IconButton>
        </Row>
        {isLoading ? null : (
          <Text tone="muted" align="center" style={{ paddingTop: theme.spacing.xxxl }}>
            {t.groupRecurring.empty}
          </Text>
        )}
      </Screen>
    );
  }
  // Keyed by the rule so a sync that rewrites it does not rewrite a half-made edit.
  return <EditForm key={rule.id} groupId={groupId} ruleId={rule.id} />;
}

function EditForm({ groupId, ruleId }: { groupId: string; ruleId: string }) {
  const theme = useTheme();
  const clearance = useBottomClearance();
  const { t, locale } = useStrings();
  const r = t.groupRecurring;
  const viewerId = useViewerId();
  const { members } = useGroup(groupId);
  const { rules } = useGroupRecurring(groupId);
  const update = useUpdateGroupRecurring(groupId);
  // The rule as it was when the form opened; the diff is against this.
  const [rule] = useState(() => rules.find((candidate) => candidate.id === ruleId)!);

  const [state, setState] = useState<ExpenseEditState>(() => editStateFromRule(rule));
  const [notes, setNotes] = useState(rule.notes ?? '');
  const [when, setWhen] = useState<GroupRecurringWhen>(() => editFromRule(rule).when);
  const [picking, setPicking] = useState<'category' | 'payer' | 'repeat' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const people = members.data ?? [];
  const live = people.filter(
    (member) => member.left_at === null || state.participants.includes(member.id),
  );
  const editableSplit = splitIsEditable(rule);

  // Everyone in a weighted split needs a number to start from (as the form does).
  if (state.splitKind === SplitKind.Shares) {
    const filled = fillEntries('shares', state.weights, state.participants);
    if (filled) setState((current) => ({ ...current, weights: filled }));
  } else if (state.splitKind === SplitKind.Percent) {
    const filled = fillEntries('percent', state.percents, state.participants);
    if (filled) setState((current) => ({ ...current, percents: filled }));
  }

  const template = useMemo(() => templateFromState(state, rule, notes), [state, rule, notes]);
  const problem = recurringEditProblem({ template, when });
  const patch = recurringFullPatch(rule, { template, when });
  const splitIssue = splitIssueFor(state, t.expense, locale);
  const blocker = editBlocker(state, { ...t.expense }, locale);
  const message = !problem
    ? null
    : problem === 'name'
      ? r.problemName
      : problem === 'amount'
        ? r.problemAmount
        : problem === 'people'
          ? r.problemPeople
          : problem === 'payers'
            ? (blocker ?? r.problemPayers)
            : problem === 'split'
              ? (splitIssue ?? r.problemSplit)
              : r.problemDates;

  const preview = previewShares({
    amount: state.amount,
    currency: state.currency,
    params: splitParamsFor(state),
    participants: state.participants,
    seed: rule.id,
  });

  const setEntry = (memberId: MemberId, text: string): void => {
    const next = (current: SplitEntries): SplitEntries => ({ ...current, [memberId]: text });
    setState((current) =>
      current.splitKind === SplitKind.Shares
        ? { ...current, weights: next(current.weights) }
        : current.splitKind === SplitKind.Exact
          ? { ...current, exacts: next(current.exacts) }
          : { ...current, percents: next(current.percents) },
    );
  };

  const save = async (): Promise<void> => {
    if (!patch) {
      router.back();
      return;
    }
    setError(null);
    try {
      await update.mutateAsync({ ruleId: rule.id, patch });
      router.back();
    } catch (caught) {
      setError(friendlyError(caught, r.couldNotSave, 'recurring.edit'));
    }
  };

  const pickDate = (value: string, onPick: (iso: string) => void): void => {
    DateTimePickerAndroid.open({
      value: dateFrom(value),
      mode: 'date',
      onChange: (event, picked) => {
        if (event.type === 'set' && picked) onPick(isoDate(picked));
      },
    });
  };

  const dateRow = (label: string, value: string | null, onPick: (iso: string) => void) =>
    Platform.OS === 'ios' ? (
      <Row style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <Text variant="body">{label}</Text>
        <DateTimePicker
          value={dateFrom(value ?? when.anchorDate)}
          mode="date"
          display="compact"
          onChange={(_event, picked) => picked && onPick(isoDate(picked))}
        />
      </Row>
    ) : (
      <DetailRow
        icon="calendar-outline"
        dense
        label={label}
        value={value ? showDate(value, locale) : r.endsNever}
        placeholder={!value}
        onPress={() => pickDate(value ?? when.anchorDate, onPick)}
      />
    );

  const payerNames = people
    .filter((member) => state.payers.has(member.id))
    .map((member) => displayName(member, viewerId));

  return (
    <Screen>
      <Row style={{ paddingHorizontal: theme.spacing.xl, paddingTop: theme.spacing.md }}>
        <IconButton label={t.common.back} onPress={() => router.back()}>
          <Ionicons
            name={directionalIcon('chevron-back')}
            size={iconSize.lg}
            color={theme.color.text}
          />
        </IconButton>
        <View style={{ flex: 1, alignItems: 'center' }}>
          <Text variant="heading">{r.editTitle}</Text>
        </View>
        <View style={{ width: 44 }} />
      </Row>

      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{
          paddingHorizontal: theme.spacing.xl,
          paddingBottom: clearance,
          gap: theme.spacing.md,
        }}
        showsVerticalScrollIndicator={false}
      >
        <Text variant="micro" tone="muted" align="center">
          {r.editHint}
        </Text>

        <DescriptionField
          value={state.description}
          onChange={(description) => setState((current) => ({ ...current, description }))}
          placeholder={t.expense.descriptionPlaceholder}
          accessibilityLabel={t.description}
          card
        />

        <Card style={{ gap: theme.spacing.xs }}>
          <AmountField
            currency={state.currency as CurrencyCode}
            value={state.amount}
            size="compact"
            framed
            onChange={(amount) =>
              setState((current) => {
                const only = current.payers.size === 1 ? [...current.payers.keys()][0] : undefined;
                return {
                  ...current,
                  amount,
                  payers: only ? new Map([[only, amount]]) : current.payers,
                };
              })
            }
          />
          <Text variant="micro" tone="muted">
            {fill(r.currencyNote, { currency: state.currency })}
          </Text>
        </Card>

        <DetailRows>
          <CategoryRow
            value={state.category}
            meta={state.categoryMeta}
            dense
            onPress={() => setPicking('category')}
          />
          <DetailRow
            icon="wallet-outline"
            dense
            label={t.paidBy}
            value={payerNames.join(', ') || t.paidBy}
            onPress={() => setPicking('payer')}
          />
        </DetailRows>
        {state.payers.size > 1 ? (
          <Text variant="micro" tone="muted">
            {r.severalPayers}
          </Text>
        ) : null}

        {editableSplit ? (
          <Card style={{ gap: theme.spacing.md }}>
            <Text variant="caption" tone="muted">
              {t.expense.detailSplit}
            </Text>
            <SplitKindChips
              value={state.splitKind}
              onChange={(splitKind) => setState((current) => ({ ...current, splitKind }))}
            />
            <SplitParticipants
              members={live}
              viewerId={viewerId}
              participants={state.participants}
              onToggle={(memberId) =>
                setState((current) => ({
                  ...current,
                  participants: current.participants.includes(memberId)
                    ? current.participants.filter((existing) => existing !== memberId)
                    : [...current.participants, memberId],
                }))
              }
              splitKind={state.splitKind}
              entries={entriesFor(state)}
              onEntryChange={setEntry}
              currency={state.currency}
              amount={state.amount}
              lineAmount={(memberId) => lineAmountFor(memberId, preview, state)}
              splitIssue={splitIssue}
            />
          </Card>
        ) : (
          <Text variant="micro" tone="muted">
            {r.splitKept}
          </Text>
        )}

        <Card style={{ gap: theme.spacing.md }}>
          <DetailRow
            icon="repeat"
            dense
            label={r.repeat}
            value={frequencyLabel(t, when.frequency, when.interval ?? 2)}
            onPress={() => setPicking('repeat')}
          />
          {when.frequency === Frequency.TwiceAMonth ? (
            <DayStepper
              label={t.personal.secondDay}
              value={when.secondDay ?? 15}
              min={1}
              max={31}
              onChange={(secondDay) => setWhen((current) => ({ ...current, secondDay }))}
            />
          ) : null}
          {when.frequency === Frequency.EveryNMonths ? (
            <DayStepper
              label={t.personal.everyNMonths}
              value={when.interval ?? 2}
              min={2}
              max={24}
              onChange={(interval) => setWhen((current) => ({ ...current, interval }))}
            />
          ) : null}
          {dateRow(r.nextOn, when.anchorDate, (anchorDate) =>
            setWhen((current) => ({ ...current, anchorDate })),
          )}
          {dateRow(r.ends, when.endDate ?? null, (endDate) =>
            setWhen((current) => ({ ...current, endDate })),
          )}
          {when.endDate ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => setWhen((current) => ({ ...current, endDate: null }))}
            >
              <Text variant="caption" tone="brand">
                {r.endsNever}
              </Text>
            </Pressable>
          ) : null}
        </Card>

        <Card>
          <Text variant="micro" tone="muted">
            {r.notesLabel}
          </Text>
          <TextInput
            value={notes}
            onChangeText={setNotes}
            multiline
            maxLength={500}
            accessibilityLabel={r.notesLabel}
            style={{ color: theme.color.text, fontSize: 16, minHeight: 40 }}
          />
        </Card>

        {message ? (
          <Text variant="micro" tone="negative" accessibilityRole="alert">
            {message}
          </Text>
        ) : null}
        {error ? <Callout tone="negative">{error}</Callout> : null}
        <Button
          label={r.save}
          disabled={problem !== null || update.isPending}
          onPress={() => void save()}
        />
      </ScrollView>

      {picking === 'category' ? (
        <CategorySheet
          value={state.category}
          onChange={(category, categoryMeta) => {
            setState((current) => ({ ...current, category, categoryMeta }));
            setPicking(null);
          }}
          onClose={() => setPicking(null)}
        />
      ) : null}

      {picking === 'payer' ? (
        <SheetOverlay title={t.paidBy} onClose={() => setPicking(null)}>
          <View style={{ gap: theme.spacing.xs }}>
            {live.map((member) => (
              <ChoiceRow
                key={member.id}
                leading={<Avatar name={displayName(member)} ghost={isGhost(member)} size={32} />}
                label={displayName(member, viewerId)}
                selected={state.payers.has(member.id)}
                onPress={() => {
                  setState((current) => ({
                    ...current,
                    payers: new Map([[member.id, current.amount]]),
                  }));
                  setPicking(null);
                }}
              />
            ))}
          </View>
        </SheetOverlay>
      ) : null}

      {picking === 'repeat' ? (
        <RepeatSheet
          value={{ frequency: when.frequency, interval: when.interval ?? 2 }}
          fallback={{ frequency: Frequency.Monthly, interval: 2 }}
          canStop={false}
          onChange={(next) => {
            if (next) setWhen((current) => ({ ...current, frequency: next.frequency }));
            setPicking(null);
          }}
          onClose={() => setPicking(null)}
        />
      ) : null}
    </Screen>
  );
}
