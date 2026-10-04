/**
 * Review: what the app already found, never a field to fill.
 *
 * This is the bar's "Review" tab and the one true drafts hub (A34,
 * `docs/plan-drafts-and-rules.md`) — every spend caught before it had a group,
 * whatever brought it in: typed, spoken, photographed, or read out of the
 * phone's own bank messages. It used to open on a list under day headings with
 * a chat glyph in the corner leading to a paste box. On a phone that has
 * already granted permission to read those messages, sending somebody to
 * Messages to select, copy, come back and paste is the app refusing to do its
 * job — so the paste box is no longer the shape of this screen. It is the
 * fallback it always was, reachable from the header glyph on a phone that
 * cannot read, and from the zero state — and the primary path only where there
 * is no other: iPhone, where no reading API exists at any tier. It has no
 * footer under the list: a button sitting below a hundred and forty drafts is
 * one nobody scrolls to, and on a phone that *does* read, an alternative way in
 * is not something to advertise at all.
 *
 * FOUR THINGS CHANGED, AND EACH ANSWERS A COMPLAINT.
 *
 * 1. **A status, not an instruction.** The top of the screen used to explain
 *    what to do. An instruction is what you show somebody you are about to make
 *    work; when the app is doing the work, the honest object is a *state*. So:
 *    a dot and "Watching your bank messages · 2 min ago", read in two seconds,
 *    tappable to look again. It is shown only while something really is
 *    watching (`useSmsAutoRead`), because a line claiming to watch when nothing
 *    does would be worse than no line at all. It now rides on a hero of its
 *    own (`ReviewHero`, over the owner's own lakeside photograph) — one of
 *    the three screens in the bottom bar should not announce itself with the
 *    small-glyph row of a settings page — over the count of what is still
 *    waiting and the button that adds to it.
 *
 * 2. **Two errands in tabs, two confidences in sections.** The tabs are *where
 *    a draft came from*: **SMS** — read off the phone's inbox, or pasted in on
 *    an iPhone, which is still a bank message — and what this person added on
 *    purpose. Inside whichever tab is open, the list is cut again into
 *    **Ready** and **Worth a look** — a split by what the parser is *sure of*.
 *    Two questions, asked at different moments, and `lib/reviewFeed.ts` carries
 *    both rules and the reasoning; the sections stay sections because they need
 *    no navigation, carry their own counts, and disappear when empty. The
 *    screen opens on the tab that can reach zero, which is the added one.
 *
 * 3. **One gesture, not one screen.** Most rows should need a single swipe.
 *    Toward the leading edge files the draft where that shop's money went last
 *    time — and the row's chip already *says* where that is, so the gesture
 *    confirms something visible rather than doing something hidden. The other
 *    way means **not an expense**: a credit-card bill, a transfer to yourself,
 *    rent nobody splits. That second one is what earns the feature its keep; an
 *    inbox you can only add from fills with noise and gets abandoned. Tapping
 *    still opens the full editor, and both gestures are also plain rows in the
 *    ⋯ sheet — a swipe is never the only way through (`components/SwipeRow`).
 *    And "Select" turns on tick boxes so that second answer can be given once
 *    about many: a morning's bank messages is thirty rows and most of them are
 *    a card bill or a transfer to yourself, so saying "not an expense" thirty
 *    times is not answering, it is data entry.
 *
 * 4. **The zero state is the point.** Review is trying to reach zero: it is the
 *    app's list of questions, and a good week is one where it has none. So the
 *    empty screen says "Nothing needs you" and then says how much went through
 *    anyway (`data/reviewSources.ts`), rather than apologising for being empty.
 *
 * WHAT DID NOT CHANGE. Expenses spoken in one breath still fold into one
 * collapsible card whose ⋯ can place the whole cluster at once — a batch is one
 * outing and gets one answer, which is why it keeps the sheet rather than a
 * swipe of its own. Everything is still personal and offline-first: a row still
 * queued wears a faint cloud glyph rather than hiding until the server has seen
 * it (ADR-005), and the destination chip is derived from the local ledger
 * mirror, so it is right with no network. A draft made from a message the app
 * *read* still carries no message body at all; that rule lives in
 * `lib/smsDrafts.ts` and this screen never goes near a body.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { FlashList } from '@shopify/flash-list';
import { randomUUID } from 'expo-crypto';
import { Pressable, RefreshControl, ScrollView, useWindowDimensions, View } from 'react-native';
import Reanimated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { MutationKind, peopleSignatureKey } from '@waves/core';
import {
  Badge,
  Button,
  directionalIcon,
  Divider,
  EmptyState,
  IconButton,
  iconSize,
  MoneyText,
  Row,
  SegmentedTabs,
  Screen,
  Sheet,
  Text,
  useTabBarClearance,
  useTheme,
} from '@waves/ui';

import { CategoryBadge } from '@/components/Category';
import {
  DestinationPicker,
  type DestinationSelection,
  type PersonChoice,
} from '@/components/DestinationPicker';
import { PendingMark } from '@/components/PendingMark';
import { ReviewHeroBackground } from '@/components/ReviewHeroBackground';
import { useHeroCrossfade, useHeroStatusBar } from '@/components/ScreenHero';
import { InboxSkeleton } from '@/components/Skeletons';
import { WatchingLine } from '@/components/WatchingLine';
import { dayHeading } from '@/data/activity';
import { useFiledThisWeek, useSuggestionIndex } from '@/data/reviewSources';
import {
  useAddGhostMember,
  useAssignCapture,
  useCaptures,
  useCreateGroup,
  useDeleteCapture,
  useGroupPeopleSignatures,
  useGroups,
  useHomeSummary,
  useOneToOneGroupIds,
  usePeopleBalances,
} from '@/data/hooks';
import { groupLabel, GroupType, isViewer, type CaptureRow } from '@/data/types';
import { plural, useStrings, type UiStrings } from '@/i18n';
import { useAuth } from '@/lib/auth';
import { assignCaptureHref } from '@/lib/captureAssign';
import { planCaptureAssign, stillWaiting, type AssignMember } from '@/lib/captureBulkAssign';
import { friendlyError } from '@/lib/errors';
import { useGuestGuard, usePersonalOffered } from '@/lib/guestGuard';
import { suggestGroup, tripWindowsOf, type GroupSuggestion } from '@/lib/groupSuggestion';
import { useHeroScene } from '@/lib/heroScenePreference';
import { router } from '@/lib/navigation';
import { usePullRefresh } from '@/lib/pullRefresh';
import { useTabBarStandDown } from '@/lib/useTabBarStandDown';
import {
  buildReviewFeed,
  openingTab,
  splitByTab,
  type ReviewSortOrder,
  type ReviewTabId,
  doubtsAbout,
  reviewItemKey,
  type ReviewFeedItem,
} from '@/lib/reviewFeed';
import { useReducedMotion } from '@/lib/reducedMotion';
import { reviewMomentFor } from '@/lib/reviewScene';
import { useSmsAutoRead } from '@/lib/smsAutoRead';
import { requestScanOnReturn } from '@/lib/smsReadBridge';
import { useSmsInboxReader } from '@/lib/smsFeature';
import { useSmsMessages } from '@/lib/smsMessages';
import { totalWaiting } from '@/lib/smsInbox';
import { useDialog } from '@/lib/dialog';
import { useToast } from '@/lib/toast';
import { usePlaceInPersonal } from '@/lib/usePlaceInPersonal';
import { useSync } from '@/sync';

/**
 * What the ⋯ overflow sheet is open on: a single capture (file it, add to group,
 * edit, take it off the list) or a whole spoken batch (add them all to one
 * group / delete them all). Null when nothing is open.
 */
type CaptureMenu =
  { kind: 'capture'; capture: CaptureRow } | { kind: 'batch'; items: CaptureRow[] } | null;

/**
 * What the destination sheet is placing: one draft, or a whole spoken batch at
 * once. One picker serves both, so "where does this go?" is the same control and
 * the same list of groups however many drafts are riding on the answer.
 *
 * The two differ only in what happens after the tap. A single draft opens the
 * add-expense form prefilled — the unchanged path, where a person says who split
 * what. A batch is written straight onto the queue with the form's own defaults,
 * which is the whole point of asking once for several.
 */
type AssignTarget =
  | { kind: 'capture'; capture: CaptureRow }
  /**
   * `viaBar` — opened from the selection bar, which offers "Just me" itself.
   * The picker then leaves that row out rather than putting the same answer in
   * front of somebody twice in two taps: a sheet headed "Add to a group" whose
   * first row is "Just me" contradicts its own title, and it is the row they
   * chose *not* to press a moment ago.
   */
  | { kind: 'batch'; items: CaptureRow[]; viaBar?: boolean };

/** How often the "· 2 min ago" on the status line is allowed to go stale. */
const CLOCK_TICK = 60_000;

/**
 * Did the app make this draft, or did a person?
 *
 * It decides how gently the draft is taken off the list. Something the app
 * found in a bank message costs nothing to dismiss — the message is still in
 * the phone's Messages app, and nobody typed a word of the draft — so "not an
 * expense" fires outright. Something a person captured themselves carries their
 * own words and possibly a photograph of the bill, so it keeps the confirm it
 * has always had.
 */

function wasFound(capture: CaptureRow): boolean {
  const parsed = capture.parsed;
  return (
    !!parsed && typeof parsed === 'object' && (parsed as { source?: unknown }).source === 'sms'
  );
}

/**
 * A plain-text name for a draft: its note, or failing that its category, or
 * failing that "Unassigned" — the same fallback chain the row's own title
 * uses. Pulled out so the assign sheet's "Edit {item}" accessibility label
 * names the same thing the row already does, rather than drifting from it.
 */
function captureTitle(capture: CaptureRow, t: UiStrings): string {
  const categoryLabel = capture.category
    ? (t.categories as Record<string, string>)[capture.category]
    : undefined;
  return capture.description?.trim() || categoryLabel || t.captures.unassigned;
}

/**
 * The bank message this draft was read out of, if there is one.
 *
 * A person cannot trust a parser they cannot check. The row says "PLASTICS
 * ₹1,020" and when that is wrong — a merchant taken out of a reference number,
 * a date read from the wrong half of a UPI string — nothing on this screen says
 * why, because the message itself never leaves the phone's own store
 * (`lib/smsMessageStore.ts`) and the draft deliberately carries no copy of it.
 *
 * What the draft does carry is the key, so the message can be *opened* rather
 * than copied: `parsed.dedupeKey` is the same key the Bank messages screen
 * files a body under, and that screen already exists to show one.
 */
function messageKeyOf(capture: CaptureRow): string | null {
  if (!wasFound(capture)) return null;
  const key = (capture.parsed as { dedupeKey?: unknown } | null)?.dedupeKey;
  return typeof key === 'string' && key !== '' ? key : null;
}

/**
 * Where this row is about to go, said before the gesture that confirms it.
 *
 * Two shapes, and they are different in glyph, in wording and in hue — never in
 * colour alone (#191). A known destination is a brand chip wearing the group's
 * name and a forward arrow (mirrored in RTL, because an arrow is content). No
 * known destination is an amber chip that asks "Which group?", which is the
 * honest version of a chip that would otherwise have to guess.
 */
function DestinationChip({ name, t }: { name: string | null; t: UiStrings }): React.JSX.Element {
  const theme = useTheme();
  const known = name !== null;
  return (
    <Row
      style={{
        gap: 3,
        alignItems: 'center',
        alignSelf: 'flex-start',
        paddingHorizontal: 6,
        // 1, not the chip's old 2: the compact row's meta line is a single
        // line now (no second-line wrap to spare the height to), so every
        // point this pill carries is a point the row carries too.
        paddingVertical: 1,
        borderRadius: theme.radius.pill,
        backgroundColor: known ? theme.color.brandSoft : theme.color.warningSoft,
        maxWidth: '100%',
      }}
    >
      <Ionicons
        name={known ? directionalIcon('arrow-forward') : 'help-circle-outline'}
        size={iconSize.xs}
        color={known ? theme.color.brand : theme.color.warning}
      />
      {/* 12/14, not the shared `micro` token's 11/15 — a point under the
          floor a compact row is still allowed to read at. Bank messages and
          Friends' own secondary lines sit at 12-13; this chip is the one
          piece of `micro` text that rides on every single row, so it is the
          one worth lifting rather than leaving at the token's usual 11. */}
      <Text
        numberOfLines={1}
        style={{
          fontSize: 12,
          lineHeight: 14,
          fontWeight: '600',
          color: known ? theme.color.brand : theme.color.warning,
          flexShrink: 1,
        }}
      >
        {known ? name : t.captures.whichGroup}
      </Text>
    </Row>
  );
}

/**
 * One draft, in the card grammar this screen speaks (Mobbin: Phantom Recent
 * Activity, Apple Wallet Daily Cash): a leading category glyph — always the
 * category colour, never the bill's thumbnail — the merchant over the
 * destination chip, and the amount at the trailing edge, all on a soft rounded
 * card.
 *
 * The whole card taps to assign; the ⋯ at the trailing edge opens everything
 * else. What the row gained is the second line: where it is about to go. That
 * line used to carry the place the spend happened, which was true and rarely
 * useful; the destination is the question this screen exists to ask, and
 * showing it is what lets a swipe answer it without opening anything.
 *
 * A row the app was unsure of says *what* it was unsure of, in a sentence, with
 * a warning glyph beside it — "check this" with nothing to check against is not
 * a warning, it is a worry.
 *
 * Inside a batch a row is `bare` — no card of its own, since the batch card
 * already frames it — and carries no chip: a batch is one outing with one
 * destination, answered once on the batch's own ⋯.
 */
/** The batch mark's diameter — `CategoryBadge`'s size on a single row, so the
    two kinds of row share one left column. Shrunk from 40 alongside that
    badge (see `ROW_PAD_V`) — a phone's complaint was that the list read as
    loose, and the two marks have to move together or the column breaks. */
const BATCH_MARK = 32;

/** The gap between two cards in the list — tighter than `theme.spacing.xs`
 *  (4) and short of `sm` (8), picked to match the reference board's compact
 *  stack of separate cards rather than the joined run it replaced. Left
 *  alone by the density pass below: it already matches Home's own Activity
 *  feed, which uses this same 6px between its own cards. */
const CARD_GAP = 6;

/** A single row's own top-and-bottom padding — between `theme.spacing.xs`
 *  (4, too tight to breathe) and `sm` (8, what the row wore before this
 *  pass). A phone test called the list "not compact": each row was landing
 *  near 70px end to end (card + gap), well short of Friends' and Activity's
 *  own ~54-60px rows. 7 here, together with the smaller mark and the
 *  single-line meta below, lands a row with no chip doubt at ~49px tall —
 *  still clear of the 44pt touch-target floor — for roughly a third more
 *  rows in the same screen. */
const ROW_PAD_V = 7;

function CaptureListRow({
  capture,
  locale,
  t,
  destinationName,
  onAssign,
  onMore,
  onFile,
  onDismiss,
  ticking = false,
  selected = false,
  onToggleSelected,
  bare = false,
}: {
  capture: CaptureRow;
  locale: string;
  t: UiStrings;
  /** The group this row would be filed into, or null when nothing is known. */
  destinationName: string | null;
  onAssign: () => void;
  /** Open the row's overflow sheet (file, add to group, edit, take it off). */
  onMore: () => void;
  /** File it where the chip says, without opening anything. Null when nowhere. */
  onFile: (() => void) | null;
  /** Take it off the list: it was never an expense. */
  onDismiss: () => void;
  /**
   * Whether this row offers a tick box at all.
   *
   * True on the SMS tab, where the pile is a hundred deep and answering it one
   * row at a time is data entry. False on the drafts a person added themselves:
   * there are a handful, each one is a spend they remember making, and each
   * wants its own answer — so a press there opens the picker, as it always did.
   */
  ticking?: boolean;
  /** Whether this row's tick box is filled. Never set on a `bare` row. */
  selected?: boolean;
  /** Tick or untick. Absent on a `bare` row — a batch is ticked as one card. */
  onToggleSelected?: () => void;
  /** A row nested in a batch card: no card frame of its own, and no chip. */
  bare?: boolean;
}): React.JSX.Element {
  const theme = useTheme();
  // The note names the spend; with none, its category does; with neither, it is
  // simply still unassigned. The amount always sits at the trailing edge, so the
  // title never has to carry it.
  const title = captureTitle(capture, t);
  const doubts = bare ? [] : doubtsAbout(capture);
  const dismissLabel = wasFound(capture) ? t.captures.notAnExpense : t.captures.delete;

  // Both swipe actions, offered to a screen reader as custom actions on the row
  // itself. A gesture is no good to somebody who does not make one, and a
  // control nested inside an accessible row can be unreachable — so the row
  // says what it can do, and the ⋯ sheet says it again in full.
  const actions = [
    ...(onFile && destinationName
      ? [{ name: 'file', label: t.captures.fileTo.replace('{name}', destinationName) }]
      : []),
    { name: 'dismiss', label: dismissLabel },
    { name: 'more', label: t.captures.moreActions },
  ];

  return (
    <Pressable
      // A checkbox, because that is what a press now does. It read as a button
      // labelled "file this to Goa" while actually ticking the row — an
      // announcement of one action and the performance of another, which is the
      // one accessibility bug a sighted test can never catch. The destination
      // still rides on the label, because knowing where a draft is headed is
      // most of what the row says; it is just no longer claimed as the action.
      accessibilityRole={ticking && !bare ? 'checkbox' : 'button'}
      accessibilityLabel={
        destinationName
          ? `${title}, ${t.captures.fileTo.replace('{name}', destinationName)}`
          : title
      }
      accessibilityActions={actions}
      onAccessibilityAction={(event) => {
        const name = event.nativeEvent.actionName;
        if (name === 'more') onMore();
        else if (name === 'dismiss') onDismiss();
        else if (name === 'file') onFile?.();
      }}
      // A row on the ticking tab ticks. Everything else opens the picker: the
      // drafts a person added themselves, and any row inside an opened batch,
      // which has no tick of its own to give.
      onPress={ticking && !bare ? onToggleSelected : onAssign}
      accessibilityState={ticking && !bare ? { checked: selected } : undefined}
      style={({ pressed }) =>
        bare
          ? { opacity: pressed ? 0.6 : 1 }
          : {
              opacity: pressed ? 0.85 : 1,
              // The row is the whole card now — each draft its own white,
              // fully rounded surface (the caller gives it the radius and the
              // fill), rather than a hairline inside a run several rows share.
              // `sm` on each side, not the `md` this wore before a phone test
              // called the list loose — the row's content (the 32pt mark and
              // the single-line meta below) is the thing that sets its height
              // now, not this padding, so there was room to give back here.
              paddingHorizontal: theme.spacing.sm,
            }
      }
    >
      <Row style={{ gap: theme.spacing.sm, alignItems: 'center', paddingVertical: ROW_PAD_V }}>
        {/* Always drawn — except inside an opened batch. Ticking is Review's
            main verb now: the list is a hundred rows deep on a phone whose
            messages the app reads, and answering it row by row is not
            answering, it is data entry. Behind a "Select" button that was a
            gesture most people never found; in front of them it is the one the
            screen is for. Same rule, same reasoning, as Bank messages.

            A `bare` row is a member of an expanded spoken batch. It gets no
            `onToggleSelected` and is not in `selectableIds` — the batch is
            ticked as one card — so a box here would be a control that looks
            live, never fills, and leaves "select all" apparently incomplete. */}
        {ticking && !bare ? (
          <Ionicons
            name={selected ? 'checkbox' : 'square-outline'}
            size={iconSize.lg}
            color={selected ? theme.color.brand : theme.color.textMuted}
          />
        ) : null}
        <CategoryBadge
          category={capture.category}
          meta={capture.category_meta}
          description={capture.description}
          size={32}
        />

        <View style={{ flex: 1, minWidth: 0, gap: 1 }}>
          {/* 15/18, not the `body` variant's 15/21 — the same size, a tighter
              lead, matching the Home activity feed's own title line. */}
          <Text numberOfLines={1} style={{ fontSize: 15, lineHeight: 18, fontWeight: '600' }}>
            {title}
          </Text>
          {/* Line two, and there is only one of it now — and, since this pass,
              only one *row* of it too. Where the draft goes, what the parser
              was unsure of, and whether the write is still in the queue used
              to take a line each on the un-compacted list; they wrapped onto
              a second line here as recently as this same pass. A list this
              dense has no second line to spare, so the rarer of the two
              (a doubt) now loses the space race to the chip that is on every
              row — still reachable from the row's own ⋯ and from the swipe's
              accessibility action, just not written out beneath a hundred and
              forty titles at once. */}
          <Row
            style={{
              flexWrap: 'nowrap',
              alignItems: 'center',
              gap: theme.spacing.xs,
            }}
          >
            {bare ? null : <DestinationChip name={destinationName} t={t} />}
            {/* An icon as well as the words, so the uncertainty is not carried
                by colour (#191) — and the words themselves, so "check this"
                names something a person can actually go and check. */}
            {doubts.map((doubt) => (
              <Row key={doubt} gap={3} style={{ alignItems: 'center', flexShrink: 1 }}>
                <Ionicons
                  name="alert-circle-outline"
                  size={iconSize.xs}
                  color={theme.color.warning}
                />
                <Text
                  tone="muted"
                  numberOfLines={1}
                  style={{ fontSize: 12, lineHeight: 14, flexShrink: 1 }}
                >
                  {doubt === 'date-inferred'
                    ? t.smsImport.dateNotInMessage
                    : t.smsImport.hardToRead}
                </Text>
              </Row>
            ))}
            {capture.pending ? <PendingMark size={12} /> : null}
          </Row>
        </View>

        {/* The amount and the ⋯ never shrink (RN's flexShrink is 0 by default),
            so every row's amount ends at the same point. */}
        <View style={{ alignItems: 'flex-end' }}>
          <MoneyText
            amount={BigInt(capture.amount)}
            currency={capture.currency}
            locale={locale}
            variant="subheading"
          />
        </View>
        {/* One quiet ⋯: everything that is not the card's own tap lives behind
            it. Its own hitbox for a sighted tap, but hidden from the a11y tree —
            a focusable nested in the accessible row can be unreachable, so
            screen readers reach it through the row's "more" action instead.

            A plain `Pressable` with `hitSlop`, not the shared `IconButton` —
            that disc is a fixed 44x44, which was quietly the tallest thing in
            the row and the real reason the compact pass above still landed
            near 70pt: shrinking the badge and the text did nothing while this
            still forced the row to its height. Home's own Activity feed
            never reaches for `IconButton` on a dense per-row control either,
            for the same reason; its own trailing ⋯ is this same shape. The
            padding plus `hitSlop` still clears 44pt end to end. */}
        <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <Pressable
            onPress={onMore}
            hitSlop={10}
            style={({ pressed }) => ({ padding: 6, opacity: pressed ? 0.6 : 1 })}
          >
            <Ionicons name="ellipsis-horizontal" size={iconSize.md} color={theme.color.textMuted} />
          </Pressable>
        </View>
      </Row>
    </Pressable>
  );
}

/**
 * Several expenses spoken in one breath, folded into one collapsible row: a
 * layered glyph, an "N expenses" title over a preview of what they were, and the
 * running total at the trailing edge with a chevron to open. Expanding reveals
 * each as a full capture row — still individually assignable and deletable — so
 * the total is the headline and the breakdown is one tap away.
 *
 * No swipe of its own, deliberately: a batch is one outing that wants one
 * destination, and that is exactly what its ⋯ already offers. A gesture that
 * filed four expenses at once on a flick would be a lot of money moved by an
 * accident of the thumb.
 */
function BatchGroupCard({
  items,
  locale,
  t,
  open,
  onToggle,
  onAssign,
  onMore,
  onMoreBatch,
}: {
  items: CaptureRow[];
  locale: string;
  t: UiStrings;
  open: boolean;
  onToggle: () => void;
  onAssign: (capture: CaptureRow) => void;
  onMore: (capture: CaptureRow) => void;
  onMoreBatch: () => void;
}) {
  const theme = useTheme();

  const currency = items[0]!.currency;
  const sameCurrency = items.every((item) => item.currency === currency);
  const total = sameCurrency ? items.reduce((sum, item) => sum + BigInt(item.amount), 0n) : null;
  const anyPending = items.some((item) => item.pending);
  // A spoken batch is one outing in one place, so the location belongs to the
  // group, not repeated on every item. Take the first place any item carries.
  const batchLocation = items.map((item) => item.location?.name?.trim()).find((name) => name) ?? '';

  return (
    // One rounded, bordered card so the header and its items read as a single
    // grouped unit, set apart from the flush standalone rows around it — the
    // grouped-transactions grammar (Monarch, PayPal, Commons).
    <View
      style={{
        // `md`, matching the single-row card's own corner — see
        // `CaptureListRow`'s renderItem wrapper.
        borderRadius: theme.radius.md,
        borderWidth: 1,
        borderColor: theme.color.border,
        backgroundColor: theme.color.surface,
        overflow: 'hidden',
      }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={open ? t.captures.collapseBatch : t.captures.expandBatch}
        // The ⋯ (delete-the-batch) is nested inside this expander; a nested
        // focusable can hide from a screen reader, so it rides here as a custom
        // action and is dropped from the a11y tree below.
        accessibilityActions={[{ name: 'more', label: t.captures.moreActions }]}
        onAccessibilityAction={(event) => {
          if (event.nativeEvent.actionName === 'more') onMoreBatch();
        }}
        onPress={onToggle}
        style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
      >
        {/* The same metrics a single row uses — `sm` padding, `sm` gap, a 40pt
            mark — because a batch sits in the same list as the rows it stands
            for. It had `md` padding and a 46pt rounded square, which pushed its
            title and its amount a few points off every neighbour's: two columns
            that nearly line up read as a mistake, where either lining up or
            plainly not would not. */}
        <Row
          style={{
            gap: theme.spacing.sm,
            alignItems: 'center',
            paddingVertical: theme.spacing.sm,
            paddingHorizontal: theme.spacing.sm,
          }}
        >
          <View
            style={{
              width: BATCH_MARK,
              height: BATCH_MARK,
              // Round, like the category badge a single row wears. The mark says
              // "several of these" by its glyph; it does not also need a
              // different silhouette, which only broke the column.
              borderRadius: BATCH_MARK / 2,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: theme.color.brandSoft,
            }}
          >
            <Ionicons name="layers-outline" size={iconSize.lg} color={theme.color.brand} />
          </View>

          <View style={{ flex: 1, minWidth: 0 }}>
            {/* The count is the whole headline — a batch stands for one outing,
                so the individual descriptions belong to the expanded rows, not
                here. Vertical chevrons carry no handedness, so nothing to mirror
                in RTL. */}
            <Row style={{ gap: theme.spacing.xs, alignItems: 'center' }}>
              <Text variant="subheading" numberOfLines={1} style={{ flexShrink: 1 }}>
                {plural(locale, items.length, t.captures.batchExpenses)}
              </Text>
              <Ionicons
                name={open ? 'chevron-up' : 'chevron-down'}
                size={iconSize.md}
                color={theme.color.textMuted}
              />
            </Row>
            <Row style={{ gap: theme.spacing.xs, alignItems: 'center', marginTop: 2 }}>
              <Text variant="micro" tone="muted" numberOfLines={1} style={{ flexShrink: 1 }}>
                {t.captures.batchHint}
              </Text>
              {anyPending ? <PendingMark /> : null}
            </Row>
          </View>

          <View style={{ alignItems: 'flex-end' }}>
            {total !== null ? (
              <MoneyText amount={total} currency={currency} locale={locale} variant="subheading" />
            ) : (
              <Text variant="subheading" tone="muted">
                {plural(locale, items.length, t.captures.batchExpenses)}
              </Text>
            )}
          </View>
          {/* Same compact control as a single row's own ⋯ — see
              `CaptureListRow` — so the batch card's header matches the rows
              it stands for rather than reverting to the taller shared disc. */}
          <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            <Pressable
              onPress={onMoreBatch}
              hitSlop={10}
              style={({ pressed }) => ({ padding: 6, opacity: pressed ? 0.6 : 1 })}
            >
              <Ionicons
                name="ellipsis-horizontal"
                size={iconSize.md}
                color={theme.color.textMuted}
              />
            </Pressable>
          </View>
        </Row>
      </Pressable>

      {open ? (
        <View style={{ paddingHorizontal: theme.spacing.md }}>
          {/* The outing's place, shown once for the whole group — the item rows
              below carry only their descriptions, not the place repeated. */}
          {batchLocation ? (
            <Row
              style={{
                gap: theme.spacing.xs,
                alignItems: 'center',
                paddingTop: theme.spacing.sm,
              }}
            >
              <Ionicons name="location-outline" size={13} color={theme.color.textMuted} />
              <Text variant="micro" tone="muted" numberOfLines={1} style={{ flexShrink: 1 }}>
                {batchLocation}
              </Text>
            </Row>
          ) : null}
          {items.map((capture, index) => (
            <View key={capture.id}>
              <Divider />
              <CaptureListRow
                capture={capture}
                locale={locale}
                t={t}
                destinationName={null}
                onAssign={() => onAssign(capture)}
                onMore={() => onMore(capture)}
                onFile={null}
                onDismiss={() => onMore(capture)}
                bare
              />
              {index === items.length - 1 ? <View style={{ height: theme.spacing.xs }} /> : null}
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

/**
 * One action in the ⋯ overflow sheet: a leading glyph and a label, tinted by
 * role — brand for the primary "add to group", the ink default for edit, red for
 * a delete. The whole row is the hitbox, the grammar the picker sheets use.
 */
function ActionSheetRow({
  icon,
  label,
  tone = 'default',
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  tone?: 'default' | 'brand' | 'negative';
  onPress: () => void;
}): React.JSX.Element {
  const theme = useTheme();
  const color =
    tone === 'negative'
      ? theme.color.negative
      : tone === 'brand'
        ? theme.color.brand
        : theme.color.text;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.spacing.md,
        paddingVertical: theme.spacing.md,
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <Ionicons name={icon} size={iconSize.md} color={color} />
      <Text variant="body" style={{ flex: 1, color }}>
        {label}
      </Text>
    </Pressable>
  );
}

/**
 * The compact hero Review opens on — the owner's own lakeside photograph
 * (`ReviewHeroBackground`) behind the title row and the waiting count, in
 * place of `ScreenHero`'s saturated gradient. Pulled out as its own
 * component (rather than written inline) so the shape has one name a test
 * can point at, the way `ScreenHero` itself is pinned for the screens that
 * still open on it.
 *
 * Review left the shared panel for the same reason Friends did (see
 * `screenHeroShape.test.ts`): a second, deliberately different hero shape is
 * not drift from the shared one when it is the redesign asking for it. Both
 * screens land on a photograph in the end, for the same reason — a drawn
 * gradient was never going to carry "this is a real desk, a real cup of
 * something" the way the owner's own picture does — so this stays close to
 * `FriendsHeroBackground`'s own shape rather than inventing a second one.
 *
 * Measures its own box (`onLayout`) and hands that size to the background,
 * which needs real pixels to `cover`-fit the photo by hand; nothing is drawn
 * until that first layout lands.
 */
function ReviewHero({ children }: { children: React.ReactNode }): React.JSX.Element {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const scene = useHeroScene();
  const moment = reviewMomentFor(scene);
  const [box, setBox] = useState({ width: 0, height: 0 });
  return (
    <View
      onLayout={(event) => {
        const { width, height } = event.nativeEvent.layout;
        setBox((current) =>
          current.width === width && current.height === height ? current : { width, height },
        );
      }}
      style={{ overflow: 'hidden', backgroundColor: theme.color.bg }}
    >
      <ReviewHeroBackground moment={moment} width={box.width} height={box.height} />
      <View
        style={{
          paddingTop: insets.top + theme.spacing.md,
          paddingHorizontal: theme.spacing.xl,
          paddingBottom: theme.spacing.lg,
          gap: theme.spacing.lg,
        }}
      >
        {children}
      </View>
    </View>
  );
}

/** One of the hero's two round, white top-right buttons — search and
 *  filter/tune on a reader-equipped phone, collapsing to the single
 *  "from a message" action where there is only one (see `heroActions`
 *  in `CapturesScreen`). Solid white, the same disc `ScreenHero`'s own
 *  `primary` action wears — a translucent one would wash out against the
 *  photo behind it on the brighter scenes (morning, midday). */
function HeroRoundButton({
  icon,
  label,
  onPress,
  primary = false,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  primary?: boolean;
}): React.JSX.Element {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => [
        {
          width: 40,
          height: 40,
          borderRadius: 20,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: theme.color.surface,
          opacity: pressed ? 0.75 : 1,
        },
        theme.shadow.soft,
      ]}
    >
      <Ionicons
        name={icon}
        size={iconSize.md}
        color={primary ? theme.color.brand : theme.color.text}
      />
    </Pressable>
  );
}

/** The Review tab: what was found, in two piles, one gesture each. */
export default function CapturesScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  // The photo runs dark enough under the status bar (every one of the four
  // scenes carries the same scrim) that the clock and the battery want
  // light glyphs — but only while this tab is the one you are looking at.
  // See `useHeroStatusBar`: a tab does not unmount when you leave it.
  useHeroStatusBar();
  const { height } = useWindowDimensions();
  const clearance = useTabBarClearance();
  const { t, locale } = useStrings();
  const pull = usePullRefresh();
  const { session } = useAuth();

  /**
   * Who to resolve "me" against: the session's user id, not the profile's.
   *
   * Same id, different arrival times — the session is restored from storage at
   * launch, the profile is a network fetch. Using the profile here made two
   * things wrong for as long as that fetch took: the group list was filtered by
   * a comparison that matches the first *ghost* rather than you (see
   * `data/types.isViewer`), and `myMemberId` — who goes down as having paid —
   * resolved the same way. An expense filed in that window would have named a
   * ghost as the payer.
   */
  const viewerId = session?.user?.id ?? null;
  const captures = useCaptures();
  const deleteCapture = useDeleteCapture();
  // Closing a draft against the expense it became. The single-draft form path
  // reaches this from inside add-expense; the swipe and batch paths call it here,
  // right after queueing each expense.
  const assignCapture = useAssignCapture();
  // The swipe and batch paths write the expenses themselves rather than opening a
  // form per draft, so they queue them the way the form does (ADR-005).
  const { mutate } = useSync();
  const toast = useToast();
  // "Just me" on the destination sheet: the shared path to the private ledger,
  // the same one the voice review files through.
  const placeInPersonal = usePlaceInPersonal();
  const personalOffered = usePersonalOffered();
  const { confirm, notify } = useDialog();
  // A guest past their trial may read but not write. The single-draft form path
  // is stopped by the same guard inside add-expense; a swipe or batch write never
  // reaches that screen, so it asks here.
  const guard = useGuestGuard();
  const groups = useGroups();
  const summary = useHomeSummary(viewerId);
  // The people the picker can point a draft at, and the raw material for
  // deciding whether a chosen set of them already share a group. All read from
  // the mirror, so the picker works with no network (ADR-005).
  const people = usePeopleBalances(viewerId);
  const oneToOne = useOneToOneGroupIds();
  const signatures = useGroupPeopleSignatures(viewerId);
  const createGroup = useCreateGroup();
  // Where each shop's money has been going — the whole basis of the chip and
  // therefore of the swipe. Local mirror only, so it is right offline.
  const suggestions = useSuggestionIndex();
  // Is anything actually reading the inbox? The one thing that decides whether
  // this screen opens on a status or on an instruction, and whether pasting is
  // the main path or the other way.
  const auto = useSmsAutoRead();
  // Whether this build and this phone have a reader at all — the same gate the
  // Bank messages screen asks itself, so the door is never shown to a screen
  // that would render nothing.
  const smsReader = useSmsInboxReader();

  // "Check the inbox now", from the screen somebody is actually standing on.
  // The sheet behind it is the Bank messages screen's own — it owns the choice
  // between the last month and everything, the progress while it reads, and
  // what it found — so this is a second door to one control rather than a
  // second control. It was only ever on the other screen, behind a glyph in a
  // header somebody had to know to open; a reader that cannot be asked to look
  // is indistinguishable from one that is not working.
  const reduceMotion = useReducedMotion();

  // One slow clock for the whole screen: the status line's "2 min ago" and the
  // empty state's "this week" both read it, and neither may call Date.now()
  // while rendering.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!auto.enabled) return;
    const timer = setInterval(() => setNow(Date.now()), CLOCK_TICK);
    return () => clearInterval(timer);
  }, [auto.enabled]);
  const filedThisWeek = useFiledThisWeek(now);

  // What is being assigned, if anything — drives the destination sheet: one
  // draft, or a whole spoken batch.
  /** The list's own height, so the empty state can centre in it. */
  const [listHeight, setListHeight] = useState(0);
  const [assigning, setAssigning] = useState<AssignTarget | null>(null);
  // What the sheet shows. It stays mounted through its fade-out, and drawing it
  // from `assigning` (already null by then) swapped a two-draft batch for the
  // empty single-draft layout mid-fade: "0 selected", a "Just me" row and "New
  // group" flashing up under the finger that had just chosen a group. The last
  // target is kept for the fade, synced in render (the app's idiom for
  // "follow a value until touched").
  const [lastAssigning, setLastAssigning] = useState<AssignTarget | null>(null);
  if (assigning !== null && assigning !== lastAssigning) setLastAssigning(assigning);
  const shownAssigning = assigning ?? lastAssigning;
  // The one draft under the picker, when it is a single one. The batch case has
  // no single capture to preview or pre-aim from.
  const assigningCapture = shownAssigning?.kind === 'capture' ? shownAssigning.capture : null;
  // Writing a draft into a group is several queue writes behind one gesture, and
  // a swipe is easy to repeat by accident. The lock is per target rather than a
  // single flag, so filing one row never swallows the swipe on the next.
  const placing = useRef<Set<string>>(new Set());
  // The id a group made from picked people will take, minted before the create
  // so the ghosts and the expense behind it can already name it — the
  // offline-first pattern the voice review and "add a person" both use.
  const [newGroupId, setNewGroupId] = useState(() => randomUUID());
  const [newMemberId, setNewMemberId] = useState(() => randomUUID());
  const addGhost = useAddGhostMember(newGroupId);
  // FlashList recycles row components, so batch expansion lives with the screen
  // and is keyed by batch id rather than inside the recycled row instance.
  const [openBatchIds, setOpenBatchIds] = useState<ReadonlySet<string>>(() => new Set());
  // The row's ⋯ overflow: which capture (or which spoken batch) has its actions
  // sheet open, if any. Null when nothing is open.
  const [menu, setMenu] = useState<CaptureMenu>(null);

  // The sort pill over the first day heading. Newest is where this list has
  // always opened; the other two are pure arithmetic over what is already on
  // screen (`lib/reviewFeed.ts`), not a server-side order.
  const [sortOrder, setSortOrder] = useState<ReviewSortOrder>('newest');
  const [sortOpen, setSortOpen] = useState(false);
  // The hero's "filter" button, on a phone that reads its own messages: a
  // small sheet rather than a second screen, holding the one thing that used
  // to be a bare glyph beside "open inbox" on the old dark panel — "look now"
  // — now that the top row only has room for two round buttons and the other
  // one (search) already goes to the screen that scan feeds.
  const [heroFilterOpen, setHeroFilterOpen] = useState(false);

  // Only groups the viewer still belongs to belong in the picker — or on a chip.
  // Leaving a group sets `left_at`; it does not remove the group row, so a left
  // (or owner-removed) group lingers in the local mirror and `useGroups` still
  // returns it.
  const assignableGroups = useMemo(
    () =>
      (groups.data ?? []).filter((group) =>
        summary.membersFor(group.id).some((member) => isViewer(member, viewerId)),
      ),
    [groups.data, summary, viewerId],
  );
  const assignableIds = useMemo(
    () => new Set(assignableGroups.map((group) => group.id)),
    [assignableGroups],
  );
  const nameOfGroup = useCallback(
    (groupId: string): string | null => {
      const group = assignableGroups.find((row) => row.id === groupId);
      return group ? groupLabel(group, summary.membersFor(groupId), viewerId) : null;
    },
    [assignableGroups, viewerId, summary],
  );

  // The people the picker offers, by name. A contact is somebody whose balance
  // with the viewer is explained by a single group (`only_group_id`) that is a
  // true 1:1 — you and them and nobody else. A whole trip is never a person,
  // even when it happens to be the only group you share with someone.
  const peopleChoices = useMemo(() => {
    const byGroup = new Map<string, PersonChoice>();
    for (const row of people.data ?? []) {
      if (!row.only_group_id || !oneToOne.data.has(row.only_group_id)) continue;
      byGroup.set(row.only_group_id, {
        personKey: row.person_key,
        name: row.display_name,
        groupId: row.only_group_id,
      });
    }
    return [...byGroup.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [people.data, oneToOne.data]);

  // A set of people → the group they already share, if any. First match wins;
  // it only ever answers "these exact people already have a group together".
  const groupBySignature = useMemo(() => {
    const map = new Map<string, string>();
    for (const sig of signatures.data) {
      const key = peopleSignatureKey(sig.names);
      if (!map.has(key)) map.set(key, sig.groupId);
    }
    return map;
  }, [signatures.data]);

  // How tall the picker sheet is ever allowed to get. A ceiling, not a height.
  const pickerMaxHeight = height * 0.8;

  // What the picker says it is placing when a whole batch is riding on the
  // answer: the running total (absent when the drafts are not one currency) and
  // how many drafts it stands for.
  const batchPreview = useMemo(() => {
    if (shownAssigning?.kind !== 'batch') return null;
    const items = shownAssigning.items;
    const currency = items[0]!.currency;
    const sameCurrency = items.every((item) => item.currency === currency);
    return {
      count: items.length,
      currency,
      total: sameCurrency ? items.reduce((sum, item) => sum + BigInt(item.amount), 0n) : null,
    };
  }, [shownAssigning]);

  // What the assign sheet's "Edit" affordance would open, if anything. A
  // single row offers it outright; a ticked pile offers it only when exactly
  // one draft is riding on the answer — editing is a question about one
  // expense's own fields, and a pile of several has no single set of fields
  // to open. (A spoken batch's ⋯ opens the picker on more than one row too,
  // but that path always carries more than one item, so it falls out of the
  // same check without a separate one.)
  const editTarget: CaptureRow | null =
    assigningCapture ??
    (shownAssigning?.kind === 'batch' && shownAssigning.items.length === 1
      ? shownAssigning.items[0]!
      : null);

  const rows = useMemo(() => captures.data ?? [], [captures.data]);
  // Two errands, two tabs: what the app found in the phone's bank messages,
  // and what its user added on purpose and has not filed yet. The rule and the
  // reasoning are in `lib/reviewFeed.ts`.
  const byTab = useMemo(() => splitByTab(rows), [rows]);
  const [tab, setTab] = useState<ReviewTabId | null>(null);
  // Decided once, from the first load that actually carries rows, and then
  // left alone. Re-deriving it every render would move the tab under somebody
  // as drafts arrive — an hourly read landing while they are mid-list would
  // walk them to the other half.
  //
  // Seeded during render rather than in an effect: this is a value, and
  // computing a value in an effect means rendering once with the wrong one and
  // again with the right one. React's own escape hatch for deriving state from
  // changing input, guarded so it runs exactly once — on the first load that
  // carries anything.
  const [seeded, setSeeded] = useState(false);
  if (!seeded && rows.length > 0) {
    setSeeded(true);
    setTab(openingTab(rows));
  }
  // Matches `openingTab`'s own answer for an empty list, so the tab that is
  // live before the first load carries rows is the tab seeding will choose.
  const activeTab: ReviewTabId = tab ?? 'added';
  const tabRows = byTab[activeTab];
  // The other half, for the empty state: an empty tab with drafts waiting next
  // door must say so rather than "Nothing needs you".
  const otherTab: ReviewTabId = activeTab === 'added' ? 'found' : 'added';
  const otherTabCount = byTab[otherTab].length;
  const otherTabLabel =
    otherTab === 'added'
      ? t.captures.tabAdded
      : smsReader
        ? t.captures.tabSms
        : t.captures.tabBankMessages;
  // Ticking belongs to the SMS tab only. That pile is a stream the app fills on
  // its own — a hundred and forty rows, most of them a card bill or a transfer
  // to yourself — and it is answered in handfuls. The drafts somebody added
  // themselves are a handful to begin with, each one a spend they remember
  // making and each wanting its own destination, so a tick box there would be
  // furniture on every row for a gesture that half of them never fits.
  const ticking = activeTab === 'found';
  const feedItems = useMemo(() => buildReviewFeed(tabRows, sortOrder), [tabRows, sortOrder]);
  // The pill's own label — "Sort by: Newest" — and the sheet it opens.
  const sortOptionLabel = useCallback(
    (order: ReviewSortOrder): string =>
      order === 'newest'
        ? t.captures.sortNewest
        : order === 'oldest'
          ? t.captures.sortOldest
          : t.captures.sortAmount,
    [t],
  );
  // The very first thing in the feed, when it is a day heading — shown on the
  // sort row itself rather than a second time just under it, which is what
  // `listData` below leaves out of the rows FlashList actually draws.
  const firstDayItem = feedItems[0]?.kind === 'day' ? feedItems[0] : null;
  const listData = useMemo(() => {
    if (captures.isLoading || rows.length === 0) return [];
    return firstDayItem ? feedItems.slice(1) : feedItems;
  }, [captures.isLoading, rows.length, firstDayItem, feedItems]);

  // Ticking several drafts and placing them together. Held as ids rather than
  // rows so a refresh that replaces the row objects does not silently drop a
  // selection, and pruned against what is actually on screen so "place 6" can
  // never act on a draft the person can no longer see.
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  // Exactly the rows that draw a tick box — which is not every draft in the
  // tab. A spoken batch folds several into one card with no box of its own and
  // its own "place the lot" gesture, so taking its ids here would make "select
  // all" tick rows nobody can see ticked and leave the toggle unable to reach
  // "all". Read off the built feed rather than the raw rows, so the two can
  // never drift: what is selectable is, by construction, what is rendered
  // selectable.
  const selectableIds = useMemo(
    () => feedItems.filter((item) => item.kind === 'single').map((item) => item.capture.id),
    [feedItems],
  );
  const selectableSet = useMemo(() => new Set(selectableIds), [selectableIds]);
  const chosenRows = useMemo(
    () => tabRows.filter((row) => selected.has(row.id) && selectableSet.has(row.id)),
    [tabRows, selected, selectableSet],
  );
  const everythingTicked = selectableIds.length > 0 && chosenRows.length === selectableIds.length;

  // The panel's two faces, and the ease between them. 0 is what the screen says
  // at rest — how much is waiting — and 1 is what it says while rows are ticked.
  // Both stay mounted, one overlaid on the other, so this is a crossfade rather
  // than an unmount that cuts: `useHeroCrossfade` is the same value and the same
  // 150ms the Friends header's own top-row swap rides, lifted onto `ScreenHero`
  // so the two panels can't drift apart into separately-tuned gestures.
  const selecting = chosenRows.length > 0;
  const { restingStyle: restingAnim, overlayStyle: selectAnim } = useHeroCrossfade(selecting);
  // The action bar at the foot of the screen needs its own instance of the same
  // value: it travels further than the panel's crossfade — off the bottom edge,
  // the navigation's own height, rather than shifting in place — so it cannot
  // share `useHeroCrossfade`'s fixed ±6px range.
  const sel = useSharedValue(selecting ? 1 : 0);
  useEffect(() => {
    sel.set(reduceMotion ? (selecting ? 1 : 0) : withTiming(selecting ? 1 : 0, { duration: 150 }));
  }, [selecting, reduceMotion, sel]);
  const actionBarAnim = useAnimatedStyle(() => ({
    opacity: sel.get(),
    transform: [{ translateY: (1 - sel.get()) * 72 }],
  }));

  /**
   * While anything is ticked, the bottom bar stands down.
   *
   * The action bar is an in-tree view and the navigation is rendered at the root
   * over the whole stack, so the two used to sit on top of one another — a band
   * of buttons with the bar beneath it, and the raised mic landing squarely on
   * "Add 2 to a group". Nothing about the route has changed, so neither could
   * move out of the other's way by the usual rule; the bar takes a second input
   * instead (`lib/tabBarSuppress`).
   *
   * Through `useTabBarStandDown` rather than a bare effect, because the release
   * has to be tied to *focus*, not to unmounting. This screen is a tab and a tab
   * does not unmount when you leave it: the effect this replaced held its claim
   * until the ticks cleared, so pressing back with two drafts ticked landed on
   * the dashboard with no navigation anywhere in the app and nothing left on
   * screen able to give it back.
   */
  const bottomBarStandsDown = ticking && chosenRows.length > 0;
  useTabBarStandDown(bottomBarStandsDown);
  const toggleSelected = useCallback((id: string): void => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // The trips that were actually running, from the groups this viewer can still
  // write to. Dateless trips are not windows and are left out — see
  // `tripWindowsOf`.
  const trips = useMemo(() => tripWindowsOf(assignableGroups), [assignableGroups]);

  // Every row's suggestion, worked out once per render of the list rather than
  // per recycled row: what the person tagged, else what the trip, the shop and
  // the kind of spend agree on, else nothing and the chip asks. The weighing —
  // and the two bars a winner has to clear before it is said out loud — is in
  // `lib/groupSuggestion.ts`, where a test can reach it.
  const destinations = useMemo(() => {
    const byCapture = new Map<string, GroupSuggestion>();
    for (const row of rows) {
      const found = suggestGroup({
        capture: row,
        index: suggestions,
        trips,
        assignable: assignableIds,
      });
      if (found) byCapture.set(row.id, found);
    }
    return byCapture;
  }, [rows, suggestions, trips, assignableIds]);

  // Which row the picker opens with ticked: the group the capture was tagged
  // for at capture time, else the group the row chip already suggested. Both
  // still have to be assignable; stale suggestions are not choices.
  const pickerSelection: DestinationSelection = useMemo(() => {
    if (!assigningCapture) return { kind: 'none' };
    const targetId = assigningCapture.target_group_id;
    if (targetId && assignableIds.has(targetId)) return { kind: 'existing', groupId: targetId };
    const suggestedId = destinations.get(assigningCapture.id)?.groupId;
    return suggestedId && assignableIds.has(suggestedId)
      ? { kind: 'existing', groupId: suggestedId }
      : { kind: 'none' };
  }, [assigningCapture, assignableIds, destinations]);

  const openAssign = useCallback((capture: CaptureRow): void => {
    setAssigning({ kind: 'capture', capture });
  }, []);

  // The batch card's ⋯ → "Add these to a group": the same picker, opened on the
  // whole cluster instead of one row of it.
  const openAssignBatch = useCallback((items: CaptureRow[], viaBar = false): void => {
    setAssigning({ kind: 'batch', items, viaBar });
  }, []);

  // Open the draft in the capture form to fix its fields — the same screen that
  // drafted it, now in edit mode. Every value the row carries rides along as a
  // param so the form opens filled in and saving updates the row in place rather
  // than making a second one; `parsed` (which holds the voice-batch id and the
  // message provenance) is preserved.
  const openEdit = useCallback((capture: CaptureRow): void => {
    router.push({
      pathname: '/capture',
      params: {
        editId: capture.id,
        amount: capture.amount,
        desc: capture.description ?? '',
        cur: capture.currency,
        category: capture.category ?? '',
        ...(capture.category_meta ? { categoryMeta: JSON.stringify(capture.category_meta) } : {}),
        date: capture.expense_date,
        ...(capture.payment_method ? { payment: capture.payment_method } : {}),
        ...(capture.target_group_id ? { targetGroupId: capture.target_group_id } : {}),
        ...(capture.location ? { location: JSON.stringify(capture.location) } : {}),
        ...(capture.notes ? { note: capture.notes } : {}),
        ...(capture.photo_path ? { photoPath: capture.photo_path } : {}),
        ...(capture.raw_text ? { rawText: capture.raw_text } : {}),
        ...(capture.parsed ? { parsed: JSON.stringify(capture.parsed) } : {}),
      },
    });
  }, []);

  /**
   * Take a draft off the list.
   *
   * Two behaviours, one write (`capture.delete`, which the sync protocol has
   * carried since A34 — no migration, and captures already soft-delete). A draft
   * the app *found* goes without a question: nobody typed it, and the message it
   * was made from is still in the phone's own Messages app, so there is nothing
   * to lose and nothing to confirm. A draft a person *made* keeps the confirm it
   * has always had, because their words and possibly a photograph of the bill go
   * with it.
   */
  const dismiss = useCallback(
    async (capture: CaptureRow): Promise<void> => {
      if (guard.blockWrite()) return;
      if (!wasFound(capture)) {
        const ok = await confirm({
          title: t.captures.delete,
          body: t.captures.deleteConfirm,
          confirmLabel: t.captures.delete,
          tone: 'danger',
        });
        if (!ok) return;
      }
      try {
        await deleteCapture.mutateAsync(capture.id);
        if (wasFound(capture)) toast.show(t.captures.notAnExpenseDone);
      } catch (caught) {
        toast.show(friendlyError(caught, t.captures.couldNotSave, 'captures.dismiss'), 'negative');
      }
    },
    [
      confirm,
      deleteCapture,
      guard,
      t.captures.couldNotSave,
      t.captures.delete,
      t.captures.deleteConfirm,
      t.captures.notAnExpenseDone,
      toast,
    ],
  );

  // Delete every capture in a spoken batch at once, behind one confirm.
  const confirmDeleteBatch = useCallback(
    async (items: CaptureRow[]): Promise<void> => {
      const ok = await confirm({
        title: t.captures.deleteBatch,
        body: plural(locale, items.length, t.captures.deleteBatchConfirm),
        confirmLabel: t.captures.delete,
        tone: 'danger',
      });
      if (ok) {
        for (const item of items) void deleteCapture.mutateAsync(item.id);
      }
    },
    [
      confirm,
      deleteCapture,
      locale,
      t.captures.delete,
      t.captures.deleteBatch,
      t.captures.deleteBatchConfirm,
    ],
  );

  /**
   * Take a whole ticked pile off the list at once.
   *
   * The reason this exists is the complaint that produced it: a morning's bank
   * messages is thirty rows, most of them a credit-card bill or a transfer to
   * oneself, and answering "not an expense" thirty times is not answering — it
   * is data entry. One swipe was already the cheapest single gesture the screen
   * could offer; the missing thing was a way to say it once about many.
   *
   * It follows `dismiss`'s rule rather than inventing a second one. Drafts the
   * app *found* go without a question: nobody typed a word of them and the
   * messages are still in the phone's own Messages app, so there is nothing to
   * lose and a dialog in front of a loss-free action is a dialog people learn
   * to dismiss unread. The moment one draft in the pile was made by a person —
   * their words, possibly a photograph of the bill — the confirm comes back,
   * for the whole pile, once.
   *
   * Each draft is its own attempt, like every other batch on this screen: one
   * that refuses does not take the others down, and it stays on the list rather
   * than vanishing into a success message that would be a lie.
   */
  const dismissMany = useCallback(
    async (items: readonly CaptureRow[]): Promise<void> => {
      if (items.length === 0) return;
      if (guard.blockWrite()) return;
      const allFound = items.every(wasFound);
      if (!allFound) {
        const ok = await confirm({
          title: t.captures.delete,
          body: plural(locale, items.length, t.captures.dismissManyConfirm),
          confirmLabel: t.captures.delete,
          tone: 'danger',
        });
        if (!ok) return;
      }
      setSelected(new Set());
      let failed = 0;
      let firstError: unknown = undefined;
      for (const item of items) {
        try {
          await deleteCapture.mutateAsync(item.id);
        } catch (caught) {
          failed += 1;
          if (firstError === undefined) firstError = caught;
        }
      }
      if (failed === 0) toast.show(t.captures.notAnExpenseDone);
      // The reason, not a guess at it — and reported, so a failure here is
      // something that can be looked at rather than only described.
      else
        toast.show(
          friendlyError(firstError, t.captures.couldNotSave, 'captures.dismissMany'),
          'negative',
        );
    },
    [
      confirm,
      deleteCapture,
      guard,
      locale,
      t.captures.couldNotSave,
      t.captures.delete,
      t.captures.dismissManyConfirm,
      t.captures.notAnExpenseDone,
      toast,
    ],
  );

  const closeAssign = useCallback((): void => setAssigning(null), []);

  // The assign sheet's own way to the editor — tapping what it is about to
  // place rather than backing out to the row's ⋯ first. Same route, same
  // params, same "every value rides along" as `openEdit`; this only decides
  // *when* it fires. The sheet closes first rather than after, matching how
  // every other choice on this picker already leaves (`onChoose`'s `create`
  // case): the next thing on screen is a full route, not a modal stacked on
  // one still closing.
  const editFromAssign = useCallback((): void => {
    if (!editTarget) return;
    closeAssign();
    openEdit(editTarget);
  }, [closeAssign, editTarget, openEdit]);

  /**
   * Drafts into one group, in one go — one row swiped, or a whole spoken batch.
   *
   * This is the answer to the same question the form asks, and it ends
   * differently on purpose: opening add-expense to accept its defaults is
   * exactly the work the gesture exists to remove. So the expenses are written
   * here, with the form's own defaults — everyone in the group, split equally,
   * the person filing down as having paid — and each draft is closed against the
   * expense it became.
   *
   * Both writes ride the ordinary offline queue (ADR-005), so this works with no
   * network and survives being killed mid-run. Each draft is its own attempt:
   * one that refuses does not take the others down, and it is left in Review
   * (nothing closes it) rather than vanishing into a success message that would
   * be a lie.
   */
  const placeInGroup = useCallback(
    async (input: {
      /** What the per-target lock is taken on: the row, or the batch's first row. */
      lockKey: string;
      items: readonly CaptureRow[];
      groupId: string;
      /** What to call the group in the confirmation. */
      label: string;
      members: readonly AssignMember[];
      /** Who the viewer is in that group — the payer. Resolved by the caller. */
      myMemberId: string | null;
      currency: string;
    }): Promise<void> => {
      if (placing.current.has(input.lockKey)) return;
      if (guard.blockWrite()) return;
      placing.current.add(input.lockKey);
      try {
        // Another device may have placed one of these while the sheet was open;
        // the inbox read already knows, and writing it again would file the same
        // dinner twice.
        const waiting = stillWaiting(input.items, rows);
        if (waiting.length === 0) {
          toast.show(t.captures.assignBatchAlreadyDone);
          return;
        }
        const plan = planCaptureAssign({
          captures: waiting,
          members: input.members,
          myMemberId: input.myMemberId,
          currency: input.currency,
        });

        let placed = 0;
        // A draft whose amount the ledger cannot take never had a write to try.
        let failed = plan.unusable.length;
        // Kept rather than dropped. A bare `catch {}` here counted the refusal
        // and threw away the only thing that could explain it, so every failure
        // read alike and none of them reached Sentry.
        let firstError: unknown = undefined;
        for (const write of plan.writes) {
          try {
            await mutate(MutationKind.ExpenseCreate, input.groupId, write.payload);
            // Only once the expense is on the queue: a draft closed before its
            // expense exists is a spend that quietly disappeared.
            await assignCapture.mutateAsync({
              captureId: write.captureId,
              groupId: input.groupId,
              expenseId: write.expenseId,
            });
            placed += 1;
          } catch (caught) {
            failed += 1;
            if (firstError === undefined) firstError = caught;
          }
        }

        if (failed === 0) {
          if (placed > 0) {
            toast.show(
              plural(locale, placed, t.captures.assignedBatch).replaceAll('{name}', input.label),
            );
          }
          return;
        }
        // Something did not land, so this is said in a dialog rather than a
        // toast that fades: it names how many are still waiting, and (when some
        // did land) how many did, so neither half of a partial run is implied.
        const lines: string[] = [];
        if (placed > 0) {
          lines.push(
            plural(locale, placed, t.captures.assignedBatch).replaceAll('{name}', input.label),
          );
        }
        lines.push(plural(locale, failed, t.captures.assignBatchSomeFailed));
        // And why, in words a person can act on. "Try again in a moment" is a
        // guess, and a wrong one whenever the cause is not going to pass on its
        // own; `friendlyError` reports the exception as it renders it.
        if (firstError !== undefined) {
          lines.push(friendlyError(firstError, t.captures.couldNotSave, 'captures.assignBatch'));
        }
        await notify({ title: t.captures.title, body: lines.join('\n\n') });
      } catch (caught) {
        // The callers fire this without awaiting it, so anything the planning
        // step throws would otherwise leave with no word to the person whose
        // drafts are still sitting there. A toast rather than a dialog: the
        // drafts are exactly where they were, so there is nothing to answer.
        toast.show(
          friendlyError(caught, t.captures.couldNotSave, 'captures.assignBatch'),
          'negative',
        );
      } finally {
        placing.current.delete(input.lockKey);
      }
    },
    [
      assignCapture,
      guard,
      locale,
      mutate,
      notify,
      rows,
      t.captures.assignBatchAlreadyDone,
      t.captures.assignBatchSomeFailed,
      t.captures.assignedBatch,
      t.captures.couldNotSave,
      t.captures.title,
      toast,
    ],
  );

  /** The whole of the swipe: this draft, into the group the chip already named. */
  const fileWhereItSays = useCallback(
    (capture: CaptureRow): void => {
      const destination = destinations.get(capture.id);
      if (!destination) return;
      const groupId = destination.groupId;
      const members = summary.membersFor(groupId);
      const group = assignableGroups.find((row) => row.id === groupId);
      void placeInGroup({
        lockKey: capture.id,
        items: [capture],
        groupId,
        label: group ? groupLabel(group, members, viewerId) : '',
        members,
        // `isViewer`, never a bare comparison: this decides who the ledger
        // records as having paid, and a ghost answering to an unloaded profile
        // would put somebody else's name on the expense.
        myMemberId: members.find((member) => isViewer(member, viewerId))?.id ?? null,
        currency: group?.default_currency ?? capture.currency,
      });
    },
    [assignableGroups, destinations, placeInGroup, viewerId, summary],
  );

  /**
   * A chosen existing group, for whichever the picker is open on.
   *
   * One draft is unchanged: its own values are handed to the add-expense form as
   * prefill, carrying its id so that saving there closes the capture
   * (`useAssignCapture`). A batch skips the form — that is the whole point.
   */
  const chooseExistingGroup = useCallback(
    (target: AssignTarget, groupId: string): void => {
      closeAssign();
      // Only a batch ends the selection, because only a batch can *be* the
      // selection. Filing one row from its own ⋯ while several are ticked is a
      // different errand, and wiping the ticks would punish somebody for using
      // the sheet mid-selection. Cancelling never comes through here at all,
      // which is right: a selection somebody backed out of is one they still
      // have.
      if (target.kind === 'batch') {
        setSelected(new Set());
      }
      if (target.kind === 'capture') {
        router.push(assignCaptureHref(target.capture, groupId));
        return;
      }
      const members = summary.membersFor(groupId);
      const group = assignableGroups.find((row) => row.id === groupId);
      void placeInGroup({
        lockKey: target.items[0]!.id,
        items: target.items,
        groupId,
        label: group ? groupLabel(group, members, viewerId) : '',
        members,
        myMemberId: members.find((member) => isViewer(member, viewerId))?.id ?? null,
        // Only for a draft with no currency of its own: each draft keeps its
        // own, as the form does.
        currency: group?.default_currency ?? target.items[0]!.currency,
      });
    },
    [assignableGroups, closeAssign, placeInGroup, viewerId, summary],
  );

  // The People tab, confirmed: this draft is with these people. If they already
  // share a group it is that group's expense. If they do not, the group is made
  // here and the draft assigned into it: a lone name is the 1:1 "add a person"
  // case, several is a real group, and both are named after whoever is in them
  // the way WhatsApp does.
  const assignToPeople = useCallback(
    async (names: string[]): Promise<void> => {
      const target = assigning;
      if (!target) return;
      const clean = [...new Set(names.map((name) => name.trim()).filter(Boolean))];
      if (clean.length === 0) return;

      const shared = groupBySignature.get(peopleSignatureKey(clean));
      if (shared) {
        chooseExistingGroup(target, shared);
        return;
      }

      const groupId = newGroupId;
      const currency =
        target.kind === 'capture' ? target.capture.currency : target.items[0]!.currency;
      closeAssign();
      const ghostIds: string[] = [];
      try {
        await createGroup.mutateAsync({
          groupId,
          creatorMemberId: newMemberId,
          name: clean.join(', '),
          type: GroupType.Other,
          currency,
        });
        for (const name of clean) ghostIds.push(await addGhost.mutateAsync(name));
      } catch (caught) {
        // With no group to assign into there is nowhere to push, so say why and
        // leave the draft exactly where it was.
        toast.show(
          friendlyError(caught, t.captures.couldNotSave, 'captures.newPeopleGroup'),
          'negative',
        );
        return;
      }
      // Spent — the next new group needs its own pair of ids.
      setNewGroupId(randomUUID());
      setNewMemberId(randomUUID());
      if (target.kind === 'capture') {
        router.push(assignCaptureHref(target.capture, groupId));
        return;
      }
      // The group and its people exist only on the queue so far, so the mirror
      // cannot list its members yet. Their ids were minted here, so the batch
      // names them itself rather than waiting for a read that has not happened.
      setSelected(new Set());
      void placeInGroup({
        lockKey: target.items[0]!.id,
        items: target.items,
        groupId,
        label: clean.join(', '),
        members: [{ id: newMemberId }, ...ghostIds.map((id) => ({ id }))],
        myMemberId: newMemberId,
        currency,
      });
    },
    [
      addGhost,
      assigning,
      chooseExistingGroup,
      closeAssign,
      createGroup,
      groupBySignature,
      newGroupId,
      newMemberId,
      placeInGroup,
      t.captures.couldNotSave,
      toast,
    ],
  );

  const closeMenu = useCallback((): void => setMenu(null), []);
  // What a menu row does, held until the menu has actually closed. On iOS a
  // sheet opened while this one is still closing (the group picker, a confirm)
  // is presented on top of it and then dismissed along with it, which left the
  // whole screen deaf to taps. So a row closes the menu and hands its action
  // here; the menu's `onClosed` runs it.
  const afterMenu = useRef<(() => void) | null>(null);
  const closeMenuThen = useCallback((action: () => void): void => {
    afterMenu.current = action;
    setMenu(null);
  }, []);
  const runAfterMenu = useCallback((): void => {
    const action = afterMenu.current;
    afterMenu.current = null;
    action?.();
  }, []);
  const openCaptureMenu = useCallback(
    (capture: CaptureRow): void => setMenu({ kind: 'capture', capture }),
    [],
  );
  const openBatchMenu = useCallback(
    (items: CaptureRow[]): void => setMenu({ kind: 'batch', items }),
    [],
  );

  const toggleBatch = useCallback((batchId: string): void => {
    setOpenBatchIds((current) => {
      const next = new Set(current);
      if (next.has(batchId)) next.delete(batchId);
      else next.add(batchId);
      return next;
    });
  }, []);

  const renderItem = useCallback(
    ({ item, index }: { item: ReviewFeedItem; index: number }) => {
      switch (item.kind) {
        case 'day':
          return (
            <Text
              variant="micro"
              tone="muted"
              style={{
                textTransform: 'uppercase',
                // Padding, for the same reason as the section heading above:
                // a margin on a cell root is height FlashList cannot see.
                // The first heading sits right under the list's own top
                // padding; later ones leave a day's gap after the cards above.
                // `6` under it, not `sm` (8) — a smaller section header for a
                // denser list, matching the gap Home's own day headings
                // leave above their rows.
                paddingTop: index === 0 ? 0 : theme.spacing.sm,
                paddingBottom: 6,
              }}
            >
              {dayHeading(locale, item.on)}
            </Text>
          );
        case 'batch':
          return (
            <View style={{ paddingBottom: theme.spacing.md }}>
              <BatchGroupCard
                items={item.items}
                locale={locale}
                t={t}
                open={openBatchIds.has(item.id)}
                onToggle={() => toggleBatch(item.id)}
                onAssign={openAssign}
                onMore={openCaptureMenu}
                onMoreBatch={() => openBatchMenu(item.items)}
              />
            </View>
          );
        case 'single': {
          const capture = item.capture;
          const destination = destinations.get(capture.id) ?? null;
          const destinationName = destination ? nameOfGroup(destination.groupId) : null;
          // "File it where the chip says" is offered only when the chip
          // actually names somewhere, so it can never do something the row did
          // not first state. That condition used to ride on the swipe's leading
          // action; the swipe has gone and the condition has not.
          const row = (
            <CaptureListRow
              capture={capture}
              locale={locale}
              t={t}
              destinationName={destinationName}
              onAssign={() => openAssign(capture)}
              onMore={() => openCaptureMenu(capture)}
              onFile={destinationName ? () => fileWhereItSays(capture) : null}
              onDismiss={() => void dismiss(capture)}
              ticking={ticking}
              selected={selected.has(capture.id)}
              onToggleSelected={() => toggleSelected(capture.id)}
            />
          );
          return (
            /* Its own card now, not a hairline inside a run several drafts
               shared — compact (`CARD_GAP` between them, not a margin FlashList
               cannot see) reads closer to the reference board than the tall
               joined blocks did, and it is what lets a run mix ticked and
               unticked rows without one card looking half-selected.

               No swipe. A drag that both ticks a row and files it somewhere is
               two answers to one gesture, and the one it would win is whichever
               way the finger moved further — so with the tick boxes always out,
               the swipe had to go. Both of its answers survive as plain rows in
               the ⋯ sheet, and "not an expense" now also answers a whole ticked
               pile at once, which is what the gesture was really for. */
            <View style={{ paddingBottom: CARD_GAP }}>
              <View
                style={{
                  backgroundColor: theme.color.surface,
                  // `md` (16), not `lg` (20) — a smaller card wears a smaller
                  // corner, and it is one less point of chrome around
                  // content that is already tighter.
                  borderRadius: theme.radius.md,
                }}
              >
                {row}
              </View>
            </View>
          );
        }
      }
    },
    [
      destinations,
      dismiss,
      fileWhereItSays,
      locale,
      nameOfGroup,
      openAssign,
      openBatchIds,
      openBatchMenu,
      selected,
      ticking,
      toggleSelected,
      openCaptureMenu,
      t,
      theme.color.surface,
      theme.radius.md,
      theme.spacing.md,
      theme.spacing.sm,
      toggleBatch,
    ],
  );

  // One object so a chip, a fold or a swipe re-renders a row FlashList would
  // otherwise recycle unchanged.
  const listState = useMemo(
    () => ({ openBatchIds, destinations, theme }),
    [openBatchIds, destinations, theme],
  );

  const menuCapture = menu?.kind === 'capture' ? menu.capture : null;
  const menuDestination = menuCapture ? (destinations.get(menuCapture.id) ?? null) : null;
  const menuDestinationName = menuDestination ? nameOfGroup(menuDestination.groupId) : null;

  // ── The way through to the bank messages ──────────────────────────────
  //
  // Bank messages used to be poured into this list. They should not have been:
  // Review is the short list of things genuinely waiting on a person, and a
  // stream of a hundred rows nobody has looked at makes the four that need an
  // answer unfindable. They have their own screen now, and this is the door to
  // it — one row, carrying the one number that decides whether it is worth
  // opening.
  //
  // The confident expenses are still *here* as well, by design: a message the
  // app read cleanly is an answer, not a question, and it belongs in the list of
  // things to file. Everything it was unsure of waits behind this row.
  const bankMessages = useSmsMessages(smsReader);
  const bankWaiting = useMemo(() => totalWaiting(bankMessages.rows), [bankMessages.rows]);

  // The message behind the row whose ⋯ is open, when it can actually be shown:
  // this build reads messages, the draft names one, and the store still holds
  // it. Checked here rather than left to the screen being pushed, which answers
  // a key it does not have with an empty page — an offer that leads nowhere is
  // worse than no offer.
  const menuMessageKey = useMemo(() => {
    if (!smsReader || !menuCapture) return null;
    const key = messageKeyOf(menuCapture);
    if (!key) return null;
    return bankMessages.rows.some((row) => row.dedupeKey === key) ? key : null;
  }, [bankMessages.rows, menuCapture, smsReader]);
  // Only over the messages. "Added by you" is the drafts somebody typed, spoke
  // or photographed, and a door to the bank's inbox standing above them is an
  // answer to a question that tab is not asking — it pushed nine rows of a
  // person's own work down the screen to advertise a different pile.
  const bankMessagesRow =
    smsReader && ticking ? (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${t.smsInbox.entryTitle}. ${
          bankWaiting > 0
            ? plural(locale, bankWaiting, t.smsInbox.entryWaiting)
            : t.smsInbox.entryNothing
        }`}
        onPress={() => router.push('/captures/sms')}
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          gap: theme.spacing.md,
          paddingVertical: theme.spacing.md,
          opacity: pressed ? 0.7 : 1,
        })}
      >
        <View
          style={{
            width: 38,
            height: 38,
            borderRadius: 12,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: theme.color.brandSoft,
          }}
        >
          <Ionicons name="chatbubbles" size={iconSize.md} color={theme.color.brand} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text variant="body">{t.smsInbox.entryTitle}</Text>
          <Text variant="micro" tone="muted">
            {t.smsInbox.onDevice}
          </Text>
        </View>
        {bankWaiting > 0 ? (
          <Badge label={plural(locale, bankWaiting, t.smsInbox.entryWaiting)} tone="brand" />
        ) : null}
        <Ionicons
          name={directionalIcon('chevron-forward')}
          size={iconSize.md}
          color={theme.color.textMuted}
        />
      </Pressable>
    ) : null;

  // The sort pill, over whichever day heading the first visible row would
  // otherwise carry — folded into one header row with it rather than left as
  // a second banner above it, so the two read as one line the way the
  // reference board draws them. `firstDayItem` is left out of `listData`
  // for exactly this reason: shown here, it would otherwise be shown twice.
  const sortRow =
    rows.length > 0 ? (
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: theme.spacing.sm,
          // Matches the day heading's own tightened gap below it.
          paddingBottom: 6,
        }}
      >
        <Text
          variant="micro"
          tone="muted"
          numberOfLines={1}
          style={{ textTransform: 'uppercase', flexShrink: 1 }}
        >
          {firstDayItem ? dayHeading(locale, firstDayItem.on) : ''}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t.captures.sortByLabel.replace(
            '{option}',
            sortOptionLabel(sortOrder),
          )}
          onPress={() => setSortOpen(true)}
          style={({ pressed }) => [
            {
              flexDirection: 'row',
              alignItems: 'center',
              gap: theme.spacing.xs,
              paddingHorizontal: theme.spacing.sm,
              paddingVertical: 4,
              borderRadius: theme.radius.pill,
              backgroundColor: theme.color.surface,
              opacity: pressed ? 0.7 : 1,
            },
            theme.shadow.soft,
          ]}
        >
          <Ionicons name="swap-vertical-outline" size={iconSize.sm} color={theme.color.textMuted} />
          <Text variant="micro" numberOfLines={1}>
            {t.captures.sortByLabel.replace('{option}', sortOptionLabel(sortOrder))}
          </Text>
          <Ionicons name="chevron-down" size={iconSize.xs} color={theme.color.textFaint} />
        </Pressable>
      </View>
    ) : null;

  return (
    <Screen edges={[]}>
      {/* Review opens on the owner's own photograph now, not the shared
          indigo gradient `ScreenHero` gives a group — the name of the thing,
          one number that is the point of the screen, and the two round
          buttons that used to be bare glyphs in `ScreenHero`'s corner. See
          `ReviewHero` for why this is its own component rather than a third
          caller of the shared shell.

          No back chevron: this is a bar destination and there is nowhere
          "back" from a tab. `edges={[]}` lets the band run under the status
          bar the way the dashboard's does; the FlashList's
          `paddingBottom: clearance` still reserves the room the tab bar
          needs at the other end. */}
      <ReviewHero>
        <Row style={{ alignItems: 'center', gap: theme.spacing.sm }}>
          <Ionicons name="file-tray-full-outline" size={iconSize.xl} color={theme.color.onBrand} />
          <Text
            variant="title"
            tone="onBrand"
            numberOfLines={1}
            style={{ flex: 1, fontWeight: '800' }}
          >
            {t.captures.title}
          </Text>
          {/* The hero's two round buttons, where a phone reads its own
              messages: search goes straight to Bank messages, which is
              where this screen's real search field already lives
              (`captures/sms`) — the same destination "open inbox" used to
              be a bare primary glyph for; filter opens a small sheet
              holding "look now", the one thing left over once search took
              the other action's old spot. Where nothing reads (iPhone,
              iPad, no tier of the API) there is only ever one thing this
              screen can be asked to do, so it gets the one button rather
              than a second that would open onto nothing. */}
          {smsReader ? (
            <>
              <HeroRoundButton
                icon="search-outline"
                label={t.captures.heroSearch}
                onPress={() => router.push('/captures/sms')}
              />
              <HeroRoundButton
                icon="options-outline"
                label={t.captures.heroFilter}
                onPress={() => setHeroFilterOpen(true)}
              />
            </>
          ) : (
            <HeroRoundButton
              icon="chatbubble-ellipses-outline"
              label={t.captures.fromMessage}
              primary
              onPress={() => router.push('/captures/paste')}
            />
          )}
        </Row>
        {/* The line under the name is a *state*, not an instruction: with
            something reading, it says so and when it last looked. With
            nothing reading there is no state to report, and the hero's own
            count below already says how much is waiting. */}
        {auto.enabled ? (
          <WatchingLine
            onBrand
            checking={auto.checking}
            lastCheckedAt={auto.lastCheckedAt}
            now={now}
            locale={locale}
            t={t}
            onRefresh={() => void auto.refresh()}
          />
        ) : null}
        <View style={{ gap: theme.spacing.md }}>
          {/* The panel's two faces share one slot and dissolve between them.
              What is waiting sits in flow and gives the slot its height; the
              selection is overlaid on it at the same height, so neither ever
              unmounts and ticking a row eases the panel over instead of cutting
              it. Only the face that is showing takes taps. */}
          <View style={{ justifyContent: 'center' }}>
            {/* Caption above figure, with the same `theme.spacing.md` breathing
                room `GroupHero` puts between its own caption and balance — the
                two texts used to sit flush against each other, which is the
                one thing that still read as a settings row next to a group's
                hero. */}
            <Reanimated.View
              pointerEvents={selecting ? 'none' : 'auto'}
              style={[restingAnim, { gap: theme.spacing.md }]}
            >
              {/* The caption stays whether or not anything is waiting, so the
                  panel keeps one shape — caption over figure — like every
                  other hero, instead of collapsing to a single line. */}
              <Text variant="caption" tone="onBrand" style={{ opacity: 0.85 }}>
                {t.captures.heroWaiting}
              </Text>
              {rows.length > 0 ? (
                <>
                  {/* The whole screen's figure, not the open tab's: a hero
                      number that changed every time you touched a tab would be
                      part of the tab rather than the screen. Counted the way the
                      tabs count — one per draft, a spoken batch of two counting
                      twice — so the three numbers on this screen agree. And
                      short enough to stay on one line, which "N expenses waiting
                      to be added" was not: at 140 it wrapped and took the panel
                      with it. */}
                  <Text variant="title" tone="onBrand" numberOfLines={1}>
                    {plural(locale, rows.length, t.captures.batchExpenses)}
                  </Text>
                </>
              ) : (
                /* Review is trying to reach this, so the hero says it plainly
                   rather than showing a nought. Not "Nothing needs you": the
                   empty state under it says that, and the same sentence twice
                   on one screen read as a layout mistake. */
                <Text variant="title" tone="onBrand" numberOfLines={1}>
                  {t.captures.heroCaughtUp}
                </Text>
              )}
            </Reanimated.View>
            {/* While rows are ticked the panel stops reporting the pile and
                reports the selection instead — the shape every list with a
                selection mode converges on (Todoist, Matter, GitHub, Quo all
                put the count in the header and nothing but actions at the
                bottom). Two things are won by moving it up here. The count is
                a *state*, and a state belongs where this screen already says
                what it is rather than in the band a thumb is aiming at. And
                "select all" stops sitting a few pixels from "not an expense":
                one is a scope control and the other destroys work, and putting
                them in the same row was a mis-tap waiting to be made. */}
            <Reanimated.View
              pointerEvents={selecting ? 'auto' : 'none'}
              style={[
                {
                  position: 'absolute',
                  left: 0,
                  right: 0,
                  top: 0,
                  bottom: 0,
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: theme.spacing.md,
                },
                selectAnim,
              ]}
            >
              <Text variant="title" tone="onBrand" numberOfLines={1} style={{ flex: 1 }}>
                {plural(locale, chosenRows.length, t.smsInbox.selected)}
              </Text>
              <Button
                label={everythingTicked ? t.smsInbox.selectNone : t.smsInbox.selectAll}
                variant="onBrandOutline"
                size="sm"
                onPress={() => setSelected(everythingTicked ? new Set() : new Set(selectableIds))}
              />
            </Reanimated.View>
          </View>
          {/* No "Save an expense" pill, and no discs under the number either.
              The raised mic in the bottom bar opens a capture from anywhere in
              the app, and the two message controls have gone up to the corner
              with the rest of the header — a panel whose job is one figure
              should not be pushing the list down with buttons. */}
        </View>
      </ReviewHero>

      {/* The two errands, pinned between the header and the list exactly as the
          group ledger pins its three — fixed here rather than riding in
          `ListHeaderComponent`, so scrolling never carries the tab bar off the
          top and switching tabs feels instant rather than like a new page.

          Drawn only once there is something to sort: a tab bar over an empty
          screen is two doors to the same nothing. */}
      {rows.length > 0 ? (
        <View
          style={{
            paddingHorizontal: theme.spacing.xl,
            paddingTop: theme.spacing.md,
            gap: theme.spacing.sm,
          }}
        >
          <SegmentedTabs
            value={activeTab}
            onChange={(next: ReviewTabId) => {
              setTab(next);
              // A selection belongs to the tab it was made in. Carrying it across
              // would leave rows ticked that are no longer on screen, and "place
              // 6" would act on drafts the person can no longer see.
              setSelected(new Set());
            }}
            tabs={[
              {
                // First, because it is the one this screen opens on: the finite
                // half, the spends this person caught on purpose.
                value: 'added' as ReviewTabId,
                label: t.captures.tabAdded,
                count: byTab.added.length,
                icon: (color) => (
                  <Ionicons name="create-outline" size={iconSize.md} color={color} />
                ),
              },
              {
                value: 'found' as ReviewTabId,
                // "SMS", on every phone. Everything in this pile carries
                // `source: 'sms'`, which only the message paths write — read off
                // the inbox on an Android that may, pasted in on an iPhone,
                // which cannot at any tier. Either way the thing it was made
                // from was a bank message, so the source is a true name on both
                // and a more useful one than the favour: it says at a glance
                // which half of Review fills itself.
                // Where the phone cannot read SMS (iPhone, iPad) nothing here
                // came from its inbox, so the tab is named for what is pasted.
                label: smsReader ? t.captures.tabSms : t.captures.tabBankMessages,
                count: byTab.found.length,
                icon: (color) => (
                  <Ionicons name="chatbubbles-outline" size={iconSize.md} color={color} />
                ),
              },
            ]}
          />
        </View>
      ) : null}

      {/* One virtualized scroll region for every state — pull-to-refresh still
          works while loading or empty, but a pasted month only mounts the rows
          near the viewport. */}
      <FlashList
        data={listData}
        keyExtractor={reviewItemKey}
        renderItem={renderItem}
        getItemType={(item) => item.kind}
        // The group-ledger settings: `extraData` because a chip or a fold changes
        // a row FlashList would otherwise recycle unchanged, and the draw
        // distance so a pasted month scrolls without blanking.
        extraData={listState}
        // The group ledger's number, which is the one that has actually been
        // tuned: 1500 was still being outrun by a hard fling down a long list,
        // and blank rows flashing past is the failure people report. ~2500px is
        // three dozen rows ahead, cheap when each row is light to draw.
        drawDistance={2500}
        showsVerticalScrollIndicator={false}
        onLayout={(event) => setListHeight(event.nativeEvent.layout.height)}
        contentContainerStyle={{
          paddingHorizontal: theme.spacing.xl,
          // The first card used to sit flush against the tab bar. `md`, not
          // `lg` — one more small cut in a list a phone test called loose.
          paddingTop: theme.spacing.md,
          // Room for whatever is at the foot. With nothing ticked that is the
          // navigation; with something ticked the navigation has stood down and
          // the action bar is there instead — one row of buttons now that the
          // count and "select all" have moved onto the panel, so the reserve is
          // the bar's own height and not the two-row bar's.
          paddingBottom: bottomBarStandsDown ? insets.bottom + 96 : clearance,
        }}
        refreshControl={
          <RefreshControl
            refreshing={pull.refreshing}
            onRefresh={pull.onRefresh}
            tintColor={theme.color.brand}
          />
        }
        ListHeaderComponent={
          <>
            {sortRow}
            {bankMessagesRow}
          </>
        }
        ListEmptyComponent={
          captures.isLoading ? (
            <InboxSkeleton />
          ) : otherTabCount > 0 ? (
            /* This tab is empty but the other one is not. "Nothing needs you"
               here contradicted the hero right above it, which counts both
               tabs — so the empty tab says where the waiting ones are and
               offers the way there. */
            <View
              style={{
                minHeight: Math.max(0, listHeight - clearance - theme.spacing.lg),
                justifyContent: 'center',
              }}
            >
              <EmptyState
                icon={
                  <Ionicons
                    name="file-tray-outline"
                    size={iconSize.huge}
                    color={theme.color.brand}
                  />
                }
                title={t.captures.emptyTabTitle}
                body={plural(locale, otherTabCount, t.captures.emptyTabWaiting).replace(
                  '{tab}',
                  otherTabLabel,
                )}
                action={
                  <Button
                    label={t.captures.emptyTabShow.replace('{tab}', otherTabLabel)}
                    onPress={() => {
                      setTab(otherTab);
                      setSelected(new Set());
                    }}
                  />
                }
              />
            </View>
          ) : (
            /* The zero state, designed as carefully as the full one. Review is
               trying to reach *this*: it is the app's list of questions, and a
               good week is one where it has none. So it never apologises for
               being empty — it says nothing needs you, and then says how much
               went through anyway. */
            // Centred in the space the list has, not in its own height: a
            // FlashList sizes an empty component to its content, so `flex: 1`
            // did nothing and the block sat under the header with half the
            // screen blank beneath it. The reserve at the foot is taken off so
            // it centres between the header and the navigation.
            <View
              style={{
                minHeight: Math.max(0, listHeight - clearance - theme.spacing.lg),
                justifyContent: 'center',
              }}
            >
              <EmptyState
                icon={
                  <Ionicons
                    name="checkmark-done-outline"
                    size={iconSize.huge}
                    color={theme.color.brand}
                  />
                }
                title={t.captures.nothingNeedsYou}
                body={
                  filedThisWeek > 0
                    ? plural(locale, filedThisWeek, t.captures.filedThisWeek)
                    : auto.enabled
                      ? t.captures.watchingNothingYet
                      : t.captures.emptyBody
                }
                action={
                  <View style={{ gap: theme.spacing.xs, alignItems: 'center' }}>
                    <Button label={t.captures.captureCta} onPress={() => router.push('/capture')} />
                    <Button
                      label={auto.enabled ? t.captures.addAnotherWay : t.captures.fromMessage}
                      variant="ghost"
                      onPress={() => router.push('/captures/paste')}
                    />
                  </View>
                }
              />
            </View>
          )
        }
      />

      {/* The group picker, as a sheet over the list rather than a screen away —
          assigning is one tap and one choice.

          A real Modal, not an absolute overlay: the one bottom bar (`AppTabBar`)
          is rendered at the root over the whole stack, so an in-tree overlay
          paints *under* it and the sheet's lower rows hide behind the nav bar. */}
      <Sheet
        visible={assigning !== null}
        onClose={closeAssign}
        padded={false}
        closeLabel={t.common.close}
        title={t.captures.assignTitle}
        // The sheet's own title row, not a second heading in the body: the
        // header is already the drag surface and the tap-to-close target, so
        // a title handed here rides along with both rather than sitting
        // under a plain `<Text>` that offers neither. "Edit" rides the far
        // end of that same line — on the title row, beside what it is
        // naming, rather than under the summary where it used to compete
        // with the subject's own badge and amount for a second kind of tap.
        // Only present with exactly one expense on the sheet: see
        // `editTarget`.
        titleAction={
          editTarget ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t.captures.assignEditExpenseFor.replace(
                '{item}',
                captureTitle(editTarget, t),
              )}
              onPress={editFromAssign}
              // The pill stays small; the reach it answers to does not — a
              // 44pt target sat on a compact pill rather than being grown to
              // one.
              hitSlop={{ top: 14, bottom: 14, left: 10, right: 10 }}
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                gap: 4,
                paddingHorizontal: theme.spacing.sm,
                paddingVertical: 4,
                borderRadius: theme.radius.pill,
                backgroundColor: theme.color.brandSoft,
                opacity: pressed ? 0.6 : 1,
              })}
            >
              <Ionicons name="pencil" size={iconSize.xs} color={theme.color.brand} />
              <Text variant="micro" style={{ color: theme.color.brand, fontWeight: '700' }}>
                {t.captures.assignEditExpense}
              </Text>
            </Pressable>
          ) : null
        }
        style={{
          paddingHorizontal: theme.spacing.xl,
          gap: theme.spacing.md,
          maxHeight: pickerMaxHeight,
        }}
      >
        {/* The same picker the voice review opens, so "where does this go?" is
            one control in the app rather than two that drifted apart.

            A plain ScrollView, not the FlashList this screen uses everywhere
            else: FlashList's container is `flex: 1` by construction, so it
            cannot size itself to its rows, and a fixed fraction of the window
            left a person with two groups staring at a half-screen of white. */}
        <ScrollView
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          style={{ flexShrink: 1 }}
        >
          <DestinationPicker
            // Remount per draft (or per batch), so the tab and any half-made
            // people selection start fresh on each open.
            key={
              shownAssigning
                ? shownAssigning.kind === 'capture'
                  ? shownAssigning.capture.id
                  : shownAssigning.items[0]!.id
                : 'closed'
            }
            selection={pickerSelection}
            eyebrow={null}
            // What is being placed, so the sheet stands on its own over the list
            // it hides. Handed to the picker rather than drawn here: the pinned
            // shortcut shares this row now, and only the picker knows whether
            // there is one to place.
            subject={
              assigningCapture
                ? {
                    leading: (
                      <CategoryBadge
                        category={assigningCapture.category}
                        meta={assigningCapture.category_meta}
                        description={assigningCapture.description}
                        size={38}
                      />
                    ),
                    title: (
                      <MoneyText
                        amount={BigInt(assigningCapture.amount)}
                        currency={assigningCapture.currency}
                        locale={locale}
                        variant="subheading"
                      />
                    ),
                    // The note now carries the date alongside the description
                    // — amount and description alone left the one other field
                    // the editor can fix (and the reason a merchant's date is
                    // sometimes the wrong half of a UPI string) unsaid here.
                    // The summary itself is inert: editing lives on the
                    // title row now (`titleAction` above), so the subject
                    // does not also need to answer for it.
                    note: (
                      <Text variant="caption" tone="muted" numberOfLines={1}>
                        {assigningCapture.description
                          ? `${assigningCapture.description} · ${dayHeading(locale, assigningCapture.expense_date)}`
                          : dayHeading(locale, assigningCapture.expense_date)}
                      </Text>
                    ),
                  }
                : batchPreview
                  ? {
                      leading: (
                        <View
                          style={{
                            width: 38,
                            height: 38,
                            borderRadius: 12,
                            alignItems: 'center',
                            justifyContent: 'center',
                            backgroundColor: theme.color.brandSoft,
                          }}
                        >
                          <Ionicons
                            name="layers-outline"
                            size={iconSize.md}
                            color={theme.color.brand}
                          />
                        </View>
                      ),
                      title:
                        batchPreview.total !== null ? (
                          <MoneyText
                            amount={batchPreview.total}
                            currency={batchPreview.currency}
                            locale={locale}
                            variant="subheading"
                          />
                        ) : null,
                      note: (
                        <Text variant="caption" tone="muted" numberOfLines={1}>
                          {editTarget
                            ? editTarget.description
                              ? `${editTarget.description} · ${dayHeading(locale, editTarget.expense_date)}`
                              : dayHeading(locale, editTarget.expense_date)
                            : plural(locale, batchPreview.count, t.captures.batchExpenses)}
                        </Text>
                      ),
                    }
                  : null
            }
            // "Unassigned" is not offered: a draft already *is* unassigned, so
            // the row would point at where it already sits. "Just me" is — it
            // files the draft as a private personal expense (A48), through the
            // same path the voice review uses (`usePlaceInPersonal`).
            pinned={shownAssigning?.kind === 'batch' && shownAssigning.viaBar ? [] : ['me']}
            createRow={shownAssigning?.kind === 'batch' ? null : { label: t.captures.assignNew }}
            emptyGroups={t.captures.noGroups}
            labelFor={(group) => groupLabel(group, summary.membersFor(group.id), viewerId)}
            groups={assignableGroups}
            people={peopleChoices}
            t={t}
            onChoose={(choice) => {
              // The Sheet stays mounted through its fade-out, so this can fire a
              // frame after the backdrop cleared `assigning`.
              const target = assigning;
              if (!target) return;
              if (choice.kind === 'existing') {
                chooseExistingGroup(target, choice.groupId);
              } else if (choice.kind === 'me') {
                closeAssign();
                // Only the drafts that actually landed lose their tick. The
                // personal path reports which those are for exactly this
                // reason: clearing the lot up front tells somebody six went
                // when five did, and leaves the sixth on the list with nothing
                // pointing at it. What refused stays ticked, ready to retry.
                void placeInPersonal({
                  lockKey: target.kind === 'capture' ? target.capture.id : target.items[0]!.id,
                  items: target.kind === 'capture' ? [target.capture] : target.items,
                }).then((done) =>
                  setSelected((current) => {
                    const next = new Set(current);
                    for (const id of done) next.delete(id);
                    return next;
                  }),
                );
              } else if (choice.kind === 'create' && target.kind === 'capture') {
                closeAssign();
                router.push({
                  pathname: '/new-group',
                  params: { assignCaptureId: target.capture.id },
                });
              }
            }}
            onResolvePeople={(names) => void assignToPeople(names)}
          />
        </ScrollView>
      </Sheet>

      {/* What a selection can do, in the same bar and the same words the Bank
          messages screen uses — the two screens ask the same question of the
          same kind of pile, and answering it differently in each would make a
          person learn it twice.

          Both buttons hand the ticked rows to machinery that already existed
          for a spoken batch: one destination for several drafts, everybody in,
          split equally. Nothing new decides anything here. */}
      {ticking ? (
        /* It rises rather than appearing. The bar takes the navigation's place
           the instant a row is ticked, and a panel that simply *is* there reads
           as a redraw — something went wrong and the screen repainted — where
           one that slides up from the edge reads as an answer to the tap. Out
           the same way, so the navigation coming back is a handover rather than
           a flicker. Off entirely when the phone asks for less motion — `sel`
           jumps rather than eases then.

           Mounted whenever this tab is the ticking one, shown by animating
           `sel`, rather than mounted when something is ticked and animated in
           and out by `entering`/`exiting`. The difference matters here and is
           not a matter of taste:

           This screen is a tab, and the navigator freezes a blurred tab's
           rendering (`(tabs)/_layout.tsx`). A layout animation is driven by
           mount and unmount, and going away while the bar was up ran its
           `exiting` — after which coming back did not bring it back. Two drafts
           ticked, out to the voice screen and straight back, and the bar was
           gone with the selection still live and its own buttons unreachable:
           the ticks were there, "2 selected" was there, and the only way to act
           on them was to clear the selection and tick them again.

           An always-mounted view driven by a shared value has no such state to
           lose — it is the same crossfade the panel above already uses for the
           same gesture, and the reason that one survived the same trip. */
        <Reanimated.View
          pointerEvents={selecting ? 'auto' : 'none'}
          // `pointerEvents` stops a finger and nothing else: a bar at zero
          // opacity keeps its buttons in the accessibility tree, where a screen
          // reader will happily read out "Just me" and activate it with no rows
          // ticked. Invisible on the screen and present to the reader is the
          // worst of both, so the descendants are hidden outright — one prop
          // per platform, because iOS and Android spell this differently.
          accessibilityElementsHidden={!selecting}
          importantForAccessibility={selecting ? 'auto' : 'no-hide-descendants'}
          style={[
            {
              position: 'absolute',
              left: 0,
              right: 0,
              bottom: 0,
              paddingHorizontal: theme.spacing.xl,
              paddingTop: theme.spacing.md,
              // The navigation is gone while this is up (`suppressTabBar`
              // below), so the bar clears the system's own gesture pill and
              // nothing else. Using the tab-bar clearance here would reserve
              // room for a bar that is not there and leave a band of empty
              // surface.
              paddingBottom: insets.bottom + theme.spacing.md,
              gap: theme.spacing.sm,
              backgroundColor: theme.color.surface,
              borderTopWidth: 1,
              borderTopColor: theme.color.border,
            },
            actionBarAnim,
          ]}
        >
          {/* One row, and everything in it is an *action*. The count and
              "select all" moved into the panel above, which is what the rest
              of this pattern does everywhere it is done well, and what is left
              down here is the three answers a selection can be given: take
              these off the list, keep them to myself, or put them in a group.

              They are ordered by how much they commit to — the destructive one
              first and smallest, the two placements after it, the likeliest
              last and widest, under the thumb. */}
          <Row style={{ gap: theme.spacing.sm, alignItems: 'center' }}>
            {/* Most of what the app finds is not an expense at all — a card
                bill, a transfer to yourself, rent nobody splits — and that
                answer needs to be one tap for a pile as it is for a row. It
                keeps the words in its accessibility label and in the row's own
                ⋯ sheet, and shows as a glyph here: three labelled buttons on
                one line is a truncation in Tamil and Arabic, and the glyph a
                selection is dismissed with is the one control on this bar a
                person should not be able to hit while reaching for another. */}
            <IconButton
              label={chosenRows.every(wasFound) ? t.captures.notAnExpense : t.captures.delete}
              onPress={() => {
                const items = chosenRows;
                void dismissMany(items);
              }}
            >
              {/* A bin, whichever answer this is. The ✕ that used to stand
                  here for "not an expense" read as *cancel* — the control that
                  closes a selection and leaves the drafts alone — while it
                  actually takes every ticked row off the list. Two opposite
                  meanings on one glyph, in the corner of a bar whose other
                  buttons all commit. The words still differ, on the button's
                  accessibility label and in the row's own ⋯ sheet, because
                  "not an expense" and "delete" are genuinely different things
                  to say; what they are not is different *gestures*. */}
              <Ionicons name="trash-outline" size={iconSize.lg} color={theme.color.negative} />
            </IconButton>
            {/* Only where the private ledger is a place these can go: a guest
                account may not hold one, and a button whose write would be
                refused is worse than no button. */}
            {personalOffered ? (
              <Button
                label={t.voice.justMe}
                variant="secondary"
                style={{ flex: 1 }}
                onPress={() => {
                  const items = chosenRows;
                  // The bar is mounted while this tab is open, whether or not
                  // anything is ticked, so "nothing is ticked" has to be an
                  // answer this button knows how to give. `items[0]!.id` on an
                  // empty selection is a crash, and the non-null assertion is
                  // exactly the kind that reads as safe right up until some
                  // route nobody pictured — an accessibility service, a stray
                  // tap during the fade — arrives with an empty list.
                  if (items.length === 0) return;
                  // Same rule as the sheet's own "Just me": untick what landed,
                  // leave what refused where a person can see and retry it.
                  void placeInPersonal({ lockKey: items[0]!.id, items }).then((done) =>
                    setSelected((current) => {
                      const next = new Set(current);
                      for (const id of done) next.delete(id);
                      return next;
                    }),
                  );
                }}
              />
            ) : null}
            {/* "Add to a group", not "Add 3 to a group". The count is on the
                panel now, and repeating it here cost the button its line: at
                three digits of nothing-new the label wrapped to two lines and
                took the bar's alignment with it. It is also the sheet's own
                title, so the button and the thing it opens say one sentence. */}
            <Button
              label={t.captures.assignTitle}
              style={{ flex: 1.4 }}
              onPress={() => openAssignBatch(chosenRows, true)}
            />
          </Row>
        </Reanimated.View>
      ) : null}

      {/* The row's ⋯ overflow, as a small sheet. Every gesture this screen has
          is also a plain row in here: filing it where the chip says, and taking
          it off the list. A swipe is a shortcut, never the only way through. */}
      <Sheet
        visible={menu !== null}
        onClose={closeMenu}
        onClosed={runAfterMenu}
        padded={false}
        closeLabel={t.common.close}
        style={{ paddingHorizontal: theme.spacing.xl, gap: theme.spacing.xs }}
      >
        {menuCapture ? (
          <>
            <Text variant="heading" numberOfLines={1} style={{ marginBottom: theme.spacing.xs }}>
              {menuCapture.description?.trim() ||
                (menuCapture.category
                  ? (t.categories as Record<string, string>)[menuCapture.category]
                  : undefined) ||
                t.captures.unassigned}
            </Text>
            {menuDestinationName ? (
              <>
                <ActionSheetRow
                  icon="checkmark-circle-outline"
                  label={t.captures.fileTo.replace('{name}', menuDestinationName)}
                  tone="brand"
                  onPress={() => {
                    const capture = menuCapture;
                    closeMenuThen(() => fileWhereItSays(capture));
                  }}
                />
                <Divider />
              </>
            ) : null}
            <ActionSheetRow
              icon="people-outline"
              label={t.captures.assign}
              tone={menuDestinationName ? 'default' : 'brand'}
              onPress={() => {
                const capture = menuCapture;
                closeMenuThen(() => openAssign(capture));
              }}
            />
            <Divider />
            {/* The message this row was read out of. Only when there is one to
                open: this phone can read messages, the draft names a key, and
                the store still holds that body — a message forgotten or signed
                out of would otherwise lead to a screen with nothing on it.

                It sits above "Edit" deliberately. Editing a misread draft is
                the *answer*; reading the bank's own words is how somebody works
                out what to put there. */}
            {menuMessageKey ? (
              <>
                <ActionSheetRow
                  icon="chatbubble-outline"
                  label={t.smsInbox.seeMessage}
                  onPress={() => {
                    const key = menuMessageKey;
                    closeMenuThen(() =>
                      router.push(`/captures/sms/${encodeURIComponent(key)}` as never),
                    );
                  }}
                />
                <Divider />
              </>
            ) : null}
            <ActionSheetRow
              icon="create-outline"
              label={t.captures.edit}
              onPress={() => {
                const capture = menuCapture;
                closeMenuThen(() => openEdit(capture));
              }}
            />
            <Divider />
            <ActionSheetRow
              icon={wasFound(menuCapture) ? 'close-circle-outline' : 'trash-outline'}
              label={wasFound(menuCapture) ? t.captures.notAnExpense : t.captures.delete}
              tone="negative"
              onPress={() => {
                const capture = menuCapture;
                closeMenuThen(() => void dismiss(capture));
              }}
            />
          </>
        ) : menu?.kind === 'batch' ? (
          <>
            <Text variant="heading" numberOfLines={1} style={{ marginBottom: theme.spacing.xs }}>
              {plural(locale, menu.items.length, t.captures.batchExpenses)}
            </Text>
            {/* The whole cluster into one group, in one tap — the alternative to
                expanding it and answering the same question once per row. */}
            <ActionSheetRow
              icon="people-outline"
              label={t.captures.assignBatch}
              tone="brand"
              onPress={() => {
                const items = menu.items;
                closeMenuThen(() => openAssignBatch(items));
              }}
            />
            <Divider />
            <ActionSheetRow
              icon="trash-outline"
              label={t.captures.deleteBatch}
              tone="negative"
              onPress={() => {
                const items = menu.items;
                closeMenuThen(() => void confirmDeleteBatch(items));
              }}
            />
          </>
        ) : null}
      </Sheet>

      {/* The sort pill's own sheet: three plain rows, a checkmark on
          whichever is live. Three options are a sheet rather than the
          member ledger's own two-way toggle pill — a tap cycling through
          three states is a control nobody can predict the next press of. */}
      <Sheet
        visible={sortOpen}
        onClose={() => setSortOpen(false)}
        padded={false}
        closeLabel={t.common.close}
        title={t.captures.sortTitle}
        style={{ paddingHorizontal: theme.spacing.xl, gap: theme.spacing.xs }}
      >
        {(['newest', 'oldest', 'amount'] as const).map((order) => (
          <ActionSheetRow
            key={order}
            icon={sortOrder === order ? 'checkmark-circle' : 'ellipse-outline'}
            label={sortOptionLabel(order)}
            tone={sortOrder === order ? 'brand' : 'default'}
            onPress={() => {
              setSortOrder(order);
              setSortOpen(false);
            }}
          />
        ))}
      </Sheet>

      {/* The hero's "filter" button, on a phone that reads its own
          messages: the one action search's move to Bank messages left
          without a home — "look now", which scans on the screen search
          already opens rather than duplicating a result here. */}
      {smsReader ? (
        <Sheet
          visible={heroFilterOpen}
          onClose={() => setHeroFilterOpen(false)}
          padded={false}
          closeLabel={t.common.close}
          style={{ paddingHorizontal: theme.spacing.xl, gap: theme.spacing.xs }}
        >
          <ActionSheetRow
            icon="refresh"
            label={t.smsInbox.scan}
            tone="brand"
            onPress={() => {
              setHeroFilterOpen(false);
              requestScanOnReturn();
              router.push('/captures/sms');
            }}
          />
        </Sheet>
      ) : null}
    </Screen>
  );
}
