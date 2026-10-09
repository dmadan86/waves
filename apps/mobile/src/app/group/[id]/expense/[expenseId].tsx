import { useEffect, useRef, useState } from 'react';
import type { ScrollView as RNScrollView } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, Linking, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';

import {
  Avatar,
  Badge,
  Button,
  Card,
  directionalIcon,
  EmptyState,
  IconButton,
  iconSize,
  ListRow,
  MoneyText,
  Gradient,
  Row,
  Screen,
  SegmentedTabs,
  SectionHeader,
  Text,
  useTheme,
} from '@waves/ui';

import {
  balanceDirection,
  convertWithRecord,
  copyFor,
  format,
  guessIcon,
  money,
  moneyAccessibilityLabel,
  resolveCategory,
  subEventsForTemplate,
} from '@waves/core';

import { builtinCategoryLabel, CategoryRow } from '@/components/Category';
import { DetailRow, DetailRows } from '@/components/DetailRows';
import { useAvatarUrl } from '@/components/ProfileAvatar';
import { MapPreview } from '@/components/MapPreview';
import { ExpenseReceipts } from '@/components/ExpenseReceipts';
import { ExpenseComments } from '@/components/ExpenseComments';
import { ExpenseHistory } from '@/components/ExpenseHistory';
import { OverflowMenu, type OverflowMenuItem } from '@/components/OverflowMenu';
import { splitIcon } from '@/components/expense/splitIcon';
import { ExpenseFieldSheet, type ExpenseField } from '@/components/expense/ExpenseFieldSheet';
import {
  memberLookup,
  useDeleteExpense,
  useExpenseImageEvents,
  useExpenseVersions,
  useGroup,
  useRestoreExpense,
} from '@/data/hooks';
import { rateAt } from '@/lib/fxLine';
import { expenseTitle } from '@/data/expenseTitle';
import { useBlockedUsers } from '@/data/blocked';
import { displayName, groupLabel, isBlockedMember, isGhost, isViewer } from '@/data/types';
import { fill, plural, useStrings, type UiStrings } from '@/i18n';
import { useViewerId } from '@/lib/auth';
import { expenseReceiptPath, expenseReceiptUrl } from '@/data/api';
import { coordLabel, mapsUrl } from '@/lib/location';
import { useBottomClearance } from '@/lib/clearance';
import { expenseMemberHref } from '@/lib/expenseMemberRows';
import { router, useGoBack } from '@/lib/navigation';
import { useDialog } from '@/lib/dialog';
import { useSync } from '@/sync';
import { amountEditsInline, canEditInline } from '@/lib/expenseEdit';
import { showDate, showTime } from '@/lib/expenseDay';
import { timeOfDay } from '@/lib/timeline';
import { eventDetailFacts } from '@/lib/eventDetailFacts';

function splitLabels(t: UiStrings): Record<string, string> {
  return {
    equal: t.expense.splitEqually,
    exact: t.expense.exactAmounts,
    percent: t.expense.byPercentage,
    shares: t.expense.byShares,
    adjustment: t.expense.withAdjustments,
    itemized: t.expense.itemized,
  };
}

/** White-on-wash glass for the hero's controls and chips: the same
 *  white-with-alpha the hero's chips already used, so they read as one family. */
const HERO_GLASS = 'rgba(255, 255, 255, 0.18)';
/** Fainter still, for the decorative blob. */
const HERO_GLASS_SOFT = 'rgba(255, 255, 255, 0.08)';

/** A round translucent control on the hero. 36pt is the compact size: three of
 *  them, a back button and a title disc share one row on a phone, and `hitSlop`
 *  keeps the touch target generous. */
function HeroButton({
  icon,
  label,
  onPress,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  onPress: () => void;
}): React.JSX.Element {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={6}
      style={({ pressed }) => ({
        width: 36,
        height: 36,
        borderRadius: 18,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: HERO_GLASS,
        opacity: pressed ? 0.5 : 1,
      })}
    >
      <Ionicons name={icon} size={iconSize.lg} color={theme.color.onBrand} />
    </Pressable>
  );
}

/** A member's avatar showing their real picture when they have one. The signing
 *  hook (`useAvatarUrl`) must run per row, so this is its own component rather
 *  than a call inside a `.map`. Falls back to initials — same as the comment
 *  thread below. */
function MemberAvatar({
  name,
  photo,
  ghost,
  size = 38,
}: {
  name: string;
  photo: string | null | undefined;
  ghost: boolean;
  size?: number;
}): React.JSX.Element {
  const url = useAvatarUrl(photo);
  return <Avatar name={name} photoUrl={url} ghost={ghost} size={size} />;
}

export default function ExpenseDetailScreen() {
  const theme = useTheme();
  const goBack = useGoBack();
  const insets = useSafeAreaInsets();
  const clearance = useBottomClearance();
  const { t, locale } = useStrings();
  const { confirm } = useDialog();
  const { id, expenseId } = useLocalSearchParams<{ id: string; expenseId: string }>();
  const groupId = id ?? '';
  // Identity for "which member am I", from the session rather than the profile:
  // the session is on the device at launch, the profile is a fetch that lands
  // later, and in the gap `profile?.id` is undefined — which `isViewer` refuses
  // to match, but only if it is given the right thing to compare. See
  // `lib/auth.useViewerId`.
  const viewerId = useViewerId();

  const { group, members, expenses } = useGroup(groupId);
  const versions = useExpenseVersions(expenseId ?? '');
  const imageEvents = useExpenseImageEvents(expenseId ?? '');
  const scrollRef = useRef<RNScrollView>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  // The page has two faces: its breakdown, and its edit history. The hero stays
  // above both; only the body below the tab bar swaps.
  const [tab, setTab] = useState<'details' | 'history'>('details');
  // The Location row's map, folded away until asked for.
  const [mapOpen, setMapOpen] = useState(false);
  // The fact being changed in a pop-up, if one is open (ExpenseFieldSheet).
  const [editingField, setEditingField] = useState<ExpenseField | null>(null);
  const deleteExpense = useDeleteExpense(groupId);
  const restoreExpense = useRestoreExpense(groupId);

  const expense = expenses.rows.find((row) => row.id === expenseId);
  const version = expense?.currentVersion;

  // Opened from a push, the expense is usually newer than this phone: the
  // notification arrives the moment it is added, and the app is launched (or
  // woken) straight onto it before any pull has brought it down. Reading that
  // as "not found — deleted more than 30 days ago" for the second the pull
  // takes was a lie on the one screen people reach from a notification. So a
  // miss asks the server once, and the screen keeps its loading shell until
  // that answer is in; only a miss that survives it is "not found".
  const { flush } = useSync();
  const missing = !expenses.isLoading && !version;
  const askedServer = useRef(false);
  const [serverAnswered, setServerAnswered] = useState(false);
  useEffect(() => {
    if (!missing || askedServer.current) return;
    askedServer.current = true;
    void flush()
      .catch(() => {})
      .finally(() => setServerAnswered(true));
  }, [missing, flush]);
  const askingServer = missing && !serverAnswered;
  const { blockedIds } = useBlockedUsers();

  // The kept bill (E2), resolved from R2. `expenseReceiptUrl` doubles as the
  // existence check — it returns null when no bill was ever kept — so a URL here
  // both proves the receipt exists and gives the thumbnail something to show. A
  // group receipt in R2 is group-readable, so any member sees it, not just the
  // author. Absent on web/anonymous where storage does not resolve, which reads
  // as "no receipt" and simply hides the row.
  const [receiptUri, setReceiptUri] = useState<string | null>(null);
  const currentExpenseId = expense?.id;
  // Re-resolve on focus, not only when the ids change: a bill kept on the edit
  // screen (which uploads on save) is not in R2 when this screen first mounts, so
  // resolving again on the way back is what reveals the receipt row.
  // Inline, not wrapped in useCallback: this app compiles with React Compiler
  // (`reactCompiler: true`), which auto-memoises the callback — and actively
  // rejects a hand-written useCallback here ("existing memoization could not be
  // preserved"). So the focus effect does not re-run every render.
  useFocusEffect(() => {
    if (!currentExpenseId) return undefined;
    let active = true;
    // Keep the last good URL on a failed refresh: `expenseReceiptUrl` returns
    // null for both "no receipt" and a transient signing failure, and a receipt
    // that was showing should not vanish just because one refresh could not sign
    // it. A first resolve starts from null, so a real absence still reads as none.
    expenseReceiptUrl(groupId, currentExpenseId).then((url) => {
      if (active) setReceiptUri((prev) => url ?? prev);
    });
    return () => {
      active = false;
    };
  });
  const lookup = memberLookup(members.data);
  // A party to this expense — a payer of the current version, or its author — is
  // the only one who may attach to it (the RPC enforces this too). Non-parties
  // still SEE any group-visible attachment; they just cannot add or see a private
  // one. Computed from the mirror; the server is the real gate.
  const myMemberId =
    (members.data ?? []).find((m) => isViewer(m, viewerId) && m.left_at === null)?.id ?? null;
  const isExpenseParty = Boolean(
    myMemberId &&
    version &&
    (version.author_member_id === myMemberId ||
      version.payers.some((p) => p.member_id === myMemberId)),
  );
  // Whether *you* have any stake in this bill — money you put in, or a share you
  // owe of it. A member who is on the group but not on this split (or written into
  // it with a zero share) has no stake, so the screen frames itself as someone
  // else's bill: an observer banner up top, and the split shown in neutral ink
  // instead of the owe-red that would imply the debt is yours. This is money-only
  // on purpose — being the author but not a party still reads as not involved.
  const myPaidHere = version?.payers.find((p) => p.member_id === myMemberId)?.amount;
  const myShareHere = version?.shares.find((s) => s.member_id === myMemberId)?.amount;
  // Only classify once we know who the viewer is. An unresolved `myMemberId` (the
  // members mirror still hydrating, or a viewer with no membership row yet) would
  // otherwise read as zero-paid/zero-share and flash the "not involved" banner
  // over a bill the viewer may well be in. Null → leave it involved (no banner)
  // until resolution; a resolved member genuinely not in the split still gets the
  // zero-stake treatment.
  const notInvolved =
    Boolean(version) &&
    myMemberId !== null &&
    BigInt(myPaidHere ?? 0) === 0n &&
    BigInt(myShareHere ?? 0) === 0n;
  // Admin of this group — the moderation lever on the comment thread (delete
  // anyone's, resolve a report). The server re-checks; this only shows controls.
  const iAmAdmin =
    (members.data ?? []).find((m) => isViewer(m, viewerId) && m.left_at === null)?.role === 'admin';
  const nameOf = (memberId: string | null): string => {
    const member = memberId ? lookup.get(memberId) : undefined;
    return member ? displayName(member, viewerId, blockedIds, t.misc.someone) : t.misc.someone;
  };
  // The label reads "You"; the avatar keeps the real name so the current user's
  // circle is the same initial and colour here as on every other screen — a
  // balances row keys the avatar off the real name too. Passing "You" to the
  // avatar made it a lone pink "Y" next to a blue "G" elsewhere for one person.
  const avatarNameOf = (memberId: string | null): string => {
    const member = memberId ? lookup.get(memberId) : undefined;
    return member ? displayName(member, null, blockedIds, t.misc.someone) : t.misc.someone;
  };

  if (expenses.isLoading || askingServer) {
    // Shell first: the back button paints instantly on navigation; the title
    // and body fill in once the mirror read lands (a few ms at launch).
    return (
      <Screen>
        <View style={{ paddingHorizontal: theme.spacing.xl }}>
          <Row style={{ paddingTop: theme.spacing.md }}>
            <IconButton label={t.common.back} onPress={() => router.back()}>
              <Ionicons
                name={directionalIcon('chevron-back')}
                size={iconSize.lg}
                color={theme.color.text}
              />
            </IconButton>
            <View style={{ flex: 1 }} />
            <View style={{ width: 44 }} />
          </Row>
          <View style={{ paddingTop: theme.spacing.xxxl, alignItems: 'center' }}>
            <ActivityIndicator color={theme.color.brand} />
          </View>
        </View>
      </Screen>
    );
  }

  if (!expense || !version) {
    return (
      <Screen>
        <EmptyState
          title={t.expense.notFound}
          body={t.expense.notFoundBody}
          action={<Button label={t.common.back} onPress={() => router.back()} />}
        />
      </Screen>
    );
  }

  const currency = version.currency;
  const deleted = Boolean(expense.deleted_at);
  // Paid in a currency other than the group's: what it comes to at the stored
  // rate. Nothing for a same-currency bill or one with no rate.
  const convertedHome =
    version.fx &&
    group.data &&
    currency !== group.data.default_currency &&
    BigInt(version.amount) > 0n
      ? convertWithRecord(money(BigInt(version.amount), currency), version.fx)
      : null;

  /**
   * Everyone this bill touches, and what it does to them.
   *
   * Built from the union of the split and the payers, not from the split alone:
   * somebody can put money into a bill they owe no part of (a parent chipping in
   * on a group dinner), and listing only the split leaves their contribution
   * visible in "Paid by" and then unaccounted for below it.
   *
   * `net` is paid − share, so it sums to exactly zero across the rows — Σ payers
   * and Σ shares both equal the total, a rule the SQL trigger enforces.
   */
  const ledgerRows = (() => {
    const paidBy = new Map(version.payers.map((row) => [row.member_id, BigInt(row.amount)]));
    const rows = version.shares.map((share) => {
      const paid = paidBy.get(share.member_id) ?? 0n;
      paidBy.delete(share.member_id);
      return {
        memberId: share.member_id,
        share: BigInt(share.amount),
        paid,
        net: paid - BigInt(share.amount),
      };
    });
    // Whoever is left paid something without being in the split at all.
    for (const [memberId, paid] of paidBy) {
      rows.push({ memberId, share: 0n, paid, net: paid });
    }
    return rows;
  })();

  // Where it happened (A43), when the author attached one. A plain snapshot — a
  // tap opens the point in the phone's maps app.
  const location = version.location;
  // Event organizer facts (docs/event-organizer.md): the sub-event tag and the
  // vendor advance. Only present on an Event group's expense that carries them.
  const eventFacts = eventDetailFacts({
    version,
    subEvents: subEventsForTemplate(group.data?.event_template),
    timeZone: group.data?.time_zone ?? 'Asia/Kolkata',
  });
  const openPlan = () => router.push(`/group/${groupId}/plan`);
  // The typed note. It also names the expense in the hero, but that heading is
  // clamped to a single line while the field is multiline — so a long or
  // multi-line note is only half-shown up top. Render the full text as a "Note"
  // row whenever the hero cannot have conveyed all of it (more than one line, or
  // longer than one fits), so nothing the author typed is lost on this screen.
  const note = (version.description ?? '').trim();
  // Roughly one line of the hero heading on a phone; past this the clamp bites.
  const HERO_TITLE_CLAMP = 30;
  const showNote = note !== '' && (note.includes('\n') || note.length > HERO_TITLE_CLAMP);
  // The hero's category, said twice: the glyph in the white disc (refined by what
  // was typed, as the list badge does) and the plain category icon + name on the
  // chip beside the title.
  const heroCategory = resolveCategory(version.category, version.category_meta);
  const heroGlyph = heroCategory.custom
    ? heroCategory.icon
    : (guessIcon(version.description) ?? heroCategory.icon);
  // A built-in's name comes from the string table (the catalog's own label is
  // English); a custom tag carries its own.
  const heroLabel = builtinCategoryLabel(t, heroCategory);
  // Year included, unlike the list rows: this is the one place the bill's own date
  // is stated outright. UTC, because the ledger stores a plain day with no zone.
  const heroDate = new Intl.DateTimeFormat(locale, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(version.expense_date));

  const confirmDelete = async (): Promise<void> => {
    const ok = await confirm({
      title: t.expense.deleteQuestion,
      body: t.expense.deleteBody,
      confirmLabel: t.common.delete,
      tone: 'danger',
    });
    if (ok) deleteExpense.mutate(expense.id, { onSuccess: () => router.back() });
  };

  // A fact on this screen is its own door to changing it: a tap opens a small
  // sheet for that one field, which saves through the full editor's own write
  // path. Not on a deleted bill (nothing to change until it is restored), and
  // not on an itemized or adjusted split — those reopen as equal, so a one-field
  // save would quietly re-split them; the pencil is still the way in there.
  const inlineEditable = !deleted && canEditInline(version.split_type);
  // The bill's time of day: the one chosen, else the save time on its own day.
  const shownAt = timeOfDay(version.expense_date, expense.created_at, version.occurred_at);
  const changeOn = (field: ExpenseField): (() => void) | undefined =>
    inlineEditable ? () => setEditingField(field) : undefined;
  // A new total alone cannot be saved when the split is exact or several people
  // paid: the typed amounts, or the payers' figures, would no longer add up,
  // and the amount pop-up has no controls to fix either. Those bills go straight
  // to the full editor (focused on the amount) rather than to a dead-end sheet.
  const amountInline = inlineEditable && amountEditsInline(version);

  const openEditor = (focus?: 'amount' | 'payers'): void => {
    // "Fix the number" is the most common reason a bill is reopened, so tapping
    // the amount carries a focus hint that lands straight in the field with the
    // keyboard up — no hunting for the pencil, then noticing the number is a
    // field, then tapping it.
    const suffix = focus ? `&focus=${focus}` : '';
    router.push(`/group/${groupId}/add-expense?expenseId=${expense.id}${suffix}`);
  };

  // What is left in the header's three-dot menu once Edit has its own glyph
  // beside it: the destructive action on a live bill, Restore on a deleted one.
  // Edit is the thing people come back to a bill to do, and burying the common
  // action behind a menu meant hunting for it every time; Delete is the one that
  // is better off a tap deeper. The mutations' pending flags disable the row so
  // a double-tap cannot fire twice.
  const menuItems: OverflowMenuItem[] = deleted
    ? [
        {
          icon: 'refresh',
          label: t.expense.restore,
          onPress: () => {
            if (!restoreExpense.isPending) restoreExpense.mutate(expense.id);
          },
        },
      ]
    : [
        {
          icon: 'trash-outline',
          label: t.expense.deleteAction,
          tone: 'danger',
          onPress: () => {
            if (!deleteExpense.isPending) void confirmDelete();
          },
        },
      ];

  return (
    <Screen edges={[]}>
      {/* The hero runs dark under the status bar, so its icons must be light —
          overriding the app's theme-driven default for this route. */}
      <StatusBar style="light" />
      {/* The expense hero: one saturated wash edge to edge and up under the status
          bar, white controls and amount on it. Neutral brand indigo, never a money
          colour: the amount is a total that is nobody's balance. A fixed header —
          it sits as a sibling before the scroll so only the body below it scrolls
          — with only its bottom corners rounded. */}
      <Gradient
        radius={0}
        colors={theme.gradient.brand}
        style={{
          // Compact: a tight top, a short foot and small gaps, so the hero is a
          // header over the page rather than half of it.
          paddingTop: insets.top + theme.spacing.sm,
          paddingHorizontal: theme.spacing.xl,
          paddingBottom: theme.spacing.md,
          borderBottomLeftRadius: theme.radius.xxl,
          borderBottomRightRadius: theme.radius.xxl,
          gap: theme.spacing.sm,
          overflow: 'hidden',
        }}
      >
        {/* A soft lighter blob bleeding off the top end: depth on the flat wash
            without art. Decorative, so it is hidden from screen readers. */}
        <View
          pointerEvents="none"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={{
            position: 'absolute',
            top: -60,
            end: -70,
            width: 220,
            height: 220,
            borderRadius: 110,
            backgroundColor: HERO_GLASS_SOFT,
          }}
        />
        {/* Back, the bill's identity, then the actions — one row, as the design
            has it. The glass buttons are round and translucent so they sit on the
            wash without a second colour. */}
        <Row style={{ alignItems: 'center', gap: theme.spacing.sm }}>
          <HeroButton icon={directionalIcon('arrow-back')} label={t.common.back} onPress={goBack} />
          {/* The disc is the bill's kind; on a bill that can be changed in
              place, a tap on it changes the kind. */}
          <Pressable
            onPress={changeOn('category')}
            disabled={!inlineEditable}
            accessible={inlineEditable}
            accessibilityRole="button"
            accessibilityLabel={t.whatFor}
            accessibilityHint={t.expense.detailTapHint}
            hitSlop={6}
            style={({ pressed }) => ({
              width: 40,
              height: 40,
              borderRadius: 20,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: theme.color.onBrand,
              opacity: pressed ? 0.6 : 1,
            })}
          >
            <Ionicons
              name={heroGlyph as keyof typeof Ionicons.glyphMap}
              size={iconSize.xl}
              color={theme.color.brand}
            />
          </Pressable>
          <View style={{ flex: 1, minWidth: 0, gap: 2, alignItems: 'flex-start' }}>
            <Row style={{ alignItems: 'center', gap: theme.spacing.sm }}>
              {/* The description is the heading; a tap on it opens the note in a
                  small sheet — type it, or speak it with the mic. */}
              <Pressable
                onPress={changeOn('description')}
                disabled={!inlineEditable}
                accessible={inlineEditable}
                accessibilityRole="button"
                accessibilityHint={t.expense.detailTapHint}
                style={({ pressed }) => ({ flexShrink: 1, opacity: pressed ? 0.6 : 1 })}
              >
                <Text variant="subheading" tone="onBrand" numberOfLines={1}>
                  {expenseTitle(version.description, version.category, t, version.category_meta)}
                </Text>
              </Pressable>
              {deleted ? <Badge label={t.expense.deleted} tone="negative" /> : null}
            </Row>
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 4,
                maxWidth: '100%',
                paddingHorizontal: theme.spacing.sm,
                paddingVertical: 2,
                borderRadius: theme.radius.pill,
                backgroundColor: HERO_GLASS,
              }}
            >
              <Ionicons
                name={heroCategory.icon as keyof typeof Ionicons.glyphMap}
                size={iconSize.sm}
                color={theme.color.onBrand}
              />
              <Text
                variant="micro"
                tone="onBrand"
                numberOfLines={1}
                style={{ fontWeight: '600', flexShrink: 1 }}
              >
                {heroLabel}
              </Text>
            </View>
          </View>
          {/* The three controls the screen already had, as glass buttons: the
              timeline entry, Edit (gone on a deleted bill — nothing to edit until
              it is restored), and the three-dot menu for Delete / Restore. */}
          <HeroButton
            icon="git-commit-outline"
            label={`${t.timeline.entryRow}: ${t.timeline.entryRowValue}`}
            onPress={() =>
              router.push({ pathname: '/timeline', params: { focus: expenseId ?? '' } })
            }
          />
          {deleted ? null : (
            <HeroButton icon="create-outline" label={t.common.edit} onPress={() => openEditor()} />
          )}
          <HeroButton
            icon="ellipsis-vertical"
            label={t.group.more}
            onPress={() => setMenuOpen(true)}
          />
        </Row>

        {/* The amount, the figure the page is about. On a live bill it is the door
            to editing it: a tap opens the editor with the amount already focused,
            the one-tap path for the change a bill is most often reopened for. A
            deleted bill cannot be edited, so there it is plain text. A bill you
            have no stake in — not a payer, no share — says so in a small tag
            beside its total; its spoken label carries the whole sentence. */}
        <Row style={{ alignItems: 'center', gap: theme.spacing.sm, flexWrap: 'wrap' }}>
          {deleted ? (
            <MoneyText
              amount={BigInt(version.amount)}
              currency={currency}
              locale={locale}
              variant="display"
              style={{ color: theme.color.onBrand, fontSize: 32, lineHeight: 38 }}
            />
          ) : (
            <Pressable
              // The amount pop-up where one fits the bill (see `amountInline`);
              // otherwise the editor, focused on the amount.
              onPress={amountInline ? () => setEditingField('amount') : () => openEditor('amount')}
              accessibilityRole="button"
              accessibilityLabel={`${t.common.edit}: ${format(money(BigInt(version.amount), currency), { locale })}`}
              accessibilityHint={amountInline ? t.expense.detailTapHint : undefined}
              hitSlop={8}
              style={({ pressed }) => ({ alignSelf: 'flex-start', opacity: pressed ? 0.6 : 1 })}
            >
              <MoneyText
                amount={BigInt(version.amount)}
                currency={currency}
                locale={locale}
                variant="display"
                style={{ color: theme.color.onBrand, fontSize: 32, lineHeight: 38 }}
              />
            </Pressable>
          )}
          {notInvolved ? (
            <View
              accessible
              accessibilityLabel={`${t.expense.notInvolvedTitle}. ${t.expense.notInvolvedBody}`}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 4,
                paddingHorizontal: theme.spacing.sm,
                paddingVertical: 2,
                borderRadius: theme.radius.pill,
                backgroundColor: HERO_GLASS,
              }}
            >
              <Ionicons name="eye-outline" size={iconSize.sm} color={theme.color.onBrand} />
              <Text variant="micro" tone="onBrand" style={{ fontWeight: '600' }}>
                {t.expense.notInvolvedChip}
              </Text>
            </View>
          ) : null}
        </Row>
        {/* Paid in another currency: the amount above stays the main figure,
            with what it came to in the group's money and the rate, small. */}
        {version.fx && convertedHome ? (
          <View style={{ gap: 2 }}>
            <Text variant="caption" style={{ color: theme.color.onBrand }}>
              {`= ${format(convertedHome, { locale })}`}
            </Text>
            <Text variant="micro" tone="onBrand" style={{ opacity: 0.8 }}>
              {rateAt(version.fx, t.fx.viewAt)}
            </Text>
          </View>
        ) : null}

        {/* The group this bill belongs to on the start, its date on the end; a
            tap on the group opens it. */}
        <Row
          style={{ alignItems: 'center', justifyContent: 'space-between', gap: theme.spacing.md }}
        >
          <Pressable
            onPress={() => router.push(`/group/${groupId}`)}
            accessibilityRole="button"
            accessibilityLabel={groupLabel(group.data, members.data ?? [], viewerId)}
            hitSlop={6}
            style={({ pressed }) => ({
              flexShrink: 1,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 4,
              paddingHorizontal: theme.spacing.sm,
              paddingVertical: 2,
              borderRadius: theme.radius.pill,
              backgroundColor: HERO_GLASS,
              opacity: pressed ? 0.6 : 1,
            })}
          >
            {group.data?.cover_emoji ? (
              <Text variant="caption">{group.data.cover_emoji}</Text>
            ) : (
              <Ionicons name="people-outline" size={iconSize.sm} color={theme.color.onBrand} />
            )}
            <Text
              variant="caption"
              tone="onBrand"
              numberOfLines={1}
              style={{ fontWeight: '600', flexShrink: 1 }}
            >
              {groupLabel(group.data, members.data ?? [], viewerId)}
            </Text>
          </Pressable>
          <Row style={{ alignItems: 'center', gap: theme.spacing.xs }}>
            <Ionicons name="calendar-outline" size={iconSize.sm} color={theme.color.onBrand} />
            <Text variant="caption" tone="onBrand" style={{ fontWeight: '600' }}>
              {heroDate}
            </Text>
          </Row>
        </Row>
      </Gradient>

      {/* The two faces of the page — its breakdown and its edit history —
          sectioned so the audit is its own place rather than the tail of a long
          scroll.

          Outside the ScrollView, pinned under the hero. Inside it, the row
          scrolled away with the content: three screens into the comments there
          was no way to reach the history without scrolling all the way back, and
          the control that says which face you are on was the one thing not on
          screen. It sits tight against the hero — a label for what follows, not
          a band of its own. */}
      <View style={{ paddingHorizontal: theme.spacing.xl, paddingTop: theme.spacing.sm }}>
        <SegmentedTabs
          value={tab}
          // Back to the top on the way in. The two faces are different lengths,
          // so keeping the offset landed somebody halfway down a history they
          // had not scrolled, or at the foot of a page they had just opened.
          onChange={(next) => {
            scrollRef.current?.scrollTo({ y: 0, animated: false });
            setTab(next);
          }}
          tabs={[
            {
              value: 'details',
              label: t.expense.detailsTab,
              icon: (color) => <Ionicons name="receipt-outline" size={iconSize.md} color={color} />,
            },
            {
              value: 'history',
              label: t.expense.history,
              icon: (color) => <Ionicons name="time-outline" size={iconSize.md} color={color} />,
            },
          ]}
        />
      </View>

      <ScrollView
        ref={scrollRef}
        style={{ flex: 1 }}
        contentContainerStyle={{
          paddingHorizontal: theme.spacing.xl,
          paddingBottom: clearance,
          paddingTop: theme.spacing.lg,
          gap: theme.spacing.xl,
        }}
        showsVerticalScrollIndicator={false}
        // The comment composer lives at the very bottom; keep tapping its actions
        // working while the keyboard is up, and let iOS inset for the keyboard.
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
      >
        {tab === 'history' ? (
          <ExpenseHistory
            versions={versions.data ?? []}
            imageEvents={imageEvents.data ?? []}
            nameOf={nameOf}
            myMemberId={myMemberId}
            groupName={groupLabel(group.data, members.data ?? [], viewerId)}
            t={t}
            locale={locale}
          />
        ) : (
          <>
            {/* Vendor deposit: the money comes first. What was paid now, and what
                is still owing and by when, ahead of the receipts and the
                group / category / split details. A tap opens the plan. */}
            {eventFacts.isDeposit ? (
              <Pressable
                onPress={openPlan}
                accessibilityRole="button"
                accessibilityLabel={`${t.eventOrganizer.advancePaid}, ${format(
                  money(BigInt(version.amount), currency),
                  { locale },
                )}. ${
                  eventFacts.balanceDueMinor != null
                    ? fill(t.eventOrganizer.balanceDueValue, {
                        amount: format(money(eventFacts.balanceDueMinor, currency), { locale }),
                        date: eventFacts.balanceDueDate
                          ? showDate(eventFacts.balanceDueDate, locale)
                          : t.eventOrganizer.dueWhenever,
                      })
                    : t.eventOrganizer.fullyPaid
                }`}
              >
                <Card>
                  <Row style={{ alignItems: 'flex-start', gap: theme.spacing.lg }}>
                    <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                      <Text variant="caption" tone="muted">
                        {t.eventOrganizer.advancePaid}
                      </Text>
                      <MoneyText
                        amount={BigInt(version.amount)}
                        currency={currency}
                        locale={locale}
                        variant="title"
                      />
                    </View>
                    <View style={{ flex: 1, minWidth: 0, gap: 2, alignItems: 'flex-end' }}>
                      <Text variant="caption" tone="muted">
                        {t.eventOrganizer.balanceDueLabel}
                      </Text>
                      {eventFacts.balanceDueMinor != null ? (
                        <>
                          <MoneyText
                            amount={eventFacts.balanceDueMinor}
                            currency={currency}
                            locale={locale}
                            variant="title"
                            style={eventFacts.overdue ? { color: theme.color.negative } : undefined}
                          />
                          <Text
                            variant="caption"
                            tone={eventFacts.overdue ? 'negative' : 'muted'}
                            numberOfLines={1}
                          >
                            {eventFacts.balanceDueDate
                              ? fill(t.eventOrganizer.balanceDueBy, {
                                  date: showDate(eventFacts.balanceDueDate, locale),
                                })
                              : t.eventOrganizer.dueWhenever}
                          </Text>
                        </>
                      ) : (
                        <Text variant="body" style={{ fontWeight: '600' }}>
                          {t.eventOrganizer.fullyPaid}
                        </Text>
                      )}
                    </View>
                  </Row>
                </Card>
              </Pressable>
            ) : null}

            {/* Receipts — one gallery, many images, each group-visible or private.
            Folds in the legacy single bill (E2) as its first item. Adding is now
            the hero button (externalAdd), driven through the ref; this section
            shows the gallery of what is already kept.

            First on the page, ahead of the facts: the bill itself is the thing
            somebody opens this screen to look at, and the figures below are what
            was read off it. */}
            <ExpenseReceipts
              groupId={groupId}
              expenseId={expense.id}
              canManage={isExpenseParty}
              canRemoveLegacy={isExpenseParty || iAmAdmin}
              legacyReceiptPath={receiptUri ? expenseReceiptPath(groupId, expense.id) : null}
              onLegacyRemoved={() => setReceiptUri(null)}
            />

            {/* The bill's facts as a tidy labelled card — who paid, when, and how
                it was split — in place of the stacked caption and chips the hero
                used to wear. The group it belongs to leads the list so the bill
                is placed without crowding the hero. */}
            <Card padded={false} style={{ paddingHorizontal: theme.spacing.lg }}>
              <DetailRows>
                {/* What kind of bill it is, in words. The badge in the hero
                    shows it only as an icon, so the name was visible only in
                    the editor. Same row the editor uses; a tap changes it. */}
                <CategoryRow
                  value={version.category}
                  meta={version.category_meta}
                  onPress={changeOn('category')}
                  accessibilityHint={t.expense.detailTapHint}
                />
                <DetailRow
                  icon="wallet-outline"
                  label={t.paidBy}
                  value={
                    version.payers.length > 1
                      ? plural(locale, version.payers.length, t.misc.peopleCount)
                      : nameOf(version.payers[0]?.member_id ?? null)
                  }
                  onPress={changeOn('payer')}
                  accessibilityHint={t.expense.detailTapHint}
                />
                <DetailRow
                  icon="calendar-outline"
                  label={t.expense.detailDate}
                  value={[
                    new Intl.DateTimeFormat(locale, {
                      day: 'numeric',
                      month: 'long',
                      year: 'numeric',
                      timeZone: 'UTC',
                    }).format(new Date(version.expense_date)),
                    ...(shownAt != null ? [showTime(shownAt, locale)] : []),
                  ].join(' · ')}
                  onPress={changeOn('date')}
                  accessibilityHint={t.expense.detailTapHint}
                />
                <DetailRow
                  icon={splitIcon(version.split_type)}
                  label={t.expense.detailSplit}
                  value={splitLabels(t)[version.split_type] ?? version.split_type}
                  onPress={changeOn('split')}
                  accessibilityHint={t.expense.detailTapHint}
                />
                {/* Event organizer: the sub-event this bill belongs to, and the
                    vendor advance. Only drawn when set; a tap opens the plan,
                    where the budget and upcoming vendor balances live. */}
                {eventFacts.subEvent ? (
                  <DetailRow
                    icon="albums-outline"
                    label={t.eventOrganizer.subEventLabel}
                    value={`${eventFacts.subEvent.emoji} ${
                      t.eventSubEvents[eventFacts.subEvent.id] ?? eventFacts.subEvent.id
                    }`.trim()}
                    onPress={openPlan}
                    accessibilityLabel={`${t.eventOrganizer.subEventLabel}, ${
                      t.eventSubEvents[eventFacts.subEvent.id] ?? eventFacts.subEvent.id
                    }`}
                  />
                ) : null}
                {/* Where it happened (A43), folded into the facts: the place's
                    name, and a tap opens the map here rather than spending a
                    card's height on it for everyone. The map's corner opens it
                    full screen on the timeline's map; a tap on the map itself
                    opens the phone's maps app. */}
                {location ? (
                  <DetailRow
                    icon="location-outline"
                    label={t.location.label}
                    value={location.name?.trim() || coordLabel(location)}
                    onPress={() => setMapOpen((open) => !open)}
                    expanded={mapOpen}
                    accessibilityLabel={`${t.location.label}, ${location.name?.trim() || coordLabel(location)}`}
                  />
                ) : null}
                {location && mapOpen ? (
                  <View style={{ paddingBottom: theme.spacing.md }}>
                    <MapPreview
                      location={location}
                      height={180}
                      accessibilityLabel={t.location.openMap}
                      onPress={() => void Linking.openURL(mapsUrl(location)).catch(() => undefined)}
                    />
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={t.timeline.seeOnMap}
                      hitSlop={8}
                      onPress={() =>
                        router.push({
                          pathname: '/timeline',
                          params: { focus: expenseId ?? '', view: 'map' },
                        })
                      }
                      style={({ pressed }) => ({
                        position: 'absolute',
                        top: theme.spacing.sm,
                        end: theme.spacing.sm,
                        width: 36,
                        height: 36,
                        borderRadius: 18,
                        alignItems: 'center',
                        justifyContent: 'center',
                        backgroundColor: theme.color.surface,
                        opacity: pressed ? 0.8 : 1,
                        ...theme.shadow.lifted,
                      })}
                    >
                      <Ionicons name="expand" size={iconSize.md} color={theme.color.text} />
                    </Pressable>
                  </View>
                ) : null}
              </DetailRows>
            </Card>

            {/* The full note, when the clamped hero heading could not have shown
            all of it — a multi-line or long description is only half-visible up
            top, so it gets its own readable, wrapping row here. */}
            {showNote ? (
              <View>
                <SectionHeader title={t.expense.note} />
                <Card>
                  <Text variant="body">{note}</Text>
                </Card>
              </View>
            ) : null}

            {version.payers.length > 1 ? (
              <View>
                <SectionHeader title={t.paidBy} />
                <Card padded={false} style={{ paddingHorizontal: theme.spacing.lg }}>
                  {version.payers.map((payer, index) => {
                    const payerMember = lookup.get(payer.member_id);
                    const payerHref = expenseMemberHref(
                      groupId,
                      payer.member_id,
                      Boolean(payerMember),
                    );
                    return (
                      <View key={payer.member_id}>
                        <ListRow
                          title={nameOf(payer.member_id)}
                          quiet
                          onPress={payerHref ? () => router.push(payerHref) : undefined}
                          accessibilityLabel={t.expense.paidByNameAmount
                            .replace('{name}', nameOf(payer.member_id))
                            .replace(
                              '{amount}',
                              format(money(BigInt(payer.amount), currency), {
                                locale,
                              }),
                            )}
                          leading={
                            <MemberAvatar
                              name={avatarNameOf(payer.member_id)}
                              photo={payerMember?.profile?.avatar_url}
                              ghost={
                                payerMember
                                  ? isGhost(payerMember) || isBlockedMember(payerMember, blockedIds)
                                  : false
                              }
                            />
                          }
                          trailing={
                            <MoneyText
                              amount={BigInt(payer.amount)}
                              currency={currency}
                              locale={locale}
                              variant="caption"
                            />
                          }
                        />
                        {index < version.payers.length - 1 ? (
                          <View style={{ height: 1, backgroundColor: theme.color.border }} />
                        ) : null}
                      </View>
                    );
                  })}
                </Card>
              </View>
            ) : null}

            <View>
              <SectionHeader title={t.expense.whoOwesWhat} />
              <Card padded={false} style={{ paddingHorizontal: theme.spacing.lg }}>
                {ledgerRows.map((row, index) => {
                  const member = lookup.get(row.memberId);
                  // Every person on the bill is a way into their page — the same
                  // push the members list uses, and the member screen reads the
                  // same mirror, so a ghost opens exactly as a joined member
                  // does. A row whose member the mirror cannot resolve (someone
                  // written into an old version and since gone) has nowhere to
                  // land, so it stays a plain row rather than a tap that ends on
                  // "member not found".
                  const memberHref = expenseMemberHref(groupId, row.memberId, Boolean(member));
                  const openMember = memberHref ? () => router.push(memberHref) : undefined;
                  // The words under the name, computed once and given to both the
                  // row and its spoken label — an explicit `accessibilityLabel`
                  // replaces `ListRow`'s default wholesale, so anything only the
                  // subtitle said would otherwise be dropped from the audio.
                  const subtitle =
                    [
                      // Not "not joined yet": on a bill the question is who owes
                      // what, and whether somebody has an account is noise here
                      // (the members list and their own page still say it).
                      // Only for somebody who put money in: their row shows a
                      // net, and without this the two numbers it came from are
                      // nowhere on the screen.
                      row.paid > 0n
                        ? t.expense.paidAndShare
                            .replace('{paid}', format(money(row.paid, currency), { locale }))
                            .replace('{share}', format(money(row.share, currency), { locale }))
                        : null,
                    ]
                      .filter(Boolean)
                      .join(' · ') || undefined;
                  // Making the row one button groups its text, so the amount
                  // `MoneyText` would have spoken on its own has to be said here
                  // — in the same compact form the row prints, so what is heard
                  // and what is seen are the same figure and not "₹500.00" over
                  // a visible "₹500".
                  //
                  // Third person, because the row is about them: "Ravi owes ₹500".
                  // Except on your own row, where the third person would read the
                  // literal "You" back through a sentence built for a name — "You
                  // owes ₹500", and in Tamil, Hindi or Arabic an English word
                  // spliced mid-sentence. That row speaks the second person the
                  // rest of the app already uses for your own money.
                  const spokenAmount = format(money(row.net < 0n ? -row.net : row.net, currency), {
                    locale,
                  });
                  const spokenName = nameOf(row.memberId);
                  const isMe = member ? isViewer(member, viewerId) : false;
                  const spokenBalance = isMe
                    ? moneyAccessibilityLabel(
                        { minor: row.net, currency },
                        balanceDirection(row.net),
                        copyFor(locale).money,
                        { locale },
                      )
                    : row.net > 0n
                      ? fill(t.expense.rowOwed, { name: spokenName, amount: spokenAmount })
                      : row.net < 0n
                        ? fill(t.expense.rowOwes, { name: spokenName, amount: spokenAmount })
                        : fill(t.expense.rowSquare, { name: spokenName });
                  const rowLabel = [spokenBalance, subtitle].filter(Boolean).join('. ');
                  return (
                    <View key={row.memberId}>
                      <ListRow
                        title={nameOf(row.memberId)}
                        quiet
                        onPress={openMember}
                        accessibilityLabel={rowLabel}
                        subtitle={subtitle}
                        subtitleContent={
                          row.paid > 0n ? (
                            <PaidAndShare
                              template={t.expense.paidAndShare}
                              paid={format(money(row.paid, currency), { locale })}
                              share={format(money(row.share, currency), { locale })}
                            />
                          ) : undefined
                        }
                        leading={
                          <MemberAvatar
                            name={avatarNameOf(row.memberId)}
                            photo={member?.profile?.avatar_url}
                            ghost={
                              member
                                ? isGhost(member) || isBlockedMember(member, blockedIds)
                                : false
                            }
                          />
                        }
                        trailing={
                          <MoneyText
                            // What this bill does to them: paid − share.
                            //
                            // This used to be the raw share, forced red, on the
                            // reasoning that every share is money owed. That held only
                            // while one person could pay. On a bill several people put
                            // money into, the biggest contributor was shown in owe-red
                            // for their share — Lokesh paying ₹5,000 of a ₹10,000 bill
                            // and owing ₹2,000 read as "Lokesh owes ₹2,000" when he is
                            // owed ₹3,000.
                            //
                            // The net says it correctly for everyone at once, with no
                            // special case: somebody who paid nothing has a net of
                            // exactly minus their share, which is the same red figure
                            // the row showed before, so the common bill is unchanged.
                            // Sign-derived now (mode="balance") rather than forced —
                            // colour, sign and spoken label agree, the way money reads
                            // everywhere else in the app.
                            amount={row.net}
                            currency={currency}
                            locale={locale}
                            variant="caption"
                            mode={notInvolved ? 'plain' : 'balance'}
                            // Not your bill, not your verdict: an observer sees the
                            // ledger in neutral ink, matching the banner up top.
                            tone={notInvolved ? 'muted' : undefined}
                          />
                        }
                      />
                      {index < ledgerRows.length - 1 ? (
                        <View style={{ height: 1, backgroundColor: theme.color.border }} />
                      ) : null}
                    </View>
                  );
                })}
              </Card>
            </View>

            {/* The thread on this bill. Any member reads and adds; the author edits
            and deletes their own; an admin deletes anyone's and resolves reports.
            The controls the component offers mirror what the RPCs allow. */}
            <View>
              <SectionHeader title={t.comments.title} />
              <Card>
                <ExpenseComments
                  groupId={groupId}
                  expenseId={expense.id}
                  myMemberId={myMemberId}
                  iAmAdmin={iAmAdmin}
                  nameOf={nameOf}
                  avatarNameOf={avatarNameOf}
                  photoOf={(memberId) =>
                    memberId ? (lookup.get(memberId)?.profile?.avatar_url ?? null) : null
                  }
                />
              </Card>
            </View>
          </>
        )}
      </ScrollView>

      <OverflowMenu visible={menuOpen} onClose={() => setMenuOpen(false)} items={menuItems} />

      {/* One fact, changed in place. Keyed by field so each opening seeds
          afresh from the version on screen. */}
      {editingField && inlineEditable ? (
        <ExpenseFieldSheet
          key={editingField}
          field={editingField}
          groupId={groupId}
          expenseId={expense.id}
          version={version}
          members={members.data ?? []}
          viewerId={viewerId}
          myMemberId={myMemberId}
          savedAt={expense.created_at}
          onClose={() => setEditingField(null)}
          onOpenEditor={(focus) => openEditor(focus)}
        />
      ) : null}
    </Screen>
  );
}

/**
 * "paid ₹2,000 · share ₹20,000", with the two figures told apart by colour.
 *
 * The words stay muted; only the amounts are coloured. **Paid** wears the
 * app's "gets money back" colour — putting money in is what earns a refund, so
 * it reads as a credit at a glance, the same hue the row's net takes when they
 * are owed. **Share** wears the brand purple: the person's own part, neutral.
 * Not red — every share would then look like a debt, and the net on the right
 * already says who owes. The template is split on its placeholders, so each
 * language keeps its own word order.
 */
function PaidAndShare({
  template,
  paid,
  share,
}: {
  template: string;
  paid: string;
  share: string;
}): React.JSX.Element {
  const theme = useTheme();
  const parts = template.split(/(\{paid\}|\{share\})/);
  return (
    <>
      {parts.map((part, index) =>
        part === '{paid}' ? (
          <Text
            key={index}
            variant="caption"
            style={{ color: theme.color.positive, fontWeight: '700' }}
          >
            {paid}
          </Text>
        ) : part === '{share}' ? (
          <Text
            key={index}
            variant="caption"
            style={{ color: theme.color.brand, fontWeight: '700' }}
          >
            {share}
          </Text>
        ) : (
          part
        ),
      )}
    </>
  );
}
