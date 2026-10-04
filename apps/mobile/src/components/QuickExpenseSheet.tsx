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
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { randomUUID } from 'expo-crypto';
import { Image } from 'expo-image';
import { ActivityIndicator, Pressable, ScrollView, TextInput, View } from 'react-native';

import { encodeTxn, toFxRecord, type CategoryMeta, type ExpenseLocation } from '@waves/core';
import { Avatar, Button, iconSize, Row, Sheet, Text, useTheme } from '@waves/ui';

import { DestinationPicker } from '@/components/DestinationPicker';
import { DictateButton } from '@/components/DictateButton';
import { QuickAmountRow } from '@/components/QuickAmountRow';
import { QuickCategoryRow } from '@/components/QuickCategoryRow';
import { GroupMark } from '@/components/GroupMark';
import { useAvatarUrl } from '@/components/ProfileAvatar';
import { uploadCapturePhoto, uploadExpenseReceipt } from '@/data/api';
import {
  useCreateCapture,
  useGroup,
  useGroupFxRates,
  useGroupLabeller,
  useGroups,
  useHomeSummary,
  useWriteExpense,
} from '@/data/hooks';
import { todayIso, useUpsertPersonalRecord } from '@/data/personal';
import { isGhost, isViewer, type GroupRow } from '@/data/types';
import { fill, plural, useStrings } from '@/i18n';
import { useAuth, useViewerId } from '@/lib/auth';
import { useDefaultCurrency } from '@/lib/currency';
import { CurrencyChoices } from '@/components/expense/CurrencySheet';
import { usePersonalOffered } from '@/lib/guestGuard';
import type { PickedImage } from '@/lib/image';
import { captureLocationIfGranted } from '@/lib/location';
import { router } from '@/lib/navigation';
import { useQuickReceipt } from '@/lib/quickReceipt';
import { useToast } from '@/lib/toast';
import { tripRateFor } from '@/lib/tripRates';
import {
  groupDestination,
  noteDestination,
  PERSONAL_DESTINATION,
  useRecentDestinations,
} from '@/lib/recentDestinations';

// Only pulled in when the in-app camera opens (and only reachable when the
// binary has the native module — see `useQuickReceipt`).
const ReceiptCamera = lazy(() => import('@/components/ReceiptCamera'));

/** How many chips the row offers. More than this and the row stops being a
    glance and starts being a list — which is what the picker is for. */
const CHIPS = 5;

/** Every destination chip's height, fixed rather than left to its content —
 *  a group chip carries two lines (name, member count) and "Just me" carries
 *  one, and a row where some pills are taller than others reads as a layout
 *  bug rather than a row of peers. Tall enough for the two-line chip with its
 *  padding; everything shorter is centred in it by `tile`'s own
 *  `alignItems: 'center'`, which is what keeps "Just me" centred rather than
 *  pinned to the top of the row. */
const CHIP_HEIGHT = 48;

export function QuickExpenseSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const theme = useTheme();
  const dark = theme.scheme === 'dark';
  const soft = dark ? theme.color.surfaceMuted : '#F3F0FE';
  const accent = dark ? theme.color.brand : '#6A45E8';
  // A destination pill: a lavender chip, outlined in violet when chosen.
  const tile = (picked: boolean) => ({
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
    height: CHIP_HEIGHT,
    paddingHorizontal: 12,
    borderRadius: 19,
    borderWidth: 1.25,
    borderColor: picked ? accent : 'transparent',
    backgroundColor: picked ? (dark ? theme.color.brandSoft : '#FFFFFF') : soft,
  });
  const { t, locale } = useStrings();
  const defaultCurrency = useDefaultCurrency();
  const groups = useGroups();
  const labelOf = useGroupLabeller();
  const recents = useRecentDestinations();
  const viewerId = useViewerId();
  // The same per-group member count the groups list and dashboard already
  // compute — read here rather than a query per chip, which is what a
  // `useGroup(group.id)` inside the chip's own row would have been.
  const { memberCountFor } = useHomeSummary(viewerId);
  // Your own face for the "Just me" chip — the same resolution (signed URL,
  // falling back to initials) the account screen's own portrait uses.
  const { profile } = useAuth();
  const myName = profile?.display_name ?? t.quickExpense.justMe;
  const myAvatarUrl = useAvatarUrl(profile?.avatar_url);
  // The one receipt a quick add can carry — held here, not uploaded until the
  // footer below actually saves (see lib/quickReceipt). Destructured rather
  // than passed around as one object, so the reset effect below can name the
  // one function it depends on instead of the whole bundle.
  const {
    receipt,
    busy: attachingReceipt,
    attach: attachReceipt,
    clear: clearReceipt,
    cameraOpen: receiptCameraOpen,
    closeCamera: closeReceiptCamera,
    onShot: onReceiptShot,
    onLibrary: onReceiptLibrary,
    onDenied: onReceiptDenied,
  } = useQuickReceipt();

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
  const [note, setNote] = useState('');
  // Optional, and guessed at nothing: see QuickCategoryRow's own doc comment
  // for why this never pre-selects. `meta` is the custom-tag snapshot and is
  // only ever set alongside a custom `category` key, never a built-in one.
  const [category, setCategoryState] = useState<string | null>(null);
  const [categoryMeta, setCategoryMeta] = useState<CategoryMeta | null>(null);
  const setCategory = (key: string | null, meta: CategoryMeta | null): void => {
    setCategoryState(key);
    setCategoryMeta(meta);
  };
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
    setNote('');
    setCategory(null, null);
    setPickerOpen(false);
    setPickingCurrency(false);
    setPlace(null);
    currencyChosen.current = false;
    setCurrency(defaultCurrency);
    clearReceipt();
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

  // The private ledger has no column for a receipt (A48's blob has none), so a
  // bill picked while a group was still chosen would otherwise sit on the chip
  // promising something the save a line below cannot do. Dropped the moment
  // "Just me" is picked, rather than silently ignored at save time.
  useEffect(() => {
    if (personalPicked) clearReceipt();
  }, [personalPicked, clearReceipt]);

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
    // The note and category travel with the amount: read before the reset
    // empties them.
    const typed = note.trim();
    const carriedCategory = category;
    const carriedMeta = categoryMeta;
    closeAndReset();
    if (chosen) {
      router.push({
        pathname: '/group/[id]/add-expense',
        params: {
          id: chosen.id,
          amount: amount.toString(),
          currency,
          ...(typed ? { description: typed } : {}),
          ...(carriedCategory ? { category: carriedCategory } : {}),
          ...(carriedMeta ? { categoryMeta: JSON.stringify(carriedMeta) } : {}),
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
        params: {
          amount: amount.toString(),
          currency,
          kind: 'expense',
          ...(typed ? { note: typed } : {}),
        },
      });
      return;
    }
    router.push({
      pathname: '/capture',
      params: {
        amount: amount.toString(),
        cur: currency,
        ...(typed ? { desc: typed } : {}),
        ...(carriedCategory ? { category: carriedCategory } : {}),
        ...(carriedMeta ? { categoryMeta: JSON.stringify(carriedMeta) } : {}),
      },
    });
  };

  return (
    <Sheet visible={visible} onClose={closeAndReset} handle>
      <View style={{ gap: theme.spacing.md }}>
        {/* The sheet's own heading, drawn by hand rather than through the
            Sheet's `title`/`titleAction` pair: those hold one line, and this
            sheet wants two — the name, and the sentence under it saying what
            it is for. The grab handle above still comes from the Sheet. */}
        <Row
          style={{
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: theme.spacing.sm,
          }}
        >
          <View style={{ flex: 1 }}>
            <Text variant="title">{t.quickExpense.title}</Text>
            <Text variant="caption" tone="muted">
              {t.quickExpense.subtitle}
            </Text>
          </View>
          {/* The escape hatch, a pill rather than a text link — it carries the
              same weight as the destination and category pills beside it now
              that the sheet has more than one row of them. */}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t.quickExpense.advancedLong}
            onPress={handOff}
            hitSlop={8}
            style={({ pressed }) => ({
              flexDirection: 'row',
              alignItems: 'center',
              gap: 2,
              minHeight: 34,
              paddingHorizontal: 14,
              borderRadius: theme.radius.pill,
              backgroundColor: soft,
              opacity: pressed ? 0.6 : 1,
            })}
          >
            <Text style={{ fontSize: 13, fontWeight: '700', color: accent }}>
              {t.quickExpense.advanced}
            </Text>
            <Ionicons name="chevron-forward" size={14} color={accent} />
          </Pressable>
        </Row>

        <QuickAmountRow
          currency={currency}
          value={amount}
          onChange={setAmount}
          onPickCurrency={() => setPickingCurrency((open) => !open)}
        />

        {/* The shared "Choose currency" picker, in place of the form below
            while it is open: this sheet is already a modal, and a second one
            cannot be stacked on it. Picking puts the form back. */}
        {pickingCurrency ? (
          <ScrollView
            style={{ maxHeight: 440 }}
            keyboardShouldPersistTaps="handled"
            nestedScrollEnabled
            showsVerticalScrollIndicator={false}
          >
            <CurrencyChoices
              value={currency}
              onPick={(code) => {
                currencyChosen.current = true;
                setCurrency(code);
                setPickingCurrency(false);
              }}
            />
          </ScrollView>
        ) : (
          <>
            <QuickCategoryRow value={category} meta={categoryMeta} onChange={setCategory} />

            <View style={{ gap: theme.spacing.xs }}>
              <Row style={{ alignItems: 'center', justifyContent: 'space-between' }}>
                <Text style={{ fontSize: 13, fontWeight: '600', color: theme.color.textMuted }}>
                  {t.quickExpense.where}
                </Text>
                {/* The one place this sheet's always-equal split can be
                    changed — the full form's own editor, not a second one
                    built here (see the file's own "What it refuses to do"). */}
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t.quickExpense.splitLink}
                  onPress={handOff}
                  hitSlop={8}
                  style={({ pressed }) => ({
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 4,
                    paddingVertical: 2,
                    opacity: pressed ? 0.6 : 1,
                  })}
                >
                  <Ionicons name="people-outline" size={14} color={accent} />
                  <Text style={{ fontSize: 13, fontWeight: '600', color: accent }}>
                    {t.quickExpense.splitLink}
                  </Text>
                </Pressable>
              </Row>
              {/* One compact row of pills, the catch-all included — rather than
                  a tall stack of cards plus a separate "other places" link
                  underneath saying the same thing. The catch-all pill is drawn
                  every time, empty destinations included, so the picker stays
                  one tap away even on a fresh install with nothing to suggest
                  yet; the caption above just says why the row is short. */}
              {chips.length === 0 && !personalOffered ? (
                <Text variant="caption" tone="faint">
                  {t.quickExpense.noPlacesYet}
                </Text>
              ) : null}
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <Row style={{ gap: theme.spacing.sm, alignItems: 'center' }}>
                  {/* The private ledger, first and always — a spend that is
                  nobody else's business is the one destination that never
                  depends on which groups you happen to be in. Hidden from a
                  guest, who has no private ledger to write to. */}
                  {personalOffered ? (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityState={{ selected: personalPicked }}
                      onPress={() => setChosenId('personal')}
                      style={tile(personalPicked)}
                    >
                      {/* Your own face, the same as everywhere else it is
                          shown — initials when there is no photo, exactly as
                          `Avatar` already falls back for any other person. */}
                      <Avatar name={myName} photoUrl={myAvatarUrl} size={24} />
                      <Text style={{ fontSize: 14, fontWeight: '600', color: theme.color.text }}>
                        {t.quickExpense.justMe}
                      </Text>
                      {personalPicked ? <PickedTick color={accent} /> : null}
                    </Pressable>
                  ) : null}
                  {chips.map((group) => (
                    <Pressable
                      key={group.id}
                      accessibilityRole="button"
                      accessibilityState={{ selected: group.id === chosenId }}
                      accessibilityLabel={`${labelOf(group)}, ${plural(locale, memberCountFor(group.id), t.memberCount)}`}
                      onPress={() => setChosenId(group.id)}
                      style={[tile(group.id === chosenId), { maxWidth: 180 }]}
                    >
                      {group.cover_emoji ? (
                        <GroupMark emoji={group.cover_emoji} size={16} />
                      ) : (
                        <Ionicons name="paper-plane-outline" size={15} color={accent} />
                      )}
                      <View style={{ flexShrink: 1 }}>
                        <Text
                          numberOfLines={1}
                          style={{ fontSize: 13, fontWeight: '600', color: theme.color.text }}
                        >
                          {labelOf(group)}
                        </Text>
                        <Text
                          numberOfLines={1}
                          style={{ fontSize: 11, color: theme.color.textMuted }}
                        >
                          {plural(locale, memberCountFor(group.id), t.memberCount)}
                        </Text>
                      </View>
                      {group.id === chosenId ? <PickedTick color={accent} /> : null}
                    </Pressable>
                  ))}
                  {/* Every other group and person, behind one pill — the sheet's
                      only way to the full picker once Advanced has left with it. */}
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t.quickExpense.otherPlaces}
                    onPress={() => setPickerOpen(true)}
                    style={[tile(false), { paddingHorizontal: 12 }]}
                  >
                    <Ionicons name="people-outline" size={17} color={accent} />
                  </Pressable>
                </Row>
              </ScrollView>
            </View>

            {/* A word about what it was, if there is one to hand. Optional —
                the quick add never asks. */}
            <Row
              style={{
                alignItems: 'center',
                gap: 10,
                minHeight: 40,
                paddingHorizontal: 12,
                borderRadius: 12,
                backgroundColor: soft,
              }}
            >
              <Ionicons name="reorder-three-outline" size={18} color={theme.color.textMuted} />
              <TextInput
                value={note}
                onChangeText={setNote}
                placeholder={t.quickExpense.notePlaceholder}
                placeholderTextColor={theme.color.textFaint}
                accessibilityLabel={t.quickExpense.notePlaceholder}
                returnKeyType="done"
                numberOfLines={1}
                style={{ flex: 1, fontSize: 14, color: theme.color.text, paddingVertical: 0 }}
              />
              {/* Renders nothing on web or on a binary built before the speech
                  module existed — the row is exactly as wide either way. */}
              <DictateButton value={note} onChange={setNote} compact />
              {/* The same size and shape as the mic beside it — a bill is as
                  optional as the note it sits next to. Disabled once "Just
                  me" is picked, which has nowhere to put a receipt. */}
              <QuickReceiptControl
                receipt={receipt}
                busy={attachingReceipt}
                disabled={personalPicked}
                onAttach={attachReceipt}
                onRemove={clearReceipt}
                addLabel={t.quickExpense.addReceipt}
                removeLabel={t.quickExpense.removeReceipt}
              />
            </Row>

            {/* The slim footer: one 46dp save action (or the save/draft pair),
                never taller than the primary button plus its one line of
                context. */}
            {personalPicked ? (
              <QuickPersonalFooter
                amount={amount}
                currency={currency}
                note={note}
                onSaved={closeAndReset}
              />
            ) : chosen ? (
              <QuickExpenseFooter
                group={chosen}
                amount={amount}
                currency={currency}
                note={note}
                place={place}
                category={category}
                categoryMeta={categoryMeta}
                receipt={receipt}
                onSaved={closeAndReset}
              />
            ) : (
              <Button
                label={t.quickExpense.save}
                fullWidth
                disabled
                style={{ height: 46 }}
                onPress={() => undefined}
              />
            )}
          </>
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
              const typed = note.trim();
              setPickerOpen(false);
              closeAndReset();
              // Carrying what was typed, exactly as Advanced does. The reset
              // above empties the sheet but not this closure, so the figure
              // still travels — and arriving at a screen that had forgotten it
              // is the thing this branch already fixes everywhere else.
              router.push({
                pathname: '/capture',
                params: {
                  amount: amount.toString(),
                  cur: currency,
                  ...(typed ? { desc: typed } : {}),
                },
              });
            }}
          />
        </Sheet>
      ) : null}
      {receiptCameraOpen ? (
        <Suspense fallback={null}>
          <ReceiptCamera
            onShot={onReceiptShot}
            onLibrary={onReceiptLibrary}
            onClose={closeReceiptCamera}
            onDenied={onReceiptDenied}
          />
        </Suspense>
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
  note,
  place,
  category,
  categoryMeta,
  receipt,
  onSaved,
}: {
  group: GroupRow;
  amount: bigint;
  currency: string;
  /** What it was, if they said; the expense's description. */
  note: string;
  /** Where this was paid, when the reader had already granted location. Null
   *  is the ordinary case and means the row simply carries no place. */
  place: ExpenseLocation | null;
  /** A built-in id or a custom tag's id; null for "optional, and skipped". */
  category: string | null;
  /** The custom tag's denormalised display, when `category` is one. */
  categoryMeta: CategoryMeta | null;
  /** The bill picked above, if any — held, not yet uploaded. */
  receipt: PickedImage | null;
  onSaved: () => void;
}) {
  const labelOf = useGroupLabeller();
  const theme = useTheme();
  const { t } = useStrings();
  const toast = useToast();
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
    // A capture is not an expense yet (A34), so the kept-bill path above —
    // keyed by groupId/expenseId — has nothing to attach to. Its own photo
    // field is a direct upload under the capture's own id instead, exactly as
    // the inbox's own capture screen keeps one; the id is minted here, ahead
    // of the write, so the upload and the capture row agree on it.
    const captureId = randomUUID();
    let photoPath: string | null = null;
    if (receipt && viewerId) {
      try {
        photoPath = await uploadCapturePhoto({
          ownerUserId: viewerId,
          captureId,
          base64: receipt.base64,
          mimeType: receipt.mimeType,
        });
      } catch {
        // Best-effort, matching the capture screen's own upload: the draft is
        // still worth keeping without its photo — but, same as the group
        // path, the person who took it should be told it did not stick.
        photoPath = null;
        toast.show(t.receipts.couldNotAdd, 'negative');
      }
    }
    await createCapture.mutateAsync({
      captureId,
      description: note.trim(),
      expenseDate: new Date().toISOString().slice(0, 10),
      currency,
      amount,
      category,
      categoryMeta,
      // Tagged with where it is going, so picking it up again is one tap
      // rather than the "which group was this?" question a second time.
      targetGroupId: group.id,
      location: place,
      photoPath,
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
      const expenseId = await write.mutateAsync({
        description: note.trim(),
        expenseDate: new Date().toISOString().slice(0, 10),
        currency,
        amount,
        category,
        categoryMeta,
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
      if (receipt) {
        // After the write, not beside it — the kept bill (E2) is keyed by
        // groupId/expenseId, and the expense has to exist first. Not awaited:
        // the money is already saved and the sheet is closing, so this runs
        // past that point rather than holding Save open for an upload. Unlike
        // `lib/receiptQueue` this has no retry queue behind it, so a failure
        // here is a real, permanent loss — the one thing the sheet still owes
        // the reader is saying so, in a toast that outlives it, rather than
        // leaving them to discover a missing bill later with no idea why.
        void uploadExpenseReceipt({
          groupId: group.id,
          expenseId,
          base64: receipt.base64,
          mimeType: receipt.mimeType,
        }).catch(() => toast.show(t.receipts.couldNotAdd, 'negative'));
      }
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
              group: labelOf(group),
            })
          : foreign
            ? fill(t.quickExpense.keptInCurrency, {
                currency,
                group: labelOf(group),
              })
            : // No payer to name means no expense to write, so Save keeps a
              // draft instead (see `save`). "Split equally between 4" here
              // would be a sentence about money that does not happen.
              canWriteExpense
              ? fill(t.quickExpense.splitEqually, { count: String(participants.length) })
              : fill(t.quickExpense.keptForGroup, { group: labelOf(group) })}
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
          style={{ flex: 1, height: 46 }}
          disabled={!canSave}
          onPress={() => void keepDraft()}
        />
        <Button
          label={t.quickExpense.save}
          style={{ flex: 1, height: 46 }}
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
  note,
  onSaved,
}: {
  amount: bigint;
  currency: string;
  note: string;
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
          note: note.trim() || null,
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
        fullWidth
        disabled={!canSave}
        style={{ height: 46 }}
        onPress={() => void save()}
      />
    </View>
  );
}

/** The chosen pill's mark: a filled violet disc with a tick. */
function PickedTick({ color }: { color: string }) {
  return (
    <View
      style={{
        width: 17,
        height: 17,
        borderRadius: 8.5,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: color,
      }}
    >
      <Ionicons name="checkmark" size={11} color="#FFFFFF" />
    </View>
  );
}

/**
 * The camera button beside the note field, or — once a bill is picked — the
 * same-sized chip showing it.
 *
 * Deliberately the mic's own size and shape (a 32pt soft-brand pill): the note
 * field already offers one optional way to fill itself in without typing, and
 * this is the other one. It never grows past that square, even carrying a
 * photo — a thumbnail big enough to recognise the bill by is a gallery's job,
 * not this row's; the chip here only has to say "something is attached".
 */
function QuickReceiptControl({
  receipt,
  busy,
  disabled,
  onAttach,
  onRemove,
  addLabel,
  removeLabel,
}: {
  receipt: PickedImage | null;
  busy: boolean;
  disabled: boolean;
  onAttach: () => void;
  onRemove: () => void;
  addLabel: string;
  removeLabel: string;
}) {
  const theme = useTheme();
  const size = 32;

  if (receipt) {
    return (
      <View style={{ width: size, height: size }}>
        <Image
          source={{ uri: receipt.uri }}
          style={{ width: size, height: size, borderRadius: theme.radius.sm }}
          contentFit="cover"
        />
        {/* The chip's own "x" — removing here never asks to confirm, unlike the
            full gallery's remove: nothing has been uploaded yet, so there is
            nothing to lose but a re-tap of the camera button. */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={removeLabel}
          onPress={onRemove}
          hitSlop={8}
          style={({ pressed }) => ({
            position: 'absolute',
            top: -6,
            right: -6,
            width: 18,
            height: 18,
            borderRadius: 9,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: theme.color.text,
            opacity: pressed ? 0.7 : 1,
          })}
        >
          <Ionicons name="close" size={12} color={theme.color.onBrand} />
        </Pressable>
      </View>
    );
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={addLabel}
      accessibilityState={{ disabled: disabled || busy, busy }}
      disabled={disabled || busy}
      onPress={onAttach}
      hitSlop={10}
      style={({ pressed }) => ({
        width: size,
        height: size,
        borderRadius: theme.radius.pill,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: theme.color.brandSoft,
        opacity: disabled ? 0.4 : pressed ? 0.85 : 1,
      })}
    >
      {busy ? (
        <ActivityIndicator size="small" color={theme.color.brand} />
      ) : (
        <Ionicons name="camera-outline" size={iconSize.md} color={theme.color.brand} />
      )}
    </Pressable>
  );
}
