/**
 * The capture inbox: expenses caught before they had a group (A34).
 *
 * Each row is a spend the user pinned for later — an amount, maybe a note and a
 * photo of the bill — waiting to be assigned to a group. Assigning opens the
 * ordinary add-expense form prefilled; saving there turns the capture into a
 * real group expense and drops it from this list. Everything here is personal
 * and offline-first: a row still queued wears a faint cloud glyph rather than
 * hiding until the server has seen it (ADR-005). Expenses spoken in one breath
 * fold into a single collapsible "N expenses" row with the running total.
 */

import { useCallback, useMemo, useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { FlashList } from '@shopify/flash-list';
import { randomUUID } from 'expo-crypto';
import {
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  useWindowDimensions,
  View,
} from 'react-native';

import { peopleSignatureKey } from '@waves/core';
import {
  Button,
  directionalIcon,
  Divider,
  EmptyState,
  IconButton,
  iconSize,
  MoneyText,
  Row,
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
import { InboxSkeleton } from '@/components/Skeletons';
import { dayHeading } from '@/data/activity';
import {
  useAddGhostMember,
  useCaptures,
  useCreateGroup,
  useDeleteCapture,
  useGroupPeopleSignatures,
  useGroups,
  useHomeSummary,
  useOneToOneGroupIds,
  usePeopleBalances,
} from '@/data/hooks';
import { groupLabel, GroupType, type CaptureRow } from '@/data/types';
import { plural, useStrings, type UiStrings } from '@/i18n';
import { useAuth } from '@/lib/auth';
import { assignCaptureHref } from '@/lib/captureAssign';
import { foldedCaptureCount } from '@/lib/captureBatch';
import { buildCaptureFeedItems, type CaptureFeedItem } from '@/lib/captureFeed';
import { friendlyError } from '@/lib/errors';
import { router } from '@/lib/navigation';
import { usePullRefresh } from '@/lib/pullRefresh';

/**
 * What the ⋯ overflow sheet is open on: a single capture (add to group / edit /
 * delete) or a whole spoken batch (delete them all). Null when nothing is open.
 */
type CaptureMenu =
  { kind: 'capture'; capture: CaptureRow } | { kind: 'batch'; items: CaptureRow[] } | null;

/**
 * One capture, in the card grammar this screen now speaks (Mobbin: Phantom
 * Recent Activity, Apple Wallet Daily Cash): a leading category glyph — always
 * the category colour, never the bill's thumbnail — the note over a muted place
 * line, and the amount at the trailing edge, all on a soft rounded card.
 *
 * The whole card taps to assign — adding it to a group is the one thing you do
 * with a capture, so it is the card's own gesture, not a control to hunt for. It
 * used to say so on a chip under the title ("Add to a group"), which spent the
 * row's second line restating the one gesture the card has; the line now carries
 * where the spend happened, and carries nothing at all when the spend has no
 * place — an empty line is a title with room, not a row missing something.
 * The quieter things (edit, delete) fold behind a single ⋯ at the trailing edge,
 * which opens the actions sheet; the two used to sit on the row as a pencil and
 * an always-red trash, which crowded the amount and put "delete" a mis-tap from
 * the assign gesture. The ⋯ keeps its own hitbox so the card's tap still
 * assigns. Inside a batch a row is `bare` — no card of its own, since the batch
 * card already frames it — and drops the place (the batch is one outing, one
 * location).
 */
function CaptureListRow({
  capture,
  locale,
  t,
  onAssign,
  onMore,
  hideLocation = false,
  bare = false,
}: {
  capture: CaptureRow;
  locale: string;
  t: UiStrings;
  onAssign: () => void;
  /** Open the row's overflow sheet (add to group, edit, delete). */
  onMore: () => void;
  /** Inside a batch the description IS the line that matters, so the place is
   *  suppressed there — the batch stands for one outing, one location. */
  hideLocation?: boolean;
  /** A row nested in a batch card: no card frame of its own. */
  bare?: boolean;
}): React.JSX.Element {
  const theme = useTheme();
  // The note names the spend; with none, its category does; with neither, it is
  // simply still unassigned. The amount always sits at the trailing edge, so the
  // title never has to carry it.
  const categoryLabel = capture.category
    ? (t.categories as Record<string, string>)[capture.category]
    : undefined;
  const title = capture.description?.trim() || categoryLabel || t.captures.unassigned;
  // Second line: the place it happened, else a note, else nothing. Never the
  // date — the section heading already carries the day. A row inside a batch
  // drops the place; there the description on the title line is the whole point.
  const locationName = hideLocation ? '' : capture.location?.name?.trim() || '';
  const subtitle = locationName || capture.notes?.trim() || '';

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title}, ${t.captures.assign}`}
      // The overflow lives on a control nested inside this row; a nested focusable
      // can hide from a screen reader, so the row exposes it as a custom action
      // instead and the ⋯ itself is taken out of the a11y tree below. Assign stays
      // the row's default activate.
      accessibilityActions={[{ name: 'more', label: t.captures.moreActions }]}
      onAccessibilityAction={(event) => {
        if (event.nativeEvent.actionName === 'more') onMore();
      }}
      onPress={onAssign}
      style={({ pressed }) =>
        bare
          ? { opacity: pressed ? 0.6 : 1 }
          : {
              opacity: pressed ? 0.85 : 1,
              backgroundColor: theme.color.surface,
              borderRadius: theme.radius.lg,
              borderWidth: 1,
              borderColor: theme.color.border,
              paddingHorizontal: theme.spacing.md,
              marginVertical: theme.spacing.xs,
            }
      }
    >
      <Row
        style={{ gap: theme.spacing.md, alignItems: 'center', paddingVertical: theme.spacing.md }}
      >
        <CategoryBadge
          category={capture.category}
          meta={capture.category_meta}
          description={capture.description}
          size={46}
        />

        <View style={{ flex: 1, minWidth: 0, gap: 5 }}>
          <Text variant="subheading" numberOfLines={1}>
            {title}
          </Text>
          {/* Line two is context, not an instruction: where the spend happened,
              and the unsynced mark when the row is still queued. With neither, it
              is absent entirely and the title has the row to itself — the line
              used to be spent on a chip repeating the card's own tap. */}
          {subtitle || capture.pending ? (
            <Row style={{ gap: theme.spacing.xs, alignItems: 'center' }}>
              {locationName ? (
                <Ionicons name="location-outline" size={13} color={theme.color.textFaint} />
              ) : null}
              {subtitle ? (
                <Text variant="micro" tone="muted" numberOfLines={1} style={{ flexShrink: 1 }}>
                  {subtitle}
                </Text>
              ) : null}
              {capture.pending ? <PendingMark /> : null}
            </Row>
          ) : null}
        </View>

        {/* The amount and the ⋯ never shrink (RN's flexShrink is 0 by default),
            so every row's amount ends at the same point — the ⋯ is a fixed width
            and the amount is the item before it. That alignment is free, and the
            76pt minimum this column used to carry bought nothing for it: it only
            reserved blank space to the amount's left, on the very row where the
            title needed it. A long title now ellipses ~60pt later, and a short
            one leaves the gap where a reader expects it, between two columns. */}
        <View style={{ alignItems: 'flex-end' }}>
          <MoneyText
            amount={BigInt(capture.amount)}
            currency={capture.currency}
            locale={locale}
            variant="subheading"
          />
        </View>
        {/* One quiet ⋯ instead of the old pencil-and-red-trash pair: the actions
            that are not "add to group" live behind it, so the row carries the
            amount and a single neutral control rather than three competing marks.
            Its own hitbox for a sighted tap, but hidden from the a11y tree — a
            focusable nested in the accessible row can be unreachable, so screen
            readers reach it through the row's "more" action instead.

            It used to be followed by an empty 18pt slot standing in for the
            batch card's expand chevron, so the two kinds of row shared a right
            edge. That cost every single row 30pt of title width for a blank; the
            batch card now wears its chevron beside its title instead, and both
            trailing slots are simply the ⋯. */}
        <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <IconButton label={t.captures.moreActions} onPress={onMore}>
            <Ionicons name="ellipsis-horizontal" size={iconSize.md} color={theme.color.textMuted} />
          </IconButton>
        </View>
      </Row>
    </Pressable>
  );
}

/**
 * Several expenses spoken in one breath, folded into one collapsible row: a
 * layered glyph, an "N expenses" title over a preview of what they were, and the
 * running total at the trailing edge with a plus to open. Expanding reveals each
 * as a full capture row — still individually assignable and deletable — so the
 * total is the headline and the breakdown is one tap away.
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
        borderRadius: theme.radius.lg,
        borderWidth: 1,
        borderColor: theme.color.border,
        backgroundColor: theme.color.surface,
        overflow: 'hidden',
        marginVertical: theme.spacing.xs,
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
        <Row
          style={{
            gap: theme.spacing.md,
            alignItems: 'center',
            paddingVertical: theme.spacing.md,
            paddingHorizontal: theme.spacing.md,
          }}
        >
          <View
            style={{
              width: 46,
              height: 46,
              borderRadius: 14,
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
                here. The chevron rides beside it (down closed, up open): the
                standard reveal mark, but here rather than at the trailing edge,
                where it forced every standalone row to reserve a blank slot of
                the same width just to keep the two amounts aligned. Vertical
                chevrons carry no handedness, so nothing to mirror in RTL. The
                second line says what the folded row can do, so a person is not
                left guessing whether it assigns whole or item by item. */}
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

          {/* The total, then the ⋯ — the same trailing pair a standalone row
              carries, so a batch total lines up under the single amounts above
              and below it without either kind of row padding itself out. */}
          <View style={{ alignItems: 'flex-end' }}>
            {total !== null ? (
              <MoneyText amount={total} currency={currency} locale={locale} variant="subheading" />
            ) : (
              <Text variant="subheading" tone="muted">
                {plural(locale, items.length, t.captures.batchExpenses)}
              </Text>
            )}
          </View>
          {/* The batch's own ⋯, matching the standalone rows: it opens the sheet
              that can delete the whole batch at once, rather than a standing red
              trash on the card. A nested press for a sighted tap, but hidden from
              the a11y tree (reached through the row's "more" action). */}
          <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            <IconButton label={t.captures.moreActions} onPress={onMoreBatch}>
              <Ionicons
                name="ellipsis-horizontal"
                size={iconSize.md}
                color={theme.color.textMuted}
              />
            </IconButton>
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
                onAssign={() => onAssign(capture)}
                onMore={() => onMore(capture)}
                hideLocation
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

/** Capture inbox route backed by FlashList rows and screen-owned batch expansion state. */
export default function CapturesScreen() {
  const theme = useTheme();
  const { height } = useWindowDimensions();
  const clearance = useTabBarClearance();
  const { t, locale } = useStrings();
  const pull = usePullRefresh();
  const { profile } = useAuth();

  const captures = useCaptures();
  const deleteCapture = useDeleteCapture();
  const groups = useGroups();
  const summary = useHomeSummary(profile?.id ?? null);
  // The people the picker can point a draft at, and the raw material for
  // deciding whether a chosen set of them already share a group. All read from
  // the mirror, so the picker works with no network (ADR-005).
  const people = usePeopleBalances(profile?.id ?? null);
  const oneToOne = useOneToOneGroupIds();
  const signatures = useGroupPeopleSignatures(profile?.id ?? null);
  const createGroup = useCreateGroup();

  // Which capture is being assigned, if any — drives the destination sheet.
  const [assigning, setAssigning] = useState<CaptureRow | null>(null);
  // The id a group made from picked people will take, minted before the create
  // so the ghosts and the expense behind it can already name it — the
  // offline-first pattern the voice review and "add a person" both use. Retired
  // for a fresh one the moment it is spent, so a second new group in the same
  // session is not handed the same id.
  const [newGroupId, setNewGroupId] = useState(() => randomUUID());
  const [newMemberId, setNewMemberId] = useState(() => randomUUID());
  const addGhost = useAddGhostMember(newGroupId);
  // FlashList recycles row components, so batch expansion lives with the screen
  // and is keyed by batch id rather than inside the recycled row instance.
  const [openBatchIds, setOpenBatchIds] = useState<ReadonlySet<string>>(() => new Set());
  // The row's ⋯ overflow: which capture (or which spoken batch) has its actions
  // sheet open, if any. Null when nothing is open.
  const [menu, setMenu] = useState<CaptureMenu>(null);

  // Only groups the viewer still belongs to belong in the picker. Leaving a
  // group sets `left_at`; it does not remove the group row, so a left (or
  // owner-removed) group lingers in the local mirror and `useGroups` still
  // returns it. `membersFor` lists active members only, so a group where the
  // viewer is no longer among them is one they left — never an assignment
  // target for a new expense.
  const assignableGroups = useMemo(
    () =>
      (groups.data ?? []).filter((group) =>
        summary.membersFor(group.id).some((member) => member.profile_id === profile?.id),
      ),
    [groups.data, summary, profile?.id],
  );

  // The people the picker offers, by name. A contact is somebody whose balance
  // with the viewer is explained by a single group (`only_group_id`) that is a
  // true 1:1 — you and them and nobody else. A whole trip is never a person,
  // even when it happens to be the only group you share with someone.
  const peopleChoices = useMemo(() => {
    const byGroup = new Map<string, PersonChoice>();
    for (const row of people.data ?? []) {
      if (!row.only_group_id || !oneToOne.data.has(row.only_group_id)) continue;
      // One entry per 1:1 group — a person has a row per currency, and they all
      // carry the same display name.
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

  // Which row the picker opens with ticked: the group the capture was tagged
  // for at capture time, when it is still one the viewer can assign into. That
  // pre-aim used to be spelled out on the row itself and skip the picker
  // entirely; it is now a suggestion the picker shows and a tap confirms.
  const pickerSelection: DestinationSelection = useMemo(() => {
    const targetId = assigning?.target_group_id;
    return targetId && assignableGroups.some((group) => group.id === targetId)
      ? { kind: 'existing', groupId: targetId }
      : { kind: 'none' };
  }, [assigning?.target_group_id, assignableGroups]);
  // How tall the picker sheet is ever allowed to get. A ceiling, not a height:
  // the sheet hugs its rows and only starts scrolling here. In points off the
  // window rather than the '80%' it used to pass, because a percentage height
  // needs an ancestor with a definite one to resolve against and this card is
  // sized by its own content — points can't be quietly dropped.
  const pickerMaxHeight = height * 0.8;

  const rows = useMemo(() => captures.data ?? [], [captures.data]);
  const feedItems = useMemo(() => buildCaptureFeedItems(rows), [rows]);
  // A spoken batch is one thing waiting, not one per item — fold before counting,
  // so the header total matches the rows on screen.
  const waitingCount = useMemo(() => foldedCaptureCount(rows), [rows]);

  const openAssign = useCallback((capture: CaptureRow): void => {
    setAssigning(capture);
  }, []);

  // Open the draft in the capture form to fix its fields — the same screen that
  // drafted it, now in edit mode. Every value the row carries rides along as a
  // param so the form opens filled in and saving updates the row in place rather
  // than making a second one; `parsed` (which holds the voice-batch id) is
  // preserved so an edited batch item stays part of its batch.
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

  // Shared by the standalone rows and the rows inside a batch, so a capture is
  // deleted the same way wherever it is shown.
  const confirmDelete = useCallback(
    (capture: CaptureRow): void => {
      Alert.alert(t.captures.delete, t.captures.deleteConfirm, [
        { text: t.common.cancel, style: 'cancel' },
        {
          text: t.captures.delete,
          style: 'destructive',
          onPress: () => void deleteCapture.mutateAsync(capture.id),
        },
      ]);
    },
    [deleteCapture, t.captures.delete, t.captures.deleteConfirm, t.common.cancel],
  );

  // Delete every capture in a spoken batch at once, behind one confirm — the
  // trailing trash on the batch card.
  const confirmDeleteBatch = useCallback(
    (items: CaptureRow[]): void => {
      Alert.alert(
        t.captures.deleteBatch,
        plural(locale, items.length, t.captures.deleteBatchConfirm),
        [
          { text: t.common.cancel, style: 'cancel' },
          {
            text: t.captures.delete,
            style: 'destructive',
            onPress: () => {
              for (const item of items) void deleteCapture.mutateAsync(item.id);
            },
          },
        ],
      );
    },
    [
      deleteCapture,
      locale,
      t.captures.delete,
      t.captures.deleteBatch,
      t.captures.deleteBatchConfirm,
      t.common.cancel,
    ],
  );

  const closeAssign = useCallback((): void => setAssigning(null), []);

  // Hand the capture's own values to the add-expense form as prefill, and carry
  // its id so that saving there can close the capture (useAssignCapture). The
  // href is built by the shared helper so the "New group" flow, which routes to
  // the very same form, hands it identical params.
  const assignTo = useCallback(
    (capture: CaptureRow, groupId: string): void => {
      closeAssign();
      router.push(assignCaptureHref(capture, groupId));
    },
    [closeAssign],
  );

  // The People tab, confirmed: this draft is with these people. If they already
  // share a group it is that group's expense — the same assignment a Groups-tab
  // tap makes. If they do not, the group is made here and the draft assigned
  // into it: a lone name is the 1:1 "add a person" case, several is a real
  // group, and both are named after whoever is in them the way WhatsApp does.
  //
  // The create rides the offline queue like every other write (ADR-005), and the
  // ids were minted up front, so the add-expense screen this pushes to can name
  // the group and the members before the server has ever heard of them.
  const assignToPeople = useCallback(
    async (names: string[]): Promise<void> => {
      const capture = assigning;
      if (!capture) return;
      const clean = [...new Set(names.map((name) => name.trim()).filter(Boolean))];
      if (clean.length === 0) return;

      const shared = groupBySignature.get(peopleSignatureKey(clean));
      if (shared) {
        assignTo(capture, shared);
        return;
      }

      const groupId = newGroupId;
      closeAssign();
      try {
        await createGroup.mutateAsync({
          groupId,
          creatorMemberId: newMemberId,
          name: clean.join(', '),
          type: GroupType.Other,
          // The draft's own currency: it is the money actually spent with these
          // people, and a fresh group has nothing better to go on.
          currency: capture.currency,
        });
        for (const name of clean) await addGhost.mutateAsync(name);
      } catch (caught) {
        // With no group to assign into there is nowhere to push, so say why and
        // leave the draft exactly where it was rather than opening a form over a
        // group that was never made.
        Alert.alert(
          t.captures.title,
          friendlyError(caught, t.captures.couldNotSave, 'captures.newPeopleGroup'),
        );
        return;
      }
      // Spent — the next new group needs its own pair of ids.
      setNewGroupId(randomUUID());
      setNewMemberId(randomUUID());
      router.push(assignCaptureHref(capture, groupId));
    },
    [
      addGhost,
      assigning,
      assignTo,
      closeAssign,
      createGroup,
      groupBySignature,
      newGroupId,
      newMemberId,
      t.captures.couldNotSave,
      t.captures.title,
    ],
  );

  const closeMenu = useCallback((): void => setMenu(null), []);
  const openCaptureMenu = useCallback(
    (capture: CaptureRow): void => setMenu({ kind: 'capture', capture }),
    [],
  );
  const openBatchMenu = useCallback(
    (items: CaptureRow[]): void => setMenu({ kind: 'batch', items }),
    [],
  );

  const keyCaptureItem = useCallback((item: CaptureFeedItem): string => {
    switch (item.kind) {
      case 'day':
        return item.key;
      case 'batch':
        return `batch-${item.id}`;
      case 'single':
        return item.capture.id;
    }
  }, []);

  const toggleBatch = useCallback((batchId: string): void => {
    setOpenBatchIds((current) => {
      const next = new Set(current);
      if (next.has(batchId)) next.delete(batchId);
      else next.add(batchId);
      return next;
    });
  }, []);

  const renderCaptureItem = useCallback(
    ({ item }: { item: CaptureFeedItem }) => {
      switch (item.kind) {
        case 'day':
          return (
            <Text
              variant="micro"
              tone="muted"
              style={{
                textTransform: 'uppercase',
                marginTop: theme.spacing.md,
                marginBottom: theme.spacing.xs,
              }}
            >
              {dayHeading(locale, item.createdAt)}
            </Text>
          );
        case 'batch':
          return (
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
          );
        case 'single': {
          const capture = item.capture;
          return (
            <CaptureListRow
              capture={capture}
              locale={locale}
              t={t}
              // Every row opens the picker, pre-aimed or not. It used to skip
              // straight to the group a capture was tagged for, which was fair
              // while a chip on the row named that group; with the chip gone the
              // jump would be unannounced, so the picker opens with that group
              // already ticked and one more tap confirms it.
              onAssign={() => openAssign(capture)}
              onMore={() => openCaptureMenu(capture)}
            />
          );
        }
      }
    },
    [
      locale,
      openAssign,
      openBatchIds,
      openBatchMenu,
      openCaptureMenu,
      t,
      theme.spacing.md,
      theme.spacing.xs,
      toggleBatch,
    ],
  );

  return (
    <Screen edges={['top', 'bottom']}>
      {/* The plain back-plus-centred-title bar every pushed screen wears
          (Friends person, Merge, …), so Drafts reads as one of the family
          rather than its own thing: a back chevron on the left, the title
          optically centred, and a 44pt spacer on the right to balance the back
          button. No leading glyph and no trailing add — starting a capture
          lives on the dashboard, not here. */}
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
          <Text variant="heading" numberOfLines={1}>
            {t.captures.title}
          </Text>
          {/* How many are waiting, right under the title — so the screen answers
              "what is this and how much is here?" before a person reads a row.
              Hidden at zero, where the empty state already says it. */}
          {waitingCount > 0 ? (
            <Text variant="micro" tone="muted" numberOfLines={1}>
              {plural(locale, waitingCount, t.captures.unassignedBody)}
            </Text>
          ) : null}
        </View>
        <View style={{ width: 44 }} />
      </Row>

      {/* One virtualized scroll region for every state, the way `ActivityScreen`
          does it — pull-to-refresh still works while loading or empty, but a
          large draft inbox only mounts the rows near the viewport. */}
      <FlashList
        data={captures.isLoading || rows.length === 0 ? [] : feedItems}
        keyExtractor={keyCaptureItem}
        renderItem={renderCaptureItem}
        getItemType={(item) => item.kind}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          paddingHorizontal: theme.spacing.xl,
          paddingBottom: clearance,
        }}
        refreshControl={
          <RefreshControl
            refreshing={pull.refreshing}
            onRefresh={pull.onRefresh}
            tintColor={theme.color.brand}
          />
        }
        ListEmptyComponent={
          captures.isLoading ? (
            <InboxSkeleton />
          ) : (
            <View style={{ flex: 1, justifyContent: 'center' }}>
              <EmptyState
                title={t.captures.emptyTitle}
                body={t.captures.emptyBody}
                action={
                  <Button label={t.captures.captureCta} onPress={() => router.push('/capture')} />
                }
              />
            </View>
          )
        }
      />

      {/* The group picker, as a sheet over the list rather than a screen away —
          assigning is one tap and one choice, and a whole route for it would be
          a scroll and a back button around a short list.

          A real Modal, not an absolute overlay: the one bottom bar (`AppTabBar`)
          is rendered at the root over the whole stack, so an in-tree overlay
          paints *under* it and the sheet's lower rows hide behind the nav bar.
          A Modal floats above everything, the way the other sheets do. */}
      <Sheet
        visible={assigning !== null}
        onClose={closeAssign}
        padded={false}
        closeLabel={t.common.close}
        style={{
          paddingHorizontal: theme.spacing.xl,
          gap: theme.spacing.md,
          maxHeight: pickerMaxHeight,
        }}
      >
        <Text variant="heading">{t.captures.assignTitle}</Text>

        {/* What is being placed, so the sheet stands on its own over the
                list it hides: the amount and its note beside the capture's own
                glyph. The title says what this sheet is for; a line under this
                repeating "choose where to add this expense" only said it again,
                so the summary is the whole of the preamble now. */}
        {assigning ? (
          <Row style={{ gap: theme.spacing.md, alignItems: 'center' }}>
            <CategoryBadge
              category={assigning.category}
              meta={assigning.category_meta}
              description={assigning.description}
              size={38}
            />
            <View style={{ flex: 1, minWidth: 0 }}>
              <MoneyText
                amount={BigInt(assigning.amount)}
                currency={assigning.currency}
                locale={locale}
                variant="subheading"
              />
              {assigning.description ? (
                <Text variant="caption" tone="muted" numberOfLines={1}>
                  {assigning.description}
                </Text>
              ) : null}
            </View>
          </Row>
        ) : null}

        {/* The same picker the voice review opens, so "where does this go?" is
            one control in the app rather than two that drifted apart — and the
            drafts inbox inherits its People tab, which this screen never had.

            A plain ScrollView, not the FlashList this screen uses everywhere
            else, and the exception is deliberate: FlashList's container is
            `flex: 1` by construction, so it cannot size itself to its rows — it
            needs a height handed down, and a fixed fraction of the window left a
            person with two groups staring at a half-screen of white. The picker
            holds the groups you are in and the people you already share one
            with — a handful, and filtered by its own search once there are more
            — so rendering them all costs nothing, and `flexShrink` lets the
            sheet hug them and only start scrolling at `pickerMaxHeight`. */}
        <ScrollView
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          style={{ flexShrink: 1 }}
        >
          <DestinationPicker
            // Remount per capture, so the tab and any half-made people selection
            // start fresh on each open rather than carrying over from the last.
            key={assigning?.id ?? 'closed'}
            selection={pickerSelection}
            // The sheet's own heading already says what this is; a second
            // "SAVE TO" line under it would only say it again.
            eyebrow={null}
            // Neither pinned default belongs here: a draft already *is*
            // unassigned, and "just me" writes to the personal ledger, which
            // this screen has no path to.
            pinned={[]}
            createRow={{ label: t.captures.assignNew }}
            emptyGroups={t.captures.noGroups}
            // A group with no name of its own reads as its members here, which
            // needs the membership only the home summary holds.
            labelFor={(group) => groupLabel(group, summary.membersFor(group.id), profile?.id)}
            groups={assignableGroups}
            people={peopleChoices}
            t={t}
            onChoose={(choice) => {
              // The Sheet stays mounted through its fade-out, so this can fire a
              // frame after the backdrop cleared `assigning`.
              const capture = assigning;
              if (!capture) return;
              if (choice.kind === 'existing') {
                assignTo(capture, choice.groupId);
              } else if (choice.kind === 'create') {
                // Carry the capture through group creation so new-group can hand
                // it back and finish the assignment.
                closeAssign();
                router.push({ pathname: '/new-group', params: { assignCaptureId: capture.id } });
              }
            }}
            onResolvePeople={(names) => void assignToPeople(names)}
          />
        </ScrollView>
      </Sheet>

      {/* The row's ⋯ overflow, as a small sheet: the actions that are not "add to
          group" (the card's own tap) plus a labelled way to reach it, so the one
          thing a person does with a capture is spelled out and delete no longer
          rides on every row. A real Modal for the same reason the assign sheet is
          one — an in-tree overlay would paint under the root tab bar. */}
      <Sheet
        visible={menu !== null}
        onClose={closeMenu}
        padded={false}
        closeLabel={t.common.close}
        style={{ paddingHorizontal: theme.spacing.xl, gap: theme.spacing.xs }}
      >
        {menu?.kind === 'capture' ? (
          <>
            <Text variant="heading" numberOfLines={1} style={{ marginBottom: theme.spacing.xs }}>
              {menu.capture.description?.trim() ||
                (menu.capture.category
                  ? (t.categories as Record<string, string>)[menu.capture.category]
                  : undefined) ||
                t.captures.unassigned}
            </Text>
            <ActionSheetRow
              icon="people-outline"
              label={t.captures.assign}
              tone="brand"
              onPress={() => {
                const capture = menu.capture;
                setMenu(null);
                openAssign(capture);
              }}
            />
            <Divider />
            <ActionSheetRow
              icon="create-outline"
              label={t.captures.edit}
              onPress={() => {
                const capture = menu.capture;
                setMenu(null);
                openEdit(capture);
              }}
            />
            <Divider />
            <ActionSheetRow
              icon="trash-outline"
              label={t.captures.delete}
              tone="negative"
              onPress={() => {
                const capture = menu.capture;
                setMenu(null);
                confirmDelete(capture);
              }}
            />
          </>
        ) : menu?.kind === 'batch' ? (
          <>
            <Text variant="heading" numberOfLines={1} style={{ marginBottom: theme.spacing.xs }}>
              {plural(locale, menu.items.length, t.captures.batchExpenses)}
            </Text>
            <ActionSheetRow
              icon="trash-outline"
              label={t.captures.deleteBatch}
              tone="negative"
              onPress={() => {
                const items = menu.items;
                setMenu(null);
                confirmDeleteBatch(items);
              }}
            />
          </>
        ) : null}
      </Sheet>
    </Screen>
  );
}
