/**
 * Change one fact of a saved expense without leaving the expense screen.
 *
 * The expense screen states a bill's facts — its note, amount, day, who paid,
 * how it was split, what kind of spend it was. Changing any one of them used to
 * mean the pencil and the full editor, a whole form for one field. Each fact now
 * opens this sheet instead, holding just the control for that field; the full
 * editor stays one tap away (the sheet's own "Full editor" link, or the pencil)
 * for anything bigger.
 *
 * The write is the full editor's own, not a lookalike: the sheet seeds from the
 * version with `editStateFromVersion`, changes one field of that state, and
 * queues `expenseWritePayload` under `MutationKind.ExpenseUpdate` — the same
 * functions `add-expense.tsx` saves through. So a version written here carries
 * the note and receipt link through, sends `baseVersionNo` for the concurrent-
 * edit check, seeds `expectedShares` with the expense id (ADR-009), rides the
 * offline queue (ADR-005), and lands in the history like any other edit. The
 * same checks gate Save that gate the editor's: a total, somebody in the split,
 * a split that adds up, payers that add up.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { ActivityIndicator, Platform, Pressable, ScrollView, View } from 'react-native';

import { MutationKind, type CurrencyCode, type MemberId } from '@waves/core';
import { AmountField, Avatar, Button, Callout, Row, Sheet, Text, useTheme } from '@waves/ui';

import { CategoryChoices } from '@/components/Category';
import { DetailRow } from '@/components/DetailRows';
import { DescriptionField } from '@/components/expense/DescriptionField';
import { ChoiceRow } from '@/components/expense/SheetOverlay';
import { SplitKindChips, SplitParticipants } from '@/components/expense/SplitEditor';
import { displayName, isGhost, type ExpenseVersionRow, type MemberRow } from '@/data/types';
import { useStrings } from '@/i18n';
import { friendlyError } from '@/lib/errors';
import { dateFrom, isoDate, showDate } from '@/lib/expenseDay';
import {
  editBlocker,
  editStateFromVersion,
  entriesFor,
  expenseWritePayload,
  lineAmountFor,
  previewShares,
  splitIssueFor,
  splitParamsFor,
  type ExpenseEditState,
} from '@/lib/expenseEdit';
import { useGuestGuard } from '@/lib/guestGuard';
import { fillEntries, SplitKind, type SplitEntries } from '@/lib/split';
import { clearDraft, useSync } from '@/sync';

/** The facts on the expense screen that open a pop-up. */
export type ExpenseField = 'amount' | 'description' | 'date' | 'payer' | 'split' | 'category';

/** How long the sheet stays mounted after a dismissal, so its exit is seen. */
const EXIT_MS = 220;

/** A payload as comparable text — bigint (an exact split's amounts) as digits. */
function payloadKey(payload: Record<string, unknown>): string {
  return JSON.stringify(payload, (_key, value: unknown) =>
    typeof value === 'bigint' ? value.toString() : value,
  );
}

export function ExpenseFieldSheet({
  field,
  groupId,
  expenseId,
  version,
  members,
  viewerId,
  myMemberId,
  onClose,
  onOpenEditor,
}: {
  field: ExpenseField;
  groupId: string;
  expenseId: string;
  /** The version being changed — the one on screen when the sheet opened. */
  version: ExpenseVersionRow;
  members: readonly MemberRow[];
  viewerId: string | null | undefined;
  myMemberId: MemberId | null;
  /** Called once the sheet has finished leaving. */
  onClose: () => void;
  /** Leave for the full editor. */
  onOpenEditor: () => void;
}): React.JSX.Element | null {
  const theme = useTheme();
  const { t, locale } = useStrings();
  const { mutate } = useSync();
  const guard = useGuestGuard();

  // The version this edit is based on, pinned at open. If a sync lands a newer
  // one while the sheet is up, the write still says which version it replaces
  // (`baseVersionNo`) and the server treats it as the concurrent edit it is,
  // exactly as it would a save from the full editor opened on the older one.
  const [base] = useState(version);
  const [state, setState] = useState<ExpenseEditState>(() =>
    editStateFromVersion(version, myMemberId),
  );
  // What saving the untouched state would write, so Save on no change closes
  // instead of stamping an identical version into the history.
  const [unchanged] = useState(() =>
    payloadKey(
      expenseWritePayload({
        expenseId,
        state: editStateFromVersion(version, myMemberId),
        editing: version,
      }),
    ),
  );
  const [open, setOpen] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A date is one tap, like everywhere else a date is picked: Android raises its
  // own calendar dialog with no sheet behind it, iOS shows the calendar inline,
  // and choosing a day saves it. The sheet (with its row to raise the dialog
  // again) only appears on Android if that save was refused, to say why.
  const [pickingDate, setPickingDate] = useState(field === 'date' && Platform.OS === 'android');
  const bareDatePicker = field === 'date' && Platform.OS === 'android' && error === null;

  // A scrim tap and a drag can both land in one gesture; the screen hears once.
  const leaving = useRef(false);
  const leave = (then?: () => void): void => {
    if (leaving.current) return;
    leaving.current = true;
    setOpen(false);
    setTimeout(() => {
      onClose();
      then?.();
    }, EXIT_MS);
  };
  useEffect(
    () => () => {
      leaving.current = true;
    },
    [],
  );
  // A save in flight holds the sheet: closing it mid-write would hide the error
  // if the write is refused.
  const dismiss = (): void => {
    if (!saving) leave();
  };

  // Everybody in a weighted split needs a number to start from — the same
  // render-time fill the full editor does, and it stops once all are filled.
  if (state.splitKind === SplitKind.Shares) {
    const filled = fillEntries('shares', state.weights, state.participants);
    if (filled) setState((current) => ({ ...current, weights: filled }));
  } else if (state.splitKind === SplitKind.Percent) {
    const filled = fillEntries('percent', state.percents, state.participants);
    if (filled) setState((current) => ({ ...current, percents: filled }));
  }

  const blocker = editBlocker(state, { ...t.expense }, locale);

  const save = async (next: ExpenseEditState = state): Promise<void> => {
    if (saving) return;
    // Read-only once the guest trial is up — the same gate the editor's Save has.
    if (guard.blockWrite()) return;
    const refusal = next === state ? blocker : editBlocker(next, { ...t.expense }, locale);
    if (refusal) {
      setError(refusal);
      return;
    }
    const payload = expenseWritePayload({ expenseId, state: next, editing: base });
    if (payloadKey(payload) === unchanged) {
      leave();
      return;
    }
    setError(null);
    setSaving(true);
    try {
      // Onto the durable queue: resolves once it is on disk, network or not.
      await mutate(MutationKind.ExpenseUpdate, groupId, payload);
      // A half-typed edit of this bill left on the full editor was written
      // against the version this save just replaced. Reopening the editor would
      // restore it over the new version and a save there would quietly undo
      // this one, so it goes.
      await clearDraft(`expense:${groupId}:${expenseId}`);
      setSaving(false);
      leave();
    } catch (caught) {
      setSaving(false);
      setError(friendlyError(caught, t.couldNotSave, 'expense.inlineSave'));
    }
  };

  const setEntry = (memberId: MemberId, text: string): void => {
    const update = (current: SplitEntries): SplitEntries => ({ ...current, [memberId]: text });
    setState((current) =>
      current.splitKind === SplitKind.Shares
        ? { ...current, weights: update(current.weights) }
        : current.splitKind === SplitKind.Exact
          ? { ...current, exacts: update(current.exacts) }
          : { ...current, percents: update(current.percents) },
    );
  };

  const toggleParticipant = (memberId: MemberId): void => {
    setState((current) => ({
      ...current,
      participants: current.participants.includes(memberId)
        ? current.participants.filter((id) => id !== memberId)
        : [...current.participants, memberId],
    }));
  };

  const applyDate = (event: DateTimePickerEvent, picked?: Date): void => {
    if (Platform.OS === 'android') setPickingDate(false);
    if (event.type === 'dismissed' || !picked) {
      // Backing out of the bare Android dialog is backing out of the edit.
      if (bareDatePicker) leave();
      return;
    }
    const next = { ...state, expenseDate: isoDate(picked) };
    setState(next);
    void save(next);
  };

  const nameHints = members
    .map((member) => displayName(member, viewerId))
    .filter((name) => name !== 'You' && name !== 'Someone');

  const title =
    field === 'amount'
      ? t.expense.amountTitle
      : field === 'description'
        ? t.description
        : field === 'date'
          ? t.expense.detailDate
          : field === 'payer'
            ? t.paidBy
            : field === 'category'
              ? t.whatFor
              : t.expense.detailSplit;

  // Several payers are changed on the full editor: their figures have to add
  // up to the total, and that is a form, not a pick. The pop-up says so rather
  // than offering a tap that would silently collapse them to one.
  const severalPayers = field === 'payer' && state.payers.size > 1;

  let body: ReactNode;
  if (field === 'description') {
    body = (
      <DescriptionField
        value={state.description}
        onChange={(description) => setState((current) => ({ ...current, description }))}
        placeholder={t.expense.descriptionPlaceholder}
        accessibilityLabel={t.description}
        hints={nameHints}
        multiline
      />
    );
  } else if (field === 'amount') {
    body = (
      <View style={{ gap: theme.spacing.sm }}>
        <AmountField
          currency={state.currency as CurrencyCode}
          value={state.amount}
          autoFocus
          onChange={(amount) =>
            setState((current) => {
              // One payer carries the whole bill by definition, so their figure
              // follows the total — what the editor's rebalance does for one.
              // Several payers keep their recorded figures, and the check below
              // says what no longer adds up.
              const only = current.payers.size === 1 ? [...current.payers.keys()][0] : undefined;
              return {
                ...current,
                amount,
                payers: only ? new Map([[only, amount]]) : current.payers,
              };
            })
          }
        />
      </View>
    );
  } else if (field === 'date') {
    body =
      Platform.OS === 'ios' ? (
        <DateTimePicker
          value={dateFrom(state.expenseDate)}
          mode="date"
          display="inline"
          onChange={applyDate}
        />
      ) : (
        <View>
          <DetailRow
            icon="calendar-outline"
            label={t.expense.detailDate}
            value={showDate(state.expenseDate, locale)}
            onPress={() => setPickingDate(true)}
          />
          {pickingDate ? (
            <DateTimePicker
              value={dateFrom(state.expenseDate)}
              mode="date"
              display="default"
              onChange={applyDate}
            />
          ) : null}
        </View>
      );
  } else if (field === 'payer') {
    body = severalPayers ? (
      <View style={{ gap: theme.spacing.md }}>
        <Text variant="body" tone="muted">
          {t.expense.severalPayersHint}
        </Text>
        <Button
          label={t.expense.fullEditor}
          variant="secondary"
          onPress={() => leave(onOpenEditor)}
        />
      </View>
    ) : (
      <View style={{ gap: theme.spacing.xs }}>
        {members.map((member) => (
          <ChoiceRow
            key={member.id}
            leading={<Avatar name={displayName(member)} ghost={isGhost(member)} size={32} />}
            label={displayName(member, viewerId)}
            selected={state.payers.has(member.id)}
            onPress={() =>
              setState((current) => ({
                ...current,
                payers: new Map([[member.id, current.amount]]),
              }))
            }
          />
        ))}
      </View>
    );
  } else if (field === 'category') {
    body = (
      <CategoryChoices
        value={state.category}
        onChange={(category, categoryMeta) =>
          setState((current) => ({ ...current, category, categoryMeta }))
        }
      />
    );
  } else {
    const preview = previewShares({
      amount: state.amount,
      currency: state.currency,
      params: splitParamsFor(state),
      participants: state.participants,
      seed: expenseId,
    });
    body = (
      <View style={{ gap: theme.spacing.md }}>
        <SplitKindChips
          value={state.splitKind}
          onChange={(splitKind) => setState((current) => ({ ...current, splitKind }))}
        />
        <SplitParticipants
          members={members}
          viewerId={viewerId}
          participants={state.participants}
          onToggle={toggleParticipant}
          splitKind={state.splitKind}
          entries={entriesFor(state)}
          onEntryChange={setEntry}
          currency={state.currency}
          amount={state.amount}
          lineAmount={(memberId) => lineAmountFor(memberId, preview, state)}
          splitIssue={splitIssueFor(state, t.expense, locale)}
        />
      </View>
    );
  }

  // The split states its own complaint under its list; every other field has
  // none of its own, so what blocks Save is said above the button — an amount
  // that no longer matches the payers' figures, or an exact split's.
  const inlineIssue = field === 'split' || severalPayers ? null : blocker;

  if (bareDatePicker) {
    return pickingDate ? (
      <DateTimePicker
        value={dateFrom(state.expenseDate)}
        mode="date"
        display="default"
        onChange={applyDate}
      />
    ) : null;
  }

  return (
    <Sheet
      visible={open}
      onClose={dismiss}
      title={title}
      closeLabel={t.common.close}
      style={{ maxHeight: '90%' }}
      titleAction={
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t.expense.fullEditor}
          onPress={() => {
            if (!saving) leave(onOpenEditor);
          }}
          hitSlop={{ top: 15, bottom: 15, left: 8, right: 8 }}
        >
          <Text variant="micro" tone="brand" style={{ fontWeight: '700' }}>
            {t.expense.fullEditor}
          </Text>
        </Pressable>
      }
    >
      <ScrollView
        style={{ flexShrink: 1 }}
        contentContainerStyle={{ gap: theme.spacing.md, paddingBottom: theme.spacing.sm }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {body}
        {inlineIssue ? (
          <Text
            variant="micro"
            tone="negative"
            accessibilityRole="alert"
            accessibilityLiveRegion="polite"
          >
            {inlineIssue}
          </Text>
        ) : null}
      </ScrollView>

      {field === 'date' ? (
        error ? (
          <View style={{ paddingTop: theme.spacing.md }}>
            <Callout tone="negative">{error}</Callout>
          </View>
        ) : null
      ) : severalPayers ? null : (
        <View style={{ gap: theme.spacing.sm, paddingTop: theme.spacing.md }}>
          {error ? <Callout tone="negative">{error}</Callout> : null}
          <Row style={{ justifyContent: 'flex-end', alignItems: 'center', gap: theme.spacing.md }}>
            {saving ? <ActivityIndicator color={theme.color.brand} /> : null}
            <Button label={t.cancel} variant="ghost" disabled={saving} onPress={dismiss} />
            <Button
              label={t.expense.saveChanges}
              disabled={saving || blocker !== null}
              onPress={() => void save()}
            />
          </Row>
        </View>
      )}
    </Sheet>
  );
}
