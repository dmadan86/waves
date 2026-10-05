import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import Ionicons from '@expo/vector-icons/Ionicons';
import { randomUUID } from 'expo-crypto';
import { useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  TextInput,
  View,
} from 'react-native';

import {
  CategoryId,
  currencySymbol,
  format,
  formatMinorInput,
  guessCategory,
  money,
  MutationKind,
  rebalancePayers,
  subEventsForTemplate,
  validatePayers,
  type CategoryMeta,
  type CurrencyCode,
  type ExpenseLocation,
  type FxRecord,
  type MemberId,
  type PaymentMethod,
  type SplitParams,
} from '@waves/core';
import {
  AmountField,
  amountKeyboard,
  Avatar,
  Button,
  Callout,
  Card,
  ChipRow,
  EmptyState,
  iconSize,
  MoneyText,
  Row,
  Screen,
  Text,
  useScreenClearance,
  useTheme,
} from '@waves/ui';

import { CategoryRow, CategorySheet } from '@/components/Category';
import { ExpenseReceipts } from '@/components/ExpenseReceipts';
import { TagEditorSheet } from '@/components/TagEditorSheet';
import { PaymentMethodRow, PaymentMethodSheet } from '@/components/PaymentMethodPicker';
import { LocationField } from '@/components/LocationField';
import { captureLocationIfGranted, locationUnchanged, reverseGeocode } from '@/lib/location';
import { friendlyError } from '@/lib/errors';
import { receiptProblemText } from '@/lib/problemText';
import { CurrencyRate } from '@/components/CurrencyRate';
import { DescriptionField } from '@/components/expense/DescriptionField';
import { CurrencySheet } from '@/components/expense/CurrencySheet';
import { ExpenseHero } from '@/components/expense/ExpenseHero';
import { splitIcon } from '@/components/expense/splitIcon';
import { DetailRow, DetailRows } from '@/components/DetailRows';
import {
  canAddReceipt,
  expenseReceiptPath,
  expenseReceiptUrl,
  scanReceipt,
  scanReceiptText,
  uploadExpenseReceipt,
} from '@/data/api';
import { router } from '@/lib/navigation';
import { routeAmount } from '@/lib/routeAmount';
import { receiptCapStatus, receiptTapAction } from '@/lib/receiptCapGate';
import { tripRateFor } from '@/lib/tripRates';
import { NotUploaderError, StorageCapError } from '@/lib/storage';
import { useAssignCapture, useGroup, useGroupFxRates } from '@/data/hooks';
import { displayName, groupLabel, isGhost, isViewer } from '@/data/types';
import { fill, plural, useStrings } from '@/i18n';
import { useViewerId } from '@/lib/auth';
import { useGuestGuard } from '@/lib/guestGuard';
import { handoverKey } from '@/lib/handover';
import { resolveDraftCurrency, resolveDraftFx } from '@/lib/expenseDraft';
import { dateFrom, isoDate, showDate } from '@/lib/expenseDay';
import {
  expenseDateFor,
  planCollapseToOne,
  planEvenly,
  planToggle,
  planTypedAmount,
  todayIso,
  type PayerPlan,
} from '@/lib/expenseForm';
import { captureReceipt, pickReceiptImage, type PickedImage } from '@/lib/image';
import { recogniseReceipt } from '@/lib/ocr';
import { capturePaymentMethod } from '@/lib/captureAssign';
import { matchMemberNames, stripMemberNames } from '@/lib/voiceExpense';
import { fillEntries, SplitKind, type SplitEntries } from '@/lib/split';
import {
  editStateFromVersion,
  expenseWritePayload,
  lineAmountFor,
  payerIssueFor,
  previewShares,
  splitIssueFor,
  splitParamsFor,
  withBalanceCleared,
} from '@/lib/expenseEdit';
import { SplitKindChips, SplitParticipants } from '@/components/expense/SplitEditor';
import { clearDraft, syncEngine, useDraft, useRestoredDraft, useSync } from '@/sync';
import { discardHeldReceipts, flushReceiptQueue, releaseHeldReceipts } from '@/lib/receiptQueue';
import { useDialog } from '@/lib/dialog';

/** Shared empty set — a new one per render would defeat every memo below it. */
const EMPTY_LOCKS: ReadonlySet<MemberId> = new Set();

/**
 * The width of one "paid by" tile.
 *
 * Fixed on purpose: the lane must be the same shape in a group of Hethus as in
 * a group of Lokesh Rangasamys. Just wide enough to clear the 44pt avatar it
 * holds and give a long name somewhere to put its ellipsis — 76 left so much
 * slack around each avatar that four people read as four separated islands
 * rather than one row of faces.
 */
const PAYER_TILE_WIDTH = 60;

/**
 * The press area around this form's small text links — "Split by item", "Paid
 * by several", "Split evenly".
 *
 * They are drawn in `micro`, which is 15 points of line: a symmetric slop of 8
 * left them a ~31pt target, well under the 44 both platforms ask for, and
 * they sit on crowded rows where a miss lands on something else. The vertical
 * slop is the half that matters, so it is the half that grows; widening the
 * sides as well would only steal presses from the control next to them. Slop
 * rather than padding because these links share a line with a heading — padding
 * would push the heading's baseline around.
 */
const LINK_HIT_SLOP = { top: 15, bottom: 15, left: 8, right: 8 } as const;

/** Who paid what, in minor units. */
type PayerMap = ReadonlyMap<MemberId, bigint>;

interface ExpenseDraft {
  amount: string;
  description: string;
  splitKind: SplitKind;
  /**
   * Who paid, before a bill could be paid by several people. Drafts written by
   * an older build still carry it and nothing else, so it is read as a
   * single-payer `payers` map rather than dropped.
   */
  payer?: MemberId | null;
  /** Who paid what, in minor units as decimal strings. */
  payers?: Record<string, string>;
  /** The payers whose figure was typed rather than derived (see rebalancePayers). */
  lockedPayers?: string[];
  /**
   * The currency this expense was paid in, when it differs from the group's.
   * Optional: drafts written before this field existed omit it, which is not
   * the same as an explicit null — see resolveDraftCurrency.
   */
  currency?: string | null;
  /** The stored conversion rate for a foreign-currency expense (ADR-003). */
  fx?: FxRecord | null;
  participants: MemberId[];
  /** Kept apart, because a weight of 1 is not one percent — nor is either of
   *  them ₹1. Optional: drafts written before the exact split existed have no
   *  `exacts`, which reads as an empty set of fields, not as a lost one. */
  weights: SplitEntries;
  percents: SplitEntries;
  exacts?: SplitEntries;
  category: string | null;
  /** The custom tag's display, when `category` is a custom tag (extends TDR §8). */
  categoryMeta: CategoryMeta | null;
  /** Whether the category above was chosen, rather than guessed. */
  categoryChosen: boolean;
  /** Where the spend happened (A43), when the person attached one. */
  location?: ExpenseLocation | null;
}

/**
 * The travel shortcuts a trip group is offered, in the order they are shown.
 *
 * `none` is not one of them: it is the state of the row before any has been
 * applied, which a strip that always has exactly one chip lit has no other way
 * to say. Nothing is stored under it and it is never an option to tap.
 */

/**
 * A custom tag's display arrives from the capture hand-off as a JSON route
 * param. Anything that does not parse to a proper {label, icon, tint} is simply
 * no meta — the expense falls back to a built-in rather than crashing the form.
 */
function parseCategoryMetaParam(value: string | undefined): CategoryMeta | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<CategoryMeta>;
    if (parsed && typeof parsed.label === 'string' && typeof parsed.icon === 'string') {
      return {
        label: parsed.label,
        icon: parsed.icon,
        tint: (parsed.tint as CategoryMeta['tint']) ?? 'sky',
      };
    }
  } catch {
    // fall through
  }
  return null;
}

/**
 * A capture's location arrives as a JSON route param (A43), the same handoff
 * `categoryMeta` uses. A malformed or out-of-range value is simply no location —
 * a prefill is never worth a crash — so the point is validated to Earth's ranges
 * exactly as the server does before it seeds the form.
 */
function parseLocationParam(value: string | undefined): ExpenseLocation | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<ExpenseLocation>;
    const lat = typeof parsed?.lat === 'number' ? parsed.lat : NaN;
    const lng = typeof parsed?.lng === 'number' ? parsed.lng : NaN;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
    const name = typeof parsed.name === 'string' ? parsed.name : null;
    return { lat, lng, name };
  } catch {
    return null;
  }
}

/**
 * Let go of the receipts held for a newly saved expense, and send them.
 *
 * After the ledger push rather than beside it: the attach RPC needs the expense
 * row, and a receipt that raced ahead of it would fail and sit out a retry
 * backoff. Never awaited by the screen — the queue owns them from here, and it
 * keeps trying on launch, foreground and reconnect if this cannot finish.
 */
async function sendHeldReceipts(expenseId: string): Promise<void> {
  try {
    if ((await releaseHeldReceipts(expenseId)) === 0) return;
    await syncEngine.flush();
    const sent = await flushReceiptQueue();
    if (sent.uploadedExpenseIds.length > 0) await syncEngine.flush();
  } catch {
    // Best-effort; the queue retries on its own.
  }
}

export default function AddExpenseScreen() {
  const theme = useTheme();
  // The room the pinned action bar leaves under Save for the system navigation
  // bar. Read here rather than in the bar's style so the whole screen agrees on
  // one number, and so the hook is not buried in a `return`.
  const clearance = useScreenClearance(theme.spacing.md);
  const { t, locale } = useStrings();
  const { confirm } = useDialog();
  // The capture params are the inbox handoff (A34): assigning a capture opens
  // this form prefilled and carries the capture id so a successful save can
  // close it. Absent for every ordinary add or edit, which behave unchanged.
  const {
    id,
    expenseId,
    captureId,
    voice,
    people: voicePeople,
    amount: captureAmount,
    description: captureDescription,
    category: captureCategory,
    categoryMeta: captureCategoryMeta,
    location: captureLocation,
    paymentMethod: capturePayment,
    expenseDate: captureExpenseDate,
    focus,
    currency: handedCurrency,
    quick,
    subEventId: handedSubEventId,
    settlesExpenseId,
  } = useLocalSearchParams<{
    id: string;
    expenseId?: string;
    captureId?: string;
    /** '1' when opened from the voice quick-add — seeds amount/description like a capture. */
    voice?: string;
    /** The raw spoken sentence, for matching names to members on a voice hand-off. */
    people?: string;
    amount?: string;
    description?: string;
    category?: string;
    /** A custom tag's {label,icon,tint} snapshot, JSON-encoded, when a capture
     *  tagged with one is being assigned (extends TDR §8). */
    categoryMeta?: string;
    /** The capture's {lat,lng,name} place, JSON-encoded, carried onto the
     *  assigned expense (A43). Absent when the capture had no location. */
    location?: string;
    /** How the capture says it was paid, so assigning keeps it. Absent when the
     *  draft never named one, and on a voice hand-off. */
    paymentMethod?: string;
    expenseDate?: string;
    /** 'amount' when the editor was opened by tapping the total on the expense
     *  screen — the amount field takes focus and raises the keyboard on arrival.
     *  'payers' from the Paid by sheet's "Several people paid": the form opens
     *  in several-payer mode, scrolled to who paid. */
    focus?: string;
    /** The currency already chosen elsewhere — the quick sheet hands one over
     *  when it is not the group's own, which is exactly the case it cannot
     *  save and this form can (it has the rate card). Without this the choice
     *  would be silently dropped on the way in and typed twice. */
    currency?: string;
    /** '1' when the quick sheet handed this over. It seeds the amount the same
     *  way a capture or a voice hand-off does — arriving here from that sheet
     *  is an explicit choice to carry on with what was typed, and without a
     *  marker the amount is read as a stale draft and dropped. */
    quick?: string;
    /** Event "Pay balance" (Vendors tab): the sub-event the vendor was tagged with. */
    subEventId?: string;
    /** Event "Pay balance": the vendor advance this payment settles. Once this
     *  expense is saved, that advance's balance is cleared (a second write of
     *  the original expense, balance 0), so the vendor shows as paid off. */
    settlesExpenseId?: string;
  }>();
  const groupId = id ?? '';

  // Identity for "which member am I", from the session rather than the profile:
  // the session is on the device at launch, the profile is a fetch that lands
  // later, and in the gap `profile?.id` is undefined — which `isViewer` refuses
  // to match, but only if it is given the right thing to compare. See
  // `lib/auth.useViewerId`.
  const viewerId = useViewerId();

  const { group, members, expenses } = useGroup(groupId);
  const groupFxRates = useGroupFxRates(groupId);
  const { mutate } = useSync();
  const assignCapture = useAssignCapture();
  const guard = useGuestGuard();

  const editing = expenses.rows.find((expense) => expense.id === expenseId);

  // The id is chosen here, not by the server. It seeds the remainder rotation
  // (ADR-009), so previewing with one id and writing with another would put the
  // extra paisa on a different person and the server would rightly reject the
  // write as a SHARE_MISMATCH. It is also what lets this expense be created
  // with no network at all (ADR-005).
  const [newExpenseId] = useState(() => randomUUID());
  const targetExpenseId = expenseId ?? newExpenseId;

  // Receipts added while the expense is still new are parked under its id but
  // held (`ExpenseReceipts` in draft mode). Saving lets them go; leaving
  // without saving drops them, so an abandoned add leaves no photographs
  // behind. `saved` is a ref because the cleanup below runs after the last
  // render has gone.
  //
  // Saved is decided on the way out, not only at the save: a save whose kept
  // bill then fails to upload leaves the person on this screen, and a picture
  // added after that is held again. Released on leaving, it goes with the
  // expense it now belongs to; discarded, it would be a bill somebody watched
  // themselves attach.
  const saved = useRef(false);
  useEffect(
    () => () => {
      if (expenseId) return;
      void (saved.current ? sendHeldReceipts(newExpenseId) : discardHeldReceipts(newExpenseId));
    },
    [expenseId, newExpenseId],
  );

  // ADR-005: a crash mid-entry must not cost the user their typing.
  const draftKey = `expense:${groupId}:${expenseId ?? 'new'}`;
  const restored = useRestoredDraft<ExpenseDraft>(draftKey);

  const [amount, setAmount] = useState<bigint>(0n);
  const [description, setDescription] = useState('');
  const [splitKind, setSplitKind] = useState<SplitKind>(SplitKind.Equal);
  /**
   * Who put the money in, and how much each of them put in (minor units).
   *
   * A map rather than one id, because "she got the taxi, I got the tickets" is
   * one dinner, not two. Almost every bill has a single entry here and the form
   * behaves exactly as it always did; the moment a second person is tapped, the
   * amounts appear and have to add up to the total — the same rule the SQL
   * trigger and both edge functions enforce (`PAYER_MISMATCH`).
   */
  const [payers, setPayers] = useState<PayerMap>(new Map());
  /** Payers whose figure a person typed. Everyone else absorbs what is left. */
  const [lockedPayers, setLockedPayers] = useState<ReadonlySet<MemberId>>(EMPTY_LOCKS);
  /** What is in each payer's field, so a half-typed "12." survives a render. */
  const [paidText, setPaidText] = useState<Record<MemberId, string>>({});
  /** The `amount:currency` the payer figures were last derived for. */
  const [payersFor, setPayersFor] = useState<string | null>(null);
  /**
   * Whether the payer row is asking about one person or several.
   *
   * It matters because the two need opposite gestures. With one payer a tap has
   * to *replace* — "actually she paid" is the single most common correction on
   * this form and it was one tap before this feature existed, so it stays one
   * tap. With several, a tap has to *add*, or you could never build the list.
   * A control cannot be both, so the mode is explicit and the row says which it
   * is in. A bill that already has several payers is in 'many' whatever the
   * flag says — reopening it must not offer to silently drop one.
   */
  const [payerMode, setPayerMode] = useState<'one' | 'many'>('one');
  // Arrived from "Several people paid": switch to several payers once the form
  // is seeded (seeding sets the payers, so switching earlier would be undone),
  // then bring the who-paid card into view on its first layout.
  const [payersFocusApplied, setPayersFocusApplied] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  const scrolledToPayers = useRef(false);
  // How it was paid — a free-text tag on the expense. Defaults to cash; the
  // picker offers UPI only where the region settles over it.
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash');
  // The day the expense is filed under. It opens on the answer `expenseDateFor`
  // has always computed — a capture's own day, a saved expense's own day, or
  // today for a new one — and, now that there is a picker, the person can move
  // it. `null` means "nobody has touched it", which is what keeps an edit from
  // re-filing an expense it did not mean to move.
  const [pickedDate, setPickedDate] = useState<string | null>(null);
  const [editingDate, setEditingDate] = useState(false);
  const [participants, setParticipants] = useState<MemberId[]>([]);
  // What was typed into each member's field, as text. Two maps, not one: the
  // same person is "2 shares" and "40%", and switching between the two must not
  // reinterpret one number as the other.
  const [weights, setWeights] = useState<SplitEntries>({});
  const [percents, setPercents] = useState<SplitEntries>({});
  // The exact split's fields: money as typed, one line per person. Kept apart
  // from the two weighted maps for the same reason those are kept apart from
  // each other — 1 is not one percent, and neither of them is ₹1.
  const [exacts, setExacts] = useState<SplitEntries>({});
  // Guessed from the description until somebody picks one themselves, at which
  // point the guess must stop moving it — see `categoryChosen`.
  // A built-in id or a custom tag's id; `categoryMeta` carries a custom tag's
  // display so it rides onto the expense for every member (extends TDR §8).
  const [category, setCategory] = useState<string | null>(CategoryId.Food);
  const [categoryMeta, setCategoryMeta] = useState<CategoryMeta | null>(null);
  const [categoryChosen, setCategoryChosen] = useState(false);
  // The create-tag sheet, opened from the category sheet's "＋ New tag" row.
  const [editingTag, setEditingTag] = useState(false);
  // The two "more details" rows open their options in sheets, and those sheets
  // are rendered at the screen root rather than beside their rows: the sheet is
  // absolutely positioned against its nearest positioned ancestor, and a row
  // inside the scroll view would anchor it to the scrolled content instead of
  // the screen. The same reason the currency sheet lives down there.
  const [pickingCategory, setPickingCategory] = useState(false);
  const [pickingPayment, setPickingPayment] = useState(false);
  /**
   * Names to bias the recogniser towards. "You" and "Someone" are placeholders
   * this screen prints, not things anybody says out loud, so they would only
   * teach it to hear the wrong word.
   */
  const nameHints = useMemo(
    () =>
      (members.data ?? [])
        .map((member) => displayName(member, viewerId))
        .filter((name) => name !== 'You' && name !== 'Someone'),
    [members.data, viewerId],
  );

  // Seeded from the hand-off when one came with a currency, so a foreign amount
  // chosen in the quick sheet arrives here already foreign — which is the whole
  // reason that sheet sent the person over: this form has the rate card.
  const [expenseCurrency, setExpenseCurrency] = useState<string | null>(
    handedCurrency && handedCurrency.length === 3 ? handedCurrency.toUpperCase() : null,
  );
  const [fx, setFx] = useState<FxRecord | null>(null);
  // The currency is chosen from the header pill's sheet, the same shortlist the
  // capture screen offers. Picking one clears any rate typed for the old
  // currency, exactly as the old in-card chips did (see CurrencyRate.choose).
  const [pickingCurrency, setPickingCurrency] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanNote, setScanNote] = useState<string | null>(null);
  /** Set once a scan has read line items, so the offer to itemize is real. */
  const [scannedItems, setScannedItems] = useState(0);
  // The kept bill for this expense (E2): a URI to show as the thumbnail, and the
  // R2 storage path the viewer resolves from. Both null until a scan or attach
  // uploads one, or the seeding probe below finds one an earlier edit already
  // kept — a group receipt in R2 is group-readable, so it survives a reinstall
  // and shows on any member's device. The thumbnail URI is the local image just
  // after a capture, and the signed R2 URL once reloaded.
  const [receiptUri, setReceiptUri] = useState<string | null>(null);
  const [receiptPath, setReceiptPath] = useState<string | null>(null);
  // The picked bill, held until the expense is saved. Uploading on save (not on
  // pick) means an add that is abandoned never leaves an orphaned object in R2.
  const [pendingReceipt, setPendingReceipt] = useState<PickedImage | null>(null);

  // Where the spend happened (A43). Optional and opt-in: null until the person
  // taps "Add location" and grants the permission. Kept in the draft so a crash
  // mid-entry does not lose it, and seeded from the version when editing.
  const [location, setLocation] = useState<ExpenseLocation | null>(null);
  // Whether the one-shot auto-capture below has run for this screen. A ref, not
  // state: it guards the attempt to a single run without itself forcing a render
  // (and without a synchronous setState inside the effect).
  const autoLocatedRef = useRef(false);

  // Event organizer (docs/event-organizer.md): which sub-event this spend is
  // for, and whether it is a vendor deposit still owing a balance. Both are
  // optional metadata, like paymentMethod/location above — null/false until
  // the person opts in, seeded from the version when editing.
  const [subEventId, setSubEventId] = useState<string | null>(null);
  const [isDeposit, setIsDeposit] = useState(false);
  const [balanceDueMinor, setBalanceDueMinor] = useState<bigint | null>(null);
  const [balanceDueDate, setBalanceDueDate] = useState<string | null>(null);

  // The per-group receipt ceiling. A group holds a few receipts for free (the
  // number is an admin knob); past it, scanning is a paid feature. A paid group
  // has no cap. This only draws the affordance — the server enforces the same
  // rule when it records the receipt.
  const receiptCap = useQuery({
    queryKey: ['receiptCap', groupId],
    queryFn: () => canAddReceipt(groupId),
  });
  // A failed fetch must not lock a scan the server would allow: an undefined
  // answer that is no longer loading is treated as allowed, and the server is
  // the real boundary if it turns out the group was capped after all.
  const capStatus = receiptCap.isError
    ? 'allowed'
    : receiptCapStatus(receiptCap.data, receiptCap.isLoading);
  const capLocked = capStatus === 'locked';
  const queryClient = useQueryClient();

  const myMemberId = useMemo(
    () => (members.data ?? []).find((member) => isViewer(member, viewerId))?.id ?? null,
    [members.data, viewerId],
  );

  // Seed the kept bill from R2 when reopening an expense that already has one
  // (E2). `expenseReceiptUrl` doubles as the existence check — it returns null
  // when nothing was ever kept, so a signed URL here both proves the receipt
  // exists and gives the thumbnail something to show. Runs once per expense.
  useEffect(() => {
    // Only an existing expense can already have a kept bill; a brand-new one's id
    // has never been uploaded to, so there is nothing to probe for.
    if (!expenseId) return;
    let active = true;
    void (async () => {
      const url = await expenseReceiptUrl(groupId, expenseId);
      if (!active || !url) return;
      setReceiptUri(url);
      setReceiptPath(expenseReceiptPath(groupId, expenseId));
    })();
    return () => {
      active = false;
    };
  }, [groupId, expenseId]);

  // Seed the form once the group has loaded: I paid, everyone splits — or the
  // current version's values when editing. Done during render (React's
  // "adjust state when the input changes" pattern) so the form never flashes
  // empty before the data arrives.
  const [seededFor, setSeededFor] = useState<string | null>(null);
  /**
   * Seed the payer side as one person holding the whole bill — the state every
   * new expense starts in, and the state an older draft or a single-payer bill
   * comes back as. Written as a helper because the seeding block below reaches
   * it from four branches, and because the three pieces (who, how much, what the
   * field shows) have to move together or the form opens with a figure that does
   * not match the total.
   */
  const seedSolePayer = (memberId: MemberId | null, total: bigint): void => {
    if (!memberId) {
      setPayers(new Map());
      setLockedPayers(EMPTY_LOCKS);
      setPaidText({});
      return;
    }
    setPayers(new Map([[memberId, total]]));
    setLockedPayers(EMPTY_LOCKS);
    setPaidText({});
  };

  const seedKey =
    members.data && !restored.loading ? (editing?.currentVersion?.id ?? `new:${groupId}`) : null;
  if (seedKey && seedKey !== seededFor) {
    setSeededFor(seedKey);
    const version = editing?.currentVersion;
    const draft = restored.draft;
    if ((captureId || voice || quick === '1') && !editing) {
      // Seeded from a capture (A34), the voice quick-add, or the quick expense
      // sheet: the passed amount and description fill the form ahead of any
      // stale draft, since arriving here that way is an explicit choice to turn
      // what was captured, spoken or typed into this expense.
      setAmount(routeAmount(captureAmount));
      const memberRows = members.data ?? [];
      // Voice may name who to split with. Match those names to members and keep
      // the payer in; anything else — a capture, or a sentence naming nobody —
      // takes the ordinary default of everyone. The names that became rows are
      // taken out of the description, which is only what was spent on.
      const named =
        voice && voicePeople
          ? matchMemberNames(
              voicePeople,
              memberRows.map((member) => ({
                id: member.id,
                name: displayName(member, viewerId),
              })),
            )
          : [];
      const chosen =
        named.length > 0
          ? myMemberId && !named.includes(myMemberId)
            ? [...named, myMemberId]
            : named
          : memberRows.map((member) => member.id);
      setParticipants(chosen);
      setDescription(
        voice
          ? stripMemberNames(
              captureDescription ?? '',
              memberRows.map((member) => ({
                id: member.id,
                name: displayName(member, viewerId),
              })),
            )
          : (captureDescription ?? ''),
      );
      setCategory(captureCategory || null);
      // A capture tagged with a custom tag carries its display as a JSON param,
      // so the assigned expense keeps the same tag rather than dropping to a
      // built-in. A malformed param is simply no meta (a built-in).
      setCategoryMeta(parseCategoryMetaParam(captureCategoryMeta));
      setCategoryChosen(Boolean(captureCategory));
      // Carry the capture's place onto the expense it becomes (A43).
      setLocation(parseLocationParam(captureLocation));
      // And how the draft says it was paid, so assigning does not quietly turn a
      // card payment into cash. A voice hand-off carries none and keeps the
      // default; anything the ledger does not know falls back to it too.
      setPaymentMethod(capturePaymentMethod(capturePayment));
      seedSolePayer(myMemberId, routeAmount(captureAmount));
      if (handedSubEventId) setSubEventId(handedSubEventId);
    } else if (draft) {
      // A draft outranks the saved version: it is what the user was in the
      // middle of writing when the app went away.
      setAmount(routeAmount(draft.amount));
      setDescription(draft.description);
      setSplitKind(draft.splitKind);
      // The payer picker is on the edit form too now, so a draft's payers are a
      // change somebody was in the middle of making rather than stale values to
      // discard. `payers` is the current shape; `payer` is what an older build
      // wrote, and is read as a bill paid entirely by that one person.
      const draftAmount = routeAmount(draft.amount);
      if (draft.payers && Object.keys(draft.payers).length > 0) {
        setPayers(new Map(Object.entries(draft.payers).map(([id, v]) => [id, routeAmount(v)])));
        setLockedPayers(new Set(draft.lockedPayers ?? []));
        // `groupCurrency` is derived further down the render; the seeding block
        // runs above it, so the group's default is read straight off the row.
        const draftCurrency = draft.currency ?? group.data?.default_currency ?? 'INR';
        setPaidText(
          Object.fromEntries(
            Object.entries(draft.payers).map(([id, v]) => [
              id,
              formatMinorInput(routeAmount(v), draftCurrency as CurrencyCode),
            ]),
          ),
        );
        setPayersFor(`${draftAmount}:${draftCurrency}`);
      } else {
        seedSolePayer(draft.payer ?? version?.payers[0]?.member_id ?? myMemberId, draftAmount);
      }
      setExpenseCurrency(resolveDraftCurrency(draft.currency, version?.currency ?? null));
      setFx(resolveDraftFx(draft.fx));
      setParticipants(draft.participants);
      setWeights(draft.weights ?? {});
      setPercents(draft.percents ?? {});
      setExacts(draft.exacts ?? {});
      setCategory(draft.category ?? null);
      setCategoryMeta(draft.categoryMeta ?? null);
      setCategoryChosen(draft.categoryChosen ?? false);
      setLocation(draft.location ?? null);
    } else if (version) {
      // The saved version as an edit starts from it — the same seeding the
      // expense screen's pop-ups use (lib/expenseEdit), so the two write the same
      // thing for the same change. It keeps the currency the bill was paid in
      // and the rate it was written at (ADR-003), every payer it records (not
      // just the first — flattening a several-payer bill on open and saving it
      // back silently rewrote who put money in), the saved place, and the split
      // figures back in the fields they were typed into.
      const seeded = editStateFromVersion(version, myMemberId);
      setAmount(seeded.amount);
      setDescription(seeded.description);
      // A saved category is a decision somebody already made. Re-guessing it on
      // open would quietly rewrite their answer.
      setCategory(seeded.category);
      setCategoryMeta(seeded.categoryMeta);
      setCategoryChosen(version.category !== null);
      setExpenseCurrency(seeded.currency);
      setFx(seeded.fx);
      // Several payers come back locked: those figures are recorded facts, so
      // they survive a change to the total rather than being quietly re-divided.
      setPayers(seeded.payers);
      setLockedPayers(seeded.payers.size > 1 ? new Set(seeded.payers.keys()) : EMPTY_LOCKS);
      setPaidText(
        Object.fromEntries(
          [...seeded.payers].map(([memberId, paid]) => [
            memberId,
            formatMinorInput(paid, seeded.currency as CurrencyCode),
          ]),
        ),
      );
      setPayersFor(`${seeded.amount}:${seeded.currency}`);
      setPaymentMethod(seeded.paymentMethod);
      setLocation(seeded.location);
      setSubEventId(seeded.subEventId);
      setIsDeposit(seeded.isDeposit);
      setBalanceDueMinor(seeded.balanceDueMinor);
      setBalanceDueDate(seeded.balanceDueDate);
      setParticipants(seeded.participants);
      setSplitKind(seeded.splitKind);
      setWeights(seeded.weights);
      setPercents(seeded.percents);
      setExacts(seeded.exacts);
    } else {
      setParticipants((members.data ?? []).map((member) => member.id));
      seedSolePayer(myMemberId, 0n);
    }
  }

  // The guess follows the description while it is being typed, and stops the
  // moment a chip is tapped. Keyed by the text it was made from so it runs once
  // per description rather than once per render.
  const [guessedFrom, setGuessedFrom] = useState<string | null>(null);
  if (seededFor !== null && !categoryChosen && description !== guessedFrom) {
    setGuessedFrom(description);
    // Keep the current category when the text matches no bucket: guessCategory
    // returns null for unrecognised descriptions, and clearing on null would
    // wipe the Food & drink default (or an earlier guess).
    const guess = guessCategory(description);
    if (guess) {
      setCategory(guess);
      // The guess is always a built-in, so it carries no custom snapshot.
      setCategoryMeta(null);
    }
  }

  // Everybody in a weighted split needs a number to start from, and the set
  // changes as people are ticked on and off. `fillEntries` returns null once
  // there is nothing left to fill, which is what stops this looping.
  if (splitKind === SplitKind.Shares) {
    const filled = fillEntries('shares', weights, participants);
    if (filled) setWeights(filled);
  } else if (splitKind === SplitKind.Percent) {
    const filled = fillEntries('percent', percents, participants);
    if (filled) setPercents(filled);
  }

  const entries =
    splitKind === SplitKind.Shares ? weights : splitKind === SplitKind.Exact ? exacts : percents;
  const setEntry = (memberId: MemberId, text: string): void => {
    const update = (current: SplitEntries): SplitEntries => ({ ...current, [memberId]: text });
    if (splitKind === SplitKind.Shares) setWeights(update);
    else if (splitKind === SplitKind.Exact) setExacts(update);
    else setPercents(update);
  };

  // The split used to fold into a one-line summary card, opening itself when the
  // configuration was not the "I paid, split equally" default. The fold is gone:
  // the three controls (how to split, who paid, who is in) stand open under a
  // plain heading, so changing a split is the tap that changes it rather than a
  // tap to open, then a tap to change.

  // The "paid by" and "split" rows unfold the same way: closed on the common
  // case (one payer, an equal split) so the dense card reads as a handful of
  // short facts, and open on its own the moment the bill is already in the
  // less common shape — several payers, or a split that is not equal — so
  // reopening an edit never hides a configuration that is already unusual.
  const [payerSectionChoice, setPayerSectionChoice] = useState<boolean | null>(null);
  const [splitSectionChoice, setSplitSectionChoice] = useState<boolean | null>(null);

  const groupCurrency = group.data?.default_currency ?? 'INR';
  // The expense keeps the currency it was paid in; the group's is only the
  // default and what a converted total would be shown in (ADR-003).
  const currency = expenseCurrency ?? groupCurrency;
  // The rate the trip has pinned for whatever this bill is in, if it has pinned
  // one (`components/TripRates`). It is a default for the rate field below and
  // nothing more — the bill can still carry its own, and whichever rate is on
  // the expense when it saves is the one it keeps (ADR-003).
  //
  /**
   * The group's pinned rate, offered on the card as one way to fill it.
   *
   * This used to be withheld from an edit. The reason was sound while it
   * lasted: a saved expense's own rate was not in the read model, so putting
   * the trip's number on the card would have re-priced a bill that was written
   * at a different one, silently, on save. Now the bill opens carrying its own
   * rate (`setFx` above), so the trip rate is what it always should have been
   * here — an offer next to the number already there, taken only if somebody
   * taps it.
   */
  const tripRate = tripRateFor(groupFxRates.data ?? [], currency, groupCurrency);

  // ───────────────────────────────────────────────────────── who paid ──
  //
  // One payer is the whole of the common case and stays a single tap. The
  // moment a second person is added, the figures have to add up to the total —
  // the ledger has always allowed several payer rows, and both edge functions
  // reject a write whose rows do not sum to the amount.
  // The day this expense is filed under, picked or inherited (expenseDateFor).
  const expenseDate = expenseDateFor({
    picked: pickedDate,
    captureDate: captureId ? captureExpenseDate : null,
    savedDate: editing?.currentVersion?.expense_date,
    today: todayIso(),
  });

  const applyDate = (event: DateTimePickerEvent, picked?: Date): void => {
    // Android's dialog dismisses itself; iOS keeps the spinner on the screen.
    if (Platform.OS === 'android') setEditingDate(false);
    if (event.type === 'dismissed' || !picked) return;
    setPickedDate(isoDate(picked));
  };

  // Event organizer (docs/event-organizer.md): the fixed sub-event list this
  // group's template suggests — empty for a Trip/Home/Couple/Friends/Other
  // group, for an Event made before templates shipped, and for 'other'.
  const eventSubEvents = subEventsForTemplate(group.data?.event_template);
  // Collapsed like the split/payer rows beside it — closed until tapped,
  // since there is no equivalent of `manyPayers` to auto-open it on.
  const [showSubEventSection, setShowSubEventSection] = useState(false);

  const [editingBalanceDueDate, setEditingBalanceDueDate] = useState(false);
  const applyBalanceDueDate = (event: DateTimePickerEvent, picked?: Date): void => {
    if (Platform.OS === 'android') setEditingBalanceDueDate(false);
    if (event.type === 'dismissed' || !picked) return;
    setBalanceDueDate(isoDate(picked));
  };

  const payerIds = [...payers.keys()];
  // With one payer there is nothing to hold constant: that person carries the
  // whole bill by definition, so a lock left over from a moment when there were
  // two must not survive and strand the total.
  const effectiveLocks = payers.size <= 1 ? EMPTY_LOCKS : lockedPayers;
  const payerProblem = validatePayers(amount, payers);
  // A bill that already records several payers is in several-payer mode however
  // the flag was left — an edit must never offer to quietly drop one of them.
  const manyPayers = payerMode === 'many' || payers.size > 1;
  // The chooser's order: whoever is paying, then everybody else, each keeping
  // the group's own order within their half (`sort` is stable). The lane scrolls
  // sideways, so without this a payer picked from the end of a long member list
  // would be the one thing on the screen you cannot see.
  const payerChoices = useMemo(() => {
    const rows = members.data ?? [];
    return [...rows].sort((a, b) => Number(payers.has(b.id)) - Number(payers.has(a.id)));
  }, [members.data, payers]);

  // Closed by default: the "paid by" row reads as a fact ("You") rather than a
  // control until it is tapped, or until the bill already has several payers
  // (an edit, or the several-payer link tapped earlier in this same visit).
  const showPayerSection = payerSectionChoice ?? manyPayers;
  // One line for the dense row: who is carrying the bill, in words rather than
  // avatars — "You" for the common single payer, "You +2" once several are on
  // it. The full lane of avatars (and, in several-payer mode, each one's own
  // figure) only draws once the row is tapped open.
  const payerSummary = (() => {
    const names = payerIds.map((memberId) => {
      const member = (members.data ?? []).find((row) => row.id === memberId);
      return member ? displayName(member, viewerId) : t.misc.someone;
    });
    if (names.length === 0) return t.misc.someone;
    if (names.length === 1) return names[0]!;
    return `${names[0]} +${names.length - 1}`;
  })();

  /** Re-derive the figures, then refresh every field except the typed ones. */
  const applyPayers = (
    selected: readonly MemberId[],
    current: PayerMap,
    locked: ReadonlySet<MemberId>,
    total: bigint,
    typed?: { readonly member: MemberId; readonly text: string },
  ): void => {
    const effective = selected.length <= 1 ? EMPTY_LOCKS : locked;
    const next = rebalancePayers({
      amount: total,
      selected,
      current,
      locked: effective,
      // The expense id, so which payer absorbs an odd paisa is stable across
      // devices and across reopening the form (ADR-009).
      seed: targetExpenseId,
    });
    setPayers(next);
    setLockedPayers(effective);
    setPayersFor(`${total}:${currency}`);
    setPaidText(() => {
      const fields: Record<MemberId, string> = {};
      for (const [member, paid] of next) {
        // A typed field keeps the characters that were typed — reformatting
        // "12." to "12.00" mid-keystroke moves the caret out from under a thumb.
        fields[member] =
          typed && typed.member === member
            ? typed.text
            : formatMinorInput(paid, currency as CurrencyCode);
      }
      return fields;
    });
  };

  /**
   * Carry out a plan from `expenseForm` — the pure half of every payer gesture.
   * Null means the gesture is a no-op, which is why each of them can be a
   * single line below.
   */
  const run = (plan: PayerPlan | null): void => {
    if (!plan) return;
    applyPayers(plan.selected, plan.current, plan.locked, amount, plan.typed);
  };

  /**
   * Tap a member. In one-payer mode that replaces whoever was there; in
   * several-payer mode it adds or removes them.
   */
  const togglePayer = (memberId: MemberId): void => {
    // Null is the tap that does nothing — the last payer cannot be removed.
    run(planToggle({ many: manyPayers, payers, locked: effectiveLocks, amount, memberId }));
  };

  /**
   * Switch between the two. Going to several splits the paying evenly between
   * whoever is there so the figures start out adding up; coming back keeps the
   * person who put in the most and hands them the whole bill, because dropping
   * the largest contributor is the one collapse nobody means.
   */
  const setManyPayers = (many: boolean): void => {
    if (many || payers.size <= 1) {
      setPayerMode(many ? 'many' : 'one');
      return;
    }
    const plan = planCollapseToOne({ payers, amount });
    if (!plan) return;
    const keeping = plan.selected[0]!;
    const member = (members.data ?? []).find((row) => row.id === keeping);
    const name = member ? displayName(member, viewerId) : t.misc.someone;
    // Collapsing is not undoable inside the form: going back to several payers
    // re-divides evenly, so the figures somebody typed are gone either way. On
    // a bill that already records several payers those figures are recorded
    // facts, and this is a text link sitting next to an ordinary one — near
    // enough to a save button to be worth a question first.
    void confirm({
      title: t.expense.collapsePayersTitle,
      body: fill(t.expense.collapsePayersBody, { name }),
      confirmLabel: t.expense.collapsePayersConfirm,
      cancelLabel: t.cancel,
      tone: 'danger',
    }).then((ok) => {
      if (!ok) return;
      setPayerMode('one');
      run(plan);
    });
  };

  // Who may add or remove a bill against this expense: a party to it (its author
  // or one of its payers), which is what the attach RPCs enforce. An admin who is
  // not a party may still remove the legacy group-visible bill — the same split
  // of powers the expense screen applies.
  const editingVersion = editing?.currentVersion;
  const isExpenseParty = Boolean(
    myMemberId &&
    editingVersion &&
    (editingVersion.author_member_id === myMemberId ||
      editingVersion.payers.some((row) => row.member_id === myMemberId)),
  );
  const iAmGroupAdmin =
    (members.data ?? []).find((row) => isViewer(row, viewerId))?.role === 'admin';

  /** A figure typed against one payer. Typing locks it; the others absorb. */
  const setPaidEntry = (memberId: MemberId, text: string): void => {
    run(
      planTypedAmount({
        payers,
        locked: effectiveLocks,
        memberId,
        text,
        currency: currency as CurrencyCode,
      }),
    );
  };

  /** Back to an even split of the paying — the way out of any tangle above. */
  const splitPaidEvenly = (): void => {
    run(planEvenly(payers));
  };

  // Keep the figures answering to the total. React's "adjust state when the
  // input changes" pattern — the same one the seeding above uses — rather than
  // an effect, so a scan that fills in ₹1,240 re-splits the paying in the very
  // render that shows the new total, with no frame in between where the payers
  // and the amount disagree. Typed figures survive it: only the unlocked ones
  // move (see rebalancePayers).
  if (focus === 'payers' && seededFor !== null && !payersFocusApplied) {
    setPayersFocusApplied(true);
    setPayerMode('many');
  }

  const payersKey = `${amount}:${currency}`;
  if (seededFor !== null && payers.size > 0 && payersKey !== payersFor) {
    applyPayers(payerIds, payers, effectiveLocks, amount);
  }

  // Picking from the header pill: a rate typed for the previous currency would
  // convert the wrong thing (and the server rejects it), so clear it — the same
  // reset the old in-card currency chips did.
  const chooseCurrency = (code: string): void => {
    setExpenseCurrency(code);
    setFx(null);
    setPickingCurrency(false);
  };

  // Every keystroke, debounced just enough to avoid one write per character.
  useDraft<ExpenseDraft>(
    draftKey,
    {
      amount: amount.toString(),
      description,
      splitKind,
      payers: Object.fromEntries([...payers].map(([id, paid]) => [id, paid.toString()])),
      lockedPayers: [...lockedPayers],
      currency: expenseCurrency,
      fx,
      participants,
      weights,
      percents,
      exacts,
      category,
      categoryMeta,
      categoryChosen,
      location,
    },
    { enabled: seededFor !== null },
  );

  // Auto-stamp the current place on a brand-new expense (A43 follow-up), but
  // only ever when the person already granted location on an earlier explicit
  // "Add location" — opening this form must never raise a system prompt (the
  // deferred-permission stance `lib/location` is built around). It runs once,
  // never on an edit (that expense's place is a decision already made, and it
  // may have happened elsewhere), never over a capture/voice/draft that already
  // carried a place, and never over a pin set (or cleared) by hand: the
  // functional set below drops the fix if a value appeared meanwhile. A denied
  // or unavailable fix is simply no location, exactly as before.
  useEffect(() => {
    if (autoLocatedRef.current || seededFor === null) return;
    if (editing || captureId || voice) return;
    // One attempt, whatever the outcome — clearing the pin by hand is never
    // undone, and a draft/seed that already placed it (checked next) is left be.
    autoLocatedRef.current = true;
    if (location) return;
    let active = true;
    void captureLocationIfGranted().then((loc) => {
      // Never override a place set in the meantime — only fill an empty pin.
      if (!active || !loc) return;
      setLocation((current) => current ?? loc);
      // The name is resolved separately, never awaited, so it cannot delay the
      // fix above. Patched in only if the pin still matches this fix — the
      // reader has not since cleared or moved it by hand, or picked a spot.
      void reverseGeocode(loc.lat, loc.lng).then((name) => {
        if (!active || !name) return;
        setLocation((current) =>
          locationUnchanged(current, loc.lat, loc.lng) ? { ...current, name } : current,
        );
      });
    });
    return () => {
      active = false;
    };
  }, [seededFor, editing, captureId, voice, location]);

  const splitParams: SplitParams = useMemo(
    () => splitParamsFor({ splitKind, weights, percents, exacts, participants, currency }),
    [splitKind, weights, percents, exacts, currency, participants],
  );

  // Preview with the same engine the server uses; if they ever disagree the
  // server wins and tells us why (SHARE_MISMATCH).
  const preview = useMemo(
    () =>
      previewShares({ amount, currency, params: splitParams, participants, seed: targetExpenseId }),
    [amount, currency, splitParams, participants, targetExpenseId],
  );

  // Why the split does not add up, if it does not: an exact split's money left
  // over (or over-assigned) first — only once there is a bill to measure
  // against — then the weighted check (lib/expenseEdit.splitIssueFor, shared
  // with the expense screen's split pop-up).
  const splitIssue = splitIssueFor(
    { splitKind, weights, percents, exacts, participants, currency, amount },
    t.expense,
    locale,
  );

  // Closed by default, same as "paid by": a plain equal split reads as a
  // fact ("Equally") until the row is tapped, and an edit that already split
  // some other way opens straight to the controls that explain why. A split
  // the person closed by hand reopens itself the moment it stops adding up —
  // changing the amount afterwards (a scan, say) can unbalance an exact split
  // that was fine when it was collapsed, and `saveHint` below does not repeat
  // the split card's own reason, so a Save left disabled by a closed card
  // would otherwise have nothing on screen to explain it.
  const showSplitSection =
    splitIssue !== null || (splitSectionChoice ?? splitKind !== SplitKind.Equal);
  const splitKindLabel =
    splitKind === SplitKind.Equal
      ? t.expense.equally
      : splitKind === SplitKind.Shares
        ? t.expense.shares
        : splitKind === SplitKind.Percent
          ? t.expense.percent
          : t.expense.exactly;

  if (group.isLoading || members.isLoading || restored.loading) {
    // Shell first: the back button and title paint instantly on navigation, and
    // only the form body waits on the mirror read (a few ms at launch). A bare
    // full-screen spinner used to leave a headerless blank while it loaded.
    return (
      <Screen edges={[]}>
        <StatusBar style="light" />
        {/* The same hero the loaded form opens on, so the panel does not repaint
            from a white bar to a purple one once the mirror read lands. */}
        <ExpenseHero
          title={editing ? t.expense.edit : t.addExpense}
          category={category}
          categoryMeta={categoryMeta}
          description={description}
          currency={currency}
          amount={amount}
          onAmountChange={setAmount}
          onPressCurrency={() => setPickingCurrency(true)}
        />
        <View style={{ paddingTop: theme.spacing.xxxl, alignItems: 'center' }}>
          <ActivityIndicator color={theme.color.brand} />
        </View>
      </Screen>
    );
  }

  if (!group.data) {
    return (
      <Screen>
        <EmptyState title={t.group.notFound} body={t.group.notFoundArchived} />
      </Screen>
    );
  }

  const submit = async (): Promise<void> => {
    // Read-only once the guest trial is up (ADR-006 addendum): the group and its
    // history stay visible, but a new or edited expense sends them to sign up.
    if (guard.blockWrite()) return;
    setError(null);
    // The same check the server makes. Catching it here means a bill that does
    // not add up is a sentence under the button rather than a PAYER_MISMATCH
    // that comes back minutes later off a queue.
    if (payerProblem) {
      setError(payerMessage);
      return;
    }
    setSaving(true);
    try {
      // Straight into the durable queue: this returns as soon as the mutation
      // is on disk, so the expense is saved whether or not there is a network.
      // The bill image, if any, was uploaded to R2 the moment it was scanned or
      // attached (persistReceipt) — the ledger write carries only the money.
      //
      // The payload is built by the same function the expense screen's pop-ups
      // use (lib/expenseEdit.expenseWritePayload): blank description stays
      // blank, every payer is serialised, the note and receipt link are carried
      // through from the version being edited (the write nulls whatever it is
      // not given), `expectedShares` is seeded with this expense's id, and
      // `baseVersionNo` lets the server spot a concurrent edit (TDR §4.4).
      await mutate(
        expenseId ? MutationKind.ExpenseUpdate : MutationKind.ExpenseCreate,
        groupId,
        expenseWritePayload({
          expenseId: targetExpenseId,
          state: {
            amount,
            description,
            category,
            categoryMeta,
            // A chosen day wins outright. Untouched, a capture keeps the day it
            // was caught, a saved expense keeps the day it has, and only a new
            // one is today's (expenseDateFor).
            expenseDate,
            currency,
            fx,
            splitKind,
            participants,
            weights,
            percents,
            exacts,
            payers,
            paymentMethod,
            location,
            subEventId,
            isDeposit,
            balanceDueMinor,
            balanceDueDate,
          },
          editing: editing?.currentVersion,
        }),
      );
      // Paying a vendor's balance: the advance it settles is rewritten with its
      // balance cleared (a new version of that expense, via the ordinary edit
      // path), so the Vendors tab shows the vendor as paid off.
      if (!expenseId && settlesExpenseId) {
        const advance = expenses.rows.find((row) => row.id === settlesExpenseId);
        const advanceVersion = advance?.currentVersion;
        // Only the advance's author or a payer may edit it (same rule as the
        // editor); anybody else's payment still saves, the balance stays.
        const mayEdit =
          advanceVersion !== null &&
          advanceVersion !== undefined &&
          (advanceVersion.author_member_id === myMemberId ||
            advanceVersion.payers.some((row) => row.member_id === myMemberId));
        if (advance && advanceVersion && mayEdit && !advance.deleted_at) {
          await mutate(
            MutationKind.ExpenseUpdate,
            groupId,
            expenseWritePayload({
              expenseId: settlesExpenseId,
              state: withBalanceCleared(editStateFromVersion(advanceVersion, myMemberId)),
              editing: advanceVersion,
            }),
          );
        }
      }
      await clearDraft(draftKey);
      // The receipts held for a new expense can go now (see sendHeldReceipts).
      if (!expenseId) {
        saved.current = true;
        void sendHeldReceipts(targetExpenseId);
      }
      // The expense exists now; closing the capture removes it from the inbox
      // and records which expense it became (A34). Done before leaving so a
      // successful save never leaves the capture orphaned in the list.
      if (captureId) {
        await assignCapture.mutateAsync({ captureId, groupId, expenseId: targetExpenseId });
      }

      // Only now — the expense is saved — does the kept bill go to R2, so an
      // abandoned add never orphans an object. The upload is best-effort and
      // never un-saves the money: on failure the person is told why (an over-cap
      // refusal points at the upgrade) and left on the screen, where saving again
      // re-attempts the upload (the money write is idempotent by expense id),
      // rather than being navigated away with the bill silently lost.
      if (pendingReceipt) {
        try {
          await uploadExpenseReceipt({
            groupId,
            expenseId: targetExpenseId,
            base64: pendingReceipt.base64,
            mimeType: pendingReceipt.mimeType,
          });
          setPendingReceipt(null);
        } catch (uploadError) {
          if (uploadError instanceof NotUploaderError) {
            // Somebody else kept this expense's bill. Saving again would only be
            // refused again, so the new photo is dropped and the reason shown;
            // the expense itself is already saved.
            setPendingReceipt(null);
            setScanNote(t.storage.notUploader);
            return;
          }
          setScanNote(uploadError instanceof StorageCapError ? t.storage.full : t.couldNotSave);
          return;
        }
      }

      router.back();
    } catch (caught) {
      setError(friendlyError(caught, t.couldNotSave, 'expense.save'));
    } finally {
      setSaving(false);
    }
  };

  /**
   * What this person is down for, in money, as the number beside their name
   * changes.
   *
   * The preview is the ledger's own arithmetic and is what gets saved, so it
   * wins whenever it exists. It does not exist while the percentages are still
   * short of 100 — `computeShares` refuses that, rightly — and staying blank
   * until the last field is right hides the one number somebody is typing
   * towards. So the incomplete case falls back to this line's own share of the
   * total: 20% of ₹300 is ₹60 whatever the other rows say, and the message
   * under the list is what says the column does not add up yet.
   */
  const lineAmount = (memberId: MemberId): bigint =>
    lineAmountFor(memberId, preview, { splitKind, percents, amount });

  /**
   * Keep the bill (E2): upload it to the group's R2 storage under the expense id
   * (A44), so any member can open it later and the owner can from any device. A
   * group receipt in R2 is group-readable — the `r2-sign` edge authorises a read
   * by group membership — which is the visibility the old E3 "share" toggle used
   * to arrange by hand. The image counts against the group's storage ceiling
   * (ADR-011); only the money rides the expense sync.
   *
   * The local image is shown as the thumbnail at once; the bytes are held and
   * only uploaded to R2 once the expense is saved ({@link submit}), so an add the
   * person abandons never leaves an orphaned object behind.
   */
  const stageReceipt = (picked: PickedImage): void => {
    setReceiptUri(picked.uri);
    setReceiptPath(expenseReceiptPath(groupId, targetExpenseId));
    setPendingReceipt(picked);
  };

  /**
   * Attach a bill the person already has (E1).
   *
   * The escape hatch for when scanning is the wrong tool: the bill is a
   * screenshot of a delivery order, a PDF photographed earlier, or a scan that
   * failed and they would rather attach the picture in their gallery. Unlike a
   * scan it never hits the metered `receipt-parse` path — nothing is recorded
   * server-side, so it does not count against the group's receipt cap and is
   * offered even when the cap is reached. The image is kept and the amount stays
   * theirs to type.
   */
  const attach = async (): Promise<void> => {
    setError(null);
    setScanNote(null);
    let picked: PickedImage | null = null;
    try {
      picked = await pickReceiptImage();
    } catch {
      picked = null;
    }
    if (!picked) return;
    stageReceipt(picked);
  };

  /**
   * Photograph the bill, fill in the two fields somebody was about to type.
   *
   * This screen deliberately does not become an itemizing screen. Most bills
   * are split some way that has nothing to do with what each line cost, and a
   * scan that dragged everybody into claiming items would be worse than typing
   * a total. What it takes is the grand total and the merchant's name; the
   * lines it read are handed to the itemize screen, which is one tap away for
   * the times that matters.
   *
   * ADR-008 still holds: the model proposes and the person confirms. Nothing
   * saves itself, and the amount lands in the same field, editable.
   */
  const scan = async (): Promise<void> => {
    // The cap decides the button below, but guard here too: a scan is not free
    // to start (the camera, the OCR, the metered call), and the server would
    // refuse to record it anyway.
    if (receiptTapAction(capStatus) !== 'scan') return;
    setError(null);
    setScanNote(null);
    let picked: Awaited<ReturnType<typeof captureReceipt>> = null;
    try {
      picked = await captureReceipt();
    } catch {
      picked = null;
    }
    if (!picked) return;
    setScanning(true);
    try {
      // Read the text on the phone first: the photograph never leaves the
      // device when it works, and it costs about a tenth as much. A dark or
      // blurred bill falls back to sending the image, which reads it better.
      const recognised = await recogniseReceipt(picked.uri);
      const result = recognised
        ? await scanReceiptText({ groupId, rawText: recognised.text, currency, source: 'camera' })
        : await scanReceipt({
            groupId,
            base64: picked.base64,
            mimeType: picked.mimeType,
            currency,
          });

      if (result.parsed.grandTotal > 0) setAmount(BigInt(result.parsed.grandTotal));
      if (result.parsed.merchant && !description.trim()) setDescription(result.parsed.merchant);
      setScannedItems(result.parsed.items.length);

      // Keep the photographed bill too (E2): upload it to the group's R2 storage
      // so the owner and every member can view it later. The scan's own server
      // receipt is a separate thing (the metered parse); this is the kept copy.
      stageReceipt(picked);

      // Kept for the itemize screen in case they want it. Nobody should have to
      // photograph the same bill twice, and a scan is metered (ADR-011).
      void syncEngine.saveDraft(handoverKey(groupId), {
        parsed: result.parsed,
        receiptId: result.receiptId,
        at: Date.now(),
      });

      setScanNote(
        result.check.reconciles && result.check.problems.length === 0
          ? t.expense.scanReconciles
          : result.check.problems[0]
            ? receiptProblemText(
                result.check.problems[0],
                t.itemize,
                result.parsed.items.map((item) => item.label),
              )
            : t.expense.scanCheckTotal,
      );

      // The receipt just landed, so the cached cap count is now stale. Refresh
      // the gate before another scan can start from a wrong number.
      await queryClient.invalidateQueries({ queryKey: ['receiptCap', groupId] });
    } catch (caught) {
      setError(friendlyError(caught, t.couldNotScan, 'expense.scan'));
    } finally {
      setScanning(false);
    }
  };

  const toggleParticipant = (memberId: MemberId): void => {
    setParticipants((current) =>
      current.includes(memberId)
        ? current.filter((item) => item !== memberId)
        : [...current, memberId],
    );
  };

  // Why Save is disabled, in one line, so a greyed-out button is never a dead
  // end the person has to guess their way out of. A broken split already prints
  // its own reason in the split card, so it is not repeated here; `saving` is a
  // transient state, not something to instruct around.
  // The payer side's complaint, in money the person can read. `delta` is signed:
  // positive is still to hand out, negative is more claimed than the bill.
  const payerMessage = payerIssueFor({ amount, payers, currency }, t.expense, locale);

  const saveHint =
    amount === 0n
      ? t.expense.saveNeedsAmount
      : participants.length === 0
        ? t.expense.saveNeedsWho
        : // Only worth saying once the bill has a total: "₹0 left to assign" on an
          // empty form is noise, not guidance.
          payerMessage;
  const canSave =
    amount > 0n && participants.length > 0 && splitIssue === null && payerProblem === null;

  // The bottom-bar sub-line. When an equal split lands the same amount on every
  // head, say it in money — "3 people owe ₹200 each" — which is the number
  // people actually care about; otherwise the plain headcount.
  const previewValues = preview ? [...preview.values()] : [];
  const evenEach =
    previewValues.length > 0 && previewValues.every((value) => value === previewValues[0])
      ? previewValues[0]
      : null;
  const savePreview =
    participants.length === 0
      ? t.extras.savedStraightAway
      : evenEach !== null && amount > 0n
        ? plural(locale, participants.length, t.expense.oweEach).replace(
            '{amount}',
            format(money(evenEach, currency), { locale }),
          )
        : plural(locale, participants.length, t.memberCount);

  return (
    // No safe-area edges: this screen reserves neither end itself. The hero pads
    // the status bar into its own gradient at the top, and the action bar pads
    // the navigation bar into its own fill at the bottom, so both surfaces run
    // to the screen edge instead of floating on a strip of page colour — the
    // grammar the app's bottom bar already uses.
    //
    // It also settles where a picker sheet lands. `SheetOverlay` is drawn in
    // this tree, absolutely positioned to the bottom, and an absolute child is
    // laid out inside its parent's padding: with a bottom inset on the Screen
    // the sheet stopped short of the screen edge, its scrim left the navigation
    // bar unwashed, and the sheet then reserved the same inset a second time
    // under its own last row.
    <Screen edges={[]}>
      {/* The hero runs dark under the status bar, so its icons must be light —
          the same override the expense screen this form mirrors makes. */}
      <StatusBar style="light" />
      {/* The action bar is pinned to the bottom edge, outside the scroll, and a
          split-share field can be the focused input — on iOS the soft keyboard
          would slide up over both. Lifting the scroll + bar together keeps the
          running total, Save, and the field you are typing in above the
          keyboard. Android resizes the window itself (adjustResize), so it needs
          no behaviour. The currency sheet sits outside this wrapper so it stays
          anchored to the screen, not shoved by the keyboard-avoid. */}
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {/* The same panel the expense screen wears — category badge, one line of
            identity, the amount — so tapping Edit changes what you can do, not
            where anything is. The amount is editable here and shares its line
            with the currency pill instead of standing alone at 44pt over it.
            "Split by item" moved down beside the split it belongs to. */}
        <ExpenseHero
          title={`${editing ? t.expense.edit : t.addExpense} · ${groupLabel(
            group.data,
            members.data ?? [],
            viewerId,
          )}`}
          category={category}
          categoryMeta={categoryMeta}
          description={description}
          currency={currency}
          amount={amount}
          onAmountChange={setAmount}
          onPressCurrency={() => setPickingCurrency(true)}
          // Opened by tapping the total on the expense screen: land in the amount
          // field with the keyboard already up.
          autoFocusAmount={focus === 'amount'}
        />
        <ScrollView
          ref={scrollRef}
          style={{ flex: 1 }}
          // Most of what used to be separate blocks here — facts, paid by,
          // split, location — is one dense card now, so this gutter only ever
          // separates the receipt row, the note, that card, and (rarely) the
          // FX rate. `md` between them keeps the grouping legible without
          // spending height a dense card no longer needs it to.
          contentContainerStyle={{
            paddingHorizontal: theme.spacing.xl,
            paddingTop: theme.spacing.sm,
            paddingBottom: theme.spacing.md,
            gap: theme.spacing.md,
          }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* The bill, first — the order the expense screen reads in.

            Viewing a bill puts its receipts at the top, above the card of facts
            and above the split; the form used to put them third, after the note
            and the day, so the same expense told its story in two different
            orders depending on whether you were reading it or writing it. The
            bill is also the thing a person is most often holding when they open
            this screen, and scanning it fills in the amount and the note below —
            so it belongs before the fields it populates, not after them.

            The bill is still a shortcut, not the screen: two small actions
            rather than a card that makes this look like a receipt scanner. Scan
            is metered and gives way when the group is capped; Add photo keeps an
            image on the device and never records a receipt server-side, so it
            is offered even at the cap.

            New expenses only. On an edit the gallery below is already the place
            bills are added and removed — it carries its own add tile — so these
            two would be a second door to the same room, one of which (scan)
            would also re-read a bill that has already been entered. */}
          <View style={{ gap: theme.spacing.xs }}>
            {/* The bill, as one slim row rather than a pair of ghost buttons
              plus the gallery's own "Add receipt" row stacked under them — on a
              brand-new expense those used to be two separate invitations to do
              the same thing. A small disc (a camera glyph, or the thumbnail
              once something is attached via `ExpenseReceipts` below), the
              row's words, and a trailing action: scan while nothing is capped,
              a plain attach once it is. Scanning is the primary tap — a bill is
              usually in hand when this screen opens — and "Add photo" is the
              small pill beside it, the same split `ReceiptField` on the
              no-group capture screen draws. New expenses only: an existing
              one's bills are already managed by the gallery beneath this. */}
            {!editing ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={
                  capLocked
                    ? t.expense.addPhoto
                    : scanning
                      ? t.expense.reading
                      : t.expense.scanReceipt
                }
                accessibilityHint={capLocked ? t.expense.capReachedBody : t.captureForm.receiptSub}
                disabled={scanning || saving || (!capLocked && capStatus === 'loading')}
                onPress={() => (capLocked ? void attach() : void scan())}
                // The row's trailing control — "Upgrade" once capped, the
                // "Add photo" pill otherwise — is a `Pressable`/`Button`
                // nested inside this one, which VoiceOver and TalkBack treat
                // as a single accessible element: a screen-reader user could
                // reach the row but never that control. An accessibility
                // action exposes it as a second, named action on the same
                // element instead, without changing the sighted layout.
                accessibilityActions={
                  scanning
                    ? undefined
                    : capLocked
                      ? [{ name: 'upgrade', label: t.expense.capUpgrade }]
                      : [{ name: 'attach', label: t.expense.addPhoto }]
                }
                onAccessibilityAction={(event) => {
                  if (event.nativeEvent.actionName === 'upgrade') router.push('/settings/upgrade');
                  else if (event.nativeEvent.actionName === 'attach') void attach();
                }}
                style={({ pressed }) => ({
                  flexDirection: 'row',
                  alignItems: 'center',
                  minHeight: 48,
                  gap: theme.spacing.md,
                  opacity: pressed ? 0.7 : 1,
                })}
              >
                <View
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 18,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: theme.color.brandSoft,
                  }}
                >
                  <Ionicons name="camera-outline" size={iconSize.md} color={theme.color.brand} />
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text variant="subheading" numberOfLines={1}>
                    {capLocked
                      ? t.expense.addPhoto
                      : scanning
                        ? t.expense.reading
                        : t.expense.scanReceipt}
                  </Text>
                  <Text variant="micro" tone="muted" numberOfLines={1}>
                    {capLocked ? t.expense.capReachedBody : t.captureForm.receiptSub}
                  </Text>
                </View>
                {scanning ? (
                  <ActivityIndicator color={theme.color.brand} />
                ) : capLocked ? (
                  <Button
                    label={t.expense.capUpgrade}
                    size="sm"
                    onPress={() => router.push('/settings/upgrade')}
                  />
                ) : (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t.expense.addPhoto}
                    disabled={saving}
                    onPress={() => void attach()}
                    hitSlop={6}
                    style={({ pressed }) => ({
                      paddingHorizontal: theme.spacing.sm,
                      paddingVertical: theme.spacing.xs,
                      borderRadius: theme.radius.pill,
                      backgroundColor: theme.color.brandSoft,
                      opacity: pressed ? 0.6 : 1,
                    })}
                  >
                    <Text variant="caption" tone="brand" style={{ fontWeight: '700' }}>
                      {t.expense.addPhoto}
                    </Text>
                  </Pressable>
                )}
              </Pressable>
            ) : null}
            {scanNote ? (
              <Text variant="caption" tone="brand">
                {scanNote}
              </Text>
            ) : null}

            {/* The bills kept against this expense — the same gallery the expense
              screen shows, not a second design for the same thing. `externalAdd`
              on a new expense: the row above already owns adding (scan or
              attach), so the gallery draws only once something exists rather
              than repeating its own "Add receipt" invitation under it.

              On a new expense there is no row to attach to yet, so the gallery
              runs in draft mode: what is added is parked on the device, held,
              and sent once the save lands (see `saved` above). */}
            {editing || !expenseId ? (
              <ExpenseReceipts
                groupId={groupId}
                expenseId={targetExpenseId}
                draft={!expenseId}
                canManage={editing ? isExpenseParty : true}
                canRemoveLegacy={isExpenseParty || iAmGroupAdmin}
                legacyReceiptPath={receiptUri ? receiptPath : null}
                externalAdd={!editing}
                onLegacyRemoved={() => {
                  setReceiptUri(null);
                  setReceiptPath(null);
                }}
              />
            ) : null}

            {scannedItems > 0 && !editing ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => router.replace(`/group/${groupId}/itemize`)}
              >
                <Text variant="caption" tone="brand" style={{ fontWeight: '700' }}>
                  {`${plural(locale, scannedItems, t.expense.scanReadItemsCta)} →`}
                </Text>
              </Pressable>
            ) : null}
          </View>

          {/* "How much" and "what for" are the whole of the common case. The
            amount is in the hero above and the note is here, with only the bill
            between them — and the bill is what fills both in when it is scanned,
            so it is on the way to the note rather than in front of it. The names
            are handed to the recogniser as hints; a general model guesses at
            Indian names and the note is where they turn up. */}
          {/* One line, not several: the note is a short "what for", and a tall
            multiline well cost more height than anything else on this screen
            ever needed back. The field still scrolls its own text if someone
            types past the edge — nothing is lost, it just no longer grows the
            screen to show it. */}
          <DescriptionField
            value={description}
            onChange={setDescription}
            placeholder={t.expense.descriptionPlaceholder}
            accessibilityLabel={t.description}
            hints={nameHints}
          />

          {/* Every fact about this bill — what for, who paid, when, how it is
            split, how it was paid, what it is in, where, and anything still
            optional — as one dense card of single-line rows instead of five
            separate sections each wearing its own heading and padding.
            `DetailRows` puts a hairline in the gap between each pair, so none
            of this needs a divider of its own; `dense` shrinks every row to a
            48pt line with a 28pt icon disc, so eight facts read as one short
            list rather than a stack of 68pt cards.

            Category, payment method, the day and the currency are plain
            facts — a short, already-chosen answer, changed from a sheet — and
            stay open, the same rows this card has always carried. "Paid by"
            and "split" are facts with a control behind them, so each is now a
            row that unfolds its own picker in place rather than a card of its
            own: closed on the common shape (one payer, split evenly) so the
            card reads short, and open on its own the moment it is not — an
            edit with several payers, say, or a split that was never equal.
            Nothing inside either fold changed; only the shell around it did. */}
          <Card padded={false} style={{ paddingHorizontal: theme.spacing.lg }}>
            <DetailRows>
              <CategoryRow
                value={category}
                meta={categoryMeta}
                onPress={() => setPickingCategory(true)}
                tinted
                dense
              />

              {/* Event organizer (docs/event-organizer.md): which sub-event this
              spend is for — a row like the ones beside it, collapsed to its
              label until tapped. Only on an Event group whose template
              suggests any; a plain Trip/Home/Couple/Friends/Other group, or
              an Event with no template, never grows this row. */}
              {eventSubEvents.length > 0 ? (
                <View>
                  <DetailRow
                    icon="sparkles-outline"
                    tint={theme.tint.mint}
                    dense
                    label={t.eventOrganizer.subEventLabel}
                    value={
                      subEventId
                        ? `${eventSubEvents.find((subEvent) => subEvent.id === subEventId)?.emoji ?? ''} ${
                            t.eventSubEvents[subEventId] ?? subEventId
                          }`.trim()
                        : t.eventOrganizer.noSubEvent
                    }
                    placeholder={!subEventId}
                    expanded={showSubEventSection}
                    onPress={() => setShowSubEventSection((was) => !was)}
                  />
                  {showSubEventSection ? (
                    <View style={{ paddingBottom: theme.spacing.sm }}>
                      <ChipRow
                        options={[
                          { value: 'none', label: t.eventOrganizer.noSubEvent },
                          ...eventSubEvents.map((subEvent) => ({
                            value: subEvent.id,
                            label: `${subEvent.emoji} ${t.eventSubEvents[subEvent.id] ?? subEvent.id}`,
                          })),
                        ]}
                        value={subEventId ?? 'none'}
                        onChange={(picked) => setSubEventId(picked === 'none' ? null : picked)}
                      />
                    </View>
                  ) : null}
                </View>
              ) : null}

              {/* Who paid — on an edit as much as on a new expense, and now as
              many people as actually put money in. Collapsed, the row says
              who in a word ("You", "You +2"); tapping it unfolds the same
              lane of avatars — and, once several are on it, each one's own
              figure — this used to carry in a card of its own below.

              The picker used to be hidden the moment the form opened on an
              existing bill, so the correction people most often come back
              to make had no control anywhere on the screen; and it was
              single-select, so "she got the taxi, I got the tickets" had to
              be entered as two expenses. Both fixes are unchanged here. */}
              <View
                onLayout={(event) => {
                  if (focus !== 'payers' || scrolledToPayers.current) return;
                  scrolledToPayers.current = true;
                  const top = Math.max(0, event.nativeEvent.layout.y - theme.spacing.lg);
                  requestAnimationFrame(() =>
                    scrollRef.current?.scrollTo({ y: top, animated: true }),
                  );
                }}
              >
                <DetailRow
                  icon="people-outline"
                  tint={theme.tint.sky}
                  dense
                  label={t.paidBy}
                  value={payerSummary}
                  expanded={showPayerSection}
                  onPress={() => setPayerSectionChoice(!showPayerSection)}
                />
                {showPayerSection ? (
                  <View style={{ gap: theme.spacing.sm, paddingBottom: theme.spacing.sm }}>
                    <Row style={{ justifyContent: 'flex-end' }}>
                      <Row style={{ gap: theme.spacing.lg, alignItems: 'center', flexShrink: 0 }}>
                        {manyPayers && payers.size > 1 ? (
                          <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={t.expense.splitPaidEvenly}
                            onPress={splitPaidEvenly}
                            hitSlop={LINK_HIT_SLOP}
                          >
                            <Text variant="micro" tone="brand" style={{ fontWeight: '700' }}>
                              {t.expense.splitPaidEvenly}
                            </Text>
                          </Pressable>
                        ) : null}
                        {/* The way in and out of several-payer mode. A link
                            rather than a hidden long-press: nobody discovers a
                            long-press, and this is the whole feature. */}
                        <Pressable
                          accessibilityRole="switch"
                          accessibilityState={{ checked: manyPayers }}
                          accessibilityLabel={
                            manyPayers ? t.expense.paidByOne : t.expense.paidBySeveral
                          }
                          onPress={() => setManyPayers(!manyPayers)}
                          hitSlop={LINK_HIT_SLOP}
                        >
                          <Text variant="micro" tone="brand" style={{ fontWeight: '700' }}>
                            {manyPayers ? t.expense.paidByOne : t.expense.paidBySeveral}
                          </Text>
                        </Pressable>
                      </Row>
                    </Row>

                    {/* One lane that scrolls, not a grid that reflows. Every
                      tile is the same width, the name gets one line and an
                      ellipsis, and the overflow goes sideways where a tap can
                      reach it. Whoever is paying leads the lane
                      (`payerChoices`), so on a long member list the answer is
                      at the start rather than somewhere off the right-hand
                      edge. */}
                    <ScrollView
                      horizontal
                      showsHorizontalScrollIndicator={false}
                      contentContainerStyle={{
                        gap: theme.spacing.xs,
                        paddingRight: theme.spacing.xl,
                      }}
                    >
                      {payerChoices.map((member) => {
                        const isPayer = payers.has(member.id);
                        return (
                          <Pressable
                            key={member.id}
                            // The role follows the mode, because the gesture
                            // does: one payer is a radio (tapping replaces),
                            // several is a checkbox (tapping adds).
                            accessibilityRole={manyPayers ? 'checkbox' : 'radio'}
                            accessibilityState={
                              manyPayers ? { checked: isPayer } : { selected: isPayer }
                            }
                            accessibilityLabel={`${t.paidBy}: ${displayName(member, viewerId)}`}
                            onPress={() => togglePayer(member.id)}
                            style={{
                              width: PAYER_TILE_WIDTH,
                              alignItems: 'center',
                              gap: 4,
                              opacity: isPayer ? 1 : 0.45,
                            }}
                          >
                            <Avatar name={displayName(member)} ghost={isGhost(member)} />
                            <Text
                              variant="micro"
                              tone={isPayer ? 'brand' : 'muted'}
                              numberOfLines={1}
                              style={{ textAlign: 'center' }}
                            >
                              {displayName(member, viewerId)}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </ScrollView>

                    {manyPayers && payers.size > 1 ? (
                      <View style={{ gap: theme.spacing.xs }}>
                        {payerIds.map((memberId) => {
                          const member = (members.data ?? []).find((row) => row.id === memberId);
                          const name = member ? displayName(member, viewerId) : t.misc.someone;
                          return (
                            <Row
                              key={memberId}
                              style={{ gap: theme.spacing.md, alignItems: 'center' }}
                            >
                              <Avatar
                                name={member ? displayName(member) : name}
                                ghost={member ? isGhost(member) : false}
                                size={32}
                              />
                              <Text
                                variant="body"
                                numberOfLines={1}
                                style={{ flex: 1, minWidth: 0 }}
                              >
                                {name}
                              </Text>
                              {/* The figure may be long — a six-figure trip
                                  total, a yen amount, a large accessibility
                                  font. It gives way to the name rather than
                                  clipping, down to a floor wide enough to
                                  still read as a field. */}
                              <Row
                                style={{
                                  gap: theme.spacing.xs,
                                  alignItems: 'center',
                                  flexShrink: 1,
                                  minWidth: 96,
                                  maxWidth: '60%',
                                }}
                              >
                                <Text variant="caption" tone="muted">
                                  {currencySymbol(currency)}
                                </Text>
                                <TextInput
                                  value={paidText[memberId] ?? ''}
                                  onChangeText={(text) => setPaidEntry(memberId, text)}
                                  keyboardType={amountKeyboard(currency as CurrencyCode)}
                                  selectTextOnFocus
                                  placeholder="0"
                                  placeholderTextColor={theme.color.textFaint}
                                  accessibilityLabel={t.expense.paidByNameAmount
                                    .replace('{name}', name)
                                    .replace(
                                      '{amount}',
                                      format(money(payers.get(memberId) ?? 0n, currency), {
                                        locale,
                                      }),
                                    )}
                                  // What is wrong with the set of figures, on
                                  // each field that can put it right. React
                                  // Native has no invalid accessibility state,
                                  // so the message itself is the hint —
                                  // otherwise the only announcement of a bill
                                  // that does not add up arrives at the save
                                  // button.
                                  accessibilityHint={payerMessage ?? undefined}
                                  style={{
                                    flexGrow: 1,
                                    flexShrink: 1,
                                    minWidth: 72,
                                    minHeight: 44,
                                    fontSize: 16,
                                    fontWeight: '700',
                                    textAlign: 'right',
                                    textAlignVertical: 'center',
                                    color: theme.color.text,
                                    backgroundColor: theme.color.bg,
                                    borderRadius: theme.radius.sm,
                                    paddingVertical: theme.spacing.sm,
                                    paddingHorizontal: theme.spacing.sm,
                                  }}
                                />
                              </Row>
                            </Row>
                          );
                        })}
                      </View>
                    ) : null}

                    {/* What is still unaccounted for, or claimed twice over.
                      Only once the bill has a total: "₹0 left to assign" on an
                      empty form is noise rather than guidance. A single payer
                      always holds the whole bill, so there is nothing to
                      report — that row gets the hint instead. */}
                    {payerMessage && amount > 0n ? (
                      <Text
                        variant="micro"
                        tone="negative"
                        accessibilityRole="alert"
                        accessibilityLiveRegion="polite"
                      >
                        {payerMessage}
                      </Text>
                    ) : null}
                  </View>
                ) : null}
              </View>

              <View>
                <DetailRow
                  icon="calendar-outline"
                  tint={theme.tint.pink}
                  dense
                  label={t.captures.date}
                  value={showDate(expenseDate, locale)}
                  onPress={() => setEditingDate(true)}
                />
                {editingDate ? (
                  <DateTimePicker
                    value={dateFrom(expenseDate)}
                    mode="date"
                    display={Platform.OS === 'ios' ? 'inline' : 'default'}
                    onChange={applyDate}
                  />
                ) : null}
              </View>

              {/* "How is this split" — a row like the one above it, collapsed
                to its summary ("Equally") until tapped. The chips, the itemize
                shortcut and the full participant list — all unchanged — unfold
                beneath it instead of standing as their own blocks below. */}
              <View>
                <DetailRow
                  icon={splitIcon(splitKind)}
                  tint={theme.tint.peach}
                  dense
                  label={t.expense.howToSplit}
                  value={splitKindLabel}
                  expanded={showSplitSection}
                  onPress={() => setSplitSectionChoice(!showSplitSection)}
                />
                {showSplitSection ? (
                  <View style={{ gap: theme.spacing.md, paddingBottom: theme.spacing.sm }}>
                    {/* Splitting the bill line by line is another answer to
                        "how is this split". New expenses only — an existing
                        one is edited in place, not re-itemised. */}
                    {!editing ? (
                      <Row style={{ justifyContent: 'flex-end' }}>
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={t.expense.splitByItem}
                          onPress={() => router.replace(`/group/${groupId}/itemize`)}
                          hitSlop={LINK_HIT_SLOP}
                        >
                          <Text variant="micro" tone="brand" style={{ fontWeight: '700' }}>
                            {t.expense.splitByItem}
                          </Text>
                        </Pressable>
                      </Row>
                    ) : null}
                    {/* Word plus glyph, not four identical word-pills: the icon
                      is what carries over to the expense screen, where the
                      same split comes back as a marked row rather than a bare
                      word. */}
                    <SplitKindChips value={splitKind} onChange={setSplitKind} />
                    <SplitParticipants
                      members={members.data ?? []}
                      viewerId={viewerId}
                      participants={participants}
                      onToggle={toggleParticipant}
                      splitKind={splitKind}
                      entries={entries}
                      onEntryChange={setEntry}
                      currency={currency}
                      amount={amount}
                      lineAmount={lineAmount}
                      splitIssue={splitIssue}
                    />
                  </View>
                ) : null}
              </View>

              <PaymentMethodRow
                value={paymentMethod}
                onPress={() => setPickingPayment(true)}
                tinted
                dense
              />

              {/* What it was paid in, as a named row rather than only as the
                pill in the header. The pill is still there and still works —
                but it is a hairline outline on a gradient beside a large
                amount, and "there is no currency selection" is what somebody
                looking for one reported. This names the field and opens the
                same sheet. */}
              <DetailRow
                icon="globe-outline"
                tint={theme.tint.lilac}
                dense
                label={t.captures.currencyLabel}
                value={`${currencySymbol(currency)} ${currency}`}
                onPress={() => setPickingCurrency(true)}
              />

              {/* Event organizer (docs/event-organizer.md): a vendor deposit
                  — this expense is a part-payment, with a balance still
                  owing. The row's own control states the value and changes
                  it in the same gesture (tapping toggles it on/off), the same
                  idiom the "simplify debts" row elsewhere in the app uses;
                  the amount and due date unfold under it once it is on. */}
              <View>
                <DetailRow
                  icon="pricetag-outline"
                  tint={theme.tint.coral}
                  dense
                  label={t.eventOrganizer.depositLabel}
                  value={isDeposit ? t.eventOrganizer.depositOn : t.eventOrganizer.depositOff}
                  expanded={isDeposit}
                  onPress={() => setIsDeposit((was) => !was)}
                />
                {isDeposit ? (
                  <View style={{ gap: theme.spacing.xs, paddingBottom: theme.spacing.sm }}>
                    <DetailRow
                      icon="cash-outline"
                      label={t.eventOrganizer.balanceDueLabel}
                      trailing={
                        <AmountField
                          currency={currency}
                          value={balanceDueMinor ?? 0n}
                          onChange={setBalanceDueMinor}
                          size="compact"
                        />
                      }
                    />
                    <DetailRow
                      icon="calendar-outline"
                      label={t.eventOrganizer.balanceDueDateLabel}
                      value={balanceDueDate ? showDate(balanceDueDate, locale) : t.add}
                      placeholder={!balanceDueDate}
                      onPress={() => setEditingBalanceDueDate(true)}
                    />
                    {editingBalanceDueDate ? (
                      <DateTimePicker
                        value={dateFrom(balanceDueDate ?? expenseDate)}
                        mode="date"
                        display={Platform.OS === 'ios' ? 'inline' : 'default'}
                        onChange={applyBalanceDueDate}
                      />
                    ) : null}
                  </View>
                ) : null}
              </View>

              {/* Where it happened (A43) — optional, opt-in, never a background
                track — as the one-line row `compact` draws: a pin, the
                address, a small map thumbnail that doubles as the fold into
                the full map and the change/clear actions, the same disclosure
                every other row in this card uses. */}
              <View style={{ paddingVertical: theme.spacing.sm }}>
                <LocationField value={location} onChange={setLocation} compact />
              </View>
            </DetailRows>
          </Card>

          {/* The one thing left that is still genuinely optional: the FX rate
            for a foreign-currency bill. This used to sit behind a "More
            details" row that, by the time category, payment method and
            location each got a row of their own above, toggled nothing —
            `CurrencyRate` already renders nothing for a same-currency bill and
            the rate card for a foreign one regardless of that toggle's state,
            so the fold had become a tap that changed nothing on screen. It is
            gone; `CurrencyRate` shows itself exactly when there is a rate to
            give. */}
          <CurrencyRate
            groupCurrency={groupCurrency}
            currency={currency}
            amount={amount}
            fx={fx}
            onFxChange={setFx}
            tripRate={tripRate}
          />
        </ScrollView>

        {/* The one action, pinned. The screen is tall — keypad, scan, currency,
          description, category, split, two rosters — and Save used to sit at the
          bottom of all of it, a scroll away from wherever you were. Here it
          rides the bottom edge with the running total and headcount beside it,
          so what you are about to save is always in view, and so is the button
          that saves it. A submit error surfaces here too, next to the button
          that raised it, rather than lost up the scroll. */}
        <View
          style={{
            paddingHorizontal: theme.spacing.xl,
            paddingTop: theme.spacing.sm,
            // The bar is the last thing on the screen, so it is the one that
            // owes the navigation bar its room — and it pays it as padding, not
            // as a gap: the fill and the hairline run all the way to the bottom
            // edge behind the gesture pill or the three buttons, and Save sits a
            // clear breath above them. A bare `spacing.md` left the button
            // pressed against the system bar on any phone whose bar is drawn
            // over the app.
            paddingBottom: clearance,
            gap: theme.spacing.xs,
            borderTopWidth: 1,
            borderTopColor: theme.color.border,
            backgroundColor: theme.color.surface,
          }}
        >
          {error ? <Callout tone="negative">{error}</Callout> : null}
          <Row style={{ justifyContent: 'space-between', gap: theme.spacing.lg }}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <MoneyText amount={amount} currency={currency} locale={locale} variant="heading" />
              <Text variant="micro" tone="muted" numberOfLines={1}>
                {savePreview}
              </Text>
            </View>
            <Row style={{ gap: theme.spacing.md, flexGrow: 0, flexShrink: 0 }}>
              {saving ? <ActivityIndicator color={theme.color.brand} /> : null}
              {/* 46pt, not the stock 56pt `lg` button: a slimmer footer needs a
                  shorter Save to match, and the label stays one line at this
                  height on every locale this form ships in. */}
              <Button
                label={editing ? t.expense.saveChanges : t.expense.saveExpense}
                size="lg"
                style={{ height: 46 }}
                disabled={!canSave || saving}
                onPress={() => void submit()}
              />
            </Row>
          </Row>
          {/* The one reason Save cannot be tapped yet, spelled out under it —
            shown only while the button is actually blocked and no save is in
            flight. */}
          {saveHint && !saving ? (
            <Text variant="micro" tone="muted">
              {saveHint}
            </Text>
          ) : null}
        </View>
      </KeyboardAvoidingView>

      {/* Travel split presets, as a sheet over the form (trip groups). Each
          gathers just its inputs, then applies canonical split params through
          the core builders — nothing new is stored. */}
      {/* Currency picker — the shared "Choose currency" sheet every currency
          choice in the app uses, so a person meets the same picker everywhere. Picking a foreign one reveals the rate card
          below the amount (CurrencyRate). */}
      {pickingCurrency ? (
        <CurrencySheet
          value={currency}
          onPick={chooseCurrency}
          onClose={() => setPickingCurrency(false)}
        />
      ) : null}

      {/* What kind of expense, from the "more details" list. Picking one closes
          the sheet — one tap, one answer, which is the whole point of moving
          this off a lane of chips. "＋ New tag" swaps this sheet for the tag
          editor rather than stacking one over the other. */}
      {pickingCategory ? (
        <CategorySheet
          value={category}
          onChange={(picked, meta) => {
            setCategory(picked);
            setCategoryMeta(meta);
            // A tap of their own, so the description guess stops moving it.
            setCategoryChosen(true);
            setPickingCategory(false);
          }}
          onCreate={() => {
            setPickingCategory(false);
            setEditingTag(true);
          }}
          onClose={() => setPickingCategory(false)}
        />
      ) : null}

      {/* How it was paid — a tag on the expense, defaulting to cash. */}
      {pickingPayment ? (
        <PaymentMethodSheet
          value={paymentMethod}
          onChange={(picked) => {
            setPaymentMethod(picked);
            setPickingPayment(false);
          }}
          onClose={() => setPickingPayment(false)}
        />
      ) : null}

      {/* Make a tag on the spot, from the category sheet's "＋ New tag" row —
          and then wear it. Somebody who breaks off from tagging an expense to
          invent a tag wanted that tag on this expense; the editor used to close
          onto a row still showing the old category, with the thing they had
          just made nowhere on screen and only findable by opening the sheet
          again. Selecting it here is the rest of that one gesture. */}
      <TagEditorSheet
        open={editingTag}
        onClose={() => setEditingTag(false)}
        onCreated={(tagId, meta) => {
          setCategory(tagId);
          setCategoryMeta(meta);
          setCategoryChosen(true);
        }}
      />
    </Screen>
  );
}
