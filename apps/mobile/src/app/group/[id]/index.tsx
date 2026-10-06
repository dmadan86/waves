import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useLocalSearchParams } from 'expo-router';
import {
  AccessibilityInfo,
  Image,
  InteractionManager,
  Pressable,
  RefreshControl,
  useWindowDimensions,
  View,
} from 'react-native';
import { FlashList, type FlashListRef } from '@shopify/flash-list';
import Svg, { Path } from 'react-native-svg';
import { StatusBar } from 'expo-status-bar';

import {
  Avatar,
  Badge,
  Button,
  Card,
  directionalIcon,
  iconSize,
  MoneyText,
  Row,
  Screen,
  SegmentedTabs,
  Text,
  useTheme,
  useTabBarClearance,
} from '@waves/ui';

import {
  memberLookup,
  useCancelSettlement,
  useGhostMergePersonIds,
  useGroup,
  useGroupLedger,
  useGroupRealtime,
  useOpenReceipts,
  useCaptures,
  usePinnedGroupIds,
  useSetGroupPin,
} from '@/data/hooks';
import { myStake } from '@/data/activity';
import { useRemoveDemo } from '@/demo/useRemoveDemo';
import { sendNudge, useNudge } from '@/lib/nudge';
import { expenseTitle } from '@/data/expenseTitle';
import { personKeyOf } from '@/data/peopleBalances';
import { GroupNotFound } from '@/components/GroupNotFound';
import { GroupSkeleton } from '@/components/Skeletons';
import {
  balanceDirection,
  copyFor,
  deadLettered,
  formatParts,
  moneyAccessibilityLabel,
  paidBy,
  type MemberId,
} from '@waves/core';
import { useBlockedUsers } from '@/data/blocked';
import {
  displayName,
  groupLabel,
  GroupType,
  isBlockedMember,
  isGhost,
  isViewer,
  payableAt,
  type ExpenseRow,
  type ExpenseVersionRow,
  type MemberRow,
} from '@/data/types';
import { fill, plural, useStrings } from '@/i18n';
import { convertedTotal } from '@/lib/expenseConversion';
import { useViewerId } from '@/lib/auth';
import { canRemindFromBalanceRow } from '@/lib/balanceRowActions';
import { router } from '@/lib/navigation';
import { SPEC_ACCENT, SPEC_INK, SPEC_MUTED } from '@/lib/specPalette';

import { CategoryBadge } from '@/components/Category';
import { OverflowMenu, type OverflowMenuItem } from '@/components/OverflowMenu';
import { ExpenseFilterBar, type ExpenseScope } from '@/components/ExpenseFilterBar';
import { GroupDrafts } from '@/components/GroupDrafts';
import { GroupHero } from '@/components/GroupHero';
import { PendingMark } from '@/components/PendingMark';
import { SettlementProof } from '@/components/SettlementProof';
import { SyncBanner } from '@/components/SyncBanner';
import { useSync } from '@/sync';
import { usePullRefresh } from '@/lib/pullRefresh';
import { SettleBody } from '@/components/settle/SettleBody';
import { VendorsBody } from '@/components/VendorsBody';
import { todayInZone } from '@/lib/eventDetailFacts';
import { TimelineBody } from '@/components/timeline/TimelineBody';
import { draftsForGroup } from '@/lib/groupDrafts';
import { useDialog } from '@/lib/dialog';

enum Tab {
  Expenses = 'expenses',
  Balances = 'balances',
  Settle = 'settle',
  Timeline = 'timeline',
  Map = 'map',
  /** Event groups only: vendor advances and balances (docs/event-organizer.md). */
  Vendors = 'vendors',
}

/**
 * How many rows a freshly-chosen tab paints before it grows to its real length.
 *
 * Comfortably more than a screenful on the tallest phone, so the window is never
 * something anybody can scroll to the end of in the frame it exists for.
 */
/**
 * The trip plan screen is not offered for now.
 *
 * Both of its doors live on this screen — the ⋯ menu's "Plan" row and the
 * trip welcome card's "Set budget" — so one flag closes them together, and
 * opening them again is deleting this line and the two `PLAN_HIDDEN` reads.
 * The route itself is untouched: `/group/[id]/plan` still resolves, so a deep
 * link or a back stack already holding it is not broken, it is simply not
 * advertised.
 *
 * Worth knowing while it is hidden: that screen is the only place a trip
 * budget can be set or read after the group is made (the create screen offers
 * one up front, and group settings has no budget control), so hiding it hides
 * the budget too.
 */
const PLAN_HIDDEN = true;

const SWITCH_WINDOW = 24;

/**
 * The nudge on a balances row, for somebody who owes this group money.
 *
 * The same one-a-day server rule the Friends tab leans on (ADR-010), and the
 * same manner: once tapped it stops offering, and a rate limit reads as "already
 * nudged today" rather than as an error. Nobody should be told off for asking.
 */
function RemindChip({
  groupId,
  memberId,
  currency,
}: {
  groupId: string;
  memberId: MemberId;
  currency: string;
}) {
  const { t } = useStrings();
  const nudge = useNudge({ groupId, memberId, currency });
  const note = nudge.outcome?.label ?? null;

  if (note) {
    return (
      <Text variant="micro" tone="muted">
        {note}
      </Text>
    );
  }

  return (
    <Pressable
      onPress={nudge.send}
      disabled={nudge.pending}
      accessibilityRole="button"
      accessibilityLabel={t.people.remind}
      hitSlop={10}
      style={({ pressed }) => ({ opacity: pressed || nudge.pending ? 0.6 : 1 })}
    >
      <Badge label={t.people.remind} tone="brand" />
    </Pressable>
  );
}

/**
 * One section of the expense feed: the expenses that fall in a single calendar
 * month, kept in the order they already arrive in. `date` is a specimen date
 * from the section, `null` for the bucket of rows with no version yet (nothing
 * to date). A month heading is what turns a long ledger from a wall of rows into
 * something you can skim — the pattern every bill-splitting app in the category
 * (Splitwise, Settle Up, Tricount) leans on.
 */
interface ExpenseSection<T> {
  readonly key: string;
  readonly date: string | null;
  readonly rows: readonly T[];
}

/**
 * Cluster the feed into month sections without reordering within a month. The
 * list arrives newest-added first; we bucket by the month of each expense's
 * date so all of November sits together under one heading, in first-seen order,
 * rather than repeating the heading every time the created-order interleaves two
 * months. Undated rows (no current version) fall into their own leading bucket.
 */
function groupExpensesByMonth<T extends { currentVersion: ExpenseVersionRow | null }>(
  items: readonly T[],
): ExpenseSection<T>[] {
  const order: string[] = [];
  const buckets = new Map<string, T[]>();
  for (const item of items) {
    const date = item.currentVersion?.expense_date ?? null;
    // "YYYY-MM" groups a calendar month; "~" is the sortless bucket for the rare
    // undated row, kept out of the way at its natural position.
    const key = date ? date.slice(0, 7) : '~';
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = [];
      buckets.set(key, bucket);
      order.push(key);
    }
    bucket.push(item);
  }
  return order.map((key) => {
    const rows = buckets.get(key)!;
    return { key, date: rows[0]?.currentVersion?.expense_date ?? null, rows };
  });
}

/**
 * A month heading — "November", or "November 2024" once the year is not this
 * one. The date is a plain calendar date (no zone), so it is read in UTC to
 * match the day the rest of the feed prints beside each expense.
 *
 * The two `Intl.DateTimeFormat`s are built once per locale by the screen and
 * handed in — constructing a formatter is expensive, and doing it inside the
 * heading (which the virtualized feed re-runs as it recycles) was the same
 * per-render allocation the expense rows had.
 */
function monthLabel(
  fmtSameYear: Intl.DateTimeFormat,
  fmtWithYear: Intl.DateTimeFormat,
  isoDate: string,
  now: number = Date.now(),
): string {
  const parsed = Date.parse(isoDate);
  if (!Number.isFinite(parsed)) return isoDate;
  const when = new Date(parsed);
  const sameYear = when.getUTCFullYear() === new Date(now).getUTCFullYear();
  return (sameYear ? fmtSameYear : fmtWithYear).format(when);
}

/** The first of a "YYYY-MM" month, as a Date the UTC-pinned month formatters read. */
function monthDate(key: string): Date {
  return new Date(`${key}-01T00:00:00Z`);
}

/**
 * One row of the virtualized expense feed. The feed used to render every expense
 * a group ever had at once inside a ScrollView; on a long-lived group that mounts
 * hundreds of rows on open. Flattening the month sections into a single typed list
 * lets FlashList recycle rows so only what is on screen is mounted — a `month`
 * item is the section heading, an `expense` item is one bill.
 */
type FeedItem =
  | { readonly kind: 'month'; readonly key: string; readonly date: string }
  | {
      readonly kind: 'expense';
      readonly key: string;
      readonly expense: ExpenseRow;
      readonly isFirst: boolean;
      readonly isLast: boolean;
    }
  | {
      readonly kind: 'balance';
      readonly key: string;
      readonly member: MemberRow;
      readonly balance: bigint;
      readonly isFirst: boolean;
      readonly isLast: boolean;
    };

/**
 * One expense row of the virtualized feed, memoized so a recycled row that lands
 * on the same expense does no work when the parent re-renders. Every prop is a
 * primitive or a reference the screen keeps stable across renders — `theme` and
 * `t` are memoized/static, `nameOf` is a `useCallback`, and `dateFmt` is built
 * once per locale — so the shallow `memo` compare holds and the fast fling never
 * has to re-run a row it already drew.
 *
 * `myMemberId` is lifted to a prop (not read from the ledger inside) precisely
 * so this stays a pure function of stable inputs.
 * The date is formatted with the hoisted `dateFmt`, not a fresh
 * `Intl.DateTimeFormat` per render, which was what made `renderItem` too slow to
 * keep up with recycling and left blank cells on a hard fling.
 */
const ExpenseFeedRow = memo(function ExpenseFeedRow({
  expense,
  isFirst,
  isLast,
  myMemberId,
  groupId,
  groupCurrency,
  locale,
  dateFmt,
  t,
  theme,
  nameOf,
}: {
  expense: ExpenseRow;
  isFirst: boolean;
  isLast: boolean;
  myMemberId: MemberId | null;
  groupId: string;
  /** What this group counts in, so a foreign bill can say what it came to. */
  groupCurrency: string;
  locale: string;
  dateFmt: Intl.DateTimeFormat;
  t: ReturnType<typeof useStrings>['t'];
  theme: ReturnType<typeof useTheme>;
  nameOf: (memberId: string | null) => string;
}) {
  const version = expense.currentVersion;
  // An imported Splitwise expense can have several payers, so
  // "Asha paid ₹1,200" beside the expense total would put the
  // whole bill on whoever happens to sort first. One payer is
  // named and credited with what they actually put in; several
  // are counted, and the number beside them is the total they
  // put in between them. The rule is `paidBy`, shared with the
  // month drill-down so the two cannot disagree.
  const paid = paidBy(version?.payers ?? []);
  const paidLine =
    version === null
      ? fill(t.expense.paidByName, { name: nameOf(null) })
      : fill(t.expense.paidByNameAmount, {
          name:
            paid.kind === 'several'
              ? plural(locale, paid.count, t.misc.peopleCount)
              : nameOf(paid.memberId),
          amount: formatParts(
            // A payerless version still shows the bill's own total rather
            // than a zero nobody recorded.
            {
              minor: paid.amount > 0n ? paid.amount : BigInt(version.amount),
              currency: version.currency,
            },
            { locale },
          ).text,
        });
  // What a foreign bill came to in the group's own money, beside what was
  // actually handed over. Only ever from the rate stored on this expense, so
  // the row cannot show a figure the balance disagrees with — see
  // `convertedTotal`. Null for an expense already in the group's currency, and
  // for a foreign one nobody has given a rate yet.
  const converted = version ? convertedTotal(version, groupCurrency) : null;
  const paidLineWithRate = converted
    ? `${paidLine} (${formatParts(converted, { locale }).text})`
    : paidLine;
  // What this one expense did to *your* balance: what you put in
  // beyond your share (you lent), or your share of what somebody
  // else put in (you borrowed). The row used to end in the
  // expense total, which is the group's number and never the
  // answer to the question somebody opens a ledger with. The
  // total keeps its place in the subtitle.
  const stake = myStake(version, myMemberId);
  // Flat row: the category is the badge on the left, not the row's
  // colour. A deleted row is dimmed rather than hidden, so the
  // ledger stays visibly append-only.
  const title = expenseTitle(version?.description, version?.category, t, version?.category_meta);
  // The direction of your stake, said in words. It rides under the amount on the
  // right and doubles as the label the muted date pairs with — "you lent · 19
  // Mar" — so the row's meaning is the sign on the amount, not the row's colour.
  const directionLabel =
    stake === null
      ? t.expense.notInvolved
      : stake > 0n
        ? t.expense.youLent
        : stake < 0n
          ? t.expense.youBorrowed
          : t.allSettled;
  // The day-and-month stamp lives in the fixed right column now, not on the
  // muted subtitle under the title. That is what guarantees it survives a long
  // payer name: the name ellipsizes in the flexible middle, the date rides the
  // column that never shrinks.
  const dateStamp = version ? dateFmt.format(new Date(version.expense_date)) : null;
  // The right column's date-line: the direction and the date, joined the way the
  // subtitle joins its parts. Undated rows (no version) show the label alone.
  const rightMeta = [directionLabel, dateStamp].filter(Boolean).join(' · ');
  // The whole row is one button to a screen reader, so the money a sighted user
  // reads on the right has to ride the row's label — otherwise it announces the
  // title alone and never the amount. The magnitude (the direction is already in
  // words), the direction and the date, comma-joined so it reads as a list, not
  // "dot". Everything from the right column is gated on `version`, so a row with
  // nothing priced on the right announces nothing extra either.
  const amountA11y =
    version && stake !== null && stake !== 0n
      ? formatParts({ minor: stake < 0n ? -stake : stake, currency: version.currency }, { locale })
          .text
      : null;
  const rowLabel = [title, version ? directionLabel : null, amountA11y, dateStamp]
    .filter(Boolean)
    .join(', ');
  // The amount's colour: blue when you lent, the negative red when you borrowed
  // (the sign is also said in words under it, so colour is never the only cue).
  const stakeColor =
    stake === null || stake === 0n
      ? theme.color.textMuted
      : stake > 0n
        ? theme.scheme === 'dark'
          ? '#7AA2FF'
          : '#2563EB'
        : theme.color.negative;
  return (
    <CardRow isFirst={isFirst} isLast={isLast} theme={theme}>
      <Row style={{ alignItems: 'center' }}>
        <Pressable
          onPress={() => router.push(`/group/${groupId}/expense/${expense.id}`)}
          accessibilityRole="button"
          accessibilityLabel={rowLabel}
          style={({ pressed }) => ({
            flex: 1,
            minWidth: 0,
            opacity: pressed ? 0.6 : expense.deleted_at ? 0.55 : 1,
          })}
        >
          <Row
            style={{
              gap: theme.spacing.md,
              alignItems: 'center',
              paddingVertical: ROW_PAD,
              paddingStart: theme.spacing.md,
            }}
          >
            <CategoryBadge
              category={version?.category}
              meta={version?.category_meta}
              description={version?.description}
              size={36}
            />
            {/* MIDDLE — the one zone that yields. `minWidth: 0` lets a long title
                or payer name ellipsize here rather than shoving the amount and
                date off the row. */}
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text numberOfLines={1} style={{ fontSize: 15, lineHeight: 20, fontWeight: '700' }}>
                {title}
              </Text>
              <Text variant="caption" tone="muted" numberOfLines={1} style={{ fontSize: 12 }}>
                {[
                  paidLineWithRate,
                  expense.deleted_at ? t.expense.deleted : null,
                  (version?.version_no ?? 1) > 1
                    ? plural(locale, version!.version_no - 1, t.expense.editedTimes)
                    : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </Text>
            </View>
            {/* RIGHT — fixed and right-aligned, the money column: the amount is
                the hero and never squeezed by a long name; only the middle gives.
                `maxWidth` is a safety valve for a pathological amount. */}
            {version ? (
              <View style={{ flexShrink: 0, maxWidth: '50%', alignItems: 'flex-end' }}>
                <Row style={{ gap: theme.spacing.xs, alignItems: 'center' }}>
                  {stake !== null && stake !== 0n ? (
                    <MoneyText
                      amount={stake}
                      currency={version.currency}
                      locale={locale}
                      mode="balance"
                      numberOfLines={1}
                      variant="subheading"
                      style={{ fontSize: 15, lineHeight: 20, fontWeight: '700', color: stakeColor }}
                    />
                  ) : null}
                  {expense.pending ? <PendingMark /> : null}
                </Row>
                <Text variant="micro" tone="muted" numberOfLines={1} style={{ fontSize: 11 }}>
                  {rightMeta}
                </Text>
              </View>
            ) : null}
          </Row>
        </Pressable>
        {/* Tapping the row opens it; the pencil goes straight to editing. A
            deleted expense has nothing to edit, so it keeps the space empty. */}
        {expense.deleted_at ? (
          <View style={{ width: iconSize.md + theme.spacing.sm + theme.spacing.md }} />
        ) : (
          <Pressable
            onPress={() => router.push(`/group/${groupId}/add-expense?expenseId=${expense.id}`)}
            accessibilityRole="button"
            accessibilityLabel={t.common.edit}
            hitSlop={{ top: 8, bottom: 8 }}
            // The right inset matches the badge's left one, so the row reads even.
            style={({ pressed }) => ({
              paddingStart: theme.spacing.sm,
              paddingEnd: theme.spacing.md,
              alignSelf: 'stretch',
              alignItems: 'center',
              justifyContent: 'center',
              opacity: pressed ? 0.5 : 1,
            })}
          >
            <Ionicons name="pencil" size={14} color={theme.color.brand} style={{ opacity: 0.5 }} />
          </Pressable>
        )}
      </Row>
    </CardRow>
  );
});

/** Vertical padding of a ledger row; with the 36dp badge it makes a ~56dp row. */
const ROW_PAD = 10;

/**
 * One row of a "card" the flat feed draws: FlashList cannot wrap a run of rows
 * in a container, so each row paints its own slice of the card — side borders
 * throughout, the top edge and corners on the first, the bottom on the last, a
 * hairline between neighbours.
 */
function CardRow({
  isFirst,
  isLast,
  theme,
  children,
}: {
  isFirst: boolean;
  isLast: boolean;
  theme: ReturnType<typeof useTheme>;
  children: React.ReactNode;
}) {
  const radius = theme.radius.lg;
  return (
    <View
      style={{
        backgroundColor: theme.color.surface,
        borderColor: theme.color.border,
        borderLeftWidth: 1,
        borderRightWidth: 1,
        borderTopWidth: isFirst ? 1 : 0,
        borderBottomWidth: 1,
        borderTopLeftRadius: isFirst ? radius : 0,
        borderTopRightRadius: isFirst ? radius : 0,
        borderBottomLeftRadius: isLast ? radius : 0,
        borderBottomRightRadius: isLast ? radius : 0,
        // The last row's bottom edge closes the card; the others' is the divider.
        borderBottomColor: theme.color.border,
        overflow: 'hidden',
      }}
    >
      {children}
    </View>
  );
}

export default function GroupScreen() {
  const theme = useTheme();
  // The root bar is over this screen, so the room starts from the bar's own
  // clearance rather than the bare system inset. The extra 36 has no cause
  // anywhere in this file — there is no floating action and no pinned footer
  // asking for it — it is simply what the hardcoded 112 this replaces comes to
  // once the bar (60) and its breath (16) are taken out, kept so the ledger
  // renders exactly as it did. Derived rather than hardcoded so it follows
  // `BAR_HEIGHT` instead of quietly sliding under a taller bar one day.
  const tabBarClearance = useTabBarClearance();
  const clearance = tabBarClearance + 36;
  const pull = usePullRefresh();
  const { t, locale } = useStrings();
  const { confirm } = useDialog();
  // `?welcome=trip` is set once, by the create screen, when a trip is made
  // without dates — it opens this group with a one-time plan-your-trip nudge.
  // The param is gone on any later visit, so the nudge is a moment, not a nag.
  const {
    id,
    welcome,
    tab: tabParam,
    vendorFilter,
  } = useLocalSearchParams<{
    id: string;
    welcome?: string;
    /** 'vendors' opens the Vendors tab (Plan's "View all"). */
    tab?: string;
    vendorFilter?: string;
  }>();
  const groupId = id ?? '';
  // Identity for "which member am I", from the session rather than the profile:
  // the session is on the device at launch, the profile is a fetch that lands
  // later, and in the gap `profile?.id` is undefined — which `isViewer` refuses
  // to match, but only if it is given the right thing to compare. See
  // `lib/auth.useViewerId`.
  const viewerId = useViewerId();
  const [tab, setTab] = useState<Tab>(tabParam === 'vendors' ? Tab.Vendors : Tab.Expenses);
  const [menuOpen, setMenuOpen] = useState(false);
  // The Expenses tab's filters: who paid, which month, and a text search.
  const [scope, setScope] = useState<ExpenseScope>('all');
  const [monthKey, setMonthKey] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  // The expense whose ⋮ menu is open, if any.
  const [monthMenuOpen, setMonthMenuOpen] = useState(false);
  const [scopeMenuOpen, setScopeMenuOpen] = useState(false);
  const [tripNudgeDismissed, setTripNudgeDismissed] = useState(false);

  // Live updates from the other devices in this group (TDR §1).
  useGroupRealtime(groupId);
  // The refused-change state still needs somewhere to act (retry / discard), so
  // the header glyph is paired with the one banner that carries buttons; the
  // ambient offline / syncing states are the header glyph's job now (below).
  const { queue, rejected } = useSync();

  const { group, members, expenses, settlements } = useGroup(groupId);
  const ledger = useGroupLedger(groupId, viewerId);
  // Pin/Unpin lives in this screen's own ••• menu — the discoverable path; a
  // long-press on the group's row (dashboard or All groups) is the fast one.
  const pinnedIds = usePinnedGroupIds();
  const isPinned = pinnedIds.has(groupId);
  const setGroupPin = useSetGroupPin();
  const removeDemo = useRemoveDemo();
  const openReceipts = useOpenReceipts(groupId);
  const cancelSettlement = useCancelSettlement(groupId);

  const { blockedIds } = useBlockedUsers();
  const lookup = useMemo(() => memberLookup(members.data), [members.data]);
  const nameOf = useCallback(
    (memberId: string | null): string => {
      const member = memberId ? lookup.get(memberId) : undefined;
      return member ? displayName(member, viewerId, blockedIds, t.misc.someone) : t.misc.someone;
    },
    [blockedIds, lookup, viewerId, t.misc.someone],
  );

  // Where a Balances row goes when it is tapped: that person, un-collapsed
  // across every group you share with them.
  //
  // The key has to be spelled the way the database spells it — `personKeyOf` is
  // the same COALESCE(profile_id, merge person_id, member_id) the
  // `waves_person_group_balances` view keys on — because a second, client-side
  // guess at who somebody is would point the screen at a stranger's ledger. A
  // ghost the viewer has merged folds through their merge, exactly as the
  // Friends list folds them, so the same tap lands on the same person from
  // either screen.
  //
  // Null means the row is a dead end, and a dead end must not look tappable:
  //   * yourself — there is no such thing as the groups you share with yourself;
  //   * a member who exists only in the local queue, whose id the server has
  //     never seen, and for whom the view would honestly answer "nothing" —
  //     which reads as "you are square", the wrong thing to say about somebody
  //     who has not been saved yet.
  // A blocked person is *not* a dead end: Friends opens them too, with their
  // name masked all the way through, and this passes the masked name along.
  const mergePersonIds = useGhostMergePersonIds();
  const personKeyFor = useCallback(
    (member: MemberRow): string | null => {
      // Both readings of "me", because `myMemberId` is derived from the members
      // and is null for the frame before they land — long enough for your own
      // row to be drawn as a doorway into yourself.
      if (member.id === ledger.myMemberId) return null;
      if (isViewer(member, viewerId)) return null;
      if (member.pending) return null;
      return personKeyOf({
        profileId: member.profile_id,
        mergePersonId: mergePersonIds.get(member.id) ?? null,
        memberId: member.id,
      });
    },
    [ledger.myMemberId, mergePersonIds, viewerId],
  );

  // Date formatters built once per locale, not per row. Constructing an
  // `Intl.DateTimeFormat` is expensive; doing it inside the row renderer meant a
  // fast fling re-allocated a formatter for every recycled cell, slowing
  // `renderItem` enough to outrun recycling and flash blanks. `dateFmt` is the
  // day-and-month stamp on each expense; the two month formatters feed the
  // section headings (same output as before — long month, year only off-year).
  const dateFmt = useMemo(
    () => new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', timeZone: 'UTC' }),
    [locale],
  );
  const monthFmtShort = useMemo(
    () => new Intl.DateTimeFormat(locale, { month: 'short', year: 'numeric', timeZone: 'UTC' }),
    [locale],
  );
  const monthFmtWithYear = useMemo(
    () => new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' }),
    [locale],
  );

  // The feed, memoized so a re-render that leaves the ledger untouched does not
  // re-filter and re-section every expense. Hoisted above the loading/error
  // guards below so these hooks run in the same order on every render.
  // A deleted expense leaves the feed. It is not gone — the ledger is
  // append-only and the Activity tab still says who removed what — but the
  // feed is what the group owes today, and a "Show deleted" switch above it
  // was one more control for a question almost nobody asks.
  const visibleExpenses = useMemo(
    () => expenses.rows.filter((expense) => !expense.deleted_at),
    [expenses.rows],
  );
  // The months the ledger spans, newest first — what the month pill offers.
  const monthKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const expense of visibleExpenses) {
      const date = expense.currentVersion?.expense_date;
      if (date) keys.add(date.slice(0, 7));
    }
    return [...keys].sort().reverse();
  }, [visibleExpenses]);
  // A month that no longer has any expense (deleted, or a different group) must
  // not leave the feed empty behind a pill that cannot be seen to clear.
  const activeMonth = monthKey && monthKeys.includes(monthKey) ? monthKey : null;
  const myId = ledger.myMemberId;
  const filteredExpenses = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (scope === 'all' && !activeMonth && !needle) return visibleExpenses;
    return visibleExpenses.filter((expense) => {
      const version = expense.currentVersion;
      if (activeMonth && version?.expense_date.slice(0, 7) !== activeMonth) return false;
      if (scope !== 'all') {
        // "Mine" is what you paid for; "Others" is what somebody else paid.
        const iPaid = myId !== null && (version?.payers ?? []).some((p) => p.member_id === myId);
        if ((scope === 'mine') !== iPaid) return false;
      }
      if (needle) {
        const title = expenseTitle(
          version?.description,
          version?.category,
          t,
          version?.category_meta,
        );
        if (!`${title} ${version?.description ?? ''}`.toLowerCase().includes(needle)) return false;
      }
      return true;
    });
  }, [visibleExpenses, scope, activeMonth, query, myId, t]);
  const filtersActive = scope !== 'all' || activeMonth !== null || query.trim() !== '';
  const expenseSections = useMemo(() => groupExpensesByMonth(filteredExpenses), [filteredExpenses]);
  // The month sections flattened into one recyclable list: a heading item per
  // month, then its expense rows. FlashList mounts only what is on screen, so a
  // group with a thousand bills opens as fast as one with ten.
  const feedItems: FeedItem[] = useMemo(() => {
    const items: FeedItem[] = [];
    for (const section of expenseSections) {
      if (section.date) {
        items.push({ kind: 'month', key: `month-${section.key}`, date: section.date });
      }
      section.rows.forEach((expense, index) =>
        items.push({
          kind: 'expense',
          key: expense.id,
          expense,
          isFirst: index === 0,
          isLast: index === section.rows.length - 1,
        }),
      );
    }
    return items;
  }, [expenseSections]);
  // The Balances and Activity tabs ride the same virtualized list as Expenses,
  // one FeedItem per row, so switching to them renders only the handful of rows
  // on screen — not every member and every activity entry at once, which is what
  // made the tab switch stall (they were mapped in full inside the list footer).
  const balanceItems: FeedItem[] = useMemo(
    () =>
      (members.data ?? []).map((member, index, arr) => ({
        kind: 'balance',
        key: `balance-${member.id}`,
        member,
        balance: ledger.balances.get(member.id) ?? 0n,
        isFirst: index === 0,
        isLast: index === arr.length - 1,
      })),
    [members.data, ledger.balances],
  );
  // The rows the list shows for the current tab. One source for `data`, so the
  // three tabs are the same list with different contents rather than a list plus
  // two hand-rolled footers.
  const tabData: FeedItem[] = tab === Tab.Balances ? balanceItems : feedItems;

  // The tab switch must not cost what the whole tab costs.
  //
  // Each tab's rows are memoised, so switching does not rebuild them — but
  // handing FlashList a different `data` makes it lay the new set out, and that
  // walk is per item. On a group with a thousand bills or a long activity trail
  // the whole walk landed between the tap and the first frame, which is the
  // pause somebody feels.
  //
  // So a freshly-chosen tab paints a screenful first and grows to its real
  // length on the next tick. `expandedTab` is the tab that has already grown:
  // choosing another one makes it stale, which is what re-arms the window with
  // no reset to write. `runAfterInteractions` is what makes the growth a *tick*
  // and not a stutter — it waits for the tap's own work to finish, so the first
  // frame never competes with it.
  const [expandedTab, setExpandedTab] = useState<Tab | null>(null);
  // The list is put back to the top on a tab change, before its data swaps. The
  // three tabs are wildly different lengths, and FlashList keeps its offset — so
  // switching from halfway down a long ledger landed on the end of a short
  // activity trail, or, now that a fresh tab paints a window first, on nothing
  // at all until the rest arrived.
  const listRef = useRef<FlashListRef<FeedItem>>(null);
  const windowed = expandedTab !== tab;
  useEffect(() => {
    if (expandedTab === tab) return undefined;
    const task = InteractionManager.runAfterInteractions(() => setExpandedTab(tab));
    return () => task.cancel();
  }, [tab, expandedTab]);
  // Drafts (A34) are owned by the person, not the group, so they come from the
  // captures read rather than the ledger — filtered here to the ones addressed
  // to this group.
  const captures = useCaptures();
  const groupDrafts = useMemo(
    () => draftsForGroup(captures.data, groupId),
    [captures.data, groupId],
  );

  const listData: FeedItem[] = useMemo(
    () => (windowed && tabData.length > SWITCH_WINDOW ? tabData.slice(0, SWITCH_WINDOW) : tabData),
    [windowed, tabData],
  );
  // The Expenses tab with nothing on it: the empty state fits the screen, so
  // Android draws no overscroll glow over it. It still scrolls when drafts, receipts or large text push
  // the content past the screen, so nothing below is out of reach.
  const emptyExpenses = tab === Tab.Expenses && listData.length === 0;

  if (group.isLoading) {
    return <GroupSkeleton />;
  }

  if (group.isError || !group.data) {
    return <GroupNotFound groupId={groupId} />;
  }

  const groupData = group.data;
  const isEvent = groupData.type === GroupType.Event;
  // The Vendors tab is Event-only; a stale selection on a group that is not one
  // falls back to Expenses rather than an empty body.
  const activeTab = tab === Tab.Vendors && !isEvent ? Tab.Expenses : tab;
  const currency = groupData.default_currency;
  // The hero panel wears its verdict, the same rule the dashboard hero follows:
  // a blue wash when the group owes you, a red one when you owe it, the brand
  // indigo when all is settled. Every stop is dark enough to hold the white
  // balance and its labels; the sign lives in the words, not just the hue.
  const heroGradient =
    ledger.myBalance > 0n
      ? theme.gradient.positive
      : ledger.myBalance < 0n
        ? theme.gradient.negative
        : theme.gradient.brand;
  // The two sync states that still earn an inline card, because both need a
  // decision the header glyph cannot offer: a change the server refused, and a
  // change that has stopped retrying (which also blocks everything queued
  // behind it in this group — see `deadLettered` / `nextBatch` in @waves/core).
  const stalledHere =
    rejected.some((item) => item.groupId === groupId) ||
    deadLettered(queue.filter((item) => item.groupId === groupId)).length > 0;
  const pendingForMe = (settlements.data ?? []).filter(
    (settlement) =>
      settlement.status === 'initiated' && settlement.to_member_id === ledger.myMemberId,
  );
  // The other side of the same coin: settlements I said I made that the payee
  // has not yet confirmed. These earn their own card so the payer has somewhere
  // to attach a payment proof — and simply to be told their claim is in flight,
  // which the app never acknowledged before.
  const pendingByMe = (settlements.data ?? []).filter(
    (settlement) =>
      settlement.status === 'initiated' && settlement.from_member_id === ledger.myMemberId,
  );

  // The overflow: the same three-dot dropdown the dashboard uses, not a bottom
  // sheet, so the two headers behave alike. Planner only appears where there is
  // a trip to plan; a flatshare has no use for the row.
  // The one-time trip nudge: a trip opened straight from create, with no dates
  // on it yet, until it is dismissed. Dates being the tell — a dated trip was
  // already planned at create, and a nudge would be noise.
  const showTripNudge =
    welcome === 'trip' && groupData.type === 'trip' && !groupData.start_date && !tripNudgeDismissed;

  // Whether the list header has any card in it — it keeps its section gap
  // below only when it does, so an empty header adds nothing under the tabs.
  const hasHeaderCards =
    groupData.isDemo === true ||
    stalledHere ||
    groupDrafts.length > 0 ||
    showTripNudge ||
    (openReceipts.data?.length ?? 0) > 0 ||
    pendingByMe.length > 0;

  const menuItems: OverflowMenuItem[] = [
    // Pinning has one effect — it sorts this group to the top of the
    // dashboard and All-groups lists — so it belongs beside the other ways
    // of changing how the group behaves, not the ones that navigate away.
    // Label carries which it will do rather than a static "Pin", so a
    // screen reader (which reads the button text as the label here, same
    // as every other row) hears the same "Pin Goa trip" the row's own
    // long-press action does.
    {
      icon: isPinned ? 'pin' : 'pin-outline',
      label: `${isPinned ? t.group.unpin : t.group.pin} ${groupLabel(groupData, members.data, viewerId)}`,
      onPress: () => setGroupPin.mutate({ groupId, pinned: !isPinned }),
    },
    // The hero's QR used to open this; the hero's corner is Activity now.
    { icon: 'qr-code-outline', label: t.people.inviteTitle, route: `/group/${groupId}/invite` },
    { icon: 'pie-chart-outline', label: t.spending, route: `/group/${groupId}/insights` },
    ...(!PLAN_HIDDEN && groupData.type === 'trip'
      ? [
          {
            icon: 'map-outline',
            label: t.plan,
            route: `/group/${groupId}/plan`,
          } as OverflowMenuItem,
        ]
      : []),
    { icon: 'download-outline', label: t.groupExport.menu, route: `/group/${groupId}/export` },
    { icon: 'settings-outline', label: t.group.settings, route: `/group/${groupId}/settings` },
    // The demo's own way out, reachable from the same menu as everything
    // else about the group — not only from the banner, which a person may
    // have already scrolled past.
    ...(groupData.isDemo
      ? [
          {
            icon: 'flask-outline',
            label: t.demo.removeAction,
            onPress: () =>
              void removeDemo().then((removed) => {
                if (removed) router.replace('/');
              }),
            tone: 'danger',
          } as OverflowMenuItem,
        ]
      : []),
  ];

  // The month pill's choices: every month the ledger spans, or all of them.
  const scopeItems: OverflowMenuItem[] = (
    [
      ['all', t.group.filterAll],
      ['mine', t.group.filterMine],
      ['others', t.group.filterOthers],
    ] as const
  ).map(([key, label]) => ({
    icon: scope === key ? 'checkmark' : 'ellipse-outline',
    label,
    onPress: () => setScope(key),
  }));
  const monthItems: OverflowMenuItem[] = [
    {
      icon: activeMonth === null ? 'checkmark' : 'calendar-outline',
      label: t.group.allMonths,
      onPress: () => setMonthKey(null),
    },
    ...monthKeys.map((key): OverflowMenuItem => ({
      icon: key === activeMonth ? 'checkmark' : 'calendar-outline',
      label: monthFmtWithYear.format(monthDate(key)),
      onPress: () => setMonthKey(key),
    })),
  ];

  // A month heading or an expense row. Headings carry the between-section gap the
  // ScrollView used to give for free; the first item needs none, its space comes
  // from the header block above it. The row itself is a memoized component fed
  // only stable props, so a recycled cell that lands on the same expense does no
  // work — the allocation and re-render both moved out of the hot fling path.
  const renderFeedItem = ({ item, index }: { item: FeedItem; index: number }) => {
    if (item.kind === 'month') {
      return (
        <Text
          variant="micro"
          tone="muted"
          style={{
            marginTop: index === 0 ? 0 : theme.spacing.lg,
            marginBottom: theme.spacing.xs,
            textTransform: 'uppercase',
            letterSpacing: 0.6,
            fontWeight: '600',
          }}
        >
          {monthLabel(monthFmtWithYear, monthFmtWithYear, item.date)}
        </Text>
      );
    }
    if (item.kind === 'expense') {
      return (
        <ExpenseFeedRow
          expense={item.expense}
          isFirst={item.isFirst}
          isLast={item.isLast}
          myMemberId={ledger.myMemberId}
          groupId={groupId}
          groupCurrency={currency}
          locale={locale}
          dateFmt={dateFmt}
          t={t}
          theme={theme}
          nameOf={nameOf}
        />
      );
    }
    if (item.kind === 'balance') {
      const { member, balance, isFirst, isLast } = item;
      // The name the row is allowed to say — already masked for a blocked
      // person, and it travels with the tap so the destination opens under the
      // same mask rather than flashing the real name while it loads.
      const shownName = displayName(member, viewerId, blockedIds, t.misc.someone);
      const personKey = personKeyFor(member);
      const canRemind = canRemindFromBalanceRow({
        balance,
        isGhost: isGhost(member),
        memberId: member.id,
        myMemberId: ledger.myMemberId,
      });
      // What a screen reader hears once the row is one button: who, then the
      // amount in the words `MoneyText` would have spoken on its own, then —
      // for a guest — that they have not joined. Making the row accessible
      // groups its text, so anything worth hearing has to be said here.
      const rowLabel = [
        shownName,
        moneyAccessibilityLabel(
          { minor: balance, currency },
          balanceDirection(balance),
          copyFor(locale).money,
          { locale },
        ),
        isGhost(member) ? t.notJoinedYet : '',
      ]
        .filter(Boolean)
        .join('. ');
      // Flat row: the money meaning is the sign on the amount and its
      // "you are owed / you owe" label, not the row's colour.
      const row = (
        <Row
          style={{
            gap: theme.spacing.md,
            alignItems: 'center',
            paddingVertical: ROW_PAD,
            paddingHorizontal: theme.spacing.md,
          }}
        >
          <Avatar
            name={displayName(member, null, blockedIds, t.misc.someone)}
            ghost={isGhost(member) || isBlockedMember(member, blockedIds)}
            size={36}
          />
          {/* The name gets the row's width. It used to share its line with an
              admin badge while the Remind chip and the amount sat beside it,
              which left "Renn…" of "Renny Benita". Who is an admin is a
              Members-screen fact, not a balance; Remind sits under the amount. */}
          <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
            <Text variant="subheading" numberOfLines={1}>
              {shownName}
            </Text>
            <Row style={{ gap: theme.spacing.xs, alignItems: 'center' }}>
              <Text variant="caption" tone="muted" numberOfLines={1} style={{ flexShrink: 1 }}>
                {isGhost(member)
                  ? t.notJoinedYet
                  : isBlockedMember(member, blockedIds)
                    ? // A payment handle carries a name, an address or a phone
                      // number — masked for a blocked person.
                      t.misc.noUpiYet
                    : // `payableAt`, not `member.vpa ?? profile.default_vpa`: the
                      // rail pair is where a handle lives now, and reading only
                      // the old column showed a dash to everybody whose handle is
                      // a Pix key, a PayID or a Venmo name. With none, words
                      // rather than a bare dash that read as missing data.
                      (payableAt(member)?.handle ?? t.misc.noUpiYet)}
              </Text>
            </Row>
          </View>
          <Row style={{ gap: theme.spacing.sm, alignItems: 'center' }}>
            <View style={{ alignItems: 'flex-end', gap: theme.spacing.xs }}>
              <Row style={{ gap: theme.spacing.xs, alignItems: 'center' }}>
                <MoneyText amount={balance} currency={currency} locale={locale} mode="balance" />
                {member.pending ? <PendingMark /> : null}
              </Row>
              {/* Somebody who owes the group money can be nudged from the row
                  that says so, the way Friends already does. Ghosts have nowhere
                  to send it. Touch keeps the visible chip; screen readers get the
                  same affordance as a custom action on the row below, because a
                  nested accessible button can be hidden by an accessible parent. */}
              {canRemind ? (
                <RemindChip groupId={groupId} memberId={member.id} currency={currency} />
              ) : null}
            </View>
            {/* A fixed slot at the trailing edge, on every row whether or not it
                leads anywhere, so the amounts stay in one column instead of
                sliding left on the rows that have no chevron. The glyph itself
                flips with the writing direction. */}
            <View style={{ width: iconSize.md, alignItems: 'center' }}>
              {personKey ? (
                <Ionicons
                  name={directionalIcon('chevron-forward')}
                  size={iconSize.md}
                  color={theme.color.textFaint}
                />
              ) : null}
            </View>
          </Row>
        </Row>
      );
      return (
        <CardRow isFirst={isFirst} isLast={isLast} theme={theme}>
          {personKey ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={rowLabel}
              accessibilityHint={t.people.seeSharedGroups}
              accessibilityActions={
                canRemind ? [{ name: 'remind', label: t.people.remind }] : undefined
              }
              onAccessibilityAction={(event) => {
                if (event.nativeEvent.actionName === 'remind') {
                  // Said aloud either way: a screen reader has no badge to
                  // watch change.
                  void sendNudge({ groupId, memberId: member.id, currency }, t).then((result) =>
                    AccessibilityInfo.announceForAccessibility(result.label),
                  );
                }
              }}
              onPress={() =>
                router.push(
                  `/friends/person/${encodeURIComponent(personKey)}?name=${encodeURIComponent(
                    shownName,
                  )}` as never,
                )
              }
              style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
            >
              {row}
            </Pressable>
          ) : (
            row
          )}
        </CardRow>
      );
    }
    return null;
  };

  return (
    <Screen edges={[]}>
      {/* The hero runs dark under the status bar; force light icons for it. */}
      <StatusBar style="light" />
      {/* No entrance re-animation: the screen already slides in natively, and a
          second scale-up on top of that read as an unwanted zoom. */}
      <View style={{ flex: 1 }}>
        <GroupHero
          groupId={groupId}
          group={group.data}
          members={members.data ?? []}
          profileId={viewerId}
          currency={currency}
          myBalance={ledger.myBalance}
          pending={ledger.pending}
          pendingForMe={pendingForMe}
          heroGradient={heroGradient}
          nameOf={nameOf}
          onOpenMenu={() => setMenuOpen(true)}
        />
        {/* The faces of the page, pinned between the hero and the list.
            It used to ride inside `ListHeaderComponent`, which meant scrolling
            the ledger carried the tab bar off the top of the screen and you had
            to fling back to the beginning to change tab. Fixed here, the tabs
            stay under your thumb and only the rows move — which is also what
            makes switching tabs feel instant rather than like a new page.

            A tab, not a choice on a form, so it wears the underlined tab look
            rather than the selection pills the rest of the app fills in. */}
        <View
          style={{
            paddingHorizontal: theme.spacing.lg,
            paddingTop: theme.spacing.xs,
            gap: theme.spacing.xs,
          }}
        >
          {/* Plain underline tabs on the page — no card, no border. */}
          <View>
            <SegmentedTabs<Tab>
              divider={false}
              value={activeTab}
              onChange={(next) => {
                listRef.current?.scrollToOffset({ offset: 0, animated: false });
                setTab(next);
              }}
              tabs={[
                {
                  value: Tab.Expenses,
                  label: t.expenses,
                  icon: (color) => (
                    <Ionicons name="receipt-outline" size={iconSize.md} color={color} />
                  ),
                },
                ...(isEvent
                  ? [
                      {
                        value: Tab.Vendors,
                        label: t.eventOrganizer.vendorsTab,
                        icon: (color: string) => (
                          <Ionicons name="storefront-outline" size={iconSize.md} color={color} />
                        ),
                      },
                    ]
                  : []),
                {
                  value: Tab.Balances,
                  label: t.balances,
                  icon: (color) => (
                    <Ionicons name="swap-horizontal-outline" size={iconSize.md} color={color} />
                  ),
                },
                {
                  value: Tab.Settle,
                  label: t.settleUp,
                  icon: (color) => (
                    <Ionicons name="cash-outline" size={iconSize.md} color={color} />
                  ),
                },
                {
                  value: Tab.Timeline,
                  label: t.timeline.viewTimeline,
                  icon: (color) => (
                    <Ionicons name="time-outline" size={iconSize.md} color={color} />
                  ),
                },
                {
                  value: Tab.Map,
                  label: t.timeline.viewMap,
                  icon: (color) => <Ionicons name="map-outline" size={iconSize.md} color={color} />,
                },
              ]}
              // Five faces do not share a phone's width evenly with their words
              // on one line, so the row scrolls rather than stacking each glyph
              // over its word.
              scrollable
            />
          </View>
          {activeTab === Tab.Expenses && visibleExpenses.length > 0 ? (
            <ExpenseFilterBar
              scope={scope}
              onScope={setScope}
              labels={{
                all: t.group.filterAll,
                mine: t.group.filterMine,
                others: t.group.filterOthers,
                search: t.group.searchExpenses,
                clearSearch: t.group.clearExpenseSearch,
              }}
              monthText={
                activeMonth ? monthFmtShort.format(monthDate(activeMonth)) : t.group.allMonths
              }
              monthActive={activeMonth !== null}
              onOpenMonth={() => setMonthMenuOpen(true)}
              onOpenScope={() => setScopeMenuOpen(true)}
              searchOpen={searchOpen}
              onToggleSearch={() => {
                if (searchOpen) setQuery('');
                setSearchOpen(!searchOpen);
              }}
              query={query}
              onQuery={setQuery}
            />
          ) : null}
        </View>

        {/* The header menu and the month menu live at the screen's root,
            not in the list header, so they open from every tab. */}
        <OverflowMenu visible={menuOpen} onClose={() => setMenuOpen(false)} items={menuItems} />
        <OverflowMenu
          visible={scopeMenuOpen}
          onClose={() => setScopeMenuOpen(false)}
          items={scopeItems}
        />
        <OverflowMenu
          visible={monthMenuOpen}
          onClose={() => setMonthMenuOpen(false)}
          items={monthItems}
        />

        {/* The waves close the page above the tab bar on every tab, behind the
            content — rows and cards scroll over them. */}
        <FooterWaves bottom={tabBarClearance - WAVES_TUCK} />
        {activeTab === Tab.Vendors ? (
          <VendorsBody
            groupId={groupId}
            initialFilter={
              vendorFilter === 'due' || vendorFilter === 'overdue' ? vendorFilter : 'all'
            }
            today={todayInZone(groupData.time_zone ?? 'Asia/Kolkata')}
          />
        ) : tab === Tab.Settle ? (
          // Settling up, as a face of the group rather than a button on its
          // hero: the same flow as the Settle up screen. Recorded, it shows
          // the balances that just moved.
          <SettleBody groupId={groupId} onRecorded={() => setTab(Tab.Balances)} />
        ) : tab === Tab.Timeline || tab === Tab.Map ? (
          // This group's own timeline and map: the Timeline screen's list and
          // map, held to this group, each on its own tab rather than behind a
          // second switch inside one. They own their scrolling, so they take
          // the list's place rather than riding inside it. One instance for
          // both, so a date range or "only mine" set on one carries to the
          // other.
          <TimelineBody lockedGroupId={groupId} fixedView={tab === Tab.Map ? 'map' : 'timeline'} />
        ) : (
          <FlashList
            ref={listRef}
            // Bounce stays on: on iOS it is what pull-to-refresh pulls.
            bounces
            overScrollMode={emptyExpenses ? 'never' : 'auto'}
            data={listData}
            // Not the tab: switching tabs already hands `data` a different array,
            // and naming it here only made every mounted cell re-render a second
            // time for the same switch.
            //
            // A Balances row's destination is not in its `data` item — it comes
            // from who you are in this group and from the ghost merges on the
            // phone — so those go in here too, or a recycled row keeps whatever
            // tappability it was drawn with. `myMemberId` arrives a beat after
            // the members do, and a merge that syncs in mid-scroll only ever adds
            // a row, so its size is enough to notice one landing.
            extraData={`${locale}|${ledger.myMemberId ?? ''}|${mergePersonIds.size}|${theme.scheme}`}
            keyExtractor={(item) => item.key}
            getItemType={(item) => item.kind}
            renderItem={renderFeedItem}
            // Belt-and-suspenders on top of the allocation-light, memoized row:
            // render well beyond the viewport so a fast fling down a long ledger
            // never outruns recycling and flashes blank rows (default is 250px,
            // which a hard fling clears in a frame). ~2500px ≈ three dozen rows
            // ahead — cheap now that each row barely costs anything to draw, and
            // 1500 was still being outrun by a hard fling on a long ledger.
            drawDistance={2500}
            contentContainerStyle={{
              // The same side margin as Home's group list and this screen's tabs.
              paddingHorizontal: theme.spacing.lg,
              paddingBottom: clearance,
            }}
            showsVerticalScrollIndicator={false}
            refreshControl={
              <RefreshControl
                refreshing={pull.refreshing}
                onRefresh={pull.onRefresh}
                tintColor={theme.color.brand}
              />
            }
            ListHeaderComponent={
              // Alerts, shared receipts and pending settlements — everything that
              // is about the group rather than about one tab. It scrolls under the
              // pinned tab bar. The stack used to open on 20pt of top margin plus a
              // 20pt gap plus each card's own padding, which pushed the first
              // expense most of a thumb below the tabs on a screen where nothing
              // was wrong. Now it follows the screen standard: the first card sits
              // `lg` under the tabs, cards are separate sections `xl` apart, and
              // the list starts `xl` below the last one. With no cards the header
              // takes no room at all and the rows start `lg` under the tabs.
              <View style={{ marginBottom: hasHeaderCards ? theme.spacing.xl : 0 }}>
                <View style={{ gap: theme.spacing.xl, marginTop: theme.spacing.lg }}>
                  {/* The demo trip says what it is before anything else on the
              screen does — a banner, not a badge easy to miss on the way in,
              with the one action that ends it right there beside the words. */}
                  {groupData.isDemo ? (
                    <Card
                      style={{ backgroundColor: theme.color.surfaceMuted, gap: theme.spacing.sm }}
                    >
                      <Row style={{ gap: theme.spacing.sm, alignItems: 'center' }}>
                        <Ionicons
                          name="flask-outline"
                          size={iconSize.md}
                          color={theme.color.textMuted}
                        />
                        <Text variant="subheading" style={{ flex: 1 }}>
                          {t.demo.bannerTitle}
                        </Text>
                      </Row>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={t.demo.removeAction}
                        hitSlop={8}
                        onPress={() =>
                          void removeDemo().then((removed) => {
                            if (removed) router.replace('/');
                          })
                        }
                        style={({ pressed }) => ({
                          alignSelf: 'flex-start',
                          minHeight: 44,
                          justifyContent: 'center',
                          opacity: pressed ? 0.6 : 1,
                        })}
                      >
                        <Text variant="caption" tone="negative" style={{ fontWeight: '600' }}>
                          {t.demo.removeAction}
                        </Text>
                      </Pressable>
                    </Card>
                  ) : null}

                  {/* Only the banners that need a decision survive inline — they
              carry the retry / discard buttons the header glyph cannot. Offline,
              queued and in-flight now read from the glyph in the header,
              matching the dashboard. */}
                  {stalledHere ? <SyncBanner groupId={groupId} /> : null}

                  {/* Drafts kept for this group — money caught but not an expense
              yet, usually waiting on a rate. Above everything else on purpose:
              the only thing a draft needs is somebody to come back and finish
              it, and nobody comes back to a row below a month of expenses. */}
                  <GroupDrafts groupId={groupId} captures={groupDrafts} />

                  {/* The balance cross-check (ADR-004) used to raise a red card
            here. It no longer says anything: the ledger below is the source of
            truth, the disagreement was always this device holding a stale
            snapshot of the server's copy, and there was nothing the reader
            could do about it but doubt their own money. `useGroupLedger` now
            refetches and reports it to us instead. */}

                  {/* The one-time nudge to plan a fresh trip. Dates and budget were
            moved off the create screen to keep it short; this is where a trip
            gets offered them, once, on its own group. Later dismisses it for
            this visit; the param is gone next time regardless. */}
                  {showTripNudge ? (
                    <Card style={{ gap: theme.spacing.md }}>
                      <Row style={{ gap: theme.spacing.sm, alignItems: 'center' }}>
                        <Ionicons name="airplane" size={iconSize.md} color={theme.color.brand} />
                        <Text variant="subheading" style={{ flex: 1 }}>
                          {t.extras.tripWelcomeTitle}
                        </Text>
                      </Row>
                      <Text variant="caption" tone="muted">
                        {t.extras.tripWelcomeBody}
                      </Text>
                      <Row style={{ gap: theme.spacing.sm, flexWrap: 'wrap' }}>
                        <Button
                          label={t.extras.tripWelcomeAddDates}
                          size="sm"
                          onPress={() => router.push(`/group/${groupId}/settings`)}
                        />
                        {PLAN_HIDDEN ? null : (
                          <Button
                            label={t.extras.tripWelcomeSetBudget}
                            size="sm"
                            variant="secondary"
                            onPress={() => router.push(`/group/${groupId}/plan`)}
                          />
                        )}
                        <Button
                          label={t.extras.tripWelcomeLater}
                          size="sm"
                          variant="ghost"
                          onPress={() => setTripNudgeDismissed(true)}
                        />
                      </Row>
                    </Card>
                  ) : null}

                  {/* A bill somebody at this table scanned and shared. Without this the
            second person has no way to reach it, and the claims CRDT is
            plumbing with no tap. */}
                  {(openReceipts.data ?? []).map((receipt) => (
                    <Pressable
                      key={receipt.id}
                      accessibilityRole="button"
                      accessibilityLabel={fill(t.expense.splitBillA11y, {
                        merchant: receipt.parsed?.merchant ?? t.expense.aBill,
                      })}
                      onPress={() => router.push(`/group/${groupId}/itemize?receipt=${receipt.id}`)}
                    >
                      <Card style={{ gap: theme.spacing.sm }}>
                        <Row style={{ gap: theme.spacing.sm }}>
                          <Ionicons
                            name="receipt-outline"
                            size={iconSize.md}
                            color={theme.color.brand}
                          />
                          <Text variant="subheading" style={{ flex: 1 }} numberOfLines={1}>
                            {receipt.parsed?.merchant ?? t.expense.aBill}
                          </Text>
                          <Ionicons
                            name={directionalIcon('chevron-forward')}
                            size={iconSize.md}
                            color={theme.color.textFaint}
                          />
                        </Row>
                        <Text variant="caption" tone="muted">
                          {receipt.claimed === 0
                            ? plural(locale, receipt.items, t.expense.receiptClaimedNone)
                            : fill(t.expense.receiptClaimedSome, {
                                claimed: receipt.claimed,
                                items: receipt.items,
                              })}
                        </Text>
                      </Card>
                    </Pressable>
                  ))}

                  {/* The "they paid you" claims now ride the hero deck above as
                  swipeable slides (confirm / reject up there), so the body no
                  longer carries a full-page confirmation card. */}

                  {/* My own recorded payments, waiting on the payee. The place to
                  back the claim with a screenshot, and an acknowledgement that
                  it is in flight. */}
                  {pendingByMe.map((settlement) => (
                    <Card key={settlement.id} style={{ gap: theme.spacing.md }}>
                      <Text variant="subheading">
                        {fill(t.proof.youPaid, { name: nameOf(settlement.to_member_id) })}
                      </Text>
                      <Row style={{ gap: theme.spacing.sm }}>
                        <MoneyText
                          amount={BigInt(settlement.amount)}
                          currency={settlement.currency}
                          locale={locale}
                          variant="title"
                        />
                        {settlement.pending ? <PendingMark size={16} /> : null}
                      </Row>
                      <Text variant="micro" tone="muted">
                        {fill(t.proof.awaiting, { name: nameOf(settlement.to_member_id) })}
                      </Text>
                      {/* Manage only once the settlement has reached the server:
                      the attach/remove RPCs check party against a real row, and
                      `pending` means it has not synced yet. Until then the card
                      still shows "waiting", just without the attach control. */}
                      <SettlementProof
                        groupId={groupId}
                        settlementId={settlement.id}
                        canManage={!settlement.pending}
                      />
                      {/* Withdraw a payment recorded by mistake or twice. Queued
                        like every other mutation, so even a still-syncing claim
                        cancels cleanly — the create runs before the cancel in
                        the ordered queue. */}
                      <Button
                        label={t.group.cancelSettlement}
                        variant="secondary"
                        fullWidth
                        onPress={() =>
                          void confirm({
                            title: t.group.cancelTitle,
                            body: fill(t.group.cancelBody, {
                              name: nameOf(settlement.to_member_id),
                            }),
                            confirmLabel: t.group.cancelConfirm,
                            cancelLabel: t.group.keep,
                            tone: 'danger',
                          }).then((ok) => {
                            if (ok) cancelSettlement.mutate(settlement.id);
                          })
                        }
                        disabled={cancelSettlement.isPending}
                      />
                    </Card>
                  ))}
                </View>
              </View>
            }
            ListEmptyComponent={
              tab === Tab.Expenses && filtersActive && visibleExpenses.length > 0 ? (
                <Text tone="muted" style={{ textAlign: 'center', paddingTop: theme.spacing.xl }}>
                  {t.group.noExpenseMatches}
                </Text>
              ) : tab === Tab.Expenses ? (
                // An empty list that only describes itself leaves the one thing to
                // do on the screen to a floating button in the corner. The way out
                // of an empty state belongs inside it.
                <GroupEmptyExpenses
                  title={t.nothingYet}
                  body={t.nothingYetBody}
                  action={t.addExpense}
                  onAdd={() => router.push(`/group/${groupId}/add-expense`)}
                />
              ) : null
            }
          />
        )}

        {/* No FAB: adding an expense now lives on the hero's white pill, the
            same as the dashboard, so a floating button would be a second door
            to the same room. */}
      </View>
    </Screen>
  );
}

/**
 * A group with no expenses yet: a receipt and a plant, the fact in bold, what to
 * do about it, and the way to do it — inside the empty state rather than left
 * to a button somewhere else on the screen. Soft waves under it close the page.
 */
function GroupEmptyExpenses({
  title,
  body,
  action,
  onAdd,
}: {
  title: string;
  body: string;
  action: string;
  onAdd: () => void;
}) {
  const theme = useTheme();
  const dark = theme.scheme === 'dark';
  const accent = dark ? theme.color.brand : SPEC_ACCENT;
  return (
    <View style={{ alignItems: 'center', gap: theme.spacing.md, paddingTop: theme.spacing.lg }}>
      <Image
        source={GROUP_EMPTY_ART}
        resizeMode="contain"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={{ width: EMPTY_ART_WIDTH, height: EMPTY_ART_WIDTH / EMPTY_ART_RATIO }}
      />
      <Text
        style={{
          fontSize: 26,
          lineHeight: 32,
          fontWeight: '800',
          textAlign: 'center',
          color: dark ? theme.color.text : SPEC_INK,
        }}
      >
        {title}
      </Text>
      <Text
        style={{
          fontSize: 16,
          lineHeight: 23,
          textAlign: 'center',
          maxWidth: 300,
          color: dark ? theme.color.textMuted : SPEC_MUTED,
        }}
      >
        {body}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={action}
        onPress={onAdd}
        style={({ pressed }) => ({
          marginTop: theme.spacing.md,
          flexDirection: 'row',
          alignItems: 'center',
          gap: theme.spacing.sm,
          height: 54,
          paddingHorizontal: theme.spacing.xxl,
          borderRadius: 27,
          backgroundColor: accent,
          shadowColor: accent,
          shadowOpacity: 0.3,
          shadowRadius: 12,
          shadowOffset: { width: 0, height: 6 },
          elevation: 4,
          opacity: pressed ? 0.85 : 1,
        })}
      >
        <Ionicons name="add" size={24} color="#FFFFFF" />
        <Text style={{ fontSize: 18, fontWeight: '700', color: '#FFFFFF' }}>{action}</Text>
      </Pressable>
    </View>
  );
}

/** The empty state's picture: a receipt and a plant. Its shape (width over
 *  height, 1536 × 1024) and how wide it sits. */
const GROUP_EMPTY_ART = require('../../../../assets/images/group-empty.webp') as number;
const EMPTY_ART_RATIO = 1536 / 1024;
const EMPTY_ART_WIDTH = 200;

/**
 * Two soft waves across the foot of the screen, just above the tab bar — the
 * page's quiet close, on every tab. Decoration only.
 */
function FooterWaves({ bottom }: { bottom: number }) {
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const dark = theme.scheme === 'dark';
  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ position: 'absolute', left: 0, right: 0, bottom }}
    >
      <Svg width={width} height={WAVES_HEIGHT} viewBox="0 0 400 90" preserveAspectRatio="none">
        <Path
          d="M0 40 Q 60 10 130 30 T 260 38 T 400 20 L400 90 L0 90 Z"
          fill={dark ? 'rgba(255,255,255,0.04)' : '#ECEAFB'}
        />
        <Path
          d="M0 62 Q 90 40 180 58 T 400 48 L400 90 L0 90 Z"
          fill={dark ? 'rgba(255,255,255,0.06)' : '#E3E0FA'}
        />
      </Svg>
    </View>
  );
}

/** How tall the waves stand, and how far they tuck under the tab bar's rounded top. */
const WAVES_HEIGHT = 90;
const WAVES_TUCK = 24;
