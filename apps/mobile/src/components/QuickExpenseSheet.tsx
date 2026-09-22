/**
 * The quick expense sheet — the short way from "I just paid for something" to a
 * saved expense.
 *
 * The dashboard's "add expense" used to open the capture screen, which is the
 * right screen for a spend that does not know where it belongs yet: it asks
 * about the description, the category, the day, the payment rail, a photo. Most
 * of the time none of that is in question. You are at a table, you paid 480, it
 * goes on the flat. This sheet is that case and only that case: an amount, the
 * currency it was in, where it goes, and save.
 *
 * **Everything it does not ask is one tap away, not lost.** "More details"
 * carries the amount, currency, place and location it already has into the full
 * form and closes the sheet, so nothing typed here is typed twice. That is the
 * pressure valve which lets the sheet stay this short: it never has to grow a
 * field for the case it cannot handle, it hands that case on.
 *
 * ## Where the chips come from
 *
 * The five destinations are the ones you last filed an expense to
 * (`recentDestinations`), which is recorded on the device as expenses are saved.
 * Before that store has anything in it — a new install, or a reinstall — the row
 * is topped up from the group list so it is never half empty, and the picker is
 * one tap below it either way.
 *
 * NOT YET: on an install with no history the fallback should be `suggestGroup`,
 * the engine Review uses, which weighs a running trip and where this category
 * has been filed before and stays quiet when it is not sure. Today the fallback
 * is the plain group list, which is newest-created order and says nothing about
 * habit.
 *
 * ## What it refuses to do
 *
 * Two cases leave rather than being half-handled here:
 *
 *  - **A currency the group does not keep its books in.** Nothing is converted
 *    on its own (ADR-003); a foreign amount needs a rate, and the rate card is
 *    the full form's. The sheet says so and offers the way through.
 *  - **People who do not already share a group.** Filing with somebody new
 *    means creating a group and a ghost for them — a real, lasting thing, and
 *    not what a sheet called "quick" should do behind one tap. The picker's
 *    People tab hands those to the capture screen instead.
 *
 * ## What it saves
 *
 * An equal split across the group, with you as the payer, stated in words under
 * the chips so it is never a surprise. The split is the one nearly every quick
 * spend wants; anything else is the full form, which is a tap away. The write
 * goes through the same durable queue every other expense uses, so it saves
 * with no network and syncs later.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, ScrollView, View } from 'react-native';

import { encodeTxn, toFxRecord, type ExpenseLocation } from '@waves/core';
import { Button, Divider, iconSize, Row, Sheet, Text, useTheme } from '@waves/ui';

import { DestinationPicker } from '@/components/DestinationPicker';
import { QuickAmountRow } from '@/components/QuickAmountRow';
import { GroupMark } from '@/components/GroupMark';
import {
  useCreateCapture,
  useGroup,
  useGroupFxRates,
  useGroups,
  useWriteExpense,
} from '@/data/hooks';
import { todayIso, useUpsertPersonalRecord } from '@/data/personal';
import { groupLabel, isGhost, isViewer, type GroupRow } from '@/data/types';
import { fill, useStrings } from '@/i18n';
import { useViewerId } from '@/lib/auth';
import { useDefaultCurrency } from '@/lib/currency';
import { COMMON_CURRENCIES } from '@/lib/currencyChoices';
import { usePersonalOffered } from '@/lib/guestGuard';
import { captureLocationIfGranted } from '@/lib/location';
import { router } from '@/lib/navigation';
import { tripRateFor } from '@/lib/tripRates';
import {
  groupDestination,
  noteDestination,
  PERSONAL_DESTINATION,
  useRecentDestinations,
} from '@/lib/recentDestinations';

/** How many chips the row offers. More than this and the row stops being a
    glance and starts being a list — which is what the picker is for. */
const CHIPS = 5;

export function QuickExpenseSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const theme = useTheme();
  const { t } = useStrings();
  const defaultCurrency = useDefaultCurrency();
  const groups = useGroups();
  const recents = useRecentDestinations();

  const [amount, setAmount] = useState(0n);
  const [currency, setCurrency] = useState(defaultCurrency);

  // The sheet is mounted with the dashboard, not opened with it, so its first
  // render can happen before the profile has loaded — and `useDefaultCurrency`
  // answers with the phone's region until it has. Seeded once, the sheet would
  // keep that guess for the life of the screen and quietly file a UAE user's
  // expense in GBP. So the default keeps arriving until the reader overrules
  // it by choosing one, after which it is theirs and nothing moves it.
  const currencyChosen = useRef(false);
  useEffect(() => {
    if (!currencyChosen.current) setCurrency(defaultCurrency);
  }, [defaultCurrency]);
  // Null is "nothing picked yet"; 'personal' is the private ledger, which is
  // not a group and does not split. Everything else is a group id.
  const [chosenId, setChosenId] = useState<string | 'personal' | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickingCurrency, setPickingCurrency] = useState(false);

  /**
   * Where this was paid, read while the sheet opens and never mentioned.
   *
   * `captureLocationIfGranted` is the only honest way to do this in a sheet
   * meant to be one tap: it reads a fix *if* the person has already said yes on
   * an explicit "Add location" somewhere else, and otherwise returns null
   * without ever putting a system prompt on the screen (A43 — permission is
   * asked for once, deliberately, never sprung on somebody mid-spend).
   *
   * Read when the sheet opens rather than when Save is pressed, so a GPS lock
   * that takes a second takes it while the amount is being typed instead of
   * standing between the tap and the saved expense. An expense saved before the
   * fix lands simply carries none, exactly as it did before this existed.
   */
  const [place, setPlace] = useState<ExpenseLocation | null>(null);
  useEffect(() => {
    if (!visible) return;
    let live = true;
    void captureLocationIfGranted().then((fix) => {
      if (live) setPlace(fix);
    });
    return () => {
      live = false;
    };
  }, [visible]);

  /**
   * Closing empties it.
   *
   * The sheet lives as long as the dashboard does — it is mounted there and
   * only shown or hidden — so without this, everything typed stays put: open it
   * tomorrow and yesterday's amount is still in the field with yesterday's
   * group under it. One tap on Save and a number nobody meant to enter again
   * is an expense.
   *
   * Done here rather than in an effect on `visible`, because closing is an
   * event and not something to be synchronised after the fact — the compiler's
   * lint says as much, and it is right. Every way out goes through this: the
   * scrim, the drag, a save, and the hand-off to the full form.
   *
   * The currency goes back to following the account default, which is what an
   * untouched sheet means by "my currency".
   */
  const closeAndReset = (): void => {
    setAmount(0n);
    setChosenId(null);
    setPickerOpen(false);
    setPickingCurrency(false);
    setPlace(null);
    currencyChosen.current = false;
    setCurrency(defaultCurrency);
    onClose();
  };

  const rows = useMemo(() => groups.data ?? [], [groups.data]);
  const byId = useMemo(() => new Map(rows.map((group) => [group.id, group])), [rows]);

  /**
   * The chips: recent first, then whatever else is to hand.
   *
   * A key that no longer resolves is dropped rather than drawn — a group can be
   * left, archived or deleted between the save that recorded it and this sheet —
   * and the row is topped up from the group list so it is never half empty on a
   * device that has only filed to one place.
   */
  const chips = useMemo(() => {
    const seen = new Set<string>();
    const out: GroupRow[] = [];
    const take = (group: GroupRow | undefined): void => {
      if (!group || seen.has(group.id) || out.length >= CHIPS) return;
      seen.add(group.id);
      out.push(group);
    };
    for (const key of recents.keys) {
      const id = key.startsWith('group:') ? key.slice('group:'.length) : null;
      if (id) take(byId.get(id));
    }
    for (const group of rows) take(group);
    return out;
  }, [recents.keys, byId, rows]);

  const personalOffered = usePersonalOffered();
  const personalPicked = chosenId === 'personal';
  const chosen = chosenId && !personalPicked ? byId.get(chosenId) : undefined;

  /**
   * The long way round: the full form for wherever this is headed, carrying what
   * has been typed.
   *
   * It lives here rather than in the footers because it is the one action whose
   * meaning does not depend on being able to save — it works before a
   * destination is picked, where there is no footer to put it in. Nothing chosen
   * is not a dead end: a spend with no home is what the capture screen is for,
   * and it takes the same amount and currency.
   */
  const handOff = (): void => {
    closeAndReset();
    if (chosen) {
      router.push({
        pathname: '/group/[id]/add-expense',
        params: {
          id: chosen.id,
          amount: amount.toString(),
          currency,
          // Says where this came from, which is what lets the form seed the
          // amount rather than read it as a stale draft and drop it.
          quick: '1',
        },
      });
      return;
    }
    if (personalPicked) {
      router.push({
        pathname: '/personal/entry',
        params: { amount: amount.toString(), currency, kind: 'expense' },
      });
      return;
    }
    router.push({ pathname: '/capture', params: { amount: amount.toString(), cur: currency } });
  };

  return (
    <Sheet
      visible={visible}
      onClose={closeAndReset}
      title={t.quickExpense.title}
      titleAction={
        <Button
          label={t.quickExpense.advanced}
          accessibilityLabel={t.quickExpense.advancedLong}
          variant="ghost"
          size="sm"
          onPress={handOff}
        />
      }
    >
      <View style={{ gap: theme.spacing.lg }}>
        <QuickAmountRow
          currency={currency}
          value={amount}
          onChange={setAmount}
          onPickCurrency={() => setPickingCurrency((open) => !open)}
        />

        {pickingCurrency ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <Row style={{ gap: theme.spacing.sm }}>
              {COMMON_CURRENCIES.map((code) => (
                <Pressable
                  key={code}
                  accessibilityRole="button"
                  accessibilityState={{ selected: code === currency }}
                  onPress={() => {
                    currencyChosen.current = true;
                    setCurrency(code);
                    setPickingCurrency(false);
                  }}
                  style={{
                    paddingHorizontal: theme.spacing.md,
                    paddingVertical: theme.spacing.sm,
                    borderRadius: theme.radius.pill,
                    backgroundColor:
                      code === currency ? theme.color.brandSoft : theme.color.surfaceMuted,
                  }}
                >
                  <Text variant="caption" tone={code === currency ? 'brand' : 'default'}>
                    {code}
                  </Text>
                </Pressable>
              ))}
            </Row>
          </ScrollView>
        ) : null}

        <Divider />

        <View style={{ gap: theme.spacing.sm }}>
          <Text variant="caption" tone="muted">
            {t.quickExpense.where}
          </Text>
          {chips.length === 0 && !personalOffered ? (
            <Text variant="caption" tone="faint">
              {t.quickExpense.noPlacesYet}
            </Text>
          ) : (
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <Row style={{ gap: theme.spacing.sm }}>
                {/* The private ledger, first and always — a spend that is
                    nobody else's business is the one destination that never
                    depends on which groups you happen to be in. Hidden from a
                    guest, who has no private ledger to write to. */}
                {personalOffered ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{ selected: personalPicked }}
                    onPress={() => setChosenId('personal')}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: theme.spacing.xs,
                      paddingHorizontal: theme.spacing.md,
                      paddingVertical: theme.spacing.sm,
                      borderRadius: theme.radius.pill,
                      backgroundColor: personalPicked
                        ? theme.color.brandSoft
                        : theme.color.surfaceMuted,
                    }}
                  >
                    <Ionicons
                      name="person-circle-outline"
                      size={iconSize.sm}
                      color={personalPicked ? theme.color.brand : theme.color.text}
                    />
                    <Text variant="caption" tone={personalPicked ? 'brand' : 'default'}>
                      {t.quickExpense.justMe}
                    </Text>
                  </Pressable>
                ) : null}
                {chips.map((group) => (
                  <Pressable
                    key={group.id}
                    accessibilityRole="button"
                    accessibilityState={{ selected: group.id === chosenId }}
                    onPress={() => setChosenId(group.id)}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: theme.spacing.xs,
                      paddingHorizontal: theme.spacing.md,
                      paddingVertical: theme.spacing.sm,
                      borderRadius: theme.radius.pill,
                      backgroundColor:
                        group.id === chosenId ? theme.color.brandSoft : theme.color.surfaceMuted,
                    }}
                  >
                    <GroupMark emoji={group.cover_emoji} size={20} />
                    <Text
                      variant="caption"
                      numberOfLines={1}
                      tone={group.id === chosenId ? 'brand' : 'default'}
                    >
                      {groupLabel(group)}
                    </Text>
                  </Pressable>
                ))}
              </Row>
            </ScrollView>
          )}

          <Pressable accessibilityRole="button" onPress={() => setPickerOpen(true)}>
            <Text variant="caption" tone="brand">
              {t.quickExpense.otherPlaces}
            </Text>
          </Pressable>
        </View>

        {personalPicked ? (
          <QuickPersonalFooter amount={amount} currency={currency} onSaved={closeAndReset} />
        ) : chosen ? (
          <QuickExpenseFooter
            group={chosen}
            amount={amount}
            currency={currency}
            place={place}
            onSaved={closeAndReset}
          />
        ) : (
          <Button
            label={t.quickExpense.save}
            size="lg"
            fullWidth
            disabled
            onPress={() => undefined}
          />
        )}
      </View>

      {pickerOpen ? (
        <Sheet visible onClose={() => setPickerOpen(false)} title={t.quickExpense.where}>
          <DestinationPicker
            selection={chosen ? { kind: 'existing', groupId: chosen.id } : { kind: 'none' }}
            groups={rows}
            people={[]}
            t={t}
            pinned={[]}
            onChoose={(choice) => {
              if (choice.kind === 'existing') setChosenId(choice.groupId);
              setPickerOpen(false);
            }}
            // Somebody this ledger has never met needs a group and a ghost made
            // for them. That is a lasting thing to do behind a sheet called
            // quick, so it goes to the screen built for a spend with no home.
            onResolvePeople={() => {
              setPickerOpen(false);
              closeAndReset();
              // Carrying what was typed, exactly as Advanced does. The reset
              // above empties the sheet but not this closure, so the figure
              // still travels — and arriving at a screen that had forgotten it
              // is the thing this branch already fixes everywhere else.
              router.push({
                pathname: '/capture',
                params: { amount: amount.toString(), cur: currency },
              });
            }}
          />
        </Sheet>
      ) : null}
    </Sheet>
  );
}

/**
 * The save, and the sentence above it.
 *
 * Its own component because it needs the chosen group's members, and a hook
 * cannot be called conditionally in the sheet above — the group is chosen after
 * the sheet is already on screen.
 */
function QuickExpenseFooter({
  group,
  amount,
  currency,
  place,
  onSaved,
}: {
  group: GroupRow;
  amount: bigint;
  currency: string;
  /** Where this was paid, when the reader had already granted location. Null
   *  is the ordinary case and means the row simply carries no place. */
  place: ExpenseLocation | null;
  onSaved: () => void;
}) {
  const theme = useTheme();
  const { t } = useStrings();
  const viewerId = useViewerId();
  const { members } = useGroup(group.id);
  const write = useWriteExpense(group.id);
  const createCapture = useCreateCapture();
  const fxRates = useGroupFxRates(group.id);
  const [saving, setSaving] = useState(false);

  const rows = members.data;
  const participants = useMemo(() => rows.map((member) => member.id), [rows]);
  // Bring-up diagnostic, dev builds only.
  //
  // The sheet refuses to save in groups the dashboard lists as the reader's
  // own, because it cannot find their membership among the group's members.
  // The lookup is character-for-character the one `add-expense` uses, against
  // the same mirror and the same viewer id, so either those rows differ from
  // what that screen sees or the identity does — and one line from a device
  // settles which. `__DEV__` is false in every release build, so this cannot
  // reach anybody; it comes out altogether once the line has been read.
  useEffect(() => {
    if (!__DEV__) return;
    console.log(
      '[quick] group=%s members=%d ghosts=%d viewer=%s match=%d',
      group.id.slice(0, 8),
      rows.length,
      rows.filter((member) => isGhost(member)).length,
      viewerId ? viewerId.slice(0, 8) : 'null',
      rows.filter((member) => isViewer(member, viewerId)).length,
    );
  }, [group.id, rows, viewerId]);
  const myMemberId = useMemo(
    () => rows.find((member) => isViewer(member, viewerId))?.id ?? null,
    [rows, viewerId],
  );

  /**
   * A foreign amount is saved, not refused — and converted only if the group
   * already said how.
   *
   * ADR-003's rule is that nothing is converted *on its own*, and a rate the
   * group pinned is not on its own: an admin entered one number for the trip
   * (`TripRatesCard`), every entry in that currency is counted with it, and the
   * winner is stored on the expense so moving the rate next week cannot
   * re-price last week's dinner. So when the group has a rate for this
   * currency, the sheet uses it and says it did.
   *
   * With no pinned rate the expense is still written, in the currency it was
   * paid in. Balances are kept per currency and never summed across them
   * (ADR-004), so an unconverted row is not a wrong number anywhere — it is a
   * second currency standing on its own until somebody gives it a rate. That is
   * strictly better than the sheet refusing: you paid, you are standing there,
   * and this is the quick add.
   */
  const foreign = currency !== group.default_currency;
  const tripRate = useMemo(
    () => (foreign ? tripRateFor(fxRates.data, currency, group.default_currency) : null),
    [foreign, fxRates.data, currency, group.default_currency],
  );

  // The only thing the quick add insists on is something to save. No member
  // check, no rate check, no participant check: every one of those was a way of
  // telling somebody who has just paid for dinner that they have filled the
  // form in wrong. The full form is one tap away through Advanced for the cases
  // that genuinely need answering.
  const canSave = amount > 0n && !saving;
  // Whether an actual expense can be written, as opposed to a draft. Not a
  // gate on saving — nothing here refuses — only on what the sentence above
  // the buttons is allowed to promise.
  const canWriteExpense = myMemberId !== null && participants.length > 0;

  const writeDraft = async (): Promise<void> => {
    await createCapture.mutateAsync({
      description: '',
      expenseDate: new Date().toISOString().slice(0, 10),
      currency,
      amount,
      // Tagged with where it is going, so picking it up again is one tap
      // rather than the "which group was this?" question a second time.
      targetGroupId: group.id,
      location: place,
    });
    noteDestination(groupDestination(group.id));
    onSaved();
  };

  const keepDraft = async (): Promise<void> => {
    if (!canSave) return;
    setSaving(true);
    try {
      await writeDraft();
    } finally {
      setSaving(false);
    }
  };

  const save = async (): Promise<void> => {
    if (!canSave) return;
    setSaving(true);
    try {
      // An expense needs somebody to have paid it, and that somebody is the
      // reader. Where their membership cannot be found there is no payer to
      // record, so the money is kept against the group as a draft rather than
      // the sheet arguing with them about it — the row syncs, shows on the
      // group, and opens the full form when they come back. Silent on purpose:
      // this is a state the reader did not cause and cannot act on.
      if (!myMemberId || participants.length === 0) {
        await writeDraft();
        return;
      }
      await write.mutateAsync({
        description: '',
        expenseDate: new Date().toISOString().slice(0, 10),
        currency,
        amount,
        splitParams: { kind: 'equal' },
        participants,
        payers: { [myMemberId]: amount },
        location: place,
        // The group's own rate when it has one for this pair, and nothing when
        // it does not. `undefined` is not "convert it somehow", it is "this row
        // is in the currency it says" — which the per-currency balances handle.
        fx: tripRate ? toFxRecord(tripRate) : undefined,
        // The same engine the server runs, seeded with nothing yet — the id is
        // minted inside the write, so the preview here is only a check that the
        // split is computable at all.
        expectedShares: undefined,
      });
      noteDestination(groupDestination(group.id));
      onSaved();
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={{ gap: theme.spacing.sm }}>
      {/* What is about to happen, never why it cannot. Three sentences, and
          each of them is about the money rather than about the form: it
          converts at the group's own rate, or it stays in the currency it was
          paid in until somebody gives it one, or it splits. */}
      <Text variant="caption" tone="muted">
        {tripRate
          ? fill(t.quickExpense.atGroupRate, {
              currency,
              group: groupLabel(group),
            })
          : foreign
            ? fill(t.quickExpense.keptInCurrency, {
                currency,
                group: groupLabel(group),
              })
            : // No payer to name means no expense to write, so Save keeps a
              // draft instead (see `save`). "Split equally between 4" here
              // would be a sentence about money that does not happen.
              canWriteExpense
              ? fill(t.quickExpense.splitEqually, { count: String(participants.length) })
              : fill(t.quickExpense.keptForGroup, { group: groupLabel(group) })}
      </Text>
      {/* Side by side, because they are two answers to the same question and
          neither is the other's fallback. Save is the one with the weight;
          Draft keeps its own, since in a foreign currency it is the only thing
          that can happen here. */}
      <Row style={{ gap: theme.spacing.sm }}>
        <Button
          label={t.quickExpense.saveDraft}
          accessibilityLabel={t.quickExpense.saveDraftLong}
          variant="secondary"
          size="lg"
          style={{ flex: 1 }}
          disabled={!canSave}
          onPress={() => void keepDraft()}
        />
        <Button
          label={t.quickExpense.save}
          size="lg"
          style={{ flex: 1 }}
          disabled={!canSave}
          onPress={() => void save()}
        />
      </Row>
    </View>
  );
}

/**
 * Saving to the private ledger instead of a group.
 *
 * A different table, not a different shape of expense: `personal_records` holds
 * an encrypted blob per record (A48), and nothing about it is split, owed or
 * shared. So there is no participant count to state and no payer to name — the
 * money simply left. The one thing this still owes the reader is the sentence
 * saying so, because the row above it offers groups that do split.
 */
function QuickPersonalFooter({
  amount,
  currency,
  onSaved,
}: {
  amount: bigint;
  currency: string;
  onSaved: () => void;
}) {
  const theme = useTheme();
  const { t } = useStrings();
  const upsert = useUpsertPersonalRecord();
  const [saving, setSaving] = useState(false);

  const canSave = amount > 0n && !saving;

  const save = async (): Promise<void> => {
    if (!canSave) return;
    setSaving(true);
    try {
      await upsert.mutateAsync({
        recordKind: 'txn',
        data: encodeTxn({
          kind: 'expense',
          amount,
          currency,
          // Undescribed and uncategorised on purpose: the sheet asks for an
          // amount and a place, and the ledger already names a record with no
          // description by its category rather than inventing a word for it.
          category: null,
          note: null,
          date: todayIso(),
          loanId: null,
          recurringId: null,
        }),
      });
      noteDestination(PERSONAL_DESTINATION);
      onSaved();
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={{ gap: theme.spacing.sm }}>
      <Text variant="caption" tone="muted">
        {t.quickExpense.justMeHint}
      </Text>
      {/* One button, not the pair the group footer shows: a draft is a capture,
          and a capture waits in Review for a group to be chosen. Offering one
          here would file a spend that is nobody else's business into the place
          for spends that are. */}
      <Button
        label={t.quickExpense.save}
        size="lg"
        fullWidth
        disabled={!canSave}
        onPress={() => void save()}
      />
    </View>
  );
}
